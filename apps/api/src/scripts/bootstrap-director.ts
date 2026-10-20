import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createPool } from '@tradutor/core/db';
import { bootstrapDirector, BootstrapRefused } from '../modules/identity/bootstrap.js';

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/** Lê a senha sem eco quando há terminal; caso contrário, lê a primeira linha da entrada padrão. */
async function readPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    const onData = (key: string) => {
      for (const char of key) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') fail('\nCancelado');
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const input = z
  .object({ email: z.string().trim().toLowerCase().pipe(z.email()), name: z.string().trim().min(1).max(120) })
  .safeParse(values);
if (!input.success) fail('Uso: bootstrap:director --email <email> --name "<nome>"');
const { email, name } = input.data!;

const url = process.env.DATABASE_URL ?? fail('DATABASE_URL não definido');
const password = await readPassword('Senha do Diretor (mín. 12 caracteres): ');
if (process.stdin.isTTY) {
  const confirmation = await readPassword('Confirme a senha: ');
  if (confirmation !== password) fail('As senhas não conferem');
}

const pool = createPool(url, 1);
try {
  const id = await bootstrapDirector(pool, { email, displayName: name, password });
  process.stdout.write(`Diretor criado (id ${id}). Entre pela interface web.\n`);
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(error instanceof BootstrapRefused ? `Recusado: ${error.message}\n` : `Falha: ${String(error)}\n`);
} finally {
  await pool.end();
}
