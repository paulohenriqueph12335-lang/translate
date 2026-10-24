export interface UploadSnapshot<T> {
  key: string;
  files: T[];
  body: Record<string, unknown>;
  batchId?: string;
}

/** Mantém a requisição e a posição de cada arquivo iguais em todas as tentativas idempotentes. */
export function captureUpload<T>(files: readonly T[], body: Record<string, unknown>, key: string): UploadSnapshot<T> {
  return { key, files: [...files], body: structuredClone(body) };
}

export function planUploadRetries<T extends { name: string; size: number }>(
  documents: readonly { id: string; position: number; name: string; size: number; status: string }[],
  files: readonly T[],
) {
  return documents
    .filter((document) => document.status === 'awaiting_upload' || document.status === 'upload_failed')
    .map((document) => {
      const file = files[document.position];
      if (!file || file.name !== document.name || file.size !== document.size)
        throw new Error('O arquivo desta posição mudou. Abra a remessa em Envios para retomar o documento correto.');
      return { document, file };
    });
}
