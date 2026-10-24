import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import type { ObjectStorage } from '@tradutor/core/storage';
import { createTestApp, samples, TestClient } from './test/helpers.js';

/**
 * Critérios de aceite da Fase 2 (docs/roadmap.md, ADR-006): lote preserva estado individual; tamanhos e formatos
 * limitados; acesso indevido negado; upload incompleto ou com falha não fica falsamente concluído.
 * Fluxo de papéis: Diretor envia lotes sem equipe e os direciona; Líder envia direto para a própria equipe;
 * Operadores trabalham com todos os documentos da equipe, sem criar lotes.
 */
const PASSWORD = 'senha-de-teste-123';

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
let build: Awaited<ReturnType<typeof createTestApp>>['build'];
const ids: Record<string, string> = {};
const c: Record<string, TestClient> = {};

async function login(email: string) {
  const client = new TestClient(app);
  const response = await client.post('/api/v1/auth/login', { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return client;
}

const file = (name: string, content: Buffer) => ({ name, size: content.length });
const createBatch = (client: TestClient, files: Array<{ name: string; size: number }>, extra: Record<string, unknown> = {}) =>
  client.request('POST', '/api/v1/batches', { files, ...extra });
const upload = (client: TestClient, documentId: string, content: Buffer) =>
  client.putContent(`/api/v1/documents/${documentId}/content`, content);
const statusOf = async (documentId: string) =>
  (await pool.query<{ status: string; error_code: string | null }>('SELECT status, error_code FROM documents WHERE id = $1', [documentId]))
    .rows[0]!;
const assign = (client: TestClient, batchId: string, teamId: string) => client.post(`/api/v1/batches/${batchId}/assign`, { teamId });

before(async () => {
  ({ app, pool, build, storage } = await createTestApp('phase2'));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  c.director = await login('diretor@exemplo.test');
  for (const name of ['lider', 'lider2', 'op1', 'op2', 'opB', 'fora']) {
    const email = `${name.toLowerCase()}@exemplo.test`;
    assert.equal((await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: name, password: PASSWORD })).status, 202);
    ids[name] = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
    assert.equal((await c.director.post(`/api/v1/users/${ids[name]}/approve`)).status, 200);
  }
  ids.teamA = (await c.director.post('/api/v1/teams', { name: 'Equipe A' })).body.team.id;
  ids.teamB = (await c.director.post('/api/v1/teams', { name: 'Equipe B' })).body.team.id;
  const members: Array<[string, string, string]> = [
    ['teamA', 'lider', 'leader'],
    ['teamA', 'lider2', 'leader'],
    ['teamB', 'lider2', 'leader'],
    ['teamA', 'op1', 'operator'],
    ['teamA', 'op2', 'operator'],
    ['teamB', 'opB', 'operator'],
  ];
  for (const [team, name, role] of members) {
    assert.equal((await c.director.post(`/api/v1/teams/${ids[team]}/members`, { userId: ids[name], role })).status, 201);
  }
  for (const name of ['lider', 'lider2', 'op1', 'op2', 'opB', 'fora']) c[name] = await login(`${name.toLowerCase()}@exemplo.test`);
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('quem envia e para onde vai o lote', () => {
  it('Líder envia direto para a própria equipe; itens inválidos são recusados individualmente', async () => {
    const response = await createBatch(c.lider!, [
      file('contrato.docx', samples.docx()),
      file('scan.pdf', samples.pdf('1')),
      file('foto.JPG', samples.jpeg('1')),
      { name: 'virus.exe', size: 10 },
      { name: 'vazio.png', size: 0 },
      { name: 'enorme.pdf', size: 51 * 1024 * 1024 },
    ]);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.batch.team.id, ids.teamA);
    const docs = response.body.documents as Array<{ id: string; name: string; status: string; errorCode: string | null }>;
    assert.deepEqual(
      docs.map((doc) => [doc.name, doc.status, doc.errorCode]),
      [
        ['contrato.docx', 'awaiting_upload', null],
        ['scan.pdf', 'awaiting_upload', null],
        ['foto.JPG', 'awaiting_upload', null],
        ['virus.exe', 'rejected', 'unsupported_extension'],
        ['vazio.png', 'rejected', 'empty'],
        ['enorme.pdf', 'rejected', 'too_large'],
      ],
    );
    assert.deepEqual(response.body.batch.counts, { total: 6, stored: 0, pending: 3, rejected: 3, cancelled: 0 });
    ids.batch1 = response.body.batch.id;
    for (const doc of docs) ids[doc.name] = doc.id;
  });

  it('Líder de mais de uma equipe escolhe a equipe, e só entre as que lidera', async () => {
    const files = [file('a.pdf', samples.pdf('multi'))];
    assert.equal((await createBatch(c.lider2!, files)).status, 400);
    const toB = await createBatch(c.lider2!, files, { teamId: ids.teamB });
    assert.equal(toB.status, 201);
    assert.equal(toB.body.batch.team.id, ids.teamB);
    assert.equal((await createBatch(c.lider!, files, { teamId: ids.teamB })).status, 404);
  });

  it('Usuário (Operador) envia só para a própria equipe; quem não tem equipe não envia', async () => {
    const files = [file('a.pdf', samples.pdf('op'))];
    const own = await createBatch(c.op1!, files);
    assert.equal(own.status, 201);
    assert.equal(own.body.batch.team.id, ids.teamA);
    assert.equal((await createBatch(c.op1!, files, { teamId: ids.teamB })).status, 404);
    assert.equal((await createBatch(c.fora!, files)).status, 403);
  });

  it('lote do Diretor nasce sem equipe e só o Diretor o vê', async () => {
    assert.equal((await createBatch(c.director!, [file('d.pdf', samples.pdf('d'))], { teamId: ids.teamA })).status, 400);
    const response = await createBatch(c.director!, [file('diretoria.pdf', samples.pdf('dir')), file('anexo.png', samples.png('dir'))]);
    assert.equal(response.status, 201);
    assert.equal(response.body.batch.team, null);
    ids.directorBatch = response.body.batch.id;
    ids['diretoria.pdf'] = response.body.documents[0].id;
    ids['anexo.png'] = response.body.documents[1].id;
    assert.equal((await c.lider!.get(`/api/v1/batches/${ids.directorBatch}`)).status, 404);
    assert.equal((await c.op1!.get(`/api/v1/batches/${ids.directorBatch}`)).status, 404);
    const unassigned = await c.director!.get('/api/v1/batches?unassigned=true');
    assert.deepEqual(
      unassigned.body.items.map((batch: { id: string }) => batch.id),
      [ids.directorBatch],
    );
  });

  it('a mesma Idempotency-Key devolve o mesmo lote', async () => {
    const send = () =>
      c.lider!.raw(
        'POST',
        '/api/v1/batches',
        { 'idempotency-key': 'chave-idempotente-001' },
        { files: [file('a.pdf', samples.pdf('idem'))], protocolOmissionReason: 'Remessa sintética de teste sem protocolo externo.' },
      );
    const first = await send();
    const second = await send();
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200);
    assert.equal(first.json().batch.id, second.json().batch.id);
  });

  it('limita quantidade de arquivos e tamanho total do lote', async () => {
    const tooMany = Array.from({ length: 101 }, (_, index) => ({ name: `f${index}.pdf`, size: 10 }));
    assert.equal((await createBatch(c.lider!, tooMany)).status, 400);
    const tooBig = Array.from({ length: 30 }, (_, index) => ({ name: `g${index}.pdf`, size: 40 * 1024 * 1024 }));
    const response = await createBatch(c.lider!, tooBig);
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('recusa nomes com barras ou caracteres de controle e campos extras', async () => {
    assert.equal((await createBatch(c.lider!, [{ name: '../../etc/passwd.pdf', size: 10 }])).status, 400);
    assert.equal((await createBatch(c.lider!, [{ name: 'a.pdf', size: 1 }], { ownerId: ids.op1 })).status, 400);
  });
});

describe('direcionamento pelo Diretor', () => {
  it('Diretor envia o conteúdo antes de direcionar', async () => {
    assert.equal((await upload(c.director!, ids['diretoria.pdf']!, samples.pdf('dir'))).status, 200);
    assert.equal((await upload(c.director!, ids['anexo.png']!, samples.png('dir'))).status, 200);
  });

  it('só o Diretor direciona', async () => {
    assert.equal((await assign(c.lider!, ids.directorBatch!, ids.teamA!)).status, 404);
    assert.equal((await assign(c.op1!, ids.batch1!, ids.teamB!)).status, 403);
    assert.equal((await assign(c.lider!, ids.batch1!, ids.teamB!)).status, 403);
    assert.equal((await assign(c.director!, ids.directorBatch!, '00000000-0000-4000-8000-000000000000')).status, 404);
  });

  it('ao direcionar, toda a equipe passa a trabalhar com o lote', async () => {
    const response = await assign(c.director!, ids.directorBatch!, ids.teamA!);
    assert.equal(response.status, 200);
    assert.equal(response.body.batch.team.id, ids.teamA);
    for (const name of ['lider', 'op1', 'op2']) {
      assert.equal((await c[name]!.get(`/api/v1/batches/${ids.directorBatch}`)).status, 200, name);
    }
    const download = await c.op2!.raw('GET', `/api/v1/documents/${ids['diretoria.pdf']}/original`);
    assert.equal(download.statusCode, 200);
    assert.deepEqual(download.rawPayload, samples.pdf('dir'));
    assert.equal((await c.opB!.get(`/api/v1/batches/${ids.directorBatch}`)).status, 404);
    assert.equal((await c.director!.get('/api/v1/batches?unassigned=true')).body.items.length, 0);
  });

  it('redirecionar move o acesso para a nova equipe, sem mover objetos', async () => {
    const key = (
      await pool.query<{ object_key: string }>(`SELECT object_key FROM document_versions WHERE document_id = $1`, [ids['diretoria.pdf']])
    ).rows[0]!.object_key;
    assert.ok(key.startsWith(`batches/${ids.directorBatch}/documents/${ids['diretoria.pdf']}/original-`));
    assert.equal((await assign(c.director!, ids.directorBatch!, ids.teamB!)).status, 200);
    assert.equal((await c.op1!.get(`/api/v1/batches/${ids.directorBatch}`)).status, 404);
    assert.equal((await c.opB!.get(`/api/v1/batches/${ids.directorBatch}`)).status, 200);
    assert.equal((await c.opB!.raw('GET', `/api/v1/documents/${ids['diretoria.pdf']}/original`)).statusCode, 200);
    assert.equal(
      (await pool.query('SELECT object_key FROM document_versions WHERE document_id=$1', [ids['diretoria.pdf']])).rows[0].object_key,
      key,
    );
    const audit = await pool.query<{ metadata: { from: string; to: string } }>(
      `SELECT metadata FROM audit_events WHERE action = 'batch.assigned' AND target_id = $1 ORDER BY id`,
      [ids.directorBatch],
    );
    assert.deepEqual(
      audit.rows.map((row) => [row.metadata.from, row.metadata.to]),
      [
        [null, ids.teamA],
        [ids.teamA, ids.teamB],
      ],
    );
  });
});

describe('envio de conteúdo', () => {
  it('armazena o documento só depois de validar e gravar o objeto', async () => {
    const content = samples.docx();
    const response = await upload(c.lider!, ids['contrato.docx']!, content);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.document.status, 'stored');
    assert.equal(response.body.document.format, 'docx');
    const key = (await pool.query('SELECT object_key FROM document_versions WHERE document_id=$1', [ids['contrato.docx']])).rows[0]
      .object_key as string;
    assert.equal((await storage.head(key))?.size, content.length);
  });

  it('não aceita reenvio de documento já armazenado', async () => {
    assert.equal((await upload(c.lider!, ids['contrato.docx']!, samples.docx())).status, 409);
  });

  it('só quem criou o lote envia o conteúdo; operadores da equipe não', async () => {
    assert.equal((await upload(c.op1!, ids['scan.pdf']!, samples.pdf('1'))).status, 403);
    assert.equal((await upload(c.lider2!, ids['scan.pdf']!, samples.pdf('1'))).status, 403);
    assert.equal((await upload(c.opB!, ids['scan.pdf']!, samples.pdf('1'))).status, 404);
    assert.equal((await statusOf(ids['scan.pdf']!)).status, 'awaiting_upload');
  });

  it('recusa conteúdo que não corresponde à extensão, sem gravar objeto', async () => {
    const jpegAsPdf = samples.jpeg('x');
    const batch = await createBatch(c.lider!, [file('falso.pdf', jpegAsPdf)]);
    const id = batch.body.documents[0].id;
    const response = await upload(c.lider!, id, jpegAsPdf);
    assert.equal(response.status, 422);
    assert.equal(response.body.error.details.reason, 'extension_mismatch');
    assert.deepEqual(await statusOf(id), { status: 'rejected', error_code: 'extension_mismatch' });
    assert.equal((await pool.query('SELECT 1 FROM document_versions WHERE document_id = $1', [id])).rowCount, 0);
  });

  it('recusa Office protegido por senha ou legado', async () => {
    const ole = samples.ole();
    const batch = await createBatch(c.lider!, [file('protegido.docx', ole)]);
    const response = await upload(c.lider!, batch.body.documents[0].id, ole);
    assert.equal(response.body.error.details.reason, 'protected_or_legacy');
  });

  it('exige Content-Length igual ao tamanho declarado, sem mudar o estado', async () => {
    const response = await upload(c.lider!, ids['scan.pdf']!, samples.pdf('outro-tamanho!!'));
    assert.equal(response.status, 400);
    assert.equal((await statusOf(ids['scan.pdf']!)).status, 'awaiting_upload');
  });

  it('recusa conteúdo duplicado no mesmo lote', async () => {
    const png = samples.png('dup');
    const batch = await createBatch(c.lider!, [file('a.png', png), file('b.png', png)]);
    const [first, second] = batch.body.documents;
    assert.equal((await upload(c.lider!, first.id, png)).status, 200);
    const response = await upload(c.lider!, second.id, png);
    assert.equal(response.status, 422);
    assert.equal(response.body.error.details.reason, 'duplicate');
    assert.equal(response.body.error.details.duplicateOf, first.id);
  });

  it('falha de armazenamento deixa o item reenviável, nunca concluído', async () => {
    const broken: ObjectStorage = { ...storage, putFile: async () => Promise.reject(new Error('S3 fora do ar')) };
    const brokenApp = await build({ storage: broken });
    try {
      const client = new TestClient(brokenApp);
      client.cookie = c.lider!.cookie;
      const response = await upload(client, ids['scan.pdf']!, samples.pdf('1'));
      assert.equal(response.status, 503);
      assert.equal(response.body.error.details.retryable, true);
      assert.deepEqual(await statusOf(ids['scan.pdf']!), { status: 'upload_failed', error_code: 'storage_unavailable' });
    } finally {
      await brokenApp.close();
    }
    const retry = await upload(c.lider!, ids['scan.pdf']!, samples.pdf('1'));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.document.status, 'stored');
  });

  it('objeto gravado com tamanho divergente não conclui o item', async () => {
    const lying: ObjectStorage = { ...storage, head: async () => ({ size: 1 }) };
    const lyingApp = await build({ storage: lying });
    try {
      const client = new TestClient(lyingApp);
      client.cookie = c.lider!.cookie;
      assert.equal((await upload(client, ids['foto.JPG']!, samples.jpeg('1'))).status, 503);
      assert.equal((await statusOf(ids['foto.JPG']!)).status, 'upload_failed');
    } finally {
      await lyingApp.close();
    }
  });

  it('envio abandonado em "uploading" pode ser retomado depois do prazo', async () => {
    const id = ids['foto.JPG']!;
    await pool.query(`UPDATE documents SET status = 'uploading', upload_started_at = now() WHERE id = $1`, [id]);
    assert.equal((await upload(c.lider!, id, samples.jpeg('1'))).status, 409);
    await pool.query(`UPDATE documents SET upload_started_at = now() - interval '16 minutes' WHERE id = $1`, [id]);
    assert.equal((await upload(c.lider!, id, samples.jpeg('1'))).status, 200);
  });

  it('lote fica concluído quando não resta item pendente', async () => {
    const response = await c.op1!.get(`/api/v1/batches/${ids.batch1}`);
    assert.equal(response.body.batch.status, 'completed');
    assert.deepEqual(response.body.batch.counts, { total: 6, stored: 3, pending: 0, rejected: 3, cancelled: 0 });
  });
});

describe('Operadores trabalham com os documentos da equipe', () => {
  it('todos da equipe veem o lote do Líder; outras equipes e quem é de fora recebem 404', async () => {
    for (const name of ['op1', 'op2', 'lider2']) assert.equal((await c[name]!.get(`/api/v1/batches/${ids.batch1}`)).status, 200, name);
    assert.equal((await c.opB!.get(`/api/v1/batches/${ids.batch1}`)).status, 404);
    assert.equal((await c.fora!.get(`/api/v1/batches/${ids.batch1}`)).status, 404);
    assert.equal((await c.opB!.raw('GET', `/api/v1/documents/${ids['contrato.docx']}/original`)).statusCode, 404);
  });

  it('listagem mostra os lotes de todas as equipes da pessoa', async () => {
    const op1 = await c.op1!.get('/api/v1/batches?limit=100');
    assert.ok(op1.body.items.some((batch: { id: string }) => batch.id === ids.batch1));
    assert.ok(op1.body.items.every((batch: { team: { id: string } | null }) => batch.team?.id === ids.teamA));
    const opB = await c.opB!.get('/api/v1/batches?limit=100');
    assert.ok(opB.body.items.every((batch: { team: { id: string } | null }) => batch.team?.id === ids.teamB));
  });

  it('Operador baixa o original, com auditoria', async () => {
    const response = await c.op1!.raw('GET', `/api/v1/documents/${ids['contrato.docx']}/original`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.rawPayload, samples.docx());
    assert.match(String(response.headers['content-disposition']), /^attachment; filename="contrato.docx"/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    const audit = await pool.query(
      `SELECT 1 FROM audit_events WHERE action = 'document.downloaded' AND target_id = $1 AND actor_user_id = $2`,
      [ids['contrato.docx'], ids.op1],
    );
    assert.equal(audit.rowCount, 1);
  });

  it('quem sai da equipe perde acesso aos lotes dela', async () => {
    assert.equal((await c.director!.request('DELETE', `/api/v1/teams/${ids.teamA}/members/${ids.op1}`)).status, 204);
    assert.equal((await c.op1!.get(`/api/v1/batches/${ids.batch1}`)).status, 404);
    assert.equal((await c.op1!.raw('GET', `/api/v1/documents/${ids['contrato.docx']}/original`)).statusCode, 404);
    assert.equal((await c.director!.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.op1, role: 'operator' })).status, 201);
    assert.equal((await c.op1!.get(`/api/v1/batches/${ids.batch1}`)).status, 200);
  });
});

describe('cancelamento e histórico', () => {
  it('Líder cancela itens pendentes; Operador não; itens armazenados não são cancelados', async () => {
    const batch = await createBatch(c.lider!, [
      file('c1.pdf', samples.pdf('c1')),
      file('c2.pdf', samples.pdf('c2')),
      file('c3.pdf', samples.pdf('c3')),
    ]);
    const [c1, c2, c3] = batch.body.documents;
    assert.equal((await upload(c.lider!, c1.id, samples.pdf('c1'))).status, 200);
    assert.equal((await c.lider!.post(`/api/v1/documents/${c1.id}/cancel`)).status, 409);
    assert.equal((await c.op1!.post(`/api/v1/documents/${c3.id}/cancel`)).status, 403);
    assert.equal((await c.opB!.post(`/api/v1/documents/${c3.id}/cancel`)).status, 404);
    const single = await c.lider!.post(`/api/v1/documents/${c3.id}/cancel`);
    assert.equal(single.status, 200);
    assert.equal(single.body.document.status, 'cancelled');
    assert.equal((await c.op1!.post(`/api/v1/batches/${batch.body.batch.id}/cancel`)).status, 403);
    const cancelled = await c.director!.post(`/api/v1/batches/${batch.body.batch.id}/cancel`);
    assert.deepEqual(cancelled.body, { cancelled: 1 });
    assert.equal((await statusOf(c2.id)).status, 'cancelled');
    assert.equal((await upload(c.lider!, c2.id, samples.pdf('c2'))).status, 409);
  });

  it('filtra por estado, por "meus" e por busca sem acento', async () => {
    await c.lider!.request('POST', '/api/v1/batches', { name: 'Petição inicial', files: [{ name: 'p.pdf', size: 5 }] });
    const open = await c.op2!.get('/api/v1/batches?status=open');
    assert.ok(open.body.items.length > 0);
    assert.ok(open.body.items.every((batch: { status: string }) => batch.status === 'open'));
    const completed = await c.op2!.get('/api/v1/batches?status=completed');
    assert.ok(completed.body.items.every((batch: { status: string }) => batch.status === 'completed'));
    const search = await c.op2!.get('/api/v1/batches?q=peticao');
    assert.deepEqual(
      search.body.items.map((batch: { name: string }) => batch.name),
      ['Petição inicial'],
    );
    const byFile = await c.op2!.get('/api/v1/batches?q=contrato');
    assert.ok(byFile.body.items.some((batch: { id: string }) => batch.id === ids.batch1));
    assert.equal((await c.op2!.get('/api/v1/batches?mine=true')).body.items.length, 0);
    assert.ok((await c.lider!.get('/api/v1/batches?mine=true')).body.items.length > 0);
  });

  it('pagina o histórico sem repetir lotes', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: Array<{ id: string }>; nextCursor: string | null } } = await c.director!.get(
        `/api/v1/batches?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.body.items.map((batch) => batch.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    assert.equal(new Set(seen).size, seen.length);
    const total = await pool.query('SELECT count(*)::int AS n FROM batches');
    assert.equal(seen.length, total.rows[0].n);
  });

  it('auditoria registra o ciclo sem nome de arquivo nem conteúdo', async () => {
    const events = await pool.query<{ action: string; metadata: object }>(
      `SELECT action, metadata FROM audit_events WHERE action LIKE 'batch.%' OR action LIKE 'document.%'`,
    );
    const actions = new Set(events.rows.map((event) => event.action));
    for (const action of [
      'batch.created',
      'batch.assigned',
      'document.stored',
      'document.rejected',
      'document.upload_failed',
      'document.cancelled',
      'batch.cancelled',
      'document.downloaded',
    ]) {
      assert.ok(actions.has(action), `falta ${action}`);
    }
    assert.doesNotMatch(JSON.stringify(events.rows), /contrato\.docx|amostra sintética/);
  });

  it('versões registradas são imutáveis', async () => {
    await assert.rejects(pool.query(`UPDATE document_versions SET size_bytes = 1`), /imutável/);
  });
});
