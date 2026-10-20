import { z } from 'zod';
import { AppError } from '../http/errors.js';

export const pageQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
};

/** Cursor opaco para paginação por chave; o conteúdo é validado por quem consome. */
export const encodeCursor = (...parts: string[]) => Buffer.from(parts.join('|')).toString('base64url');

export function decodeCursor(cursor: string | undefined, validate: (parts: string[]) => boolean) {
  if (!cursor) return undefined;
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!validate(parts)) throw new AppError(400, 'VALIDATION_FAILED', 'Cursor inválido');
  return parts;
}

/** Padrão `ILIKE` de "contém", escapando os curingas digitados pelo usuário. */
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
