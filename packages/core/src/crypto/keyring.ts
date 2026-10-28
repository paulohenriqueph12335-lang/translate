import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Chaves de criptografia em repouso (ADR-032). A primeira é a ativa: cifra tudo o que é gravado. As demais só abrem o
 * que foi cifrado antes, até a rotação terminar. Formato: `id:base64` (32 bytes), separadas por vírgula ou linha.
 */
export interface Keyring {
  readonly activeId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

export function parseKeyring(spec: string): Keyring {
  const entries = spec
    .split('\n')
    .map((line) => line.replace(/#.*/, ''))
    .flatMap((line) => line.split(/[\s,]+/))
    .filter(Boolean);
  if (!entries.length) throw new Error('Nenhuma chave de criptografia informada');
  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    const id = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (separator < 1 || !KEY_ID.test(id)) throw new Error(`Identificador de chave inválido: "${id || entry.slice(0, 8)}"`);
    if (key.length !== 32) throw new Error(`A chave "${id}" precisa ter 32 bytes em base64`);
    if (keys.has(id)) throw new Error(`Chave repetida: "${id}"`);
    keys.set(id, key);
  }
  return { activeId: entries[0]!.slice(0, entries[0]!.indexOf(':')), keys };
}

/** Uma chave nova, pronta para colar no início de ENCRYPTION_KEYS ou do arquivo de chaves. */
export function generateKeyEntry(id = `k${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`) {
  if (!KEY_ID.test(id)) throw new Error(`Identificador de chave inválido: "${id}"`);
  return `${id}:${randomBytes(32).toString('base64')}`;
}

/** ENCRYPTION_KEYS (valor) ou ENCRYPTION_KEYS_FILE (arquivo, como um segredo do Docker ou do Kubernetes). */
export function loadKeyring(env: NodeJS.ProcessEnv = process.env): Keyring {
  if (env.ENCRYPTION_KEYS?.trim()) return parseKeyring(env.ENCRYPTION_KEYS);
  if (env.ENCRYPTION_KEYS_FILE?.trim()) {
    if (!existsSync(env.ENCRYPTION_KEYS_FILE))
      throw new Error(`Arquivo de chaves não encontrado: ${env.ENCRYPTION_KEYS_FILE}. Rode o serviço migrate, que o cria na primeira vez.`);
    return parseKeyring(readFileSync(env.ENCRYPTION_KEYS_FILE, 'utf8'));
  }
  throw new Error('Defina ENCRYPTION_KEYS ou ENCRYPTION_KEYS_FILE: os documentos são guardados cifrados (ADR-032).');
}

/** Cria o arquivo de chaves com uma chave nova, só leitura do dono, se ainda não existir. Devolve se criou. */
export function ensureKeyFile(path: string) {
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(
    path,
    [
      '# Chaves de criptografia do Tradutor Documental (ADR-032). A primeira linha é a ativa.',
      '# Guarde uma cópia fora deste computador: sem ela, os documentos e os backups não podem ser lidos.',
      generateKeyEntry(),
      '',
    ].join('\n'),
    { mode: 0o600, flag: 'wx' },
  );
  chmodSync(path, 0o600);
  return true;
}
