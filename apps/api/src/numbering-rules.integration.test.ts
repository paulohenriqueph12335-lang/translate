import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { processNextJob } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import { renderMaskTemplate } from '@tradutor/core/translation';
import { approvedTranscriptDraft } from '@tradutor/core/fixtures';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient, submitReady, allowTranslatorNotes } from './test/helpers.js';

/**
 * Regras de numeração por tradutor (ADR-014): o Supervisor configura e envia os números por CSV; o usuário preenche a
 * numeração da tradução; o sistema confere, aponta anomalias e emite o número na conclusão.
 */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
const ids: Record<string, string> = {};
const c: Record<string, TestClient> = {};

async function login(email: string) {
  const client = new TestClient(app);
  assert.equal((await client.post('/api/v1/auth/login', { email, password: PASSWORD })).status, 200);
  return client;
}

/** Tradutor com máscara pronta e regra configurada pelo Supervisor. */
async function translator(name: string, scheme: string, config: Record<string, unknown>) {
  const id = (await c.sup!.post('/api/v1/sworn-translators', { name })).body.translator.id as string;
  const zip = await JSZip.loadAsync(await renderMaskTemplate('en'));
  const mask = await zip.generateAsync({ type: 'nodebuffer' });
  const uploaded = await c.sup!.putContent(`/api/v1/sworn-translators/${id}/masks`, mask, { 'x-file-name': 'mascara.docx' }, 'POST');
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const rule = await c.sup!.request('PUT', `/api/v1/sworn-translators/${id}/numbering`, { scheme, config });
  assert.equal(rule.status, 200, JSON.stringify(rule.body));
  return id;
}

/** Documento em revisão com o rascunho de referência (sem erros de checagem). */
async function inReview(seed: string) {
  await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
  const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]);
  const batch = await c.op!.request('POST', '/api/v1/batches', { files: [{ name: `${seed}.pdf`, size: pdf.length }] });
  const documentId = batch.body.documents[0].id as string;
  await c.op!.putContent(`/api/v1/documents/${documentId}/content`, pdf);
  const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
  await processNextJob({ pool, storage, workerId: 'teste' });
  await c.op!.request('PUT', `/api/v1/translations/${job}/draft`, { baseRevision: 1, draft: approvedTranscriptDraft });
  return job;
}

const fill = (job: string, body: Record<string, unknown>, client = c.op!) =>
  client.request('PUT', `/api/v1/translations/${job}/numbering`, body);
const errorCodes = (response: { body: { check: { anomalies: Array<{ code: string; severity: string }> } } }) =>
  response.body.check.anomalies.filter((anomaly) => anomaly.severity === 'error').map((anomaly) => anomaly.code);

/** Preenche, marca como pronta e conclui; devolve o número exibido. */
async function issue(seed: string, body: Record<string, unknown>) {
  const job = await inReview(seed);
  const saved = await fill(job, body);
  assert.deepEqual(errorCodes(saved), [], JSON.stringify(saved.body.check));
  assert.equal((await submitReady(c.op!, job)).status, 200);
  const done = await c.sup!.post(`/api/v1/translations/${job}/approve`, {});
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { job, number: done.body.translation.number as string };
}

before(async () => {
  ({ app, pool, storage } = await createTestApp('numberingrules'));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  await allowTranslatorNotes(pool);
  c.director = await login('diretor@exemplo.test');
  for (const name of ['sup', 'op', 'op2']) {
    const email = `${name}@exemplo.test`;
    await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: name, password: PASSWORD });
    ids[name] = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
    await c.director.post(`/api/v1/users/${ids[name]}/approve`);
  }
  ids.team = (await c.director.post('/api/v1/teams', { name: 'Equipe' })).body.team.id;
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.sup, role: 'leader' });
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.op, role: 'operator' });
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.op2, role: 'operator' });
  for (const name of ['sup', 'op', 'op2']) c[name] = await login(`${name}@exemplo.test`);
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('configuração pelo Supervisor', () => {
  it('só o Supervisor configura regra, planilhas e livros', async () => {
    ids.patricia = await translator('Patricia Livro', 'book_sheet', { sheetLimit: 5, recordPages: true, alertRemaining: 2 });
    assert.equal(
      (await c.op!.request('PUT', `/api/v1/sworn-translators/${ids.patricia}/numbering`, { scheme: 'free_text', config: {} })).status,
      403,
    );
    assert.equal(
      (await c.op!.post(`/api/v1/sworn-translators/${ids.patricia}/numbering/books`, { book: '12', nextNumber: 501 })).status,
      403,
    );
    const rule = await c.op!.get(`/api/v1/sworn-translators/${ids.patricia}/numbering`);
    assert.equal(rule.body.rule.scheme, 'book_sheet');
    assert.equal(rule.body.presets, undefined);
    assert.ok((await c.sup!.get(`/api/v1/sworn-translators/${ids.patricia}/numbering`)).body.presets.walter);
  });
});

describe('Patricia: livro e folha automáticos, troca de livro e trava', () => {
  it('sem livro cadastrado a numeração trava; com livro, número e folhas seguem as páginas', async () => {
    const job = await inReview('p0');
    const locked = await fill(job, { translatorId: ids.patricia, pages: 2 });
    assert.deepEqual(errorCodes(locked), ['book_locked']);
    // A anomalia avisa os Supervisores e impede "Pronta".
    assert.equal((await c.sup!.get('/api/v1/notifications?kind=numbering_anomaly')).body.items.length, 1);
    const blocked = await submitReady(c.op!, job);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.details.reason, 'numbering_invalid');

    await c.sup!.post(`/api/v1/sworn-translators/${ids.patricia}/numbering/books`, { book: '12', nextNumber: 501 });
    const ok = await fill(job, { translatorId: ids.patricia, pages: 2 });
    assert.deepEqual(errorCodes(ok), []);
    assert.deepEqual([ok.body.check.computed.number, ok.body.check.computed.book, ok.body.check.computed.sheetStart], ['501', '12', 1]);
    assert.equal((await submitReady(c.op!, job)).status, 200);
    const done = await c.sup!.post(`/api/v1/translations/${job}/approve`, {});
    assert.equal(done.body.translation.number, '501 – Livro 12 – Folha 1 a 2');
  });

  it('documento que começa antes do limite pode passar dele; o seguinte abre o próximo livro', async () => {
    // Folhas 3 a 6 com limite 5: segue no livro 12.
    assert.equal((await issue('p1', { translatorId: ids.patricia, pages: 4 })).number, '502 – Livro 12 – Folha 3 a 6');
    // Livro esgotado e sem próximo: trava e avisa para cadastrar o próximo livro.
    const job = await inReview('p2');
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.patricia, pages: 1 })), ['book_locked']);
    assert.ok(
      (await c.sup!.get('/api/v1/notifications?kind=numbering_low')).body.items.some((n: { title: string }) => /livro 12/.test(n.title)),
    );
    await c.sup!.post(`/api/v1/sworn-translators/${ids.patricia}/numbering/books`, { book: '13', nextNumber: 900 });
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.patricia, pages: 1 })), []);
    await submitReady(c.op!, job);
    assert.equal((await c.sup!.post(`/api/v1/translations/${job}/approve`, {})).body.translation.number, '900 – Livro 13 – Folha 1');
    const books = (await c.sup!.get(`/api/v1/sworn-translators/${ids.patricia}/numbering/books`)).body.items;
    assert.deepEqual(
      books.map((book: { book: string; status: string; nextSheet: number }) => [book.book, book.status, book.nextSheet]),
      [
        ['12', 'closed', 7],
        ['13', 'current', 2],
      ],
    );
  });
});

describe('Carla: lotes por idioma, 2 usos em protocolos diferentes, lote gratuito', () => {
  it('importa as planilhas e informa o que não entrou', async () => {
    ids.carla = await translator('Carla Idiomas', 'reusable_stock', { maxUses: 2, languages: ['Francês', 'Italiano'] });
    const csv = 'Número;Idioma\n100;Francês\n101;Francês\n100;Italiano\n100;Francês\n;Francês\n';
    const imported = await c.sup!.post(`/api/v1/sworn-translators/${ids.carla}/numbering/stock`, { fileName: 'carla.csv', text: csv });
    assert.equal(imported.status, 201);
    assert.deepEqual([imported.body.read, imported.body.imported, imported.body.problems.length], [5, 3, 2]);
    const free = await c.sup!.post(`/api/v1/sworn-translators/${ids.carla}/numbering/stock`, {
      fileName: 'gratuitos.csv',
      text: '900\n901',
      language: 'Francês',
      free: true,
    });
    assert.equal(free.body.imported, 2);
    assert.equal(
      (await c.op!.post(`/api/v1/sworn-translators/${ids.carla}/numbering/stock`, { fileName: 'x.csv', text: '1' })).status,
      403,
    );
  });

  it('mesmo número: duas vezes em protocolos diferentes, nunca no mesmo; depois, esgotado', async () => {
    const first = await issue('c1', { translatorId: ids.carla, number: '100', language: 'Francês', protocol: 'P-1' });
    assert.equal(first.number, '100');
    const job = await inReview('c2');
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.carla, number: '100', language: 'Francês', protocol: 'P-1' })), [
      'same_protocol',
    ]);
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.carla, number: '100', language: 'Francês', protocol: 'P-2' })), []);
    await submitReady(c.op!, job);
    assert.equal((await c.sup!.post(`/api/v1/translations/${job}/approve`, {})).status, 200);
    const third = await inReview('c3');
    assert.deepEqual(errorCodes(await fill(third, { translatorId: ids.carla, number: '100', language: 'Francês', protocol: 'P-3' })), [
      'uses_exhausted',
    ]);
    // O 100 em italiano é outro número; o gratuito só vale como gratuito.
    assert.deepEqual(errorCodes(await fill(third, { translatorId: ids.carla, number: '100', language: 'Italiano', protocol: 'P-3' })), []);
    assert.deepEqual(
      errorCodes(await fill(third, { translatorId: ids.carla, number: '101', language: 'Francês', protocol: 'P-3', free: true })),
      ['free_mismatch'],
    );
    const freeUse = await fill(third, { translatorId: ids.carla, number: '900', language: 'Francês', protocol: 'P-3' });
    assert.deepEqual([errorCodes(freeUse), freeUse.body.check.computed.free], [[], true]);
  });
});

describe('Walter: protocolo e assinatura', () => {
  it('protocolo zerado precisa de autorização; ao chegar ao teto, a assinatura fica gratuita sozinha', async () => {
    ids.walter = await translator('Walter Sigla', 'prefixed', { prefix: 'NB', subscriptionCap: 100, translatorFee: 60 });
    const job = await inReview('w1');
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.walter, number: '1111', protocolValue: 80 })), ['pattern']);
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.walter, number: 'NB-2026-1111', protocolValue: 0 })), [
      'zero_protocol',
    ]);
    assert.equal((await c.op!.post(`/api/v1/translations/${job}/numbering/authorize-zero-protocol`)).status, 403);
    const authorized = await c.sup!.post(`/api/v1/translations/${job}/numbering/authorize-zero-protocol`);
    assert.deepEqual(errorCodes(authorized), []);
    assert.equal(authorized.body.entry.zeroProtocolAuthorizedBy, 'sup');
    await submitReady(c.op!, job);
    assert.equal((await c.sup!.post(`/api/v1/translations/${job}/approve`, {})).status, 200);

    await issue('w2', { translatorId: ids.walter, number: 'NB-2026-1112', protocolValue: 80 });
    // R$ 120,00 pagos (2 × 60) ≥ teto de R$ 100,00: a próxima assinatura é gratuita.
    const job3 = await inReview('w3');
    const free = await fill(job3, { translatorId: ids.walter, number: 'NB-2026-1113', protocolValue: 80 });
    assert.deepEqual([errorCodes(free), free.body.check.computed.translatorFee, free.body.check.computed.free], [[], 0, true]);
    assert.deepEqual(errorCodes(await fill(job3, { translatorId: ids.walter, number: 'NB-2026-1112', protocolValue: 80 })), ['duplicate']);
  });
});

describe('estoque: reservar, bloquear, avisar, excluir; lembrete; painel', () => {
  it('reservado só para a pessoa escolhida; bloqueado ninguém usa; usado não se exclui', async () => {
    ids.bruno = await translator('Bruno Lembrete', 'stock', {
      reminder: 'Enviar por e-mail para a equipe responsável.',
      alertRemaining: 1,
    });
    await c.sup!.post(`/api/v1/sworn-translators/${ids.bruno}/numbering/stock`, {
      fileName: 'b.csv',
      text: 'numero;livro\n10;3\n11;3\n12;3',
    });
    const stock = (await c.sup!.get(`/api/v1/sworn-translators/${ids.bruno}/numbering/stock`)).body.items as Array<{
      id: string;
      number: string;
    }>;
    const byNumber = Object.fromEntries(stock.map((item) => [item.number, item.id]));
    await c.sup!.request('PATCH', `/api/v1/numbering-stock/${byNumber['10']}`, {
      status: 'reserved',
      reservedFor: ids.op2,
      notifyOnUse: true,
    });
    await c.sup!.request('PATCH', `/api/v1/numbering-stock/${byNumber['11']}`, { status: 'blocked' });
    const job = await inReview('b1');
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.bruno, number: '10' })), ['reserved']);
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.bruno, number: '11' })), ['blocked']);
    assert.deepEqual(errorCodes(await fill(job, { translatorId: ids.bruno, number: '99' })), ['not_in_stock']);
    const ok = await fill(job, { translatorId: ids.bruno, number: '12' });
    assert.equal(ok.body.check.computed.book, '3');
    await submitReady(c.op!, job);
    assert.equal((await c.sup!.post(`/api/v1/translations/${job}/approve`, {})).body.translation.number, '12 – Livro 3');
    // Lembrete do tradutor para quem trabalhou na tradução.
    assert.equal(
      (await c.op!.get('/api/v1/notifications?kind=numbering_reminder')).body.items[0].body,
      'Enviar por e-mail para a equipe responsável.',
    );
    assert.equal((await c.sup!.request('DELETE', `/api/v1/numbering-stock/${byNumber['12']}`)).status, 409);
    assert.equal((await c.sup!.request('DELETE', `/api/v1/numbering-stock/${byNumber['11']}`)).status, 204);
    // O reservado é usado por quem tem a reserva; o Supervisor é avisado do uso e do estoque no fim.
    const job2 = await inReview('b2');
    await c
      .op2!.request('PUT', `/api/v1/translations/${job2}/numbering`, { translatorId: ids.bruno, number: '10' })
      .then((r) => assert.deepEqual(errorCodes(r), []));
    await submitReady(c.op!, job2);
    assert.equal((await c.sup!.post(`/api/v1/translations/${job2}/approve`, {})).status, 200);
    const alerts = (await c.sup!.get('/api/v1/notifications?kind=numbering_used,numbering_low')).body.items.map(
      (n: { title: string }) => n.title,
    );
    assert.ok(alerts.some((title: string) => /nº 10 foi usado/.test(title)));
    assert.ok(alerts.some((title: string) => /Bruno Lembrete: lote esgotado/.test(title)));
  });

  it('painel: emitidos, restantes, lotes gratuitos, livro atual, assinatura e travas', async () => {
    assert.equal((await c.op!.get('/api/v1/numbering/translators')).status, 403);
    const items = (await c.sup!.get('/api/v1/numbering/translators')).body.items as Array<Record<string, any>>;
    const by = Object.fromEntries(items.map((item) => [item.name, item]));
    assert.equal(by['Patricia Livro']!.issued, 3);
    assert.deepEqual(by['Patricia Livro']!.book, { book: '13', nextNumber: 901, nextSheet: 2, sheetsLeft: 4, sheetLimit: 5 });
    const carlaFree = by['Carla Idiomas']!.lots.find((lot: { free: boolean }) => lot.free);
    // O gratuito 900 está preso no rascunho da última tradução da Carla: restam 3 dos 4 usos.
    assert.deepEqual([carlaFree.numbers, carlaFree.capacity, carlaFree.available], [2, 4, 3]);
    const carlaFr = by['Carla Idiomas']!.lots.find((lot: { free: boolean; language: string }) => !lot.free && lot.language === 'Francês');
    assert.deepEqual([carlaFr.uses, carlaFr.available], [2, 2]);
    assert.deepEqual(by['Walter Sigla']!.subscription, { paid: 120, cap: 100, free: true });
    assert.equal(by['Bruno Lembrete']!.locked, true);
  });
});
