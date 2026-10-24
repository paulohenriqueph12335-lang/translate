import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import type { ObjectStorage } from '@tradutor/core/storage';
import type { Draft } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

const PASSWORD = 'manifesto-sintetico-123';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
let env: Awaited<ReturnType<typeof createTestApp>>;
const ids: Record<string, string> = {};
const clients: Record<string, TestClient> = {};
const blobs = new Map<string, Buffer>();
const reads: string[] = [];
const heads: string[] = [];
let onGet: ((key: string) => Promise<void>) | undefined;
let sequence = 0;
const approved: string[] = [];

const storage: ObjectStorage = {
  ensureReady: async () => undefined,
  isReady: async () => true,
  async putFile(key, file) {
    blobs.set(key, await readFile(file));
  },
  async head(key) {
    heads.push(key);
    return blobs.has(key) ? { size: blobs.get(key)!.length } : null;
  },
  async get(key) {
    reads.push(key);
    const hook = onGet;
    onGet = undefined;
    if (hook) await hook(key);
    const bytes = blobs.get(key);
    if (!bytes) throw new Error('Objeto sintético ausente');
    return Readable.from([bytes]);
  },
  async delete(key) {
    blobs.delete(key);
  },
};

interface Manifest {
  version: number;
  translationId: string;
  revision: number | null;
  formats: Array<{ format: 'docx' | 'pdf'; name: string; mimeType: string; downloadUrl: string }>;
  archive: { endpoint: string; maxDocuments: number; maxFileBytes: number; maxContentBytes: number };
}

async function createBatch(protocol = `MAN-${sequence + 1}`) {
  const id = randomUUID();
  await env.pool.query(
    `INSERT INTO batches(id,team_id,owner_id,name,protocol,declared_bytes,assigned_at,assigned_by,
      source_language,target_language,translation_mode,use_mask)
     VALUES($1,$2,$3,'Envio sintético do manifesto',$4,10000,now(),$5,'fr','es','simple',false)`,
    [id, ids.team, ids.member, protocol, ids.director],
  );
  return id;
}

/** Production approval performs the checklist, current inspection, final DOCX generation and completion guards. */
async function document(options: { batchId?: string; position?: number; approve?: boolean } = {}) {
  const index = ++sequence;
  const batchId = options.batchId ?? (await createBatch());
  const docId = randomUUID();
  const jobId = randomUUID();
  const hash = createHash('sha256').update(`Original francês synthétique ${index}`).digest();
  await env.pool.query(
    `INSERT INTO documents(id,batch_id,position,display_name,declared_extension,declared_size,status,detected_format,sha256,stored_at)
     VALUES($1,$2,$3,'Arquivo.docx','docx',100,'stored','docx',$4,now())`,
    [docId, batchId, options.position ?? 0, hash],
  );
  await env.pool.query(
    `INSERT INTO document_versions(document_id,kind,object_key,format,size_bytes,sha256)
     VALUES($1,'original',$2,'docx',100,$3)`,
    [docId, `private-fixtures/${docId}/original.docx`, hash],
  );
  await env.pool.query(
    `INSERT INTO translation_jobs(id,document_id,source_language,target_language,requested_by,assignee_id,status,
      translation_mode,use_mask,current_revision,source_title,document_type)
     VALUES($1,$2,'fr','es',$3,$3,'in_review','simple',false,1,'ATTESTATION','Declaração sintética')`,
    [jobId, docId, ids.member],
  );
  const draft: Draft = {
    sourceLanguage: 'fr',
    targetLanguage: 'es',
    sourceTitle: 'ATTESTATION',
    documentType: 'Declaración sintética',
    blocks: [
      {
        kind: 'paragraph',
        text: `El presente documento certifica la información ficticia número ${index}.`,
        sourceText: `Le présent document atteste les informations fictives numéro ${index}.`,
        align: 'left',
        bold: false,
        size: 'normal',
        origin: 'human',
      },
    ],
  };
  await env.pool.query(`INSERT INTO translation_drafts(job_id,revision,content,origin,author_id) VALUES($1,1,$2,'human',$3)`, [
    jobId,
    JSON.stringify(draft),
    ids.member,
  ]);
  if (options.approve !== false) {
    const detail = await clients.director!.get(`/api/v1/translations/${jobId}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const checked = await clients.director!.request('PUT', `/api/v1/translations/${jobId}/checks`, {
      keys: (detail.body.checklist as Array<{ key: string }>).map((item) => item.key),
      checked: true,
    });
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    const inspected = await clients.director!.post(`/api/v1/translations/${jobId}/inspections`, {
      baseRevision: 1,
      decision: 'approved',
      scope: 'all',
      comment: 'Comparação sintética do original e do Word desta revisão.',
    });
    assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
    const result = await clients.director!.post(`/api/v1/translations/${jobId}/approve`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.translation.status, 'approved');
  }
  return jobId;
}

before(async () => {
  env = await createTestApp('downloadmanifest', { storage, env: { CONVERTER_URL: '' } });
  await bootstrapDirector(env.pool, { email: 'director@manifest.test', displayName: 'Diretor sintético', password: PASSWORD });
  const director = (
    await env.pool.query<{ id: string; password_hash: string }>(`SELECT id,password_hash FROM users WHERE org_role='director'`)
  ).rows[0]!;
  ids.director = director.id;
  for (const actor of ['member', 'outsider'])
    ids[actor] = (
      await env.pool.query<{ id: string }>(
        `INSERT INTO users(email,display_name,password_hash,status) VALUES($1,$2,$3,'active') RETURNING id`,
        [`${actor}@manifest.test`, `Pessoa sintética ${actor}`, director.password_hash],
      )
    ).rows[0]!.id;
  for (const team of ['team', 'otherTeam'])
    ids[team] = (
      await env.pool.query<{ id: string }>(`INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id`, [
        `Equipe ${team}`,
        ids.director,
      ])
    ).rows[0]!.id;
  await env.pool.query(`INSERT INTO team_memberships(team_id,user_id,role,created_by) VALUES($1,$2,'operator',$5),($3,$4,'operator',$5)`, [
    ids.team,
    ids.member,
    ids.otherTeam,
    ids.outsider,
    ids.director,
  ]);
  for (const actor of ['director', 'member', 'outsider']) {
    clients[actor] = new TestClient(env.app);
    assert.equal((await clients[actor]!.post('/api/v1/auth/login', { email: `${actor}@manifest.test`, password: PASSWORD })).status, 200);
  }
  const batchId = await createBatch('ABC-10003');
  for (let position = 0; position < 3; position++) approved.push(await document({ batchId, position }));
  ids.draft = await document({ approve: false });
  ids.annulled = await document();
  await env.pool.query(
    `UPDATE translation_jobs SET annulled_at=now(),annulled_reason='Anulação sintética previamente autorizada.' WHERE id=$1`,
    [ids.annulled],
  );
  reads.length = 0;
  heads.length = 0;
});

after(async () => {
  await env?.app.close();
  await env?.pool.end();
});

async function manifest(id: string) {
  const response = await clients.member!.get(`/api/v1/translations/${id}/download-manifest`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body as Manifest;
}
const word = (data: Manifest) => data.formats.find((item) => item.format === 'docx')!;
async function state(id: string) {
  const job = (
    await env.pool.query(`SELECT download_count,first_downloaded_at,last_downloaded_at,updated_at FROM translation_jobs WHERE id=$1`, [id])
  ).rows[0];
  const audits = Number((await env.pool.query<{ total: string }>(`SELECT count(*) AS total FROM audit_events`)).rows[0]!.total);
  return { job, audits };
}

describe('manifesto privado de entrega e versão escolhida no salvamento', () => {
  it('apresenta nomes de protocolo com ordinais estáveis e formatos/URLs públicos sem chaves de armazenamento', async () => {
    const expected = ['ABC-10003 – Arquivo - ESP.docx', 'ABC-10003 – Arquivo - ESP (01).docx', 'ABC-10003 – Arquivo - ESP (02).docx'];
    for (const [index, id] of approved.entries()) {
      const data = await manifest(id);
      assert.equal(data.version, 1);
      assert.equal(data.translationId, id);
      assert.equal(data.revision, 1);
      assert.deepEqual(
        data.formats.map((item) => item.format),
        ['docx', 'pdf'],
      );
      assert.equal(word(data).name, expected[index]);
      assert.equal(data.formats[1]!.name, expected[index]!.replace(/\.docx$/, '.pdf'));
      assert.equal(word(data).mimeType, DOCX_TYPE);
      assert.equal(data.formats[1]!.mimeType, 'application/pdf');
      for (const file of data.formats) {
        const url = new URL(file.downloadUrl, 'http://localhost');
        assert.equal(url.pathname, `/api/v1/translations/${id}/final`);
        assert.equal(url.searchParams.get('format'), file.format);
        assert.equal(url.searchParams.get('download'), 'true');
        assert.equal(url.searchParams.get('revision'), '1');
        assert.match(url.searchParams.get('artifact')!, /^[a-f0-9]{64}$/);
        assert.match(url.searchParams.get('version')!, /^[a-f0-9]{64}$/);
      }
      const outputKey = (await env.pool.query<{ output_key: string }>(`SELECT output_key FROM translation_jobs WHERE id=$1`, [id])).rows[0]!
        .output_key;
      assert.ok(!JSON.stringify(data).includes(outputKey));
      assert.ok(!JSON.stringify(data).includes('private-fixtures/'));
      assert.equal(data.archive.endpoint, '/api/v1/translation-archives');
      assert.equal(data.archive.maxDocuments, 100);
    }
    assert.deepEqual(reads, []);
    assert.deepEqual(heads, []);
  });

  it('carregar e atualizar o manifesto não abre binários, não audita download e não altera contadores ou atividade', async () => {
    const id = approved[0]!;
    const before = await state(id);
    const readCount = reads.length;
    const headCount = heads.length;
    const first = await manifest(id);
    for (let i = 0; i < 3; i++) assert.deepEqual(await manifest(id), first);
    assert.deepEqual(await state(id), before);
    assert.equal(reads.length, readCount);
    assert.equal(heads.length, headCount);
    assert.equal(before.job.download_count, 0);
    assert.equal(before.job.first_downloaded_at, null);
  });

  it('exige autenticação e oculta documentos de outra equipe com404, inclusive nos links finais', async () => {
    const id = approved[0]!;
    const snapshot = await state(id);
    const beforeReads = reads.length;
    assert.equal((await new TestClient(env.app).get(`/api/v1/translations/${id}/download-manifest`)).status, 401);
    assert.equal((await clients.outsider!.get(`/api/v1/translations/${id}/download-manifest`)).status, 404);
    assert.equal((await clients.outsider!.get(`/api/v1/translations/${id}/final?format=docx`)).status, 404);
    assert.equal((await clients.member!.get(`/api/v1/translations/${randomUUID()}/download-manifest`)).status, 404);
    assert.equal((await clients.director!.get(`/api/v1/translations/${id}/download-manifest`)).status, 200);
    assert.deepEqual(await state(id), snapshot);
    assert.equal(reads.length, beforeReads);
  });

  it('recusa manifesto e arquivo de rascunho ou documento anulado sem ler armazenamento', async () => {
    const beforeReads = reads.length;
    for (const id of [ids.draft!, ids.annulled!]) {
      const snapshot = await state(id);
      assert.equal((await clients.member!.get(`/api/v1/translations/${id}/download-manifest`)).status, 409);
      assert.equal((await clients.member!.get(`/api/v1/translations/${id}/final?format=docx`)).status, 409);
      assert.deepEqual(await state(id), snapshot);
    }
    assert.equal(reads.length, beforeReads);
  });

  it('recusa revisão, SHA ou token de versão desatualizados antes da leitura e sem contar a tentativa', async () => {
    const id = approved[1]!;
    const data = await manifest(id);
    const snapshot = await state(id);
    const beforeReads = reads.length;
    for (const [parameter, value] of [
      ['revision', '2'],
      ['artifact', '0'.repeat(64)],
      ['version', '0'.repeat(64)],
    ]) {
      const url = new URL(word(data).downloadUrl, 'http://localhost');
      url.searchParams.set(parameter!, value!);
      const response = await clients.member!.get(url.pathname + url.search);
      assert.equal(response.status, 409, JSON.stringify(response.body));
      assert.equal(response.body.error.details.reason, 'artifact_changed');
    }
    assert.deepEqual(await state(id), snapshot);
    assert.equal(reads.length, beforeReads);
  });

  it('entrega a versão anunciada e só então registra o download com formato e revisão corretos', async () => {
    const id = approved[2]!;
    const data = await manifest(id);
    const key = (await env.pool.query<{ output_key: string }>(`SELECT output_key FROM translation_jobs WHERE id=$1`, [id])).rows[0]!
      .output_key;
    const beforeReads = reads.length;
    const result = await clients.member!.raw('GET', word(data).downloadUrl);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.headers['content-type'], DOCX_TYPE);
    assert.ok(decodeURIComponent(String(result.headers['content-disposition'])).includes(word(data).name));
    assert.deepEqual(result.rawPayload, blobs.get(key));
    assert.equal(reads.length, beforeReads + 1);
    const counters = (await state(id)).job;
    assert.equal(counters.download_count, 1);
    assert.ok(counters.first_downloaded_at);
    const audit = (
      await env.pool.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_events WHERE action='translation.downloaded' AND target_id=$1`,
        [id],
      )
    ).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.metadata.format, 'docx');
    assert.equal(audit[0]!.metadata.revision, 1);
    assert.equal(audit[0]!.metadata.delivery, 'single');
  });

  it('revalida o recibo atomicamente se o documento muda depois de abrir o binário', async () => {
    const id = await document();
    const data = await manifest(id);
    const before = await state(id);
    onGet = async (oldKey) => {
      const changed = Buffer.concat([blobs.get(oldKey)!, Buffer.from('different-synthetic-output')]);
      const changedKey = `${oldKey}.new`;
      blobs.set(changedKey, changed);
      await env.pool.query(`UPDATE translation_jobs SET output_key=$2,output_sha256=$3,output_size=$4 WHERE id=$1`, [
        id,
        changedKey,
        createHash('sha256').update(changed).digest(),
        changed.length,
      ]);
    };
    const result = await clients.member!.get(word(data).downloadUrl);
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.error.details.reason, 'artifact_changed');
    const after = await state(id);
    assert.equal(after.job.download_count, before.job.download_count);
    assert.equal(after.job.first_downloaded_at, null);
    assert.equal(after.audits, before.audits);
  });

  it('suporta legado sem SHA ou sem revisão com token opaco válido, sem gerar revision=null', async () => {
    for (const revision of [1, null]) {
      const id = await document();
      await env.pool.query(`UPDATE translation_jobs SET current_revision=$2,output_sha256=NULL WHERE id=$1`, [id, revision]);
      const data = await manifest(id);
      const url = new URL(word(data).downloadUrl, 'http://localhost');
      assert.equal(data.revision, revision);
      assert.equal(url.searchParams.get('artifact'), null);
      assert.equal(url.searchParams.get('revision'), revision === null ? null : '1');
      assert.match(url.searchParams.get('version')!, /^[a-f0-9]{64}$/);
      const response = await clients.member!.raw('GET', word(data).downloadUrl);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal((await state(id)).job.download_count, 1);
    }
  });

  it('atualizar o manifesto após uma reemissão produz outro token mesmo mantendo o número de revisão', async () => {
    const id = await document();
    const previous = await manifest(id);
    const previousUrl = new URL(word(previous).downloadUrl, 'http://localhost');
    const key = (await env.pool.query<{ output_key: string }>(`SELECT output_key FROM translation_jobs WHERE id=$1`, [id])).rows[0]!
      .output_key;
    const changed = Buffer.concat([blobs.get(key)!, Buffer.from('reemission-fixture')]);
    const changedKey = `${key}.reemitted`;
    blobs.set(changedKey, changed);
    await env.pool.query(`UPDATE translation_jobs SET output_key=$2,output_sha256=$3,output_size=$4 WHERE id=$1`, [
      id,
      changedKey,
      createHash('sha256').update(changed).digest(),
      changed.length,
    ]);
    const current = await manifest(id);
    const currentUrl = new URL(word(current).downloadUrl, 'http://localhost');
    assert.equal(current.revision, previous.revision);
    assert.equal(word(current).name, word(previous).name);
    assert.notEqual(currentUrl.searchParams.get('version'), previousUrl.searchParams.get('version'));
    const beforeReads = reads.length;
    assert.equal((await clients.member!.get(word(previous).downloadUrl)).status, 409);
    assert.equal(reads.length, beforeReads);
    assert.equal((await state(id)).job.download_count, 0);
    assert.equal((await clients.member!.raw('GET', word(current).downloadUrl)).statusCode, 200);
    assert.equal((await state(id)).job.download_count, 1);
  });
});
