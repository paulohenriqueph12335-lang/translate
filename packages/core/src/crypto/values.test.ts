import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateKeyEntry, parseKeyring } from './keyring.js';
import { configureEncryption, memoryDigest, openJson, openText, sealJson, sealText } from './values.js';

const KEY_A = `a:${Buffer.alloc(32, 1).toString('base64')}`;
const KEY_B = `b:${Buffer.alloc(32, 2).toString('base64')}`;

describe('criptografia dos valores (ADR-032)', () => {
  it('cifra e abre texto e JSON; o mesmo texto nunca gera o mesmo cifrado', () => {
    configureEncryption(parseKeyring(KEY_A));
    const sealed = sealText('HISTÓRICO ESCOLAR — nota 9,5');
    assert.match(sealed, /^enc:v1:a:/);
    assert.notEqual(sealed, sealText('HISTÓRICO ESCOLAR — nota 9,5'));
    assert.equal(openText(sealed), 'HISTÓRICO ESCOLAR — nota 9,5');
    const json = JSON.parse(sealJson({ blocks: [{ text: 'Maria' }] }));
    assert.deepEqual(Object.keys(json), ['$enc']);
    assert.deepEqual(openJson(json), { blocks: [{ text: 'Maria' }] });
    // Valores abertos (antigos) passam como estão.
    assert.equal(openText('texto antigo'), 'texto antigo');
    assert.deepEqual(openJson([1, 2]), [1, 2]);
  });

  it('cifrado alterado não abre', () => {
    configureEncryption(parseKeyring(KEY_A));
    const sealed = sealText('segredo');
    const raw = Buffer.from(sealed.split(':')[3]!, 'base64');
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 1, raw.length - 1);
    assert.throws(() => openText(`enc:v1:a:${raw.toString('base64')}`));
  });

  it('com a chave nova ativa, o que foi cifrado com a antiga continua abrindo; sem a antiga, não', () => {
    configureEncryption(parseKeyring(KEY_A));
    const old = sealText('antigo');
    configureEncryption(parseKeyring(`${KEY_B},${KEY_A}`));
    assert.match(sealText('novo'), /^enc:v1:b:/);
    assert.equal(openText(old), 'antigo');
    configureEncryption(parseKeyring(KEY_B));
    assert.throws(() => openText(old), /Chave de criptografia "a" não encontrada/);
  });

  it('o índice cego da memória depende da chave, do par de idiomas e do texto', () => {
    configureEncryption(parseKeyring(KEY_A));
    const digest = memoryDigest('pt', 'en', 'Diploma');
    assert.deepEqual(digest, memoryDigest('pt', 'en', 'Diploma'));
    assert.notDeepEqual(digest, memoryDigest('pt', 'fr', 'Diploma'));
    configureEncryption(parseKeyring(KEY_B));
    assert.notDeepEqual(digest, memoryDigest('pt', 'en', 'Diploma'));
  });

  it('o chaveiro recusa chave curta, repetida ou com identificador inválido', () => {
    assert.throws(() => parseKeyring(`a:${Buffer.alloc(16).toString('base64')}`), /32 bytes/);
    assert.throws(() => parseKeyring(`${KEY_A},${KEY_A}`), /repetida/);
    assert.throws(() => parseKeyring(`x y:${Buffer.alloc(32).toString('base64')}`));
    const ring = parseKeyring(`# comentário\n${generateKeyEntry('nova')}\n${KEY_A}\n`);
    assert.equal(ring.activeId, 'nova');
    assert.equal(ring.keys.size, 2);
  });
});
