import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import JSZip from 'jszip';
import type { ObjectStorage } from '@tradutor/core/storage';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { buildApp } from './app.js';
import type { Config } from './config.js';
import { protocolOutputName, safeArchiveSegment } from './modules/documents/archive.js';
import { createTestApp, samples, TestClient } from './test/helpers.js';

const password = 'protocol-test-password-123';
let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
let config: Config;
let director: TestClient;
let member: TestClient;
let outsider: TestClient;
let ownerId: string;
let teamId: string;
let temp: string;
let batchId: string;
const translationIds: string[] = [];
const documentIds: string[] = [];

before(async () => {
  ({ app, pool, storage, config } = await createTestApp('batch-protocols', { env: { CONVERTER_URL: '' } }));
  temp = await mkdtemp(join(tmpdir(), 'tradutor-protocol-tests-'));
  await bootstrapDirector(pool, { email: 'protocol-director@example.test', displayName: 'Diretor', password });
  director = new TestClient(app);
  assert.equal((await director.post('/api/v1/auth/login', { email: 'protocol-director@example.test', password })).status, 200);
  ownerId = (await pool.query<{ id: string }>("SELECT id FROM users WHERE org_role='director'")).rows[0]!.id;
  teamId = (await director.post('/api/v1/teams', { name: 'Protocolos' })).body.team.id;
  for (const name of ['member', 'outsider']) {
    const email = `protocol-${name}@example.test`;
    assert.equal((await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: name, password })).status, 202);
    const id = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [email])).rows[0]!.id;
    assert.equal((await director.post(`/api/v1/users/${id}/approve`)).status, 200);
    if (name === 'member')
      assert.equal((await director.post(`/api/v1/teams/${teamId}/members`, { userId: id, role: 'operator' })).status, 201);
    const client = new TestClient(app);
    assert.equal((await client.post('/api/v1/auth/login', { email, password })).status, 200);
    if (name === 'member') member = client;
    else outsider = client;
  }
});

after(async () => {
  await app?.close();
  await pool?.end();
  if (temp) await rm(temp, { recursive: true, force: true });
});

const payload = (extra: Record<string, unknown> = {}) => ({
  files: [{ name: 'documento.pdf', size: samples.pdf().length }],
  translation: { sourceLanguage: 'fr', targetLanguage: 'es' },
  mode: 'simple',
  ...extra,
});
const create = (body: Record<string, unknown>) => director.raw('POST', '/api/v1/batches', {}, body);

describe('protocolos obrigatórios e decisão de inspeção auditada', () => {
  it('exige protocolo ou justificativa relevante, valida exclusividade e caracteres seguros', async () => {
    assert.equal((await create(payload())).statusCode, 400);
    assert.equal((await create(payload({ protocolOmissionReason: 'curto' }))).statusCode, 400);
    assert.equal((await create(payload({ protocolOmissionReason: '1234567890123456' }))).statusCode, 400);
    assert.equal((await create(payload({ protocol: '../inseguro' }))).statusCode, 400);
    assert.equal(
      (await create(payload({ protocol: 'ABC-10003', protocolOmissionReason: 'Justificativa não compatível com protocolo.' }))).statusCode,
      400,
    );
  });

  it('guarda a justificativa sem protocolo e registra a explicação na auditoria', async () => {
    const reason = 'Documento recebido presencialmente antes da geração de protocolo.';
    const response = await create(payload({ protocolOmissionReason: reason }));
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().batch.protocol, null);
    assert.equal(response.json().batch.protocolOmissionReason, reason);
    const audit = (
      await pool.query<{ metadata: { protocolOmissionReason: string } }>(
        "SELECT metadata FROM audit_events WHERE action='batch.created' AND target_id=$1",
        [response.json().batch.id],
      )
    ).rows[0]!;
    assert.equal(audit.metadata.protocolOmissionReason, reason);
  });

  it('pergunta a inspeção em remessas grandes e persiste a escolha sem aprovar documentos', async () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ name: `arquivo${i}.pdf`, size: samples.pdf().length }));
    assert.equal((await create(payload({ files, protocol: 'BIG-00001' }))).statusCode, 400);
    const response = await create(payload({ files, protocol: 'BIG-00001', inspectionMode: 'sample' }));
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().batch.inspectionMode, 'sample');
    assert.equal(response.json().batch.inspectionSampleSize, 10);
    assert.equal(
      (
        await pool.query('SELECT 1 FROM translation_jobs j JOIN documents d ON d.id=j.document_id WHERE d.batch_id=$1', [
          response.json().batch.id,
        ])
      ).rowCount,
      0,
    );
  });

  it('mantém nomes extensos e nomes que já têm ordinal seguros e distintos', async () => {
    const names = ['Arquivo.pdf', 'Arquivo.pdf', 'Arquivo (01).pdf', `${'L'.repeat(200)}a.pdf`, `${'L'.repeat(200)}b.pdf`];
    const response = await create(payload({ protocol: 'NOMES-10004', files: names.map((name) => ({ name, size: samples.pdf().length })) }));
    assert.equal(response.statusCode, 201, response.body);
    const outputNames = await Promise.all(
      (response.json().documents as Array<{ id: string }>).map((document, index) =>
        protocolOutputName(pool, document.id, names[index]!.replace(/\.pdf$/, '-ESP.docx')),
      ),
    );
    assert.equal(new Set(outputNames.map((name) => name.toLowerCase())).size, names.length);
    for (const name of outputNames) {
      assert.ok(name.length < 180);
      assert.match(name, /^NOMES-10004 – .*\.docx$/);
    }
  });

  it('localiza a remessa e seus documentos pelo protocolo', async () => {
    const contents = [samples.pdf('primeiro'), samples.pdf('segundo'), samples.pdf('terceiro')];
    const response = await create(
      payload({ protocol: 'ABC-10003', files: contents.map((content) => ({ name: 'Arquivo.pdf', size: content.length })) }),
    );
    assert.equal(response.statusCode, 201, response.body);
    batchId = response.json().batch.id;
    assert.equal((await director.post(`/api/v1/batches/${batchId}/assign`, { teamId })).status, 200);
    for (const [index, document] of (response.json().documents as Array<{ id: string }>).entries()) {
      documentIds.push(document.id);
      assert.equal((await director.putContent(`/api/v1/documents/${document.id}/content`, contents[index]!)).status, 200);
    }
    const batches = await member.get('/api/v1/batches?q=ABC-10003');
    assert.equal(batches.body.items[0].id, batchId);
    const documents = await member.get('/api/v1/documents?q=ABC-10003');
    assert.equal(documents.body.items.length, 3);
    assert.equal(documents.body.items[0].batch.protocol, 'ABC-10003');
    assert.equal((await outsider.get('/api/v1/documents?q=ABC-10003')).body.items.length, 0);
  });
});

describe('nomes estáveis, ZIP íntegro e rastreamento de downloads', () => {
  before(async () => {
    const bytes = samples.docx();
    const file = join(temp, 'final.docx');
    await writeFile(file, bytes);
    for (const documentId of documentIds) {
      const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id=$1', [documentId])).rows[0]!;
      translationIds.push(job.id);
      const key = `protocol-tests/${job.id}/final.docx`;
      await storage.putFile(key, file, bytes.length, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      await pool.query(
        "UPDATE translation_jobs SET status='approved',approved_by=$2,approved_at=now(),output_key=$3,output_size=$4 WHERE id=$1",
        [job.id, ownerId, key, bytes.length],
      );
    }
  });

  it('diferencia documentos com o mesmo nome por identidade e ordem estável', async () => {
    const names = await Promise.all(documentIds.map((id) => protocolOutputName(pool, id, 'Arquivo-ESP.docx')));
    assert.deepEqual(names, ['ABC-10003 – Arquivo-ESP.docx', 'ABC-10003 – Arquivo-ESP (01).docx', 'ABC-10003 – Arquivo-ESP (02).docx']);
    assert.equal(safeArchiveSegment('../../etc\\evil:word'), '_.._etc_evil_word');
    const download = await member.raw('GET', `/api/v1/translations/${translationIds[1]}/final?format=docx&download=true`);
    assert.equal(download.statusCode, 200, download.body);
    assert.match(decodeURIComponent(download.headers['content-disposition'] as string), /ABC-10003.*\(01\)\.docx/);
  });

  it('exporta Word por seleção, organiza pastas e audita cada entrega e o agrupamento', async () => {
    const response = await member.raw(
      'POST',
      '/api/v1/translation-archives',
      {},
      { translationIds: [translationIds[2], translationIds[0], translationIds[1]], format: 'docx' },
    );
    assert.equal(response.statusCode, 200, response.body);
    // Todas do mesmo protocolo: o ZIP leva o protocolo.
    assert.match(decodeURIComponent(String(response.headers['content-disposition'])), /ABC-10003 – Word\.zip/);
    const archive = await JSZip.loadAsync(response.rawPayload);
    const entries = Object.keys(archive.files).filter((path) => !archive.files[path]!.dir);
    assert.equal(entries.length, 3);
    // A referência do nome no ZIP encontra a tradução na busca.
    const reference = /Tradução (\d+)\.docx$/.exec(entries[0]!)![1]!;
    const found = await member.get(`/api/v1/translations?q=${encodeURIComponent(`Tradução ${reference}`)}`);
    assert.deepEqual(
      found.body.items.map((item: { reference: number }) => item.reference),
      [Number(reference)],
    );
    assert.equal(new Set(entries.map((path) => path.toLowerCase())).size, 3);
    for (const path of entries) {
      // Sem número de Tradução Pública: protocolo e a referência sequencial da tradução.
      assert.match(path, /^ABC-10003\/FR-ES\/Word\/ABC-10003 – Tradução \d+\.docx$/);
      assert.ok(!path.split('/').includes('..'));
      assert.deepEqual(await archive.file(path)!.async('nodebuffer'), samples.docx());
    }
    const audits = await pool.query<{ metadata: { delivery: string } }>(
      "SELECT metadata FROM audit_events WHERE action='translation.downloaded' AND target_id=ANY($1::text[])",
      [translationIds],
    );
    assert.equal(audits.rows.filter((row) => row.metadata.delivery === 'zip').length, 3);
    assert.equal((await pool.query("SELECT 1 FROM audit_events WHERE action='translation.archive_downloaded'")).rowCount, 1);
  });

  it('permite a remessa completa e não libera traduções de outra equipe', async () => {
    assert.equal((await member.raw('POST', '/api/v1/translation-archives', {}, { batchId, format: 'docx' })).statusCode, 200);
    assert.equal((await outsider.raw('POST', '/api/v1/translation-archives', {}, { translationIds, format: 'docx' })).statusCode, 404);
    assert.equal((await outsider.raw('POST', '/api/v1/translation-archives', {}, { batchId, format: 'docx' })).statusCode, 404);
    assert.equal(
      (await member.raw('POST', '/api/v1/translation-archives', {}, { batchId, translationIds, format: 'docx' })).statusCode,
      400,
    );
  });

  it('conversor indisponível impede ZIP PDF e não registra downloads parciais', async () => {
    const before = (
      await pool.query<{ total: string }>('SELECT sum(download_count)::text AS total FROM translation_jobs WHERE id=ANY($1::uuid[])', [
        translationIds,
      ])
    ).rows[0]!.total;
    const response = await member.raw('POST', '/api/v1/translation-archives', {}, { batchId, format: 'pdf' });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(
      (
        await pool.query<{ total: string }>('SELECT sum(download_count)::text AS total FROM translation_jobs WHERE id=ANY($1::uuid[])', [
          translationIds,
        ])
      ).rows[0]!.total,
      before,
    );
  });

  it('falhas no fluxo Word individual, PDF e segundo item do ZIP não registram entregas parciais', async () => {
    const outputs = (
      await pool.query<{ id: string; output_key: string }>('SELECT id, output_key FROM translation_jobs WHERE id=ANY($1::uuid[])', [
        translationIds,
      ])
    ).rows;
    let failingKey = outputs.find((row) => row.id === translationIds[0])!.output_key;
    const faultyStorage: ObjectStorage = {
      ...storage,
      async get(key) {
        if (key !== failingKey) return storage.get(key);
        return Readable.from(
          (async function* () {
            yield Buffer.from('PK-partial-stream');
            throw new Error('Falha sintética de armazenamento após o primeiro bloco');
          })(),
        );
      },
    };
    const failureApp = await buildApp({ pool, storage: faultyStorage, logger: false, config });
    const client = new TestClient(failureApp);
    client.cookie = member.cookie;
    const deliveryState = async () =>
      (
        await pool.query<{ id: string; download_count: number; first_downloaded_at: Date | null; last_downloaded_at: Date | null }>(
          'SELECT id, download_count, first_downloaded_at, last_downloaded_at FROM translation_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',
          [translationIds],
        )
      ).rows;
    const before = await deliveryState();
    const auditBefore = (
      await pool.query("SELECT 1 FROM audit_events WHERE action IN ('translation.downloaded','translation.archive_downloaded')")
    ).rowCount;
    try {
      assert.equal((await client.raw('GET', `/api/v1/translations/${translationIds[0]}/final?format=docx&download=true`)).statusCode, 500);
      assert.deepEqual(await deliveryState(), before);
      assert.equal((await client.raw('GET', `/api/v1/translations/${translationIds[0]}/final?format=pdf&download=true`)).statusCode, 500);
      assert.deepEqual(await deliveryState(), before);
      failingKey = outputs.find((row) => row.id === translationIds[1])!.output_key;
      assert.equal((await client.raw('POST', '/api/v1/translation-archives', {}, { translationIds, format: 'docx' })).statusCode, 500);
      assert.deepEqual(await deliveryState(), before);
      assert.equal(
        (await pool.query("SELECT 1 FROM audit_events WHERE action IN ('translation.downloaded','translation.archive_downloaded')"))
          .rowCount,
        auditBefore,
      );
      failingKey = '';
      assert.equal((await client.raw('GET', `/api/v1/translations/${translationIds[0]}/final?format=pdf&download=true`)).statusCode, 503);
      assert.deepEqual(await deliveryState(), before);
    } finally {
      await failureApp.close();
    }
  });

  it('falha na auditoria agrupada do ZIP desfaz todos os contadores e eventos individuais', async () => {
    const deliveryState = async () =>
      (
        await pool.query(
          'SELECT id,download_count,first_downloaded_at,last_downloaded_at,last_activity_at FROM translation_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',
          [translationIds],
        )
      ).rows;
    const before = await deliveryState();
    const auditBefore = (
      await pool.query("SELECT 1 FROM audit_events WHERE action IN ('translation.downloaded','translation.archive_downloaded')")
    ).rowCount;
    await pool.query(`CREATE FUNCTION reject_archive_delivery_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='translation.archive_downloaded' THEN RAISE EXCEPTION 'Falha sintética de auditoria agrupada'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER reject_archive_delivery_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_archive_delivery_test()`);
    try {
      const failed = await member.raw('POST', '/api/v1/translation-archives', {}, { translationIds, format: 'docx' });
      assert.equal(failed.statusCode, 500, failed.body);
      assert.deepEqual(await deliveryState(), before);
      assert.equal(
        (await pool.query("SELECT 1 FROM audit_events WHERE action IN ('translation.downloaded','translation.archive_downloaded')"))
          .rowCount,
        auditBefore,
      );
    } finally {
      await pool.query('DROP TRIGGER reject_archive_delivery_test ON audit_events; DROP FUNCTION reject_archive_delivery_test()');
    }
    assert.equal((await member.raw('POST', '/api/v1/translation-archives', {}, { translationIds, format: 'docx' })).statusCode, 200);
    const after = await deliveryState();
    assert.deepEqual(
      after.map((row) => row.download_count),
      before.map((row) => row.download_count + 1),
    );
  });

  it('exporta todos os PDFs e falha integralmente quando o segundo documento não converte', async () => {
    let requests = 0;
    let failOnSecond = false;
    const converter = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        requests += 1;
        response.writeHead(failOnSecond && requests === 2 ? 503 : 200, { 'content-type': 'application/pdf' });
        response.end(failOnSecond && requests === 2 ? 'Falha sintética de conversão' : samples.pdf('convertido'));
      });
    });
    await new Promise<void>((resolve) => converter.listen(0, '127.0.0.1', resolve));
    const address = converter.address();
    assert.ok(address && typeof address !== 'string');
    const pdfApp = await buildApp({
      pool,
      storage,
      logger: false,
      config: { ...config, CONVERTER_URL: `http://127.0.0.1:${address.port}` },
    });
    const client = new TestClient(pdfApp);
    client.cookie = member.cookie;
    try {
      const response = await client.raw('POST', '/api/v1/translation-archives', {}, { batchId, format: 'pdf' });
      assert.equal(response.statusCode, 200, response.body);
      const archive = await JSZip.loadAsync(response.rawPayload);
      const entries = Object.keys(archive.files).filter((path) => !archive.files[path]!.dir);
      assert.equal(entries.length, 3);
      for (const path of entries) {
        assert.match(path, /^ABC-10003\/FR-ES\/PDF\/.*\.pdf$/);
        assert.deepEqual(await archive.file(path)!.async('nodebuffer'), samples.pdf('convertido'));
      }
      const before = (
        await pool.query<{ total: string }>('SELECT sum(download_count)::text AS total FROM translation_jobs WHERE id=ANY($1::uuid[])', [
          translationIds,
        ])
      ).rows[0]!.total;
      failOnSecond = true;
      requests = 0;
      const failed = await client.raw('POST', '/api/v1/translation-archives', {}, { batchId, format: 'pdf' });
      assert.equal(failed.statusCode, 503, failed.body);
      assert.equal(requests, 2);
      assert.equal(
        (
          await pool.query<{ total: string }>('SELECT sum(download_count)::text AS total FROM translation_jobs WHERE id=ANY($1::uuid[])', [
            translationIds,
          ])
        ).rows[0]!.total,
        before,
      );
    } finally {
      await pdfApp.close();
      await new Promise<void>((resolve, reject) => converter.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('prévia do original não conta download e etiquetas prontas exigem confirmação explícita', async () => {
    const downloadsBefore = (await pool.query("SELECT 1 FROM audit_events WHERE action='document.downloaded'")).rowCount;
    const preview = await member.raw('GET', `/api/v1/documents/${documentIds[0]}/preview`);
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.headers['content-type'], 'application/pdf');
    assert.equal((await pool.query("SELECT 1 FROM audit_events WHERE action='document.downloaded'")).rowCount, downloadsBefore);
    assert.equal((await member.request('PUT', `/api/v1/documents/${documentIds[0]}/tags`, { tags: ['conferido'] })).status, 409);
    assert.equal(
      (await member.request('PUT', `/api/v1/documents/${documentIds[0]}/tags`, { tags: ['conferido'], confirmCompleted: true })).status,
      200,
    );
  });

  it('recusa ZIP se o documento aprovado muda enquanto o conversor prepara os PDFs, sem contabilizar a versão antiga', async () => {
    const changedJob = translationIds[0]!;
    const originalSha = (
      await pool.query<{ output_sha256: Buffer | null }>('SELECT output_sha256 FROM translation_jobs WHERE id=$1', [changedJob])
    ).rows[0]!.output_sha256;
    const deliveryState = async () =>
      (
        await pool.query(
          'SELECT id,download_count,first_downloaded_at,last_downloaded_at FROM translation_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',
          [translationIds],
        )
      ).rows;
    const before = await deliveryState();
    const auditBefore = (
      await pool.query("SELECT 1 FROM audit_events WHERE action IN ('translation.downloaded','translation.archive_downloaded')")
    ).rowCount;
    let converted = 0;
    const converter = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        void (async () => {
          converted += 1;
          if (converted === 1)
            await pool.query('UPDATE translation_jobs SET output_sha256=$2 WHERE id=$1', [changedJob, Buffer.alloc(32, 7)]);
          response.writeHead(200, { 'content-type': 'application/pdf' });
          response.end(samples.pdf('versão preparada anteriormente'));
        })().catch(() => {
          response.writeHead(500);
          response.end('Falha sintética do conversor de teste');
        });
      });
    });
    await new Promise<void>((resolve) => converter.listen(0, '127.0.0.1', resolve));
    const address = converter.address();
    assert.ok(address && typeof address !== 'string');
    const receiptApp = await buildApp({
      pool,
      storage,
      logger: false,
      config: { ...config, CONVERTER_URL: `http://127.0.0.1:${address.port}` },
    });
    const client = new TestClient(receiptApp);
    client.cookie = member.cookie;
    try {
      const response = await client.raw('POST', '/api/v1/translation-archives', {}, { batchId, format: 'pdf' });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().error.details.reason, 'artifact_changed');
      assert.equal(converted, 3);
      assert.deepEqual(await deliveryState(), before);
      assert.equal(
        (await pool.query("SELECT 1 FROM audit_events WHERE action IN ('translation.downloaded','translation.archive_downloaded')"))
          .rowCount,
        auditBefore,
      );
    } finally {
      await receiptApp.close();
      await new Promise<void>((resolve, reject) => converter.close((error) => (error ? reject(error) : resolve())));
      await pool.query('UPDATE translation_jobs SET output_sha256=$2 WHERE id=$1', [changedJob, originalSha]);
    }
  });

  it('metadados de documentos prontos exigem confirmação e atividade muda somente com alteração real', async () => {
    const jobId = translationIds[2]!;
    const documentId = documentIds[2]!;
    await pool.query("UPDATE translation_jobs SET status='awaiting_approval',last_activity_at=now()-interval '1 hour' WHERE id=$1", [
      jobId,
    ]);
    assert.equal((await member.request('PUT', `/api/v1/documents/${documentId}/tags`, { tags: ['revisado'] })).status, 409);
    assert.equal(
      (await member.request('PUT', `/api/v1/documents/${documentId}/tags`, { tags: ['revisado'], confirmCompleted: true })).status,
      200,
    );
    assert.ok(
      (
        await pool.query<{ recent: boolean }>(
          "SELECT last_activity_at>now()-interval '1 minute' AS recent FROM translation_jobs WHERE id=$1",
          [jobId],
        )
      ).rows[0]!.recent,
    );
    const before = (
      await pool.query<{ last_activity_at: Date }>(
        "UPDATE translation_jobs SET last_activity_at=now()-interval '1 hour' WHERE id=$1 RETURNING last_activity_at",
        [jobId],
      )
    ).rows[0]!.last_activity_at;
    assert.equal(
      (await member.request('PUT', `/api/v1/documents/${documentId}/tags`, { tags: ['revisado'], confirmCompleted: true })).status,
      200,
    );
    assert.equal(
      (
        await pool.query<{ last_activity_at: Date }>('SELECT last_activity_at FROM translation_jobs WHERE id=$1', [jobId])
      ).rows[0]!.last_activity_at.getTime(),
      before.getTime(),
    );
    const destination = (await director.post('/api/v1/teams', { name: 'Destino de remessas prontas' })).body.team.id as string;
    assert.equal((await director.post(`/api/v1/batches/${batchId}/assign`, { teamId: destination })).status, 409);
    assert.equal((await member.get(`/api/v1/batches/${batchId}`)).status, 200);
    const outputsBefore = (
      await pool.query(
        'SELECT id,output_key,current_revision,inspection_revision FROM translation_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',
        [translationIds],
      )
    ).rows;
    const redirected = await director.post(`/api/v1/batches/${batchId}/assign`, { teamId: destination, confirmCompleted: true });
    assert.equal(redirected.status, 200, JSON.stringify(redirected.body));
    assert.equal(redirected.body.batch.team.id, destination);
    assert.equal((await member.get(`/api/v1/batches/${batchId}`)).status, 404);
    assert.deepEqual(
      (
        await pool.query(
          'SELECT id,output_key,current_revision,inspection_revision FROM translation_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',
          [translationIds],
        )
      ).rows,
      outputsBefore,
    );
  });
});
