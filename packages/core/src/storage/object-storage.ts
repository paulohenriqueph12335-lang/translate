import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { activeKeyring, keyFor } from '../crypto/values.js';
const PUT_ATTEMPTS = 3;

/** Conexão derrubada antes da resposta: seguro repetir o envio inteiro (a chave é sempre nova ou sobrescrita). */
export function isConnectionDrop(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    (typeof code === 'string' && ['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT'].includes(code)) ||
    /socket hang up/i.test(error.message)
  );
}

/** Configuração S3 (ADR-002/ADR-006); as credenciais nunca têm valor padrão. */
export interface S3Config {
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_REGION: string;
}

/** Contrato mínimo de armazenamento de objetos privados (ADR-002/ADR-006); independe do provedor S3. */
export interface ObjectStorage {
  /** Garante que o bucket existe; chamado ao iniciar a API. */
  ensureReady(): Promise<void>;
  isReady(): Promise<boolean>;
  putFile(key: string, filePath: string, size: number, contentType: string): Promise<void>;
  /** Tamanho do objeto, ou `null` se não existir. */
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/**
 * Objetos cifrados (ADR-032): cada objeto tem uma chave própria (AES-256-GCM), embrulhada pela chave ativa. O corpo
 * gravado tem o mesmo tamanho do original; IV, etiqueta e a chave embrulhada vão nos metadados. O nome do objeto entra
 * como dado autenticado: um objeto trocado de lugar não abre. Objetos antigos, sem os metadados, são lidos como estão.
 */
const ENCRYPTION_MARK = 'tdenc';

interface SealedFile {
  path: string;
  metadata: Record<string, string>;
}

function wrapKey(objectKey: Buffer) {
  const { activeId } = activeKeyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(activeId), iv);
  cipher.setAAD(Buffer.from(`${ENCRYPTION_MARK}:${activeId}`));
  const wrapped = Buffer.concat([cipher.update(objectKey), cipher.final()]);
  return { keyId: activeId, wrapped: Buffer.concat([iv, cipher.getAuthTag(), wrapped]).toString('base64') };
}

function unwrapKey(keyId: string, wrapped: string) {
  const raw = Buffer.from(wrapped, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(keyId), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${ENCRYPTION_MARK}:${keyId}`));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

async function sealFile(key: string, filePath: string): Promise<SealedFile> {
  const objectKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', objectKey, iv);
  cipher.setAAD(Buffer.from(key));
  const path = join(tmpdir(), `tradutor-${randomUUID()}.enc`);
  try {
    await pipeline(createReadStream(filePath), cipher, createWriteStream(path, { mode: 0o600 }));
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  const { keyId, wrapped } = wrapKey(objectKey);
  return {
    path,
    metadata: {
      [ENCRYPTION_MARK]: '1',
      'tdenc-kid': keyId,
      'tdenc-iv': iv.toString('base64'),
      'tdenc-tag': cipher.getAuthTag().toString('base64'),
      'tdenc-key': wrapped,
    },
  };
}

function openStream(key: string, body: Readable, metadata: Record<string, string> | undefined): Readable {
  if (metadata?.[ENCRYPTION_MARK] !== '1') return body;
  const objectKey = unwrapKey(metadata['tdenc-kid']!, metadata['tdenc-key']!);
  const decipher = createDecipheriv('aes-256-gcm', objectKey, Buffer.from(metadata['tdenc-iv']!, 'base64'));
  decipher.setAAD(Buffer.from(key));
  decipher.setAuthTag(Buffer.from(metadata['tdenc-tag']!, 'base64'));
  body.on('error', (error) => decipher.destroy(error));
  return body.pipe(decipher);
}

/** Manutenção da criptografia (ADR-032): listar objetos, ver com que chave estão e cifrar de novo. */
export interface S3ObjectStorage extends ObjectStorage {
  listKeys(): AsyncIterable<string>;
  /** Chave com que o objeto foi cifrado; `null` para objeto antigo, sem criptografia. */
  encryptionKeyOf(key: string): Promise<string | null>;
  /** Cifra o objeto de novo com a chave ativa, sem mudar o conteúdo. */
  reseal(key: string): Promise<void>;
}

const notFound = (error: unknown) =>
  error instanceof S3ServiceException &&
  (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchBucket');

export function createS3Storage(config: S3Config): S3ObjectStorage {
  const bucket = config.S3_BUCKET;
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    maxAttempts: 3,
  });

  return {
    async ensureReady() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (!notFound(error)) throw error;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    },
    async isReady() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return true;
      } catch {
        return false;
      }
    },
    putFile: (key, filePath, size, contentType) => putFile(key, filePath, size, contentType),
    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: result.ContentLength ?? 0 };
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    get,
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async *listKeys() {
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
        for (const item of page.Contents ?? []) if (item.Key) yield item.Key;
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
    async encryptionKeyOf(key) {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return result.Metadata?.[ENCRYPTION_MARK] === '1' ? (result.Metadata['tdenc-kid'] ?? null) : null;
    },
    async reseal(key) {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const path = join(tmpdir(), `tradutor-${randomUUID()}.plain`);
      try {
        await pipeline(await get(key), createWriteStream(path, { mode: 0o600 }));
        await putFile(key, path, head.ContentLength ?? 0, head.ContentType ?? 'application/octet-stream');
      } finally {
        await rm(path, { force: true });
      }
    },
  };

  async function putFile(key: string, filePath: string, size: number, contentType: string) {
    const sealed = await sealFile(key, filePath);
    try {
      // O SDK não repete envios com corpo em fluxo; quando a conexão reaproveitada já tinha sido fechada pelo servidor
      // (comum após um tempo parado), tenta de novo com um fluxo novo do mesmo arquivo.
      for (let attempt = 1; ; attempt++) {
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: createReadStream(sealed.path),
              ContentLength: size,
              ContentType: contentType,
              Metadata: sealed.metadata,
            }),
          );
          return;
        } catch (error) {
          if (attempt >= PUT_ATTEMPTS || !isConnectionDrop(error)) throw error;
        }
      }
    } finally {
      await rm(sealed.path, { force: true });
    }
  }

  async function get(key: string) {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return openStream(key, result.Body as Readable, result.Metadata);
  }
}
