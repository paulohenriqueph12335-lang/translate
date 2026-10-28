import { configureEncryption, encryptAtRest, ensureKeyFile, loadKeyring, withFileSecrets } from '@tradutor/core/crypto';
import { createPool, migrate } from '@tradutor/core/db';
import { createS3Storage } from '@tradutor/core/storage';
import { seedSkillGlossary } from '@tradutor/core/translation';

const env = withFileSecrets(process.env);
const log = (message: string) => process.stdout.write(`${message}\n`);
if (!env.DATABASE_URL) {
  process.stderr.write('DATABASE_URL não definido\n');
  process.exit(1);
}
// Primeira subida (ADR-032): sem chave informada, cria o arquivo de chaves no volume próprio.
if (!env.ENCRYPTION_KEYS?.trim() && env.ENCRYPTION_KEYS_FILE && ensureKeyFile(env.ENCRYPTION_KEYS_FILE)) {
  log('==============================================================');
  log(`  Chave de criptografia criada em ${env.ENCRYPTION_KEYS_FILE}.`);
  log('  Guarde uma cópia fora deste computador (docs/operations.md, "Criptografia").');
  log('  Sem ela, os documentos e os backups não podem ser lidos.');
  log('==============================================================');
}
configureEncryption(loadKeyring(env));

const pool = createPool(env.DATABASE_URL, 1);
try {
  const applied = await migrate(pool, env.MIGRATIONS_DIR, log);
  log(applied.length ? `${applied.length} migração(ões) aplicada(s)` : 'Banco já está atualizado');
  // Glossário das skills de tradução (ADR-015): entra uma vez, quando já existe um Diretor.
  const seeded = await seedSkillGlossary(pool);
  if (seeded) log(`${seeded} termo(s) do glossário das skills adicionados`);
  // Cifra o que ainda estiver aberto e recifra o que usar chave antiga (ADR-032). O que ainda está aberto continua
  // legível: uma falha aqui não impede o sistema de subir e é tentada de novo na próxima subida.
  try {
    const storage =
      env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
        ? createS3Storage({
            S3_ENDPOINT: env.S3_ENDPOINT,
            S3_BUCKET: env.S3_BUCKET,
            S3_ACCESS_KEY: env.S3_ACCESS_KEY,
            S3_SECRET_KEY: env.S3_SECRET_KEY,
            S3_REGION: env.S3_REGION ?? 'us-east-1',
          })
        : undefined;
    if (storage) {
      // O armazenamento pode subir depois do banco no Compose.
      for (let attempt = 1; ; attempt += 1) {
        try {
          await storage.ensureReady();
          break;
        } catch (error) {
          if (attempt >= 15) throw error;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }
    await encryptAtRest({ pool, ...(storage ? { storage } : {}), log });
  } catch (error) {
    process.stderr.write(
      `Aviso: a criptografia dos dados antigos não terminou e será tentada na próxima subida.\n${String(error)}\n${String((error as Error).cause ?? '')}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`${String(error)}\n${String((error as Error).cause ?? '')}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
