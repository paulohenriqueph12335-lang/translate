import type { Pool } from 'pg';
import type { Config } from '../config.js';
import type { Actor } from './access/policy.js';

/** Dados da requisição que os serviços podem usar sem depender do framework HTTP. */
export interface RequestContext {
  correlationId: string;
  userAgent?: string;
}

export interface AuthenticatedContext extends RequestContext {
  actor: Actor;
  sessionId: string;
}

export interface ServiceDeps {
  pool: Pool;
  config: Config;
  now?: () => Date;
}
