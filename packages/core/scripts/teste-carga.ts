/**
 * Teste de carga equilibrado no sistema local: sobe a concorrência aos poucos e para antes de forçar a máquina.
 *
 * Fase 1 (API): leituras que a equipe faz o dia todo (lista de traduções, detalhe, glossário, regras, notificações)
 * com 1, 2, 4, 8, 16 e 32 clientes simultâneos, 15 s por degrau e pausa entre degraus. Para quando o p95 passa de
 * 1,5 s, quando mais de 2% das respostas dão erro ou quando algum contêiner passa de 85% de CPU.
 * Fase 2 (fila): lote de documentos simples de uma vez, medindo envio, armazenamento e quanto tempo o worker leva
 * para traduzir tudo (LibreTranslate + revisão automática). As traduções do teste são canceladas no fim.
 *
 * Uso: node --import tsx scripts/teste-carga.ts [documentos=20]
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/exemplos-simulados');
const credentials = JSON.parse(await readFile(path.join(ROOT, '.credenciais-simulacao.json'), 'utf8')) as {
  api: string;
  supervisor: string;
  operador: string;
  senha: string;
};
const DOCUMENTS = Number(process.argv[2] ?? 20);
const STEPS = [1, 2, 4, 8, 16, 32];
const STEP_MS = 15_000;
const PAUSE_MS = 5_000;
const LIMITS = { p95Ms: 1500, errorRate: 0.02, cpu: 85 };

async function login(email: string) {
  const response = await fetch(`${credentials.api}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-protection': '1' },
    body: JSON.stringify({ email, password: credentials.senha }),
  });
  if (!response.ok) throw new Error(`login ${response.status}`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

const call = async (cookie: string, method: string, url: string, body?: unknown, raw?: Buffer) => {
  const response = await fetch(`${credentials.api}${url}`, {
    method,
    headers: {
      cookie,
      'x-csrf-protection': '1',
      ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(raw ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

async function dockerStats() {
  try {
    const { stdout } = await promisify(execFile)('docker', ['stats', '--no-stream', '--format', '{{.Name}};{{.CPUPerc}};{{.MemUsage}}'], {
      timeout: 20_000,
    });
    return stdout
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('tradutor-documental'))
      .map((line) => {
        const [name, cpu, memory] = line.split(';');
        return { name: name!.replace('tradutor-documental-', '').replace(/-1$/, ''), cpu: Number.parseFloat(cpu!), memory: memory!.split(' / ')[0]! };
      });
  } catch {
    return [];
  }
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!);
};

const supervisor = await login(credentials.supervisor);
const operator = await login(credentials.operador);
const sample = (await call(supervisor, 'GET', '/api/v1/translations?limit=30&status=approved')).body.items as Array<{ id: string }>;
const reads = [
  '/api/v1/translations?limit=30',
  '/api/v1/translations?limit=30&status=approved&q=cin',
  ...sample.slice(0, 5).map((item) => `/api/v1/translations/${item.id}`),
  '/api/v1/glossary?sourceLanguage=pt&targetLanguage=en',
  '/api/v1/translation-profiles',
  '/api/v1/notifications?limit=20',
  '/api/v1/translation-facets',
];

// ---------- Fase 1: leituras na API ----------
const phase1: Array<Record<string, unknown>> = [];
let stopReason = 'todos os degraus concluídos dentro dos limites';
for (const clients of STEPS) {
  const latencies: number[] = [];
  let errors = 0;
  const until = Date.now() + STEP_MS;
  const statsDuring = dockerStats();
  await Promise.all(
    Array.from({ length: clients }, async (_, worker) => {
      let index = worker;
      while (Date.now() < until) {
        const url = reads[index % reads.length]!;
        index += 1;
        const started = performance.now();
        try {
          const response = await fetch(`${credentials.api}${url}`, { headers: { cookie: supervisor, 'x-csrf-protection': '1' } });
          await response.arrayBuffer();
          if (!response.ok) errors += 1;
        } catch {
          errors += 1;
        }
        latencies.push(performance.now() - started);
      }
    }),
  );
  const stats = await statsDuring;
  const total = latencies.length;
  const step = {
    clientes: clients,
    requisicoes: total,
    porSegundo: Math.round(total / (STEP_MS / 1000)),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    erros: errors,
    cpu: Object.fromEntries(stats.map((item) => [item.name, item.cpu])),
    memoria: Object.fromEntries(stats.map((item) => [item.name, item.memory])),
  };
  phase1.push(step);
  process.stdout.write(
    `API ${String(clients).padStart(2)} clientes: ${step.porSegundo} req/s, p50 ${step.p50Ms} ms, p95 ${step.p95Ms} ms, p99 ${step.p99Ms} ms, erros ${errors}/${total}, CPU api ${step.cpu.api ?? '?'}% postgres ${step.cpu.postgres ?? '?'}%\n`,
  );
  const hottest = Math.max(0, ...stats.map((item) => item.cpu));
  if (step.p95Ms > LIMITS.p95Ms) stopReason = `p95 passou de ${LIMITS.p95Ms} ms com ${clients} clientes`;
  else if (errors / Math.max(1, total) > LIMITS.errorRate) stopReason = `mais de 2% de erros com ${clients} clientes`;
  else if (hottest > LIMITS.cpu) stopReason = `CPU de um contêiner passou de ${LIMITS.cpu}% com ${clients} clientes`;
  else {
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    continue;
  }
  break;
}
process.stdout.write(`Fase 1 encerrada: ${stopReason}\n`);

// ---------- Fase 2: lote na fila ----------
const team = ((await call(supervisor, 'GET', '/api/v1/teams')).body.items as Array<{ id: string; name: string }>).find(
  (item) => item.name === 'Simulação',
)!;
const pdf = await readFile(path.join(ROOT, 'originais', 'fatura-cartao-1.pdf'));
const files = Array.from({ length: DOCUMENTS }, (_, index) => ({
  name: `carga-${String(index + 1).padStart(3, '0')}.pdf`,
  data: Buffer.concat([pdf, Buffer.from(`\n%carga-${Date.now()}-${index}`)]),
}));
const uploadStarted = performance.now();
const batch = await call(operator, 'POST', '/api/v1/batches', {
  name: `Teste de carga – ${DOCUMENTS} documentos`,
  teamId: team.id,
  tags: ['teste-carga'],
  mode: 'simple',
  translation: { sourceLanguage: 'pt', targetLanguage: 'en' },
  files: files.map((file) => ({ name: file.name, size: file.data.length })),
});
if (batch.status !== 201) throw new Error(`lote ${batch.status}: ${JSON.stringify(batch.body).slice(0, 200)}`);
const documents = batch.body.documents as Array<{ id: string; name: string }>;
// Envio em paralelo de 4 em 4, como um navegador faria.
for (let index = 0; index < documents.length; index += 4) {
  await Promise.all(
    documents.slice(index, index + 4).map(async (doc) => {
      const file = files.find((item) => item.name === doc.name)!;
      const stored = await call(operator, 'PUT', `/api/v1/documents/${doc.id}/content`, undefined, file.data);
      if (stored.status !== 200) throw new Error(`upload ${stored.status}`);
    }),
  );
}
const uploadMs = performance.now() - uploadStarted;
process.stdout.write(`Fase 2: ${DOCUMENTS} documentos enviados e armazenados em ${(uploadMs / 1000).toFixed(1)} s\n`);

const queueStarted = performance.now();
const cpuSamples: Array<Record<string, number>> = [];
let ready = 0;
let failed = 0;
for (;;) {
  const list = await call(operator, 'GET', `/api/v1/translations?batchId=${batch.body.batch.id}&limit=100`);
  const items = list.body.items as Array<{ id: string; status: string }>;
  ready = items.filter((item) => item.status === 'in_review').length;
  failed = items.filter((item) => item.status === 'failed').length;
  const stats = await dockerStats();
  cpuSamples.push(Object.fromEntries(stats.map((item) => [item.name, item.cpu])));
  process.stdout.write(`  fila: ${ready}/${DOCUMENTS} prontos, ${failed} falhas, ${((performance.now() - queueStarted) / 1000).toFixed(0)} s\r`);
  if (ready + failed >= DOCUMENTS || performance.now() - queueStarted > 20 * 60_000) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
const queueMs = performance.now() - queueStarted;
const average = (name: string) =>
  Math.round(cpuSamples.reduce((sum, sample) => sum + (sample[name] ?? 0), 0) / Math.max(1, cpuSamples.length));
const phase2 = {
  documentos: DOCUMENTS,
  envioSegundos: Number((uploadMs / 1000).toFixed(1)),
  filaSegundos: Number((queueMs / 1000).toFixed(1)),
  porDocumentoSegundos: Number((queueMs / 1000 / DOCUMENTS).toFixed(1)),
  documentosPorHora: Math.round((DOCUMENTS / queueMs) * 3_600_000),
  prontos: ready,
  falhas: failed,
  cpuMedia: { worker: average('worker'), translator: average('translator'), api: average('api'), postgres: average('postgres') },
};
process.stdout.write(
  `\nFase 2: fila de ${DOCUMENTS} em ${phase2.filaSegundos} s (${phase2.porDocumentoSegundos} s/documento, ~${phase2.documentosPorHora}/hora com 1 worker), ${failed} falhas; CPU média worker ${phase2.cpuMedia.worker}% translator ${phase2.cpuMedia.translator}%\n`,
);

// Limpeza: as traduções do teste saem da lista de trabalho.
const created = (await call(operator, 'GET', `/api/v1/translations?batchId=${batch.body.batch.id}&limit=100`)).body.items as Array<{ id: string }>;
for (const item of created) await call(supervisor, 'POST', `/api/v1/translations/${item.id}/cancel`);

await writeFile(
  path.join(ROOT, 'teste-carga.json'),
  JSON.stringify({ quando: new Date().toISOString(), limites: LIMITS, fase1: { degraus: phase1, parada: stopReason }, fase2: phase2 }, null, 2),
);
process.stdout.write('Resultado em docs/exemplos-simulados/teste-carga.json\n');
