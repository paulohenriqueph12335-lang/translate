import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { notify } from '@tradutor/core/db';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

const PASSWORD = 'notificacoes-sinteticas-123';
let env: Awaited<ReturnType<typeof createTestApp>>;
let clock = Date.now();
let sequence = 0;
let passwordHash: string;
let directorId: string;
let teamA: string;
let teamB: string;
const tick = (milliseconds = 60_001) => {
  clock += milliseconds;
};

before(async () => {
  env = await createTestApp('smartnotifications', { now: () => new Date(clock) });
  await bootstrapDirector(env.pool, { email: 'diretor@notificacoes.test', displayName: 'Diretor sintético', password: PASSWORD });
  const user = (
    await env.pool.query<{ id: string; password_hash: string }>(
      `SELECT id,password_hash FROM users WHERE email='diretor@notificacoes.test'`,
    )
  ).rows[0]!;
  directorId = user.id;
  passwordHash = user.password_hash;
  const teams = await env.pool.query<{ id: string }>(
    `INSERT INTO teams(name,created_by) VALUES('Equipe A',$1),('Equipe B',$1) RETURNING id`,
    [directorId],
  );
  teamA = teams.rows[0]!.id;
  teamB = teams.rows[1]!.id;
});
after(async () => {
  await env.app.close();
  await env.pool.end();
});

async function account(profile: 'operator' | 'leader' | 'director' = 'operator', team = teamA) {
  const name = `pessoa-${++sequence}`;
  const id = (
    await env.pool.query<{ id: string }>(
      `INSERT INTO users(email,display_name,password_hash,status,org_role) VALUES($1,$2,$3,'active',$4) RETURNING id`,
      [`${name}@notificacoes.test`, name, passwordHash, profile === 'director' ? 'director' : 'member'],
    )
  ).rows[0]!.id;
  if (profile !== 'director')
    await env.pool.query(`INSERT INTO team_memberships(team_id,user_id,role,created_by) VALUES($1,$2,$3,$4)`, [
      team,
      id,
      profile,
      directorId,
    ]);
  const client = new TestClient(env.app);
  assert.equal((await client.post('/api/v1/auth/login', { email: `${name}@notificacoes.test`, password: PASSWORD })).status, 200);
  return { id, client, team };
}
async function events(id: string, count = 1, kind = 'translation_ready', team: string | null = null) {
  return (
    await env.pool.query<{ id: string }>(
      `INSERT INTO notifications(user_id,kind,title,body,team_id)
     SELECT $1,$2,'Atualização sintética '||n,'Sem conteúdo de documento',$4 FROM generate_series(1,$3::int) n RETURNING id`,
      [id, kind, count, team],
    )
  ).rows.map((row) => row.id);
}
const claim = (client: TestClient, channel: 'inApp' | 'browser' = 'inApp') =>
  client.post('/api/v1/notifications/deliveries/claim', { channel });
const preferences = (client: TestClient, input: unknown) => client.request('PATCH', '/api/v1/notifications/preferences', input);

async function job(team: string, kind: 'failed' | 'blocked' | 'approval' | 'download' | 'processing' | 'unassigned') {
  const batch = (
    await env.pool.query<{ id: string }>(
      `INSERT INTO batches(team_id,owner_id,name,declared_bytes,protocol,assigned_at,assigned_by) VALUES($1,$2,'Remessa sintética',100,$3,now(),$2) RETURNING id`,
      [team, directorId, `NOT-${++sequence}`],
    )
  ).rows[0]!.id;
  const document = (
    await env.pool.query<{ id: string }>(
      `INSERT INTO documents(batch_id,position,display_name,declared_extension,declared_size) VALUES($1,0,$2,'pdf',100) RETURNING id`,
      [batch, `Documento ${sequence}.pdf`],
    )
  ).rows[0]!.id;
  const status = {
    failed: 'failed',
    blocked: 'in_review',
    approval: 'awaiting_approval',
    download: 'approved',
    processing: 'processing',
    unassigned: 'in_review',
  }[kind];
  const id = (
    await env.pool.query<{ id: string }>(
      `INSERT INTO translation_jobs(document_id,source_language,target_language,requested_by,status,failure_code,translation_mode,
      consecutive_rejections,submitted_at,approved_by,approved_at,output_key,translation_number,translation_year,updated_at)
     VALUES($1,'fr','es',$2,$3,CASE WHEN $3='failed' THEN 'processing_error' END,'simple',$4,
      now()-interval '30 hours',CASE WHEN $3='approved' THEN $2::uuid END,
      CASE WHEN $3='approved' THEN now()-interval '30 hours' END,
      CASE WHEN $3='approved' THEN $5 END,CASE WHEN $3='approved' THEN $6::int END,
      CASE WHEN $3='approved' THEN 2026 END,now()-interval '2 hours') RETURNING id`,
      [document, directorId, status, kind === 'blocked' ? 3 : 0, `synthetic/${document}.docx`, sequence],
    )
  ).rows[0]!.id;
  return { id, batch, document };
}

describe('notificações inteligentes, preferências e entregas sem enxurrada', () => {
  it('recomenda interesses por perfil sem habilitar avisos do sistema operacional automaticamente', async () => {
    for (const profile of ['operator', 'leader', 'director'] as const) {
      const { client } = await account(profile);
      const response = await client.get('/api/v1/notifications/preferences');
      assert.equal(response.status, 200);
      assert.equal(response.body.profile, profile);
      assert.equal(response.body.deliveryMode, 'digest');
      assert.equal(response.body.delivery.minimumIntervalSeconds, 60);
      assert.equal(response.body.delivery.onlineOnly, true);
      assert.equal(response.body.delivery.windowsManagedByBrowser, true);
      assert.equal(response.body.categories.workflow.inApp, profile === 'operator');
      assert.equal(response.body.categories.administration.inApp, profile === 'director');
      assert.equal(response.body.categories.failures.inApp, true);
      assert.ok(Object.values(response.body.categories).every((category: any) => category.browser === false));
      assert.ok(response.body.catalog.every((category: any) => category.reason.length > 10));
    }
  });

  it('persiste canais por categoria, mantém mudanças concorrentes e sincroniza flags legadas sem alterar tema', async () => {
    const { client } = await account();
    const other = await account();
    await client.request('PATCH', '/api/v1/auth/preferences', { theme: 'dark' });
    const responses = await Promise.all([
      preferences(client, { categories: { workflow: { inApp: false } } }),
      preferences(client, { categories: { failures: { browser: true } }, notificationFrequency: '15m' }),
    ]);
    assert.ok(responses.every((response) => response.status === 200));
    const saved = (await client.get('/api/v1/notifications/preferences')).body;
    assert.equal(saved.categories.workflow.inApp, false);
    assert.equal(saved.categories.failures.browser, true);
    assert.equal(saved.notificationFrequency, '15m');
    assert.deepEqual((await client.get('/api/v1/auth/preferences')).body, {
      notificationsEnabled: true,
      notificationFrequency: '15m',
      theme: 'dark',
    });
    assert.equal((await other.client.get('/api/v1/notifications/preferences')).body.categories.workflow.inApp, true);
    const reset = await preferences(client, { resetToRecommended: true });
    assert.equal(reset.body.categories.workflow.inApp, true);
    assert.equal(reset.body.categories.failures.browser, false);
    assert.equal(reset.body.notificationFrequency, '15m');
  });

  it('valida contrato e exige autenticação/CSRF sem aceitar preferências ou cursor de outra pessoa', async () => {
    const anonymous = new TestClient(env.app);
    const { client } = await account();
    assert.equal((await anonymous.get('/api/v1/notifications/preferences')).status, 401);
    assert.equal((await claim(anonymous)).status, 401);
    const noCsrf = new TestClient(env.app, { csrf: false });
    noCsrf.cookie = client.cookie;
    assert.equal((await preferences(noCsrf, { deliveryMode: 'individual' })).status, 403);
    assert.equal((await claim(noCsrf)).status, 403);
    for (const input of [
      {},
      { userId: directorId },
      { deliveryMode: 'spam' },
      { notificationFrequency: 'daily' },
      { categories: { unknown: { inApp: true } } },
      { categories: { workflow: { browser: 'true' } } },
      { categories: { workflow: { email: true } } },
    ])
      assert.equal((await preferences(client, input)).status, 400, JSON.stringify(input));
    assert.equal((await client.post('/api/v1/notifications/deliveries/claim', { channel: 'email' })).status, 400);
    assert.equal((await client.post('/api/v1/notifications/deliveries/claim', { channel: 'inApp', cursor: '99' })).status, 400);
  });

  it('primeira utilização é silenciosa; 45 eventos novos viram um resumo e não marcam o histórico como lido', async () => {
    const { id, client } = await account();
    await events(id, 3);
    assert.deepEqual((await claim(client)).body.items, []);
    await events(id, 40);
    await events(id, 5, 'translation_failed');
    assert.equal((await claim(client)).body.summary, null);
    tick();
    const delivery = await claim(client);
    assert.equal(delivery.status, 200, JSON.stringify(delivery.body));
    assert.equal(delivery.body.items.length, 45);
    assert.equal(delivery.body.summary.count, 45);
    assert.equal(delivery.body.summary.severity, 'error');
    assert.equal(delivery.body.deliveryMode, 'digest');
    assert.deepEqual(
      delivery.body.summary.byCategory.map((item: any) => [item.category, item.count]),
      [
        ['workflow', 40],
        ['failures', 5],
      ],
    );
    assert.ok(delivery.body.items.every((item: any) => item.reason && item.category && item.severity));
    assert.equal((await client.get('/api/v1/notifications/unread-count')).body.unread, 48);
    tick();
    assert.deepEqual((await claim(client)).body.items, []);
  });

  it('respeita frequência de 5/15/60 minutos e usa a mesma configuração do endpoint legado', async () => {
    for (const [frequency, interval] of [
      ['5m', 300_000],
      ['15m', 900_000],
      ['1h', 3_600_000],
    ] as const) {
      const { id, client } = await account();
      await client.request('PATCH', '/api/v1/auth/preferences', { notificationFrequency: frequency });
      await claim(client);
      await events(id);
      tick(interval - 1);
      assert.equal((await claim(client)).body.summary, null);
      tick(1);
      assert.equal((await claim(client)).body.summary.count, 1);
    }
  });

  it('uma leitura antes da entrega ou uma categoria desativada não cria aviso; o centro mantém seu histórico', async () => {
    const { id, client } = await account();
    await preferences(client, { categories: { review: { inApp: false } } });
    await claim(client);
    const [read] = await events(id);
    await events(id, 2, 'translation_returned');
    assert.equal((await client.post('/api/v1/notifications/read', { ids: [read] })).body.marked, 1);
    tick();
    assert.equal((await claim(client)).body.summary, null);
    assert.equal((await client.get('/api/v1/notifications?category=review')).body.items.length, 2);
    assert.equal((await client.get('/api/v1/notifications/unread-count')).body.unread, 2);
  });

  it('abas simultâneas consomem cada canal uma vez, e habilitar Windows não interfere no aviso interno', async () => {
    const { id, client } = await account();
    await preferences(client, { categories: { workflow: { browser: true } } });
    await claim(client);
    await claim(client, 'browser');
    await events(id, 4);
    tick();
    const deliveries = await Promise.all([claim(client), claim(client), claim(client, 'browser'), claim(client, 'browser')]);
    assert.deepEqual(
      deliveries
        .slice(0, 2)
        .map((item) => item.body.items.length)
        .sort(),
      [0, 4],
    );
    assert.deepEqual(
      deliveries
        .slice(2)
        .map((item) => item.body.items.length)
        .sort(),
      [0, 4],
    );
    tick();
    assert.equal((await claim(client)).body.summary, null);
    assert.equal((await claim(client, 'browser')).body.summary, null);
  });

  it('modo individual precisa ser escolhido e entrega no máximo dez eventos de cada vez sem perder os demais', async () => {
    const { id, client } = await account();
    assert.equal((await preferences(client, { deliveryMode: 'individual' })).body.delivery.minimumIntervalSeconds, 5);
    await claim(client);
    const ids = await events(id, 25);
    tick(5_000);
    const delivered: string[] = [];
    for (const expected of [10, 10, 5]) {
      const response = await claim(client);
      assert.equal(response.body.items.length, expected);
      delivered.push(...response.body.items.map((item: any) => item.id));
      tick(5_000);
    }
    assert.deepEqual(delivered, ids);
    assert.equal(new Set(delivered).size, 25);
    assert.equal((await claim(client)).body.summary, null);
  });

  it('digerir mais de mil eventos usa páginas limitadas e preserva todos os itens pendentes', async () => {
    const { id, client } = await account();
    await claim(client);
    await events(id, 1300);
    tick();
    assert.equal((await claim(client)).body.summary.count, 1000);
    tick();
    assert.equal((await claim(client)).body.summary.count, 300);
    tick();
    assert.equal((await claim(client)).body.summary, null);
  });

  it('um ID reservado antes e gravado depois de um ID maior não perde seu aviso nem repete os anteriores', async () => {
    const { id, client } = await account();
    await claim(client);
    const late = (await env.pool.query<{ id: string }>(`SELECT nextval(pg_get_serial_sequence('notifications','id'))::text AS id`)).rows[0]!
      .id;
    const [early] = await events(id);
    tick();
    assert.deepEqual(
      (await claim(client)).body.items.map((item: any) => item.id),
      [early],
    );
    await env.pool.query(
      `INSERT INTO notifications(id,user_id,kind,title) OVERRIDING SYSTEM VALUE VALUES($1,$2,'translation_ready','ID reservado antes')`,
      [late, id],
    );
    tick();
    assert.deepEqual(
      (await claim(client)).body.items.map((item: any) => item.id),
      [late],
    );
  });

  it('desativar avisos mantém o centro e não reproduz o acervo ao reativar ou mudar os interesses', async () => {
    const { id, client } = await account();
    await claim(client);
    await preferences(client, { notificationsEnabled: false });
    await events(id, 2);
    tick();
    assert.equal((await claim(client)).body.summary, null);
    assert.equal((await client.get('/api/v1/notifications/unread-count')).body.unread, 2);
    await preferences(client, { notificationsEnabled: true });
    tick();
    assert.equal((await claim(client)).body.summary, null);
    await events(id);
    tick();
    assert.equal((await claim(client)).body.summary.count, 1);
    await preferences(client, { categories: { workflow: { browser: true } } });
    tick();
    assert.equal((await claim(client, 'browser')).body.summary, null);
    await client.request('PATCH', '/api/v1/auth/preferences', { notificationsEnabled: false });
    await events(id, 2);
    await client.request('PATCH', '/api/v1/auth/preferences', { notificationsEnabled: true });
    tick();
    assert.equal((await claim(client)).body.summary, null);
  });

  it('saída da equipe e redirecionamento da remessa revogam leitura, contador e entrega do conteúdo antigo', async () => {
    const { id, client } = await account();
    await claim(client);
    const item = await job(teamA, 'approval');
    const notification = (
      await env.pool.query<{ id: string }>(
        `INSERT INTO notifications(user_id,kind,title,team_id,batch_id,document_id,translation_id) VALUES($1,'translation_submitted','Conteúdo restrito',$2,$3,$4,$5) RETURNING id`,
        [id, teamA, item.batch, item.document, item.id],
      )
    ).rows[0]!.id;
    await env.pool.query('UPDATE batches SET team_id=$2 WHERE id=$1', [item.batch, teamB]);
    tick();
    assert.equal((await claim(client)).body.summary, null);
    assert.equal((await client.get('/api/v1/notifications')).body.items.length, 0);
    assert.equal((await client.get('/api/v1/notifications/unread-count')).body.unread, 0);
    assert.equal((await client.post('/api/v1/notifications/read', { ids: [notification] })).body.marked, 0);
    await events(id, 1, 'translation_ready', teamA);
    await env.pool.query('DELETE FROM team_memberships WHERE user_id=$1', [id]);
    assert.equal((await client.get('/api/v1/notifications/unread-count')).body.unread, 0);
  });

  it('lembretes ampliam a visão da liderança com motivos, respeitam equipes e não se repetem em cada atualização', async () => {
    const leader = await account('leader');
    const director = await account('director');
    const operator = await account();
    const jobs = await Promise.all(
      ['failed', 'blocked', 'approval', 'download', 'processing', 'unassigned'].map((kind) => job(teamA, kind as any)),
    );
    const outside = await job(teamB, 'blocked');
    await claim(leader.client);
    await claim(director.client);
    await claim(operator.client);
    const allLeader = (await leader.client.get('/api/v1/notifications?limit=100')).body.items;
    const allDirector = (await director.client.get('/api/v1/notifications?limit=100')).body.items;
    assert.ok(jobs.every((job) => allLeader.some((item: any) => item.translationId === job.id)));
    assert.ok(!allLeader.some((item: any) => item.translationId === outside.id));
    assert.ok(allDirector.some((item: any) => item.translationId === outside.id));
    assert.ok(allLeader.some((item: any) => item.kind === 'download_waiting' && item.category === 'failures'));
    assert.equal((await operator.client.get('/api/v1/notifications')).body.items.length, 0);
    tick(16 * 60_000);
    await claim(leader.client);
    await claim(director.client);
    assert.equal((await leader.client.get('/api/v1/notifications?limit=100')).body.items.length, allLeader.length);
    assert.equal((await director.client.get('/api/v1/notifications?limit=100')).body.items.length, allDirector.length);
  });

  it('deduplicação core preserva eventos normais e avisos resolvidos deixam de ser entregues', async () => {
    const { id, client } = await account();
    await claim(client);
    const item = await job(teamA, 'blocked');
    const input = {
      kind: 'review_blocked',
      title: 'Bloqueado',
      translationId: item.id,
      batchId: item.batch,
      documentId: item.document,
      dedupeKey: `block:${item.id}`,
    };
    assert.equal(await notify(env.pool, { teamId: teamA, users: [id] }, input), 1);
    assert.equal(await notify(env.pool, { teamId: teamA, users: [id] }, input), 0);
    await env.pool.query('UPDATE translation_jobs SET consecutive_rejections=0 WHERE id=$1', [item.id]);
    tick();
    assert.equal((await claim(client)).body.summary, null);
    assert.equal((await client.get('/api/v1/notifications')).body.items.length, 1);
    const normal = { kind: 'translation_ready', title: 'Evento normal' };
    assert.equal(await notify(env.pool, { teamId: teamA, users: [id] }, normal), 1);
    assert.equal(await notify(env.pool, { teamId: teamA, users: [id] }, normal), 1);
  });
});
