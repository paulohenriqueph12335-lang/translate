import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createPerformanceDashboards } from './modules/dashboards/performance.js';
import type { AuthenticatedContext } from './modules/context.js';
import { createTestApp, TestClient } from './test/helpers.js';

const PASSWORD = 'desempenho-sintetico-123';
const PERIOD = 'from=2026-06-01&to=2026-06-30';
let env: Awaited<ReturnType<typeof createTestApp>>;
const ids: Record<string, string> = {};
const clients: Record<string, TestClient> = {};
let sequence = 0;

interface JobFixture {
  team?: string;
  owner?: string;
  assignee?: string | null;
  requester?: string;
  status?: 'approved' | 'in_review' | 'failed' | 'queued';
  source?: string;
  target?: string;
  mode?: 'simple' | 'certified' | 'technical';
  created?: string;
  approved?: string;
  updated?: string;
  redo?: number;
  override?: string;
  downloaded?: string;
  consecutiveRejections?: number;
}

/** Report fixtures seed complete metadata, immutable drafts and current inspections; completion constraints remain active. */
async function job(input: JobFixture = {}) {
  const index = ++sequence;
  const team = input.team ?? ids.teamA!;
  const owner = input.owner ?? ids.leader!;
  const assignee = input.assignee === undefined ? ids.operator! : input.assignee;
  const status = input.status ?? 'approved';
  const source = input.source ?? 'fr';
  const target = input.target ?? 'es';
  const mode = input.mode ?? 'simple';
  const created = input.created ?? '2026-06-10T08:00:00Z';
  const approved = status === 'approved' ? (input.approved ?? '2026-06-11T08:00:00Z') : null;
  const updated = input.updated ?? approved ?? created;
  const hasDraft = status === 'approved' || status === 'in_review';
  const batchId = randomUUID();
  const documentId = randomUUID();
  const jobId = randomUUID();
  const hash = createHash('sha256').update(`performance-fixture-${index}`).digest();
  await env.pool.query(
    `INSERT INTO batches(id,team_id,owner_id,name,declared_bytes,protocol,assigned_at,assigned_by,created_at,
      source_language,target_language,translation_mode,use_mask)
     VALUES($1,$2,$3,$4,100,$5,$6,$7,$6,$8,$9,$10,false)`,
    [
      batchId,
      team,
      owner,
      `Envio de desempenho ${index}`,
      `PERF-${index.toString().padStart(5, '0')}`,
      created,
      ids.director,
      source,
      target,
      mode,
    ],
  );
  await env.pool.query(
    `INSERT INTO documents(id,batch_id,position,display_name,declared_extension,declared_size,status,detected_format,sha256,stored_at,updated_at)
     VALUES($1,$2,0,$3,'docx',100,'stored','docx',$4,$5,$5)`,
    [documentId, batchId, `Documento sintético ${index}.docx`, hash, created],
  );
  await env.pool.query(
    `INSERT INTO document_versions(document_id,kind,object_key,format,size_bytes,sha256,created_at)
     VALUES($1,'original',$2,'docx',100,$3,$4)`,
    [documentId, `performance-fixtures/${index}/original.docx`, hash, created],
  );
  await env.pool.query(
    `INSERT INTO translation_jobs(id,document_id,source_language,target_language,requested_by,assignee_id,status,
      created_at,updated_at,translation_mode,use_mask,current_revision,inspection_revision,approved_by,approved_at,
      output_key,output_sha256,output_size,failure_code,redo_count,approval_override_reason,first_downloaded_at,
      last_downloaded_at,download_count,consecutive_rejections)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21,$22,$23)`,
    [
      jobId,
      documentId,
      source,
      target,
      input.requester ?? owner,
      assignee,
      status,
      created,
      updated,
      mode,
      hasDraft ? 1 : null,
      status === 'approved' ? 1 : null,
      status === 'approved' ? ids.director : null,
      approved,
      status === 'approved' ? `performance-fixtures/${index}/final.docx` : null,
      status === 'approved' ? hash : null,
      status === 'approved' ? 100 : null,
      status === 'failed' ? 'processing_error' : null,
      input.redo ?? 0,
      input.override ?? null,
      input.downloaded ?? null,
      input.downloaded ? 1 : 0,
      input.consecutiveRejections ?? 0,
    ],
  );
  if (hasDraft) await draft(jobId, 1, source, target, created);
  if (approved)
    await env.pool.query(
      `INSERT INTO translation_inspections(job_id,revision,format_generation,decision,inspected_by,inspected_at)
       VALUES($1,1,1,'approved',$2,$3)`,
      [jobId, ids.director, approved],
    );
  return jobId;
}

async function draft(jobId: string, revision: number, source = 'fr', target = 'es', created = '2026-06-15T08:00:00Z') {
  const content = {
    sourceLanguage: source,
    targetLanguage: target,
    documentType: 'Documento sintético de relatório',
    sourceTitle: 'DOCUMENTO SINTÉTICO',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Conteúdo fictício para indicadores.',
        sourceText: null,
        align: 'left',
        bold: false,
        size: 'normal',
        origin: 'human',
      },
    ],
  };
  await env.pool.query(
    `INSERT INTO translation_drafts(job_id,revision,content,origin,author_id,created_at) VALUES($1,$2,$3,'human',$4,$5)`,
    [jobId, revision, JSON.stringify(content), ids.director, created],
  );
}

before(async () => {
  env = await createTestApp('performanceupgrade');
  await bootstrapDirector(env.pool, { email: 'director@performance.test', displayName: 'Diretor sintético', password: PASSWORD });
  const director = (
    await env.pool.query<{ id: string; password_hash: string }>(`SELECT id,password_hash FROM users WHERE org_role='director'`)
  ).rows[0]!;
  ids.director = director.id;
  for (const role of ['leader', 'operator', 'peer', 'empty']) {
    ids[role] = (
      await env.pool.query<{ id: string }>(
        `INSERT INTO users(email,display_name,password_hash,status) VALUES($1,$2,$3,'active') RETURNING id`,
        [`${role}@performance.test`, `Pessoa sintética ${role}`, director.password_hash],
      )
    ).rows[0]!.id;
  }
  for (const team of ['A', 'B'])
    ids[`team${team}`] = (
      await env.pool.query<{ id: string }>(`INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id`, [
        `Equipe ${team}`,
        ids.director,
      ])
    ).rows[0]!.id;
  await env.pool.query(
    `INSERT INTO team_memberships(team_id,user_id,role,created_by) VALUES
     ($1,$3,'leader',$6),($1,$4,'operator',$6),($1,$5,'operator',$6),($2,$4,'operator',$6)`,
    [ids.teamA, ids.teamB, ids.leader, ids.operator, ids.peer, ids.director],
  );
  for (const actor of ['director', 'leader', 'operator', 'peer', 'empty']) {
    clients[actor] = new TestClient(env.app);
    const login = await clients[actor]!.post('/api/v1/auth/login', { email: `${actor}@performance.test`, password: PASSWORD });
    assert.equal(login.status, 200, JSON.stringify(login.body));
  }

  for (let i = 0; i < 105; i++) await job(i === 0 ? { downloaded: '2026-06-11T09:00:00Z' } : {});
  ids.both = await job({ redo: 2, override: 'Exceção documentada na revisão', approved: '2026-06-12T08:00:00Z' });
  ids.override = await job({ override: 'Exceção sem devolução', approved: '2026-06-13T08:00:00Z' });
  ids.redo = await job({ redo: 1, approved: '2026-06-14T08:00:00Z' });
  ids.blocked = await job({ status: 'in_review', created: '2026-06-15T08:00:00Z', redo: 3, consecutiveRejections: 3 });
  await draft(ids.blocked, 2);
  await draft(ids.blocked, 3);
  await env.pool.query(`UPDATE translation_jobs SET current_revision=3,failed_stages=ARRAY['correction'] WHERE id=$1`, [ids.blocked]);
  for (const [index, stages] of [['translation', 'layout'], ['layout', 'review'], ['correction']].entries())
    await env.pool.query(
      `INSERT INTO translation_inspections(job_id,revision,format_generation,decision,failed_stages,comment,inspected_by,inspected_at)
       VALUES($1,$2,1,'rejected',$3,'Falhas sintéticas apontadas na comparação',$4,$5)`,
      [ids.blocked, index + 1, stages, ids.operator, `2026-06-15T${12 + index}:00:00Z`],
    );
  ids.technicalFailure = await job({ status: 'failed', created: '2026-06-16T08:00:00Z', updated: '2026-06-17T08:00:00Z' });
  ids.future = await job({ status: 'queued', created: '2026-07-05T08:00:00Z' });
  ids.carryIn = await job({ created: '2026-05-20T08:00:00Z', approved: '2026-06-15T08:00:00Z' });
  ids.lastDay = await job({ created: '2026-06-30T23:59:59Z', approved: '2026-07-01T00:00:00Z' });
  ids.outside = await job({ created: '2026-05-20T08:00:00Z', approved: '2026-05-25T08:00:00Z' });
  ids.teamBJob = await job({
    team: ids.teamB!,
    source: 'en',
    target: 'pt',
    mode: 'certified',
    created: '2026-06-20T08:00:00Z',
    approved: '2026-06-20T12:00:00Z',
  });
  ids.technicalMode = await job({ mode: 'technical', created: '2026-06-22T08:00:00Z', approved: '2026-06-22T12:00:00Z' });
  ids.otherPair = await job({ target: 'it', created: '2026-06-23T08:00:00Z', approved: '2026-06-23T12:00:00Z' });
  ids.peerJob = await job({
    owner: ids.operator!,
    requester: ids.operator!,
    assignee: ids.peer!,
    created: '2026-06-24T08:00:00Z',
    approved: '2026-06-24T12:00:00Z',
  });
  ids.leaderJob = await job({ assignee: ids.leader!, created: '2026-06-25T08:00:00Z', approved: '2026-06-25T12:00:00Z' });
  ids.directorJob = await job({
    team: ids.teamB!,
    assignee: ids.director!,
    created: '2026-06-26T08:00:00Z',
    approved: '2026-06-26T12:00:00Z',
  });
  ids.unassigned = await job({ owner: ids.operator!, assignee: null, status: 'queued', created: '2026-06-27T08:00:00Z' });
  // Current workload is deliberately larger than the workspace's first 50 rows, and independent of receipt dates.
  for (let i = 0; i < 55; i++) await job({ status: 'in_review', created: '2026-05-10T08:00:00Z' });
});

after(async () => {
  await env?.app.close();
  await env?.pool.end();
});

async function get(actor: string, endpoint = 'individual', query = PERIOD) {
  const response = await clients[actor]!.get(`/api/v1/dashboards/${endpoint}?${query}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

describe('desenvolvimento individual e qualidade da organização', () => {
  it('exige autenticação, reserva qualidade ao Diretor e não aceita trocar o responsável na query', async () => {
    const anonymous = new TestClient(env.app);
    for (const endpoint of ['individual', 'quality']) assert.equal((await anonymous.get(`/api/v1/dashboards/${endpoint}`)).status, 401);
    for (const actor of ['leader', 'operator', 'peer', 'empty'])
      assert.equal((await clients[actor]!.get(`/api/v1/dashboards/quality?${PERIOD}`)).status, 403);
    assert.equal((await clients.operator!.get(`/api/v1/dashboards/individual?${PERIOD}&assigneeId=${ids.peer}`)).status, 400);
    assert.equal((await get('director')).totals.approved, 1);
    assert.equal((await get('leader')).totals.approved, 1);
    assert.equal((await get('peer')).totals.approved, 1);
  });

  it('restringe todo agregado ao responsável logado, preserva totais acima de100 e conta conferência acima de50', async () => {
    const data = await get('operator');
    assert.equal(data.scope, 'individual');
    assert.equal(data.totals.received, 114);
    assert.equal(data.totals.approved, 112);
    assert.equal(data.totals.firstTime, 109);
    assert.equal(data.totals.reworked, 3);
    assert.equal(data.totals.inProgress, 57);
    assert.equal(data.totals.inReview, 56);
    assert.equal(data.totals.blocked, 1);
    assert.equal(data.totals.awaitingDownload, 111);
    assert.equal(data.totals.avgMinutes, 1806);
    assert.equal(data.totals.avgDownloadMinutes, 60);
    assert.equal(data.documents.length, 100);
    assert.equal(data.documentsTruncated, true);
    const visible = new Set(data.documents.map((row: { id: string }) => row.id));
    for (const foreign of ['peerJob', 'leaderJob', 'directorJob', 'unassigned', 'outside', 'future']) assert.ok(!visible.has(ids[foreign]));
    // Owner/requester are deliberately different from the logged-in assignee in the 105 approved baseline rows.
    assert.equal((await get('empty')).totals.approved, 0);
  });

  it('inclui a organização inteira apenas para o Diretor e mantém categorias de conclusão disjuntas', async () => {
    const data = await get('director', 'quality');
    assert.equal(data.scope, 'organization');
    assert.equal(data.totals.received, 118);
    assert.equal(data.totals.approved, 115);
    assert.equal(data.totals.firstTime, 112);
    assert.equal(data.totals.reworked, 3);
    assert.equal(data.totals.firstTime + data.totals.reworked, data.totals.approved);
    assert.equal(data.totals.firstTimeRate, 97);
    assert.equal(data.totals.inProgress, 58);
    assert.equal(data.totals.inReview, 56);
    assert.equal(data.documents.length, 100);
    assert.equal(data.documentsTruncated, true);
    const onlyReworked = await get('director', 'quality', 'from=2026-06-12&to=2026-06-14');
    assert.equal(onlyReworked.totals.approved, 3);
    assert.equal(onlyReworked.totals.reworked, 3);
    assert.equal(onlyReworked.totals.firstTime, 0);
    assert.deepEqual(new Set(onlyReworked.documents.map((row: { id: string }) => row.id)), new Set([ids.both, ids.override, ids.redo]));
  });

  it('aplica equipe, par e modalidade a todos os indicadores sem ampliar o escopo individual', async () => {
    const teamB = await get('operator', 'individual', `${PERIOD}&teamId=${ids.teamB}`);
    assert.equal(teamB.totals.approved, 1);
    assert.deepEqual(
      teamB.documents.map((row: { id: string }) => row.id),
      [ids.teamBJob],
    );
    assert.equal((await get('leader', 'individual', `${PERIOD}&teamId=${ids.teamB}`)).totals.approved, 0);
    const pair = await get('operator', 'individual', `${PERIOD}&sourceLanguage=fr&targetLanguage=it`);
    assert.equal(pair.totals.approved, 1);
    assert.deepEqual(
      pair.documents.map((row: { id: string }) => row.id),
      [ids.otherPair],
    );
    const mode = await get('operator', 'individual', `${PERIOD}&mode=technical`);
    assert.equal(mode.totals.approved, 1);
    assert.deepEqual(
      mode.documents.map((row: { id: string }) => row.id),
      [ids.technicalMode],
    );
    const combined = await get('director', 'quality', `${PERIOD}&teamId=${ids.teamB}&sourceLanguage=en&targetLanguage=pt&mode=certified`);
    assert.equal(combined.totals.received, 1);
    assert.equal(combined.totals.approved, 1);
    assert.equal(combined.totals.inReview, 0);
    assert.deepEqual(combined.failureCauses, []);
    assert.deepEqual(combined.failedStages, []);
    assert.equal(combined.documentsTruncated, false);
  });

  it('usa recebimento e conclusão nas respectivas datas, inclui o último dia inteiro e fecha semanas pelos mesmos filtros', async () => {
    const data = await get('operator');
    assert.deepEqual(data.period, { from: '2026-06-01', to: '2026-06-30' });
    assert.equal(data.weeks.length, 5);
    assert.equal(data.weeks[0].week, '2026-06-01');
    assert.equal(data.weeks.at(-1).week, '2026-06-29');
    for (const field of ['received', 'approved', 'reworked'])
      assert.equal(
        data.weeks.reduce((sum: number, row: Record<string, number>) => sum + row[field]!, 0),
        data.totals[field],
      );
    const lastDay = await get('operator', 'individual', 'from=2026-06-30&to=2026-06-30');
    assert.equal(lastDay.totals.received, 1);
    assert.equal(lastDay.totals.approved, 0);
    assert.deepEqual(
      lastDay.documents.map((row: { id: string }) => row.id),
      [ids.lastDay],
    );
    const carryIn = await get('operator', 'individual', 'from=2026-06-15&to=2026-06-15');
    assert.equal(carryIn.totals.approved, 1);
    assert.ok(carryIn.documents.some((row: { id: string }) => row.id === ids.carryIn));
  });

  it('separa reprovações e fases humanas de falhas técnicas e conta uma fase por conferência', async () => {
    const data = await get('operator');
    assert.equal(data.totals.failed, 1);
    assert.equal(data.totals.rejectedInspections, 3);
    assert.equal(data.totals.approvedInspections, 112);
    assert.deepEqual(data.failedStages, [
      { stage: 'layout', count: 2 },
      { stage: 'correction', count: 1 },
      { stage: 'review', count: 1 },
      { stage: 'translation', count: 1 },
    ]);
    assert.deepEqual(data.failureCauses, [{ code: 'processing_error', count: 1 }]);
    const technicalOnly = await get('operator', 'individual', 'from=2026-06-17&to=2026-06-17');
    assert.equal(technicalOnly.totals.failed, 1);
    assert.equal(technicalOnly.totals.rejectedInspections, 0);
    assert.deepEqual(technicalOnly.failedStages, []);
  });

  it('representa ausência de conclusões com zero e médias/taxa nulas, sem NaN ou divisão por zero', async () => {
    const data = await get('empty');
    assert.deepEqual(data.totals, {
      received: 0,
      approved: 0,
      firstTime: 0,
      reworked: 0,
      failed: 0,
      inProgress: 0,
      inReview: 0,
      blocked: 0,
      awaitingDownload: 0,
      avgMinutes: null,
      avgDownloadMinutes: null,
      approvedInspections: 0,
      rejectedInspections: 0,
      firstTimeRate: null,
    });
    assert.deepEqual(data.documents, []);
    assert.equal(data.documentsTruncated, false);
    assert.ok(
      data.weeks.every(
        (row: { approved: number; received: number; reworked: number }) => row.approved === 0 && row.received === 0 && row.reworked === 0,
      ),
    );
    const noConclusions = await get('operator', 'individual', 'from=2026-08-01&to=2026-08-31');
    assert.equal(noConclusions.totals.approved, 0);
    assert.equal(noConclusions.totals.firstTimeRate, null);
    assert.equal(noConclusions.totals.avgMinutes, null);
    assert.equal(noConclusions.totals.inReview, 56); // The UI labels this as workload "agora", independent of period.
  });

  it('valida período e filtros e permite injetar relógio sem depender da data do executor', async () => {
    for (const query of [
      'from=2026-07-01&to=2026-06-01',
      'from=2020-01-01&to=2026-06-30',
      'from=2026-02-30',
      'to=2026-02-30',
      `${PERIOD}&mode=invalid`,
      `${PERIOD}&sourceLanguage=xx`,
      `${PERIOD}&teamId=invalid`,
    ])
      assert.equal((await clients.director!.get(`/api/v1/dashboards/quality?${query}`)).status, 400, query);
    const service = createPerformanceDashboards({ pool: env.pool, now: () => new Date('2026-06-30T18:00:00Z') });
    const ctx: AuthenticatedContext = {
      actor: { id: ids.operator!, orgRole: 'member', status: 'active', memberships: new Map([[ids.teamA!, 'operator']]) },
      sessionId: randomUUID(),
      correlationId: 'performance-clock-test',
    };
    const data = await service.individual(ctx, {});
    assert.deepEqual(data.period, { from: '2026-06-01', to: '2026-06-30' });
    assert.equal(data.totals.approved, 112);
  });
});
