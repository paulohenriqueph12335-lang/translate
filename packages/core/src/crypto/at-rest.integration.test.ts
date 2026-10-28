import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Readable } from 'node:stream';
import pg, { type Pool } from 'pg';
import { createTestDatabase, configureTestEncryption, testStorageEnv } from '../testing/index.js';
import { createS3Storage, type S3ObjectStorage } from '../storage/object-storage.js';
import { encryptAtRest } from './maintenance.js';
import { learnMemory, lookupMemory } from './memory.js';
import { sealText } from './values.js';

/** Criptografia em repouso de ponta a ponta (ADR-032): banco, armazenamento, dados antigos e rotação. */
const readAll = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

let pool: Pool;
let raw: pg.Client;
let storage: S3ObjectStorage;
const NEW_ACTIVE = `nova:${Buffer.alloc(32, 9).toString('base64')}`;

before(async () => {
  const db = await createTestDatabase('crypto');
  pool = db.pool;
  // Cliente sem os conversores: enxerga o que está gravado de verdade.
  raw = new pg.Client({ connectionString: db.url, types: { getTypeParser: () => (value: string) => value } });
  await raw.connect();
  storage = createS3Storage(testStorageEnv('crypto'));
  await storage.ensureReady();
});

after(async () => {
  configureTestEncryption();
  await raw.end();
  await pool.end();
});

describe('criptografia em repouso', () => {
  it('arquivos: o S3 guarda cifrado, com o mesmo tamanho; a leitura devolve o original', async () => {
    const path = join(tmpdir(), 'cripto-teste.txt');
    const content = Buffer.from('Certidão de nascimento de Fulana de Tal '.repeat(500));
    await writeFile(path, content);
    await storage.putFile('a/arquivo.txt', path, content.length, 'text/plain');
    await rm(path);
    assert.equal((await storage.head('a/arquivo.txt'))?.size, content.length);
    assert.deepEqual(await readAll(await storage.get('a/arquivo.txt')), content);
    assert.equal(await storage.encryptionKeyOf('a/arquivo.txt'), 'teste');
    // O corpo gravado não contém o texto.
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const env = testStorageEnv('crypto');
    const client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
    const stored = Buffer.from(
      await (await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: 'a/arquivo.txt' }))).Body!.transformToByteArray(),
    );
    assert.equal(stored.length, content.length);
    assert.ok(!stored.includes(Buffer.from('Certidão')));
  });

  it('memória de tradução: grava cifrada e encontra pelo índice cego', async () => {
    await learnMemory(pool, {
      sourceLanguage: 'pt',
      targetLanguage: 'en',
      jobId: null,
      pairs: [['Diploma de bacharel', 'Bachelor degree']],
    });
    const found = await lookupMemory(pool, 'pt', 'en', ['Diploma de bacharel', 'outro']);
    assert.deepEqual([...found], [['Diploma de bacharel', 'Bachelor degree']]);
    const stored = await raw.query(`SELECT source_text, target_text FROM translation_memory`);
    assert.match(stored.rows[0].source_text, /^enc:v1:teste:/);
    assert.match(stored.rows[0].target_text, /^enc:v1:teste:/);
  });

  it('dados antigos, abertos, são cifrados pelo migrate; trocar a chave recifra tudo', async () => {
    // Um trecho antigo da memória e um arquivo antigo, gravados abertos como antes da criptografia.
    await raw.query(
      `INSERT INTO translation_memory (source_language, target_language, source_text, target_text) VALUES ('pt', 'en', 'Certidão', 'Certificate')`,
    );
    const legacy = join(tmpdir(), 'cripto-antigo.txt');
    await writeFile(legacy, 'conteúdo antigo aberto');
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const env = testStorageEnv('crypto');
    const client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
    await client.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: 'a/antigo.txt', Body: 'conteúdo antigo aberto', ContentType: 'text/plain' }),
    );
    await rm(legacy);
    assert.equal(await storage.encryptionKeyOf('a/antigo.txt'), null);
    assert.equal((await readAll(await storage.get('a/antigo.txt'))).toString(), 'conteúdo antigo aberto');

    await encryptAtRest({ pool, storage });
    assert.equal(await storage.encryptionKeyOf('a/antigo.txt'), 'teste');
    assert.equal((await readAll(await storage.get('a/antigo.txt'))).toString(), 'conteúdo antigo aberto');
    const memory = await raw.query(
      `SELECT source_text, source_digest FROM translation_memory WHERE source_text NOT LIKE 'enc:v1:teste:%' OR source_digest IS NULL`,
    );
    assert.equal(memory.rowCount, 0);
    assert.deepEqual([...(await lookupMemory(pool, 'pt', 'en', ['Certidão']))], [['Certidão', 'Certificate']]);

    // Rotação: chave nova na frente, a antiga ainda no chaveiro.
    configureTestEncryption(`${NEW_ACTIVE},teste:${Buffer.alloc(32, 7).toString('base64')}`);
    await encryptAtRest({ pool, storage });
    assert.equal(await storage.encryptionKeyOf('a/arquivo.txt'), 'nova');
    assert.equal(await storage.encryptionKeyOf('a/antigo.txt'), 'nova');
    const rotated = await raw.query(`SELECT count(*)::int AS n FROM translation_memory WHERE source_text NOT LIKE 'enc:v1:nova:%'`);
    assert.equal(Number(rotated.rows[0].n), 0);
    // Depois da rotação, a chave antiga pode sair.
    configureTestEncryption(NEW_ACTIVE);
    assert.equal((await readAll(await storage.get('a/antigo.txt'))).toString(), 'conteúdo antigo aberto');
    assert.equal((await lookupMemory(pool, 'pt', 'en', ['Diploma de bacharel'])).get('Diploma de bacharel'), 'Bachelor degree');
    assert.ok(sealText('x').startsWith('enc:v1:nova:'));
  });
});
