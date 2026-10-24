import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

const PASSWORD = 'senha-de-teste-123';
let app: FastifyInstance;
let pool: Pool;
const ids: Record<string, string> = {};
const clients: Record<string, TestClient> = {};

async function job(team: string, name: string, protocol: string, status = 'in_review') {
  const batch = (
    await pool.query<{ id: string }>(
      `INSERT INTO batches(team_id,owner_id,name,declared_bytes,protocol,assigned_at,assigned_by) VALUES($1,$2,'Remessa acadêmica',100,$3,now(),$2) RETURNING id`,
      [team, ids.leader, protocol],
    )
  ).rows[0]!.id;
  const document = (
    await pool.query<{ id: string }>(
      `INSERT INTO documents(batch_id,position,display_name,declared_extension,declared_size) VALUES($1,0,$2,'pdf',100) RETURNING id`,
      [batch, name],
    )
  ).rows[0]!.id;
  const created = (
    await pool.query<{ id: string }>(
      `INSERT INTO translation_jobs(document_id,source_language,target_language,requested_by,assignee_id,status,failure_code,translation_mode)
    VALUES($1,'fr','es',$2,$2,$3,CASE WHEN $3='failed' THEN 'OCR_UNREADABLE' END,'simple') RETURNING id`,
      [document, ids.leader, status],
    )
  ).rows[0]!.id;
  return { batch, document, id: created };
}

before(async () => {
  ({ app, pool } = await createTestApp('auditsearchupgrade'));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  const director = (await pool.query<{ id: string; password_hash: string }>("SELECT id,password_hash FROM users WHERE org_role='director'"))
    .rows[0]!;
  ids.director = director.id;
  for (const name of ['leader', 'operator']) {
    ids[name] = (
      await pool.query<{ id: string }>(
        `INSERT INTO users(email,display_name,password_hash,status) VALUES($1,$2,$3,'active') RETURNING id`,
        [`${name}@exemplo.test`, name === 'leader' ? 'Líder José' : 'Operador', director.password_hash],
      )
    ).rows[0]!.id;
  }
  for (const name of ['A', 'B'])
    ids[`team${name}`] = (
      await pool.query<{ id: string }>(`INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id`, [`Equipe ${name}`, ids.director])
    ).rows[0]!.id;
  await pool.query(`INSERT INTO team_memberships(team_id,user_id,role,created_by) VALUES($1,$2,'leader',$4),($1,$3,'operator',$4)`, [
    ids.teamA,
    ids.leader,
    ids.operator,
    ids.director,
  ]);
  for (const name of ['director', 'leader', 'operator']) {
    clients[name] = new TestClient(app);
    assert.equal(
      (
        await clients[name]!.post('/api/v1/auth/login', {
          email: name === 'director' ? 'diretor@exemplo.test' : `${name}@exemplo.test`,
          password: PASSWORD,
        })
      ).status,
      200,
    );
  }
  const a = await job(ids.teamA!, 'Certidão acadêmica.pdf', 'ABC-10003', 'failed');
  ids.documentA = a.document;
  ids.jobA = a.id;
  ids.batchA = a.batch;
  const b = await job(ids.teamB!, 'Certidão sigilosa.pdf', 'SECRETO-20002', 'failed');
  ids.jobB = b.id;
  for (let i = 0; i < 65; i++)
    await pool.query(
      `INSERT INTO audit_events(actor_user_id,action,target_type,target_id,team_id,metadata) VALUES($1,'translation.failed','translation',$2,$3,$4)`,
      [ids.leader, a.id, ids.teamA, JSON.stringify({ code: 'OCR_UNREADABLE', documentName: 'Certidão acadêmica', protocol: 'ABC-10003' })],
    );
  await pool.query(
    `INSERT INTO audit_events(action,target_type,target_id,team_id,metadata) VALUES('translation.failed','translation',$1,$2,'{"code":"PRIVATE_FAILURE"}')`,
    [b.id, ids.teamB],
  );
  const critical = await job(ids.teamA!, 'Contrato bloqueado.pdf', 'ABC-10004');
  ids.critical = critical.id;
  await pool.query(`UPDATE translation_jobs SET consecutive_rejections=3,redo_count=8 WHERE id=$1`, [critical.id]);
  await pool.query(
    `INSERT INTO audit_events(action,target_type,target_id,team_id,metadata) VALUES('translation.review_blocked','translation',$1,$2,'{"consecutiveRejections":3,"blocked":true}')`,
    [critical.id, ids.teamA],
  );
  const pending = await job(ids.teamA!, 'Fila parada.pdf', 'ABC-10005', 'queued');
  ids.stalled = pending.id;
  await pool.query(`UPDATE translation_jobs SET updated_at=now()-interval '1 hour',last_activity_at=now()-interval '1 hour' WHERE id=$1`, [
    pending.id,
  ]);
  const ready = await job(ids.teamA!, 'Pronto aguardando.pdf', 'ABC-10006');
  ids.ready = ready.id;
  await pool.query(
    `UPDATE translation_jobs SET status='approved',approved_by=$2,approved_at=now()-interval '30 hours',output_key='test/ready.docx',translation_number=1,translation_year=2026 WHERE id=$1`,
    [ready.id, ids.director],
  );
});
after(async () => {
  await app?.close();
  await pool?.end();
});

describe('auditoria operacional e pesquisa no escopo de acesso', () => {
  it('exige autenticação e acesso de liderança em todas as novas consultas', async () => {
    const anonymous = new TestClient(app);
    for (const path of ['/api/v1/search?q=ABC', '/api/v1/audit-events/summary', '/api/v1/audit-events/incidents']) {
      assert.equal((await anonymous.get(path)).status, 401);
      assert.equal((await clients.operator!.get(path)).status, 403);
    }
    assert.equal((await clients.leader!.get('/api/v1/search?q=a')).status, 400);
  });
  it('conta todos os erros filtrados, independente da página, e não expõe outra equipe', async () => {
    const summary = await clients.leader!.get('/api/v1/audit-events/summary?errorsOnly=true');
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(summary.body.total, 66);
    assert.equal(summary.body.errors, 66);
    assert.equal(summary.body.critical, 1);
    assert.deepEqual(summary.body.byFailureCode, [
      { code: 'OCR_UNREADABLE', count: 65 },
      { code: 'consecutive_review_errors', count: 1 },
    ]);
    const page = await clients.leader!.get('/api/v1/audit-events?errorsOnly=true&limit=10');
    assert.equal(page.body.items.length, 10);
    assert.ok(page.body.nextCursor);
    assert.equal((await clients.leader!.get(`/api/v1/audit-events/summary?teamId=${ids.teamB}`)).body.total, 0);
    const director = await clients.director!.get('/api/v1/audit-events/summary?failureCode=PRIVATE_FAILURE');
    assert.equal(director.body.total, 1);
    const cause = await clients.leader!.get('/api/v1/audit-events?failureCode=OCR_UNREADABLE&severity=error');
    assert.equal(cause.body.items.length, 50);
    const emergency = await clients.leader!.get('/api/v1/audit-events?failureCode=consecutive_review_errors&severity=critical');
    assert.equal(emergency.body.items.length, 1);
    assert.equal(emergency.body.items[0].action, 'translation.review_blocked');
  });
  it('encontra protocolos e nomes com vários tokens, sem acentos ou distinção de maiúsculas', async () => {
    const response = await clients.leader!.get('/api/v1/search?q=ABC-10003%20certidao%20academica');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.groups.protocols[0].id, ids.batchA);
    assert.equal(response.body.groups.documents[0].id, ids.documentA);
    assert.equal(response.body.groups.translations[0].id, ids.jobA);
    assert.match(response.body.groups.translations[0].snippet, /Francês → Espanhol/);
    assert.match(response.body.groups.documents[0].snippet, /Aguardando envio/);
    assert.doesNotMatch(response.body.groups.translations[0].snippet, /concluido aprovado pronto|relatorio|\bfailed\b/);
    assert.doesNotMatch(response.body.groups.audit[0].snippet, /\{\s*"|documentName|failureCode/);
    assert.equal(response.body.groups.reports[0].id, ids.jobA);
    assert.ok(response.body.groups.audit.length > 0);
    assert.equal((await clients.leader!.get('/api/v1/search?q=SECRETO-20002')).body.total, 0);
    assert.equal((await clients.leader!.get('/api/v1/search?q=PRIVATE_FAILURE')).body.total, 0);
    assert.ok((await clients.director!.get('/api/v1/search?q=SECRETO-20002')).body.total > 0);
    const person = await clients.leader!.get('/api/v1/search?q=jose%20certidao');
    assert.equal(person.body.groups.documents[0].id, ids.documentA);
    const phase = await clients.leader!.get('/api/v1/search?q=aprovado%20aguardando');
    assert.ok(phase.body.groups.translations.some((r: { id: string }) => r.id === ids.ready));
    const languages = await clients.leader!.get('/api/v1/search?q=frances%20espanhol%20erro');
    assert.ok(languages.body.groups.translations.some((r: { id: string }) => r.id === ids.jobA));
  });
  it('permite procurar metadados, nome de arquivo e protocolo diretamente na auditoria', async () => {
    const result = await clients.leader!.get('/api/v1/audit-events?q=certidao%20ABC-10003&errorsOnly=true');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.items.length, 50);
    const eventId = result.body.items[0].id;
    const exact = await clients.leader!.get(`/api/v1/audit-events?q=${eventId}`);
    assert.ok(exact.body.items.some((r: { id: string }) => r.id === eventId));
    const facets = await clients.leader!.get('/api/v1/audit-events/facets');
    assert.deepEqual(facets.body.failureCodes, ['OCR_UNREADABLE', 'consecutive_review_errors']);
  });
  it('identifica bloqueio, processamento parado e concluído sem download, com total sem limite da lista', async () => {
    const incidents = await clients.leader!.get('/api/v1/audit-events/incidents?limit=2');
    assert.equal(incidents.status, 200, JSON.stringify(incidents.body));
    assert.equal(incidents.body.total, 4);
    assert.equal(incidents.body.critical, 1);
    assert.equal(incidents.body.items.length, 2);
    assert.equal(incidents.body.items[0].translationId, ids.critical);
    assert.equal(incidents.body.items[0].code, 'CONSECUTIVE_FAILURES');
    const all = await clients.leader!.get('/api/v1/audit-events/incidents');
    assert.deepEqual(
      new Set(all.body.items.map((r: { code: string }) => r.code)),
      new Set(['CONSECUTIVE_FAILURES', 'PROCESSING_STALLED', 'READY_NOT_DOWNLOADED', 'OCR_UNREADABLE']),
    );
    assert.ok(!all.body.items.some((r: { translationId: string }) => r.translationId === ids.jobB));
    assert.equal((await clients.leader!.get(`/api/v1/audit-events/incidents?teamId=${ids.teamB}`)).body.total, 0);
  });
  it('mede espera até download real; prévia não encerra a espera nem conta atividade de edição', async () => {
    await pool.query(`INSERT INTO audit_events(action,target_type,target_id,team_id) VALUES('translation.previewed','translation',$1,$2)`, [
      ids.ready,
      ids.teamA,
    ]);
    let docs = (await clients.leader!.get(`/api/v1/dashboards/team?teamId=${ids.teamA}`)).body.documents;
    let ready = docs.find((d: { id: string }) => d.id === ids.ready);
    assert.equal(ready.firstDownloadedAt, null);
    assert.ok(ready.readyWithoutDownloadMinutes >= 1799);
    await pool.query(
      `INSERT INTO audit_events(action,target_type,target_id,team_id,occurred_at) VALUES('translation.downloaded','translation',$1,$2,now()-interval '2 hours')`,
      [ids.ready, ids.teamA],
    );
    docs = (await clients.leader!.get(`/api/v1/dashboards/team?teamId=${ids.teamA}`)).body.documents;
    ready = docs.find((d: { id: string }) => d.id === ids.ready);
    assert.ok(ready.firstDownloadedAt);
    assert.ok(Math.abs(ready.minutesUntilFirstDownload - 1680) <= 1);
    assert.equal(ready.readyWithoutDownloadMinutes, null);
    const incidents = await clients.leader!.get('/api/v1/audit-events/incidents');
    assert.ok(!incidents.body.items.some((r: { translationId: string }) => r.translationId === ids.ready));
    await pool.query(`UPDATE translation_jobs SET consecutive_rejections=0,format_generation=format_generation+1 WHERE id=$1`, [
      ids.critical,
    ]);
    const reset = await clients.leader!.get('/api/v1/audit-events/incidents');
    assert.equal(reset.body.critical, 0);
  });
  it('classifica falhas de envio e rejeição de arquivo pela causa registrada em reason', async () => {
    await pool.query(
      `INSERT INTO audit_events(action,target_type,target_id,team_id,metadata) VALUES('document.rejected','document',$1,$2,'{"reason":"invalid_signature"}')`,
      [ids.documentA, ids.teamA],
    );
    const result = await clients.leader!.get('/api/v1/audit-events?errorsOnly=true&failureCode=invalid_signature');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.items.length, 1);
    assert.equal(result.body.items[0].severity, 'error');
    assert.equal(result.body.items[0].failureCode, 'invalid_signature');
  });
  it('localiza a mudança de idiomas pelo protocolo e arquivo mesmo sem protocolo nos metadados do evento', async () => {
    await pool.query(`UPDATE translation_jobs SET source_language='es',target_language='it' WHERE id=$1`, [ids.jobA]);
    const event = (
      await pool.query<{ id: string }>(
        `INSERT INTO audit_events(actor_user_id,action,target_type,target_id,team_id,metadata) VALUES($1,'translation.languages_changed','translation',$2,$3,'{"from":{"sourceLanguage":"fr","targetLanguage":"es"},"to":{"sourceLanguage":"es","targetLanguage":"it"},"reason":"Correção solicitada"}') RETURNING id`,
        [ids.leader, ids.jobA, ids.teamA],
      )
    ).rows[0]!;
    const response = await clients.leader!.get('/api/v1/search?q=ABC-10003%20certidao%20idiomas');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(response.body.groups.audit.some((item: { id: string }) => item.id === String(event.id)));
    assert.doesNotMatch(response.body.groups.audit[0].snippet, /\{|sourceLanguage|targetLanguage/);
    const audit = await clients.leader!.get('/api/v1/audit-events?q=ABC-10003%20certidao');
    assert.ok(audit.body.items.some((item: { id: string }) => item.id === String(event.id)));
    assert.equal((await clients.leader!.get('/api/v1/search?q=SECRETO-20002%20idiomas')).body.total, 0);
  });
});
