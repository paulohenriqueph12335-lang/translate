import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { before, after, it } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createDocumentService } from './modules/documents/service.js';
import type { AuthenticatedContext } from './modules/context.js';
import { AppError } from './http/errors.js';
import { createTestApp, samples, TestClient } from './test/helpers.js';

let env: Awaited<ReturnType<typeof createTestApp>>;
let client: TestClient;
let ctx: AuthenticatedContext;
let sequence = 0;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const lost = (error: unknown) => error instanceof AppError && error.status === 409;
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const read = async (key: string) => {
  const chunks: Buffer[] = [];
  for await (const chunk of await env.storage.get(key)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};
before(async () => {
  env = await createTestApp('uploadattempts');
  const password = 'upload-concorrente-sintetico-123';
  await bootstrapDirector(env.pool, { email: 'diretor@upload.test', displayName: 'Diretor sintético de upload', password });
  client = new TestClient(env.app);
  assert.equal((await client.post('/api/v1/auth/login', { email: 'diretor@upload.test', password })).status, 200);
  const id = (await env.pool.query("SELECT id FROM users WHERE email='diretor@upload.test'")).rows[0].id as string;
  ctx = {
    actor: { id, status: 'active', orgRole: 'director', memberships: new Map() },
    sessionId: randomUUID(),
    correlationId: 'upload-concurrency-test',
  };
});
after(async () => {
  await env.app.close();
  await env.pool.end();
});
async function createDocument(content: Buffer, documentCategory?: string) {
  const batch = await client.post('/api/v1/batches', {
    protocol: `UP-${String(++sequence).padStart(5, '0')}`,
    mode: 'simple',
    ...(documentCategory ? { documentCategory } : {}),
    useMask: false,
    files: [{ name: 'original.pdf', size: content.length }],
    translation: { sourceLanguage: 'fr', targetLanguage: 'es' },
  });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  return batch.body.documents[0].id as string;
}
async function published(id: string, expected: Buffer) {
  const row = (
    await env.pool.query(
      `SELECT d.status,d.sha256,d.upload_attempt_id,v.object_key,
    encode(v.sha256,'hex') AS version_hash,(SELECT count(*)::int FROM translation_jobs WHERE document_id=d.id) AS jobs
    FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE d.id=$1`,
      [id],
    )
  ).rows[0];
  assert.equal(row.status, 'stored');
  assert.equal(row.upload_attempt_id, null);
  assert.equal(row.sha256.toString('hex'), digest(expected));
  assert.equal(row.version_hash, digest(expected));
  assert.deepEqual(await read(row.object_key), expected);
  assert.equal(row.jobs, 1);
  const events = (
    await env.pool.query(
      `SELECT action FROM audit_events WHERE target_id=$1 AND action IN
    ('document.stored','document.rejected','document.upload_failed') ORDER BY id`,
      [id],
    )
  ).rows;
  assert.deepEqual(
    events.map((e) => e.action),
    ['document.stored'],
  );
  return row.object_key as string;
}

it('envio antigo não sobrescreve o original publicado pela tentativa que o substituiu', async () => {
  const old = samples.pdf('primeira-A'),
    current = samples.pdf('segunda--B');
  assert.equal(old.length, current.length);
  const id = await createDocument(current),
    entered = deferred(),
    release = deferred();
  let oldKey = '';
  const oldStorage = {
    ...env.storage,
    putFile: async (key: string, path: string, size: number, mime: string) => {
      oldKey = key;
      entered.resolve();
      await release.promise;
      await env.storage.putFile(key, path, size, mime);
    },
  };
  const service = createDocumentService({ pool: env.pool, config: env.config, storage: oldStorage });
  const stale = service.uploadContent(ctx, id, Readable.from(old), old.length);
  const staleOutcome = stale.then(
    () => ({ error: null }),
    (error) => ({ error }),
  );
  await entered.promise;
  await env.pool.query("UPDATE documents SET upload_started_at=now()-interval '16 minutes' WHERE id=$1", [id]);
  const normal = createDocumentService({ pool: env.pool, config: env.config, storage: env.storage });
  const response = await normal.uploadContent(ctx, id, Readable.from(current), current.length);
  assert.equal(response.original?.mimeType, 'application/pdf');
  assert.match(response.original!.downloadUrl, /\/original$/);
  assert.equal(JSON.stringify(response).includes('object_key'), false);
  release.resolve();
  assert.ok(lost((await staleOutcome).error));
  const key = await published(id, current);
  assert.notEqual(key, oldKey);
  assert.equal(await env.storage.head(oldKey), null, 'Remove apenas o objeto órfão da tentativa antiga.');
});

it('erro ou rejeição de tentativa abandonada não muda estado nem auditoria da nova tentativa', async () => {
  for (const kind of ['invalid_format', 'interrupted', 'storage_unavailable'] as const) {
    const current = samples.pdf(kind),
      id = await createDocument(current),
      entered = deferred(),
      release = deferred();
    const delayedBody = Readable.from(
      (async function* () {
        entered.resolve();
        await release.promise;
        if (kind === 'interrupted') throw new Error('Fluxo sintético interrompido');
        yield kind === 'invalid_format' ? Buffer.alloc(current.length, 1) : current;
      })(),
    );
    const storage =
      kind === 'storage_unavailable'
        ? {
            ...env.storage,
            putFile: async () => {
              entered.resolve();
              await release.promise;
              throw new Error('Storage sintético fora do ar');
            },
          }
        : env.storage;
    const service = createDocumentService({ pool: env.pool, config: env.config, storage });
    const stale = service.uploadContent(ctx, id, kind === 'storage_unavailable' ? Readable.from(current) : delayedBody, current.length);
    const outcome = stale.then(
      () => ({ error: null }),
      (error) => ({ error }),
    );
    await entered.promise;
    await env.pool.query("UPDATE documents SET upload_started_at=now()-interval '16 minutes' WHERE id=$1", [id]);
    const fresh = createDocumentService({ pool: env.pool, config: env.config, storage: env.storage });
    await fresh.uploadContent(ctx, id, Readable.from(current), current.length);
    release.resolve();
    assert.ok(lost((await outcome).error), kind);
    await published(id, current);
  }
});

it('resposta perdida depois do COMMIT preserva o original vigente e a fila publicada', async () => {
  const content = samples.pdf('commit confirmado, resposta perdida'),
    id = await createDocument(content);
  let loseCommit = true;
  const uncertainPool = {
    query: env.pool.query.bind(env.pool),
    connect: async () => {
      const connection = await env.pool.connect();
      return {
        query: async (...args: unknown[]) => {
          const response = await (connection.query as (...input: unknown[]) => Promise<unknown>).apply(connection, args);
          if (args[0] === 'COMMIT' && loseCommit) {
            loseCommit = false;
            throw new Error('Resposta sintética do COMMIT perdida');
          }
          return response;
        },
        release: () => connection.release(),
      } as unknown as PoolClient;
    },
  } as unknown as Pool;
  const service = createDocumentService({ pool: uncertainPool, config: env.config, storage: env.storage });
  await assert.rejects(service.uploadContent(ctx, id, Readable.from(content), content.length), /COMMIT perdida/);
  await published(id, content);
});

it('expõe contrato de formatos/limites e filtra tipos com metadados sem chaves internas', async () => {
  assert.equal((await new TestClient(env.app).get('/api/v1/document-capabilities')).status, 401);
  const caps = await client.get('/api/v1/document-capabilities');
  assert.equal(caps.status, 200);
  assert.equal(caps.body.contractVersion, 1);
  assert.equal(caps.body.upload.maxFiles, 100);
  assert.equal(caps.body.upload.maxFileBytes, 50 * 1024 * 1024);
  assert.equal(caps.body.upload.maxBatchBytes, 1024 * 1024 * 1024);
  assert.equal(caps.body.upload.staleAttemptSeconds, 900);
  assert.equal(caps.body.formats.length, 5);
  assert.equal(caps.body.classification.catalogUrl, '/api/v1/document-categories');
  const content = samples.pdf('contrato de metadados'),
    id = await createDocument(content, 'contract');
  const other = await createDocument(content, 'invoice');
  let list = await client.get('/api/v1/documents?documentCategory=contract');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((d: { id: string }) => d.id === id));
  assert.equal(
    list.body.items.some((d: { id: string }) => d.id === other),
    false,
  );
  const service = createDocumentService({ pool: env.pool, config: env.config, storage: env.storage });
  await service.uploadContent(ctx, id, Readable.from(content), content.length);
  list = await client.get('/api/v1/documents?documentCategory=contract');
  const document = list.body.items.find((d: { id: string }) => d.id === id);
  assert.equal(document.original.name, 'original.pdf');
  assert.equal(document.original.mimeType, 'application/pdf');
  assert.equal(document.original.size, content.length);
  assert.equal(document.original.downloadUrl, `/api/v1/documents/${id}/original`);
  assert.equal(document.translations[0].documentCategory, 'contract');
  assert.equal(document.translations[0].classificationSource, 'human');
  assert.equal(document.translations[0].sourceLanguage, 'fr');
  assert.equal(document.translations[0].targetLanguage, 'es');
  assert.equal(document.translations[0].inspectionRequired, true);
  assert.equal(document.translations[0].currentRevision, null);
  assert.equal(JSON.stringify(document).includes('object_key'), false);
  assert.equal(JSON.stringify(document).includes('upload_attempt_id'), false);
  assert.equal((await client.get('/api/v1/documents?documentCategory=invalid')).status, 400);
});
