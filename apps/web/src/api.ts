export type UserStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type OrgRole = 'director' | 'member';
export type TeamRole = 'leader' | 'operator';

export interface User {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  orgRole: OrgRole;
  createdAt: string;
}

export interface Membership {
  teamId: string;
  teamName: string;
  role: TeamRole;
}

export interface Me {
  user: User;
  memberships: Membership[];
}

export interface Team {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  myRole: TeamRole | null;
}

export interface TeamMember {
  userId: string;
  email: string;
  displayName: string;
  status: UserStatus;
  role: TeamRole;
  addedAt: string;
}

export interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: { id: string; displayName: string | null } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  teamId: string | null;
  metadata: Record<string, unknown>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | undefined;

/** Chamado quando uma requisição autenticada recebe 401 (sessão expirada ou revogada). */
export const setUnauthorizedHandler = (handler: (() => void) | undefined) => {
  unauthorizedHandler = handler;
  return () => {
    unauthorizedHandler = undefined;
  };
};

/** Chamada à API na mesma origem (proxy do Vite). Cookie de sessão é HttpOnly; o cliente nunca vê o token. */
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-CSRF-Protection'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => undefined);
  if (response.status === 401 && !path.startsWith('/auth/login')) unauthorizedHandler?.();
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? 'Falha na comunicação com o servidor');
  }
  return data as T;
}

export const roleLabel: Record<TeamRole, string> = { leader: 'Líder', operator: 'Operador' };
export const statusLabel: Record<UserStatus, string> = {
  pending: 'Pendente',
  active: 'Ativo',
  suspended: 'Suspenso',
  rejected: 'Rejeitado',
};
