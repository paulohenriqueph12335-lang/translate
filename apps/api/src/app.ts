import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import type { Actor } from './modules/access/policy.js';
import { createAuditService } from './modules/audit/service.js';
import { createNotificationService } from './modules/notifications/service.js';
import { createNumberingService } from './modules/numbering/service.js';
import { createTranslatorNumberingService } from './modules/numbering/translator-numbering.js';
import { createProfileService } from './modules/translations/profiles.js';
import { createPatternService } from './modules/patterns/service.js';
import { createTranslatorService } from './modules/translators/service.js';
import { createDashboardService } from './modules/dashboards/service.js';
import { createDocumentService } from './modules/documents/service.js';
import { createTranslationService } from './modules/translations/service.js';
import { createIdentityService, type PublicUser } from './modules/identity/service.js';
import { createTeamService } from './modules/teams/service.js';
import { createUserAdminService } from './modules/users/service.js';
import { createS3Storage, type ObjectStorage } from '@tradutor/core/storage';
import { machineTranslatorsFromEnv, type MachineProviderName, type MachineTranslator } from '@tradutor/core/translation';
import { AppError } from './http/errors.js';
import { createRateLimiter } from './http/rate-limit.js';
import { registerRoutes, SESSION_COOKIE } from './http/routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: { actor: Actor; sessionId: string; user: PublicUser } | null;
  }
}

const CORRELATION_HEADER = 'x-correlation-id';
const CSRF_HEADER = 'x-csrf-protection';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AppDeps {
  config: Config;
  pool: Pool;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  rateLimits?: { login: RateLimitOptions; signup: RateLimitOptions };
  /** Armazenamento de objetos; padrão é o S3 configurado. Testes injetam falhas por aqui. */
  storage?: ObjectStorage;
  /** Provedores gratuitos para a revisão automática; padrão é o do ambiente. Testes injetam um falso. */
  machine?: Partial<Record<MachineProviderName, MachineTranslator>>;
}

interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

const defaultRateLimits = { login: { limit: 10, windowMs: 15 * 60_000 }, signup: { limit: 5, windowMs: 60 * 60_000 } };

export async function buildApp({
  config,
  pool,
  logger,
  now,
  rateLimits = defaultRateLimits,
  storage = createS3Storage(config),
  machine = machineTranslatorsFromEnv({
    ...(config.LIBRETRANSLATE_URL ? { LIBRETRANSLATE_URL: config.LIBRETRANSLATE_URL } : {}),
    ...(config.LIBRETRANSLATE_API_KEY ? { LIBRETRANSLATE_API_KEY: config.LIBRETRANSLATE_API_KEY } : {}),
    ...(config.DEEPL_API_KEY ? { DEEPL_API_KEY: config.DEEPL_API_KEY } : {}),
  }),
}: AppDeps) {
  const app = Fastify({
    logger: logger ?? {
      level: config.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    genReqId: (request) => {
      const incoming = request.headers[CORRELATION_HEADER];
      return typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
  });

  const deps = { pool, config, ...(now ? { now } : {}) };
  const translators = createTranslatorService({ ...deps, storage });
  const translatorNumbering = createTranslatorNumberingService(deps);
  const services = {
    identity: createIdentityService(deps),
    users: createUserAdminService(deps),
    teams: createTeamService(deps),
    audit: createAuditService(deps),
    documents: createDocumentService({ ...deps, storage }),
    translations: createTranslationService({ ...deps, storage, masks: translators.maskFor, numbering: translatorNumbering, machine }),
    translatorNumbering,
    profiles: createProfileService(deps),
    patterns: createPatternService({ ...deps, machine }),
    translators,
    notifications: createNotificationService(deps),
    numbering: createNumberingService({ ...deps, storage, masks: translators.maskFor }),
    dashboards: createDashboardService(deps),
  };

  await app.register(cookie);
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request, reply) => {
    reply.header(CORRELATION_HEADER, request.id);
    reply.header('cache-control', 'no-store');
    if (!request.url.startsWith('/api/')) return;
    // Cabeçalho customizado força preflight entre origens; sem CORS, requisições forjadas falham (ADR-003).
    if (UNSAFE_METHODS.has(request.method) && request.headers[CSRF_HEADER] !== '1') {
      throw new AppError(403, 'CSRF_HEADER_MISSING', 'Cabeçalho de proteção ausente');
    }
    const token = request.cookies[SESSION_COOKIE];
    if (token && token.length <= 128) request.auth = await services.identity.authenticate(token);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          correlationId: request.id,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'VALIDATION_FAILED', message: 'Requisição inválida', correlationId: request.id } });
    }
    request.log.error({ err: error }, 'Erro interno');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Erro interno', correlationId: request.id } });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Recurso não encontrado', correlationId: request.id } }),
  );

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const [database, objects] = await Promise.all([
      pool.query('SELECT 1').then(
        () => 'ok' as const,
        () => 'unavailable' as const,
      ),
      storage.isReady().then((ready) => (ready ? ('ok' as const) : ('unavailable' as const))),
    ]);
    const ok = database === 'ok' && objects === 'ok';
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'unavailable', dependencies: { database, storage: objects } });
  });

  registerRoutes(app, {
    services,
    config,
    loginLimiter: createRateLimiter(rateLimits.login),
    signupLimiter: createRateLimiter(rateLimits.signup),
  });

  return app;
}
