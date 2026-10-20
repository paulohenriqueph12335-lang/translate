import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class TooLargeError extends Error {}

export interface SpooledFile {
  path: string;
  size: number;
  sha256: Buffer;
  /** Remove o arquivo temporário; seguro chamar mais de uma vez. */
  dispose(): Promise<void>;
}

/** Grava o fluxo em arquivo temporário com limite de bytes, calculando SHA-256 no caminho. */
export async function spoolToTempFile(source: Readable, maxBytes: number, directory = path.join(os.tmpdir(), 'tradutor-uploads')) {
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${randomUUID()}.upload`);
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) return callback(new TooLargeError('Arquivo excede o limite'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const dispose = () => rm(filePath, { force: true });
  try {
    await pipeline(source, meter, createWriteStream(filePath, { flags: 'wx' }));
  } catch (error) {
    await dispose();
    throw error;
  }
  return { path: filePath, size, sha256: hash.digest(), dispose } satisfies SpooledFile;
}
