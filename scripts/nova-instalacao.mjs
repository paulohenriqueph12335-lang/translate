#!/usr/bin/env node
// Prepara o .env de uma instalação nova do Tradutor Documental (ADR-032), com segredos aleatórios e próprios:
// senha do banco, chaves do armazenamento, chave de criptografia e tokens do Diretor e do Líder.
//
// Sem Node no computador, rode pelo Docker, na pasta do projeto:
//   docker run --rm -v "${PWD}:/w" -w /w node:22-bookworm-slim node scripts/nova-instalacao.mjs
//
// Opções: --forcar (sobrescreve um .env existente), --https (cookies só por HTTPS).
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
if (existsSync('.env') && !args.has('--forcar')) {
  console.error('Já existe um .env. Use --forcar para gerar outro (o banco e os documentos atuais deixam de abrir com os segredos novos).');
  process.exit(1);
}
if (!existsSync('.env.example')) {
  console.error('Rode na pasta do projeto, onde está o .env.example.');
  process.exit(1);
}

const secret = (bytes = 24) => randomBytes(bytes).toString('base64url');
// Sem letras e números que se confundem (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const token = (prefix) =>
  `${prefix}-${Array.from({ length: 6 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-')}`;

const values = {
  POSTGRES_PASSWORD: secret(),
  S3_ACCESS_KEY: `tradutor-${secret(6)}`,
  S3_SECRET_KEY: secret(30),
  ENCRYPTION_KEYS: `k${new Date().toISOString().slice(0, 10).replaceAll('-', '')}:${randomBytes(32).toString('base64')}`,
  DIRECTOR_TOKEN: token('DIR'),
  LEADER_TOKEN: token('LID'),
  ...(args.has('--https') ? { COOKIE_SECURE: 'true' } : {}),
};

let env = readFileSync('.env.example', 'utf8').replace(
  '# Somente para desenvolvimento local. Troque os valores antes de qualquer uso compartilhado.',
  `# Gerado por scripts/nova-instalacao.mjs em ${new Date().toISOString().slice(0, 10)}. Não envie este arquivo a ninguém.`,
);
for (const [name, value] of Object.entries(values)) {
  const line = new RegExp(`^${name}=.*$`, 'm');
  env = line.test(env) ? env.replace(line, `${name}=${value}`) : `${env.trimEnd()}\n${name}=${value}\n`;
}
const user = /^POSTGRES_USER=(.*)$/m.exec(env)?.[1] ?? 'tradutor';
const db = /^POSTGRES_DB=(.*)$/m.exec(env)?.[1] ?? 'tradutor';
env = env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgres://${user}:${values.POSTGRES_PASSWORD}@postgres:5432/${db}`);
writeFileSync('.env', env, { mode: 0o600 });

console.log(`
.env criado com segredos novos desta instalação.

  Token do Diretor: ${values.DIRECTOR_TOKEN}
  Token do Líder:   ${values.LEADER_TOKEN}

Anote os dois tokens agora: eles criam o primeiro Diretor e autorizam senhas novas.
Guarde uma cópia do .env fora deste computador. A linha ENCRYPTION_KEYS abre os documentos:
sem ela, nem os backups podem ser lidos.

Depois: docker compose up --build -d e abra http://localhost:5173.`);
