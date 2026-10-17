import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { AuthenticatedContext, RequestContext } from '../modules/context.js';
import type { AuditService } from '../modules/audit/service.js';
import { PASSWORD_MAX, PASSWORD_MIN } from '../modules/identity/passwords.js';
import type { IdentityService } from '../modules/identity/service.js';
import { pageQuery } from '../modules/pagination.js';
import type { TeamService } from '../modules/teams/service.js';
import type { UserAdminService } from '../modules/users/service.js';
import { AppError } from './errors.js';
import type { RateLimiter } from './rate-limit.js';

export const SESSION_COOKIE = 'sid';

export interface Services {
  identity: IdentityService;
  users: UserAdminService;
  teams: TeamService;
  audit: AuditService;
}

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'E-mail inválido' }));
const uuid = z.uuid();
const teamRole = z.enum(['leader', 'operator']);
const teamName = z.string().trim().min(2).max(80);
const idParams = z.strictObject({ id: uuid });
const teamMemberParams = z.strictObject({ id: uuid, userId: uuid });

const parse = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new AppError(400, 'VALIDATION_FAILED', result.error.issues[0]?.message ?? 'Entrada inválida');
  return result.data;
};

const requestContext = (request: FastifyRequest): RequestContext => {
  const userAgent = request.headers['user-agent'];
  return { correlationId: request.id, ...(userAgent ? { userAgent } : {}) };
};

export function registerRoutes(
  app: FastifyInstance,
  deps: { services: Services; config: Config; loginLimiter: RateLimiter; signupLimiter: RateLimiter },
) {
  const { services, config } = deps;

  const auth = (request: FastifyRequest): AuthenticatedContext => {
    if (!request.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Sessão ausente ou expirada');
    return { ...requestContext(request), actor: request.auth.actor, sessionId: request.auth.sessionId };
  };

  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date) =>
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.COOKIE_SECURE,
      path: '/',
      expires: expiresAt,
    });
  const clearSessionCookie = (reply: FastifyReply) =>
    reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.COOKIE_SECURE, path: '/' });

  const limit = (limiter: RateLimiter, keys: string[]) => {
    // Avalia todas as chaves para que nenhuma fique sem contagem.
    const allowed = keys.map((key) => limiter.hit(key)).every(Boolean);
    if (!allowed) throw new AppError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.');
  };

  // ---------- Identidade ----------
  app.post('/api/v1/auth/signup', async (request, reply) => {
    const body = parse(
      z.strictObject({ email, displayName: z.string().trim().min(1).max(120), password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX) }),
      request.body,
    );
    limit(deps.signupLimiter, [`ip:${request.ip}`]);
    await services.identity.signup(body, requestContext(request));
    return reply.code(202).send({ status: 'pending', message: 'Cadastro recebido. O acesso depende de aprovação.' });
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = parse(z.strictObject({ email, password: z.string().min(1).max(PASSWORD_MAX) }), request.body);
    limit(deps.loginLimiter, [`ip:${request.ip}`, `email:${body.email}`]);
    const result = await services.identity.login(body, requestContext(request));
    deps.loginLimiter.reset(`email:${body.email}`);
    setSessionCookie(reply, result.token, result.expiresAt);
    return { user: result.user, memberships: await services.identity.listMemberships(result.user.id) };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (request.auth) await services.identity.logout(auth(request));
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/v1/auth/me', async (request) => {
    const ctx = auth(request);
    return { user: request.auth!.user, memberships: await services.identity.listMemberships(ctx.actor.id) };
  });

  app.get('/api/v1/auth/sessions', async (request) => ({ items: await services.identity.listOwnSessions(auth(request)) }));

  app.delete('/api/v1/auth/sessions/:id', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    await services.identity.revokeOwnSession(ctx, id);
    if (id === ctx.sessionId) clearSessionCookie(reply);
    return reply.code(204).send();
  });

  // ---------- Administração de usuários (Diretor) ----------
  app.get('/api/v1/users', async (request) => {
    const ctx = auth(request);
    const query = parse(
      z.strictObject({ status: z.enum(['pending', 'active', 'suspended', 'rejected']).optional(), ...pageQuery }),
      request.query,
    );
    return services.users.list(ctx, {
      limit: query.limit,
      ...(query.status ? { status: query.status } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });

  for (const action of ['approve', 'reject', 'suspend', 'reactivate'] as const) {
    app.post(`/api/v1/users/:id/${action}`, async (request) => {
      const ctx = auth(request);
      const { id } = parse(idParams, request.params);
      return { user: await services.users.changeStatus(ctx, id, action) };
    });
  }

  app.put('/api/v1/users/:id/org-role', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ orgRole: z.enum(['director', 'member']) }), request.body);
    return { user: await services.users.setOrgRole(ctx, id, body.orgRole) };
  });

  app.post('/api/v1/users/:id/sessions/revoke', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return { revoked: await services.identity.revokeAllSessionsOf(ctx, id) };
  });

  // ---------- Equipes ----------
  app.get('/api/v1/teams', async (request) => ({ items: await services.teams.list(auth(request)) }));

  app.post('/api/v1/teams', async (request, reply) => {
    const ctx = auth(request);
    const body = parse(z.strictObject({ name: teamName }), request.body);
    return reply.code(201).send({ team: await services.teams.create(ctx, body.name) });
  });

  app.get('/api/v1/teams/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return { team: await services.teams.get(ctx, id) };
  });

  app.patch('/api/v1/teams/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ name: teamName }), request.body);
    return { team: await services.teams.rename(ctx, id, body.name) };
  });

  app.get('/api/v1/teams/:id/members', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return { items: await services.teams.listMembers(ctx, id) };
  });

  app.post('/api/v1/teams/:id/members', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ email, role: teamRole }), request.body);
    return reply.code(201).send({ member: await services.teams.addMember(ctx, id, body) });
  });

  app.patch('/api/v1/teams/:id/members/:userId', async (request) => {
    const ctx = auth(request);
    const { id, userId } = parse(teamMemberParams, request.params);
    const body = parse(z.strictObject({ role: teamRole }), request.body);
    return { member: await services.teams.changeMemberRole(ctx, id, userId, body.role) };
  });

  app.delete('/api/v1/teams/:id/members/:userId', async (request, reply) => {
    const ctx = auth(request);
    const { id, userId } = parse(teamMemberParams, request.params);
    await services.teams.removeMember(ctx, id, userId);
    return reply.code(204).send();
  });

  // ---------- Auditoria (Diretor) ----------
  app.get('/api/v1/audit-events', async (request) => {
    const ctx = auth(request);
    const query = parse(z.strictObject({ action: z.string().max(64).optional(), ...pageQuery }), request.query);
    return services.audit.list(ctx, {
      limit: query.limit,
      ...(query.action ? { action: query.action } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });
}
