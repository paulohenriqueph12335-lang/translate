export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_CURRENT_PASSWORD'
  | 'ACCOUNT_PENDING'
  | 'ACCOUNT_UNAVAILABLE'
  | 'CSRF_HEADER_MISSING'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'DOCUMENT_REJECTED'
  | 'FILE_INVALID'
  | 'UPLOAD_FAILED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL';

/** Erro de domínio com mensagem segura para o cliente. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    /** Dados adicionais seguros para o cliente (sem caminhos internos ou conteúdo). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (message = 'Recurso não encontrado') => new AppError(404, 'NOT_FOUND', message);
export const forbidden = (message = 'Ação não permitida') => new AppError(403, 'FORBIDDEN', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
