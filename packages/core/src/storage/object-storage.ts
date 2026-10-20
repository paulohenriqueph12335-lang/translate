import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
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

const notFound = (error: unknown) =>
  error instanceof S3ServiceException &&
  (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchBucket');

export function createS3Storage(config: S3Config): ObjectStorage {
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
    async putFile(key, filePath, size, contentType) {
      // O SDK não repete envios com corpo em fluxo; quando a conexão reaproveitada já tinha sido fechada pelo servidor
      // (comum após um tempo parado), tenta de novo com um fluxo novo do mesmo arquivo.
      for (let attempt = 1; ; attempt++) {
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: createReadStream(filePath),
              ContentLength: size,
              ContentType: contentType,
            }),
          );
          return;
        } catch (error) {
          if (attempt >= PUT_ATTEMPTS || !isConnectionDrop(error)) throw error;
        }
      }
    },
    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: result.ContentLength ?? 0 };
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return result.Body as Readable;
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
