import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Keyring } from './keyring.js';

/**
 * Criptografia em repouso dos valores do banco (ADR-032): AES-256-GCM com IV aleatório e o identificador da chave
 * autenticado. Texto vira `enc:v1:<chave>:<base64>`; JSON vira `{"$enc": "enc:v1:…"}`, na mesma coluna jsonb.
 * A leitura é transparente: o pg abre os valores cifrados ao converter `text`, `json` e `jsonb`.
 */
const PREFIX = 'enc:v1:';
const SEALED = /^enc:v1:([A-Za-z0-9_-]{1,32}):([A-Za-z0-9+/]+={0,2})$/;

let current: Keyring | null = null;
let parsersInstalled = false;

export function configureEncryption(keyring: Keyring) {
  current = keyring;
  if (parsersInstalled) return;
  parsersInstalled = true;
  pg.types.setTypeParser(pg.types.builtins.TEXT, (value: string) => (value.startsWith(PREFIX) ? openText(value) : value));
  const json = (value: string) => openJson(JSON.parse(value));
  pg.types.setTypeParser(pg.types.builtins.JSON, json);
  pg.types.setTypeParser(pg.types.builtins.JSONB, json);
}

export function activeKeyring(): Keyring {
  if (!current) throw new Error('Criptografia não configurada: chame configureEncryption antes de usar o banco ou o armazenamento');
  return current;
}

export function keyFor(id: string) {
  const key = activeKeyring().keys.get(id);
  if (!key)
    throw new Error(`Chave de criptografia "${id}" não encontrada. Ela precisa continuar em ENCRYPTION_KEYS até a rotação terminar.`);
  return key;
}

/** Prefixo dos valores já cifrados com a chave ativa: o que não começa assim ainda precisa ser cifrado. */
export const activePrefix = () => `${PREFIX}${activeKeyring().activeId}:`;

export function sealText(plain: string): string {
  const { activeId } = activeKeyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(activeId), iv);
  cipher.setAAD(Buffer.from(`${PREFIX}${activeId}`));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${activeId}:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
}

export function openText(value: string): string {
  const match = SEALED.exec(value);
  if (!match) return value;
  const raw = Buffer.from(match[2]!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(match[1]!), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${PREFIX}${match[1]}`));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const sealNullable = (plain: string | null | undefined) => (plain === null || plain === undefined ? null : sealText(plain));

/** Valor para uma coluna json/jsonb, já serializado. */
export const sealJson = (value: unknown) => JSON.stringify({ $enc: sealText(JSON.stringify(value)) });

const isEnvelope = (value: unknown): value is { $enc: string } =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  typeof (value as { $enc?: unknown }).$enc === 'string';

export const openJson = (value: unknown): unknown => (isEnvelope(value) ? JSON.parse(openText(value.$enc)) : value);

/**
 * Índice cego da memória de tradução: HMAC-SHA256 do par de idiomas e do trecho, com uma chave derivada da ativa.
 * Permite achar o trecho igual sem guardar o texto aberto.
 */
export function memoryDigest(sourceLanguage: string, targetLanguage: string, text: string, keyId = activeKeyring().activeId) {
  const macKey = Buffer.from(hkdfSync('sha256', keyFor(keyId), 'tradutor-documental', 'translation-memory', 32));
  return createHmac('sha256', macKey).update(`${sourceLanguage}\u0000${targetLanguage}\u0000${text}`).digest();
}
