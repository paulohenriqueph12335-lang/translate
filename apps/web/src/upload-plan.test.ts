import assert from 'node:assert/strict';
import test from 'node:test';
import { captureUpload, planUploadRetries } from './upload-plan.ts';

const file = (name: string, size: number, content: string) => ({ name, size, content });
const document = (id: string, position: number, name: string, size: number, status = 'awaiting_upload') => ({
  id,
  position,
  name,
  size,
  status,
});

test('retomar preserva a posição dos arquivos e o corpo da remessa após alterações na seleção original', () => {
  const first = file('original.pdf', 10, 'primeiro');
  const second = file('outro.pdf', 20, 'segundo');
  const files = [first, second];
  const body = { protocol: 'ABC-10003', translation: { sourceLanguage: 'fr', targetLanguage: 'es' } };
  const snapshot = captureUpload(files, body, 'idempotency-original');
  files.reverse();
  files.pop();
  body.protocol = 'OUTRO-0002';
  body.translation.targetLanguage = 'en';
  assert.deepEqual(snapshot.files, [first, second]);
  assert.deepEqual(snapshot.body, { protocol: 'ABC-10003', translation: { sourceLanguage: 'fr', targetLanguage: 'es' } });
  assert.equal(snapshot.key, 'idempotency-original');
});

test('retomar inclui falhas reenviáveis e preserva arquivos distintos de mesmo nome pelo índice', () => {
  const files = [file('igual.pdf', 10, 'conteúdo A'), file('igual.pdf', 10, 'conteúdo B'), file('pronto.pdf', 20, 'pronto')];
  const plan = planUploadRetries(
    [
      document('a', 0, 'igual.pdf', 10, 'upload_failed'),
      document('b', 1, 'igual.pdf', 10),
      document('c', 2, 'pronto.pdf', 20, 'stored'),
      document('d', 3, 'recusado.pdf', 0, 'rejected'),
    ],
    files,
  );
  assert.deepEqual(
    plan.map(({ document, file }) => [document.id, file.content]),
    [
      ['a', 'conteúdo A'],
      ['b', 'conteúdo B'],
    ],
  );
});

test('nunca envia um arquivo ausente, trocado ou de tamanho diferente para o documento reservado', () => {
  const reserved = [document('a', 0, 'original.pdf', 10)];
  assert.throws(() => planUploadRetries(reserved, []), /posição mudou/);
  assert.throws(() => planUploadRetries(reserved, [file('trocado.pdf', 10, 'outro')]), /posição mudou/);
  assert.throws(() => planUploadRetries(reserved, [file('original.pdf', 99, 'outro')]), /posição mudou/);
});
