import { readFileSync, writeFileSync } from 'node:fs';
import { configureEncryption, encryptAtRest, generateKeyEntry, loadKeyring, withFileSecrets } from '@tradutor/core/crypto';
import { createPool } from '@tradutor/core/db';
import { createS3Storage } from '@tradutor/core/storage';

/**
 * Chaves de criptografia (ADR-032).
 * - `new-key`: mostra uma chave nova, para colar no início de ENCRYPTION_KEYS.
 * - `add-key`: põe uma chave nova no início do arquivo ENCRYPTION_KEYS_FILE; ela passa a ser a ativa.
 * - `rotate`: recifra o banco e o armazenamento com a chave ativa (o serviço migrate também faz isso a cada subida).
 */
const env = withFileSecrets(process.env);
const command = process.argv[2];
const log = (message: string) => process.stdout.write(`${message}\n`);

if (command === 'new-key') {
  log(generateKeyEntry(process.argv[3]));
} else if (command === 'add-key') {
  const file = env.ENCRYPTION_KEYS_FILE;
  if (!file || env.ENCRYPTION_KEYS) {
    log('add-key só funciona com ENCRYPTION_KEYS_FILE. Com ENCRYPTION_KEYS, use new-key e cole no início da variável.');
    process.exit(1);
  }
  const entry = generateKeyEntry(process.argv[3]);
  const lines = readFileSync(file, 'utf8').split('\n');
  const firstKey = lines.findIndex((line) => line.trim() && !line.trim().startsWith('#'));
  lines.splice(firstKey < 0 ? lines.length : firstKey, 0, entry);
  writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  log(`Chave ${entry.slice(0, entry.indexOf(':'))} adicionada e ativa. Recrie os serviços (docker compose up -d --force-recreate):`);
  log('o migrate recifra tudo com ela. As chaves antigas só podem sair do arquivo depois disso.');
} else if (command === 'rotate') {
  configureEncryption(loadKeyring(env));
  const pool = createPool(env.DATABASE_URL!, 1);
  try {
    const storage = createS3Storage({
      S3_ENDPOINT: env.S3_ENDPOINT!,
      S3_BUCKET: env.S3_BUCKET!,
      S3_ACCESS_KEY: env.S3_ACCESS_KEY!,
      S3_SECRET_KEY: env.S3_SECRET_KEY!,
      S3_REGION: env.S3_REGION ?? 'us-east-1',
    });
    await encryptAtRest({ pool, storage, log });
    log('Tudo cifrado com a chave ativa.');
  } finally {
    await pool.end();
  }
} else {
  log('Uso: encryption new-key [id] | add-key [id] | rotate');
  process.exit(1);
}
