import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { buildZip, samples } from '../../test/helpers.js';
import { detectFormat, extensionOf, formatForExtension } from './format.js';
import { spoolToTempFile, TooLargeError } from './spool.js';

let directory: string;
const write = async (name: string, content: Buffer) => {
  const file = path.join(directory, name);
  await writeFile(file, content);
  return file;
};

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'format-test-'));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('detecção de formato', () => {
  it('reconhece cada formato aceito pela assinatura', async () => {
    for (const format of ['pdf', 'png', 'jpeg', 'docx', 'pptx'] as const) {
      assert.deepEqual(await detectFormat(await write(`a.${format}`, samples[format]())), { ok: true, format });
    }
  });

  it('recusa Office protegido ou legado', async () => {
    assert.deepEqual(await detectFormat(await write('p.docx', samples.ole())), { ok: false, reason: 'protected_or_legacy' });
  });

  it('recusa ZIP que não é DOCX/PPTX e ZIP corrompido', async () => {
    const plainZip = buildZip({ 'readme.txt': 'oi' });
    assert.deepEqual(await detectFormat(await write('z.docx', plainZip)), { ok: false, reason: 'unknown_format' });
    const noTypes = buildZip({ 'word/document.xml': '<w/>' });
    assert.deepEqual(await detectFormat(await write('n.docx', noTypes)), { ok: false, reason: 'unknown_format' });
    const truncated = samples.docx().subarray(0, 40);
    assert.deepEqual(await detectFormat(await write('t.docx', truncated)), { ok: false, reason: 'invalid_archive' });
  });

  it('recusa conteúdo desconhecido', async () => {
    assert.deepEqual(await detectFormat(await write('x.pdf', Buffer.from('MZ executável'))), { ok: false, reason: 'unknown_format' });
  });

  it('normaliza extensões', () => {
    assert.equal(extensionOf('Relatório Final.PDF'), 'pdf');
    assert.equal(extensionOf('foto.JPG'), 'jpg');
    assert.equal(extensionOf('script.exe'), null);
    assert.equal(extensionOf('sem-extensao'), null);
    assert.equal(formatForExtension('jpg'), 'jpeg');
  });
});

describe('gravação temporária', () => {
  it('calcula tamanho e SHA-256 e remove o arquivo ao descartar', async () => {
    const content = Buffer.from('conteúdo sintético');
    const spooled = await spoolToTempFile(Readable.from([content]), 1024, directory);
    assert.equal(spooled.size, content.length);
    assert.equal(spooled.sha256.length, 32);
    await spooled.dispose();
    await assert.rejects(detectFormat(spooled.path));
  });

  it('interrompe ao passar do limite', async () => {
    await assert.rejects(spoolToTempFile(Readable.from([Buffer.alloc(2048)]), 1024, directory), TooLargeError);
  });
});
