import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { createS3Storage } from '@tradutor/core/storage';
import { createTestDatabase, testStorageEnv } from '@tradutor/core/testing';
import { renderMaskTemplate } from '@tradutor/core/translation';
import { buildApp, type AppDeps } from '../app.js';
import { loadConfig } from '../config.js';

export { createTestDatabase, testStorageEnv };

const relaxedLimits = { login: { limit: 10_000, windowMs: 60_000 }, signup: { limit: 10_000, windowMs: 60_000 } };

export async function createTestApp(
  name: string,
  options: Omit<Partial<AppDeps>, 'config' | 'pool'> & { env?: Record<string, string> } = {},
) {
  const { url, pool } = await createTestDatabase(name);
  const { env, ...appOptions } = options;
  const config = loadConfig({ DATABASE_URL: url, LOG_LEVEL: 'silent', ...testStorageEnv(name), ...env });
  const storage = createS3Storage(config);
  await storage.ensureReady();
  const build = (overrides: Omit<Partial<AppDeps>, 'config' | 'pool'> = {}) =>
    buildApp({ config, pool, logger: false, rateLimits: relaxedLimits, storage, ...appOptions, ...overrides });
  return { app: await build(), build, pool, config, storage };
}

export interface TestResponse {
  status: number;
  body: any;
  raw: LightMyRequestResponse;
}

/** Cliente HTTP mínimo com "cookie jar" e cabeçalho CSRF. */
export class TestClient {
  cookie: string | undefined;

  constructor(
    private readonly app: FastifyInstance,
    private readonly options: { csrf?: boolean } = {},
  ) {}

  async request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<TestResponse> {
    const headers: Record<string, string> = {};
    if (this.options.csrf !== false) headers['x-csrf-protection'] = '1';
    if (this.cookie) headers.cookie = this.cookie;
    // Fixtures antigas de outras funcionalidades explicitam a ausência de protocolo, sem mudar nomes esperados.
    // Casos negativos do contrato novo usam raw() para preservar o corpo exato enviado.
    if (method === 'POST' && url === '/api/v1/batches' && body && typeof body === 'object' && !Array.isArray(body)) {
      const input = body as Record<string, unknown>;
      body = {
        ...input,
        ...(!('protocol' in input) && !('protocolOmissionReason' in input)
          ? { protocolOmissionReason: 'Remessa sintética de teste sem protocolo externo.' }
          : {}),
        ...(Array.isArray(input.files) && input.files.length >= 20 && !('inspectionMode' in input) ? { inspectionMode: 'all' } : {}),
      };
    }
    const response = await this.app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    const setCookie = response.cookies.find((cookie) => cookie.name === 'sid');
    if (setCookie) this.cookie = setCookie.value ? `sid=${setCookie.value}` : undefined;
    return { status: response.statusCode, body: response.body ? response.json() : undefined, raw: response };
  }

  /** Requisição com cabeçalhos extras e resposta crua (binários, cabeçalhos de download). */
  raw(method: 'GET' | 'POST', url: string, headers: Record<string, string> = {}, payload?: object) {
    return this.app.inject({
      method,
      url,
      headers: { 'x-csrf-protection': '1', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      ...(payload ? { payload } : {}),
    });
  }

  /** Envia conteúdo bruto, como a interface faz no upload. */
  async putContent(
    url: string,
    content: Buffer,
    headers: Record<string, string> = {},
    method: 'PUT' | 'POST' = 'PUT',
  ): Promise<TestResponse> {
    const response = await this.app.inject({
      method,
      url,
      payload: content,
      headers: {
        'content-type': 'application/octet-stream',
        'x-csrf-protection': '1',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
    });
    return { status: response.statusCode, body: response.body ? safeJson(response.body) : undefined, raw: response };
  }

  get = (url: string): Promise<TestResponse> => this.request('GET', url);
  post = (url: string, body: unknown = {}): Promise<TestResponse> => this.request('POST', url, body);
}

const safeJson = (body: string) => {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

/** ZIP mínimo (sem compressão) com as entradas dadas; suficiente para a detecção de DOCX/PPTX. */
export function buildZip(entries: Record<string, string>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(entries).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Amostras sintéticas de cada formato (sem conteúdo real de usuários). */
export const samples = {
  docx: () => buildZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' }),
  pptx: () => buildZip({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p:presentation/>' }),
  pdf: (seed = '') => Buffer.from(`%PDF-1.7\n% amostra sintética ${seed}\n%%EOF\n`),
  png: (seed = '') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png ${seed}`)]),
  jpeg: (seed = '') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpeg ${seed}`)]),
  ole: () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]),
};

/**
 * Cadastra um tradutor juramentado com o modelo de máscara do sistema (ADR-012) e devolve um `conclude` que conclui
 * traduções com ele, numerando em sequência ("0001/ano", livro "001", folha "001", "002"…).
 */
export async function swornTranslator(supervisor: TestClient, name = 'Ana Beatriz Moreira Lima') {
  const created = await supervisor.post('/api/v1/sworn-translators', { name, registration: 'Matrícula JUCESP nº 0000 (fictícia)' });
  if (created.status !== 201) throw new Error(`Tradutor não cadastrado: ${JSON.stringify(created.body)}`);
  const id = created.body.translator.id as string;
  // As máscaras reais chegam por upload; nos testes, o modelo do sistema faz o papel delas.
  const template = await renderMaskTemplate('en');
  const uploaded = await supervisor.putContent(
    `/api/v1/sworn-translators/${id}/masks`,
    template,
    { 'x-file-name': 'mascara.docx' },
    'POST',
  );
  if (uploaded.status !== 201) throw new Error(`Máscara recusada: ${JSON.stringify(uploaded.body)}`);
  const year = new Date().getUTCFullYear();
  let sequence = 0;
  const next = () => {
    sequence += 1;
    return {
      translatorId: id,
      number: `${String(sequence).padStart(4, '0')}/${year}`,
      book: '001',
      sheet: String(sequence).padStart(3, '0'),
    };
  };
  const conclude = async (client: TestClient, job: string, extra: Record<string, unknown> = {}) => {
    await inspectReady(client, job);
    return client.post(`/api/v1/translations/${job}/approve`, { ...next(), ...extra });
  };
  return { id, next, conclude };
}

/**
 * Confirma o checklist das etapas manuais da modalidade (ADR-015) e marca a tradução como pronta, como a pessoa faz
 * na tela. Devolve a resposta do "Pronta".
 */
export async function submitReady(client: TestClient, jobId: string | undefined) {
  const detail = await client.get(`/api/v1/translations/${jobId}`);
  const keys = ((detail.body?.checklist ?? []) as Array<{ key: string }>).map((item) => item.key);
  if (keys.length) await client.request('PUT', `/api/v1/translations/${jobId}/checks`, { keys, checked: true });
  const submitted = await client.post(`/api/v1/translations/${jobId}/submit`);
  // A revisão automática de "Pronta" pode gerar outra revisão; a pessoa confere essa versão antes da conclusão.
  if (submitted.status === 200) await inspectReady(client, jobId);
  return submitted;
}

/** Ação humana explícita nas fixtures de conclusão; nunca altera permissões, checklist ou conteúdo do documento. */
export async function inspectReady(client: TestClient, jobId: string | undefined): Promise<TestResponse> {
  const detail = await client.get(`/api/v1/translations/${jobId}`);
  if (detail.status !== 200 || !detail.body.draft || !['in_review', 'awaiting_approval'].includes(detail.body.translation.status))
    return detail;
  const revision = detail.body.draft.revision as number;
  if (detail.body.translation.reviewLifecycle?.lastInspectionRevision === revision) return detail;
  return client.post(`/api/v1/translations/${jobId}/inspections`, {
    decision: 'approved',
    baseRevision: revision,
    scope: 'all',
    comment: 'Conferência sintética do documento original e da prévia Word nesta revisão.',
  });
}

/**
 * O rascunho de referência dos testes segue o modelo juramentado original, com notas do tradutor. As skills (ADR-015)
 * trocam as notas por marcadores; estes testes ajustam a regra da juramentada como o Supervisor faria.
 */
export async function allowTranslatorNotes(pool: Pool) {
  await pool.query(
    `INSERT INTO translation_profiles (mode, target_language, rules, updated_by)
     SELECT 'sworn', lang, '{"visualElements":"translator_notes"}'::jsonb, u.id
       FROM unnest(ARRAY['en', 'pt']) AS lang, (SELECT id FROM users WHERE org_role = 'director' LIMIT 1) u
     ON CONFLICT (mode, target_language) DO UPDATE SET rules = EXCLUDED.rules`,
  );
}
