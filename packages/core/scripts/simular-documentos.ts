/**
 * Simulação ponta a ponta no sistema local (http://localhost:3000): envia os 18 documentos fictícios de
 * docs/exemplos-simulados/originais, espera o worker traduzir (LibreTranslate + revisão automática), confirma o
 * checklist, marca como pronta, numera as juramentadas com a máscara simulada e a regra de livro e folha, conclui e
 * baixa o Word final. Gera relatorio.json com tempos, correções e problemas.
 *
 * Uso: node --import tsx scripts/simular-documentos.ts  (credenciais em docs/exemplos-simulados/.credenciais-simulacao.json)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlignmentType, Document, Footer, Header, Packer, Paragraph, TextRun } from 'docx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/exemplos-simulados');
const credentials = JSON.parse(await readFile(path.join(ROOT, '.credenciais-simulacao.json'), 'utf8')) as {
  api: string;
  supervisor: string;
  operador: string;
  senha: string;
};

type Mode = 'sworn' | 'certified' | 'technical' | 'simple';
type Lang = 'en' | 'fr' | 'it' | 'es';
const LANGS: Lang[] = ['en', 'fr', 'it', 'es'];
const TYPES: Array<{ file: string; label: string; modes: Mode[] }> = [
  { file: 'certidao-nascimento', label: 'Certidão de nascimento', modes: ['sworn', 'sworn', 'sworn'] },
  { file: 'cin', label: 'CIN (Carteira de Identidade Nacional)', modes: ['sworn', 'sworn', 'sworn'] },
  { file: 'cnh', label: 'CNH', modes: ['sworn', 'sworn', 'sworn'] },
  { file: 'fatura-cartao', label: 'Fatura de cartão', modes: ['simple', 'technical', 'simple'] },
  { file: 'certidao-conselho-medicina', label: 'Certidão do conselho de medicina (CFM)', modes: ['certified', 'certified', 'certified'] },
  { file: 'apostila', label: 'Apostila', modes: ['sworn', 'sworn', 'sworn'] },
];

class Client {
  cookie = '';
  constructor(readonly name: string) {}
  async call(method: string, url: string, body?: unknown, raw?: { data: Buffer; headers: Record<string, string> }) {
    const response = await fetch(`${credentials.api}${url}`, {
      method,
      headers: {
        'x-csrf-protection': '1',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(raw ? { 'content-type': 'application/octet-stream', ...raw.headers } : body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(raw ? { body: raw.data } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = response.headers.get('set-cookie');
    if (set?.startsWith('sid=')) this.cookie = set.split(';')[0]!;
    const type = response.headers.get('content-type') ?? '';
    const payload = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: payload as any, headers: response.headers };
  }
  async ok(method: string, url: string, body?: unknown, raw?: { data: Buffer; headers: Record<string, string> }) {
    const result = await this.call(method, url, body, raw);
    if (result.status >= 300) throw new Error(`${this.name} ${method} ${url} → ${result.status} ${JSON.stringify(result.body).slice(0, 400)}`);
    return result.body;
  }
}

/** Máscara simulada de uma tradutora pública fictícia: timbre, abertura e encerramento com os marcadores do sistema. */
async function simulatedMask() {
  const run = (text: string, options: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text, font: 'Times New Roman', size: options.size ?? 20, bold: options.bold ?? false, ...(options.color ? { color: options.color } : {}) });
  const line = (children: TextRun[], alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT, after = 80) =>
    new Paragraph({ children, alignment, spacing: { after } });
  const document = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              line([run('HELENA DUARTE FICTÍCIA', { bold: true, size: 22 })], AlignmentType.CENTER, 0),
              line([run('Tradutora Pública e Intérprete Comercial (SIMULAÇÃO) – Matrícula JUCEFIC nº 0000-FIC', { size: 16 })], AlignmentType.CENTER, 0),
              line([run('Rua das Traduções, 100 – Vila Esperança/EF – tradutora.ficticia@exemplo.test', { size: 16 })], AlignmentType.CENTER, 120),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [line([run('Máscara simulada para testes – sem validade jurídica', { size: 14, color: '777777' })], AlignmentType.CENTER, 0)],
          }),
        },
        children: [
          line([run('TRADUÇÃO PÚBLICA Nº {{numero}} – LIVRO {{livro}} – FOLHA {{folha}}', { bold: true })], AlignmentType.CENTER),
          line([run('Documento: {{tipo}} ({{titulo_original}})')]),
          line([run('Idiomas: {{idioma_origem}} → {{idioma_destino}}')], AlignmentType.LEFT, 200),
          line([run('{{texto}}')], AlignmentType.JUSTIFIED),
          line([run('Nada mais constava do documento original, que devolvo com esta tradução, conferida e achada conforme.')], AlignmentType.JUSTIFIED, 200),
          line([run('Vila Esperança, {{data}}.')], AlignmentType.RIGHT, 300),
          line([run('{{TRADUTOR}}', { bold: true })], AlignmentType.CENTER, 0),
          line([run('Tradutora Pública e Intérprete Comercial (simulação)', { size: 16 })], AlignmentType.CENTER),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

async function waitReady(client: Client, job: string, timeoutMs = 6 * 60_000) {
  const started = Date.now();
  for (;;) {
    const detail = await client.ok('GET', `/api/v1/translations/${job}`);
    const status = detail.translation.status as string;
    if (status === 'in_review') return { detail, ms: Date.now() - started };
    if (status === 'failed') throw new Error(`processamento falhou: ${detail.translation.failureCode}`);
    if (Date.now() - started > timeoutMs) throw new Error(`tempo esgotado em ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

const supervisor = new Client('supervisor');
const operator = new Client('operador');
await supervisor.ok('POST', '/api/v1/auth/login', { email: credentials.supervisor, password: credentials.senha });
await operator.ok('POST', '/api/v1/auth/login', { email: credentials.operador, password: credentials.senha });
const team = ((await supervisor.ok('GET', '/api/v1/teams')).items as Array<{ id: string; name: string }>).find((item) => item.name === 'Simulação')!;

// Tradutora fictícia com a máscara simulada e a regra de livro e folha (como a da Patricia: 400 folhas por livro).
const existing = ((await supervisor.ok('GET', '/api/v1/sworn-translators')).items as Array<{ id: string; name: string }>).find(
  (item) => item.name === 'Helena Duarte Fictícia',
);
const translatorId =
  existing?.id ??
  (
    await supervisor.ok('POST', '/api/v1/sworn-translators', {
      name: 'Helena Duarte Fictícia',
      registration: 'Matrícula JUCEFIC nº 0000-FIC (simulação)',
      languages: 'Inglês, Francês, Italiano, Espanhol',
      notes: 'Tradutora fictícia criada pela simulação de documentos.',
    })
  ).translator.id;
if (!existing) {
  const mask = await simulatedMask();
  await mkdir(path.join(ROOT, 'mascara'), { recursive: true });
  await writeFile(path.join(ROOT, 'mascara', 'mascara-helena-duarte-ficticia.docx'), mask);
  await supervisor.ok('POST', `/api/v1/sworn-translators/${translatorId}/masks`, undefined, {
    data: mask,
    headers: { 'x-file-name': encodeURIComponent('mascara-helena-duarte-ficticia.docx') },
  });
  await supervisor.ok('PUT', `/api/v1/sworn-translators/${translatorId}/numbering`, {
    scheme: 'book_sheet',
    config: { sheetLimit: 400, recordPages: true, alertRemaining: 20 },
  });
  await supervisor.ok('POST', `/api/v1/sworn-translators/${translatorId}/numbering/books`, { book: '7', nextNumber: 1201 });
}

const report: Array<Record<string, unknown>> = [];
await mkdir(path.join(ROOT, 'traduzidos'), { recursive: true });
let typeIndex = 0;
for (const type of TYPES) {
  for (let example = 0; example < 3; example += 1) {
    const target = LANGS[(typeIndex + example) % LANGS.length]!;
    const mode = type.modes[example]!;
    const file = `${type.file}-${example + 1}.pdf`;
    const entry: Record<string, unknown> = { document: file, type: type.label, mode, target };
    const started = Date.now();
    try {
      const pdf = await readFile(path.join(ROOT, 'originais', file));
      const batch = await operator.ok('POST', '/api/v1/batches', {
        name: `Simulação – ${type.label} ${example + 1}`,
        teamId: team.id,
        tags: ['simulação', type.file],
        mode,
        translation: { sourceLanguage: 'pt', targetLanguage: target },
        files: [{ name: file, size: pdf.length }],
      });
      const documentId = batch.documents[0].id as string;
      await operator.ok('PUT', `/api/v1/documents/${documentId}/content`, undefined, { data: pdf, headers: {} });
      const jobs = await operator.ok('GET', `/api/v1/translations?documentId=${documentId}&limit=5`);
      const job = jobs.items[0].id as string;
      const { detail, ms } = await waitReady(operator, job);
      entry.processingMs = ms;
      entry.machineCorrections = (detail.draft.corrections as Array<{ code: string }>).map((item) => item.code);
      entry.issuesAfterProcessing = (detail.draft.issues as Array<{ severity: string; code: string; message: string }>).map(
        (issue) => `${issue.severity}:${issue.code}`,
      );

      const keys = (detail.checklist as Array<{ key: string }>).map((item) => item.key);
      if (keys.length) await operator.ok('PUT', `/api/v1/translations/${job}/checks`, { keys, checked: true });
      const submitted = await operator.ok('POST', `/api/v1/translations/${job}/submit`);
      entry.issuesAtSubmit = (submitted.draft.issues as Array<{ severity: string; code: string }>).map((issue) => `${issue.severity}:${issue.code}`);

      if (mode === 'sworn') await supervisor.ok('PUT', `/api/v1/translations/${job}/numbering`, { translatorId, pages: 1 });
      let approved = await supervisor.call('POST', `/api/v1/translations/${job}/approve`, {});
      if (approved.status === 409 && approved.body?.error?.details?.issues) {
        entry.approveBlocked = (approved.body.error.details.issues as Array<{ message: string }>).map((issue) => issue.message);
        approved = await supervisor.call('POST', `/api/v1/translations/${job}/approve`, {
          overrideReason: 'Simulação: conferido manualmente, divergência aceita para o teste.',
        });
      }
      if (approved.status !== 200) throw new Error(`conclusão ${approved.status}: ${JSON.stringify(approved.body).slice(0, 300)}`);
      entry.number = approved.body.translation.number;
      const final = await supervisor.call('GET', `/api/v1/translations/${job}/final`);
      const disposition = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(final.headers.get('content-disposition') ?? '')?.[1] ?? `${file}.docx`);
      await writeFile(path.join(ROOT, 'traduzidos', disposition), final.body as Buffer);
      entry.output = disposition;
      entry.totalMs = Date.now() - started;
      entry.ok = true;
    } catch (error) {
      entry.ok = false;
      entry.error = String(error instanceof Error ? error.message : error);
    }
    report.push(entry);
    process.stdout.write(`${entry.ok ? 'ok ' : 'ERRO'} ${file} (${mode}, pt→${target}) ${entry.ok ? `→ ${entry.output}` : entry.error}\n`);
  }
  typeIndex += 1;
}
await writeFile(path.join(ROOT, 'relatorio.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${report.filter((item) => item.ok).length}/${report.length} concluídos\n`);
