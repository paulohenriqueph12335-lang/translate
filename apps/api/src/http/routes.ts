import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { AuthenticatedContext, RequestContext } from '../modules/context.js';
import type { AiService } from '../modules/ai/service.js';
import type { AuditService } from '../modules/audit/service.js';
import { ALLOWED_EXTENSIONS } from '../modules/documents/format.js';
import type { DocumentService } from '../modules/documents/service.js';
import type { NotificationService } from '../modules/notifications/service.js';
import type { NumberingService } from '../modules/numbering/service.js';
import { NumberingConfig, SCHEMES } from '../modules/numbering/rules.js';
import type { TranslatorNumberingService } from '../modules/numbering/translator-numbering.js';
import type { ProfileService } from '../modules/translations/profiles.js';
import type { PatternService } from '../modules/patterns/service.js';
import type { DashboardService } from '../modules/dashboards/service.js';
import { MAX_MASK_BYTES, type TranslatorService } from '../modules/translators/service.js';
import type { TranslationService } from '../modules/translations/service.js';
import {
  Draft,
  FRAME_MODEL_INFO,
  FRAME_MODELS,
  fillMask,
  LANGUAGES,
  MODES,
  renderFrameModel,
  TranslationRules,
} from '@tradutor/core/translation';
import { PASSWORD_MAX, PASSWORD_MIN } from '../modules/identity/passwords.js';
import type { IdentityService } from '../modules/identity/service.js';
import { pageQuery } from '../modules/pagination.js';
import type { TeamService } from '../modules/teams/service.js';
import type { UserAdminService } from '../modules/users/service.js';
import { AppError } from './errors.js';
import { contentDisposition } from './content-disposition.js';
import { docxToPdf, pdfName } from './pdf.js';
import type { RateLimiter } from './rate-limit.js';

export const SESSION_COOKIE = 'sid';

export interface Services {
  identity: IdentityService;
  users: UserAdminService;
  teams: TeamService;
  audit: AuditService;
  documents: DocumentService;
  translations: TranslationService;
  notifications: NotificationService;
  numbering: NumberingService;
  translatorNumbering: TranslatorNumberingService;
  profiles: ProfileService;
  patterns: PatternService;
  dashboards: DashboardService;
  translators: TranslatorService;
  ai: AiService;
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
/** Data AAAA-MM-DD dos filtros de período. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)');
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
/** Lista separada por vírgulas em query string, validada item a item. */
const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .max(500)
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(item));
/** Etiqueta: minúsculas, sem espaços nas pontas; até 10 por documento. */
const tag = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' '));
const tags = z
  .array(tag)
  .max(10, 'Até 10 etiquetas por documento')
  .transform((list) => [...new Set(list)]);
/** Remove chaves indefinidas, para os serviços com exactOptionalPropertyTypes. */
const defined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
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

  app.get('/api/v1/teams/:id/candidates', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const query = parse(
      z.strictObject({
        q: z.string().trim().max(100).optional(),
        assignment: z.enum(['any', 'unassigned', 'assigned']).default('any'),
        ...pageQuery,
      }),
      request.query,
    );
    return services.teams.listCandidates(ctx, id, {
      assignment: query.assignment,
      limit: query.limit,
      ...(query.q ? { q: query.q } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });

  app.post('/api/v1/teams/:id/members', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(
      z.union([z.strictObject({ email, role: teamRole }), z.strictObject({ userId: uuid, role: teamRole })]),
      request.body,
    );
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
    const query = parse(
      z.strictObject({
        action: z.string().max(64).optional(),
        category: z
          .string()
          .regex(/^[a-z_]{1,32}$/)
          .optional(),
        actorId: uuid.optional(),
        system: flag.optional(),
        teamId: uuid.optional(),
        targetType: z.string().max(32).optional(),
        targetId: z.string().max(64).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        q: z.string().trim().max(100).optional(),
        ...pageQuery,
      }),
      request.query,
    );
    return services.audit.list(ctx, defined({ ...query, q: query.q || undefined }));
  });

  app.get('/api/v1/audit-events/facets', async (request) => services.audit.facets(auth(request)));

  // ---------- Lotes e documentos (ADR-006) ----------
  const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, 'Idempotency-Key inválida');

  app.post('/api/v1/batches', async (request, reply) => {
    const ctx = auth(request);
    const body = parse(
      z.strictObject({
        teamId: uuid.optional(),
        name: z.string().trim().min(1).max(120).optional(),
        // Todo documento enviado é processado (ADR-010); sem par informado, PT → EN.
        translation: z
          .strictObject({ sourceLanguage: z.enum(LANGUAGES), targetLanguage: z.enum(LANGUAGES) })
          .refine((pair) => pair.sourceLanguage !== pair.targetLanguage, 'Idiomas de origem e destino iguais')
          .default({ sourceLanguage: 'pt', targetLanguage: 'en' }),
        tags: tags.optional(),
        // Juramentada, certificada, técnica ou simples (ADR-015); sem informar, juramentada.
        mode: z.enum(MODES).optional(),
        // Juramentada com ou sem máscara, e o tradutor da máscara (ADR-017).
        useMask: z.boolean().optional(),
        translatorId: uuid.optional(),
        files: z
          .array(
            z.strictObject({
              name: z
                .string()
                .trim()
                .min(1)
                .max(255)
                .refine((name) => !/[\\/\u0000-\u001f]/.test(name), 'Nome de arquivo inválido'),
              size: z.number().int().min(0),
            }),
          )
          .min(1, 'Envie ao menos um arquivo'),
      }),
      request.body,
    );
    const header = request.headers['idempotency-key'];
    const key = header === undefined ? undefined : parse(idempotencyKey, header);
    const result = await services.documents.createBatch(
      ctx,
      {
        files: body.files,
        translation: body.translation,
        ...(body.tags ? { tags: body.tags } : {}),
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.useMask !== undefined ? { useMask: body.useMask } : {}),
        ...(body.translatorId ? { translatorId: body.translatorId } : {}),
        ...(body.teamId ? { teamId: body.teamId } : {}),
        ...(body.name ? { name: body.name } : {}),
      },
      key,
    );
    return reply.code(result.replayed ? 200 : 201).send({ batch: result.batch, documents: result.documents });
  });

  app.get('/api/v1/batches', async (request) => {
    const ctx = auth(request);
    const query = parse(
      z.strictObject({
        teamId: uuid.optional(),
        unassigned: z.enum(['true', 'false']).optional(),
        status: z.enum(['open', 'completed']).optional(),
        mine: z.enum(['true', 'false']).optional(),
        q: z.string().trim().max(100).optional(),
        ...pageQuery,
      }),
      request.query,
    );
    return services.documents.listBatches(ctx, {
      limit: query.limit,
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.unassigned === 'true' ? { unassigned: true } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.mine === 'true' ? { mine: true } : {}),
      ...(query.q ? { q: query.q } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });

  // Limites para a interface validar antes de enviar; o servidor continua sendo quem decide.
  app.get('/api/v1/batches/limits', async (request) => {
    auth(request);
    return {
      maxFileMb: config.UPLOAD_MAX_FILE_MB,
      maxBatchFiles: config.UPLOAD_MAX_BATCH_FILES,
      maxBatchMb: config.UPLOAD_MAX_BATCH_MB,
      extensions: ALLOWED_EXTENSIONS,
    };
  });

  app.get('/api/v1/batches/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const result = await services.documents.getBatch(ctx, id);
    // Visibilidade já verificada pelo lote; as traduções de cada documento seguem a mesma regra.
    const translations = await services.translations.forDocuments(result.documents.map((doc) => doc.id));
    return { ...result, documents: result.documents.map((doc) => ({ ...doc, translations: translations.get(doc.id) ?? [] })) };
  });

  app.post('/api/v1/batches/:id/assign', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ teamId: uuid }), request.body);
    return services.documents.assignBatch(ctx, id, body.teamId);
  });

  app.post('/api/v1/batches/:id/cancel', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.documents.cancelBatch(ctx, id);
  });

  app.get('/api/v1/documents', async (request) => {
    const ctx = auth(request);
    const query = parse(
      z.strictObject({
        q: z.string().trim().max(100).optional(),
        teamId: uuid.optional(),
        unassigned: flag.optional(),
        batchId: uuid.optional(),
        mine: flag.optional(),
        uploadedBy: uuid.optional(),
        status: csv(z.enum(['awaiting_upload', 'uploading', 'stored', 'rejected', 'upload_failed', 'cancelled'])).optional(),
        format: csv(z.enum(['pdf', 'docx', 'pptx', 'jpeg', 'png'])).optional(),
        tag: tag.optional(),
        untagged: flag.optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        translation: z.enum(['none', 'active', 'approved', 'failed']).optional(),
        ...pageQuery,
      }),
      request.query,
    );
    return services.documents.searchDocuments(ctx, defined({ ...query, q: query.q || undefined }));
  });

  app.put('/api/v1/documents/:id/tags', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ tags }), request.body);
    return { document: await services.documents.updateTags(ctx, id, body.tags) };
  });

  app.get('/api/v1/tags', async (request) => ({ items: await services.documents.listTags(auth(request)) }));

  app.post('/api/v1/documents/:id/cancel', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return { document: await services.documents.cancelDocument(ctx, id) };
  });

  app.get('/api/v1/documents/:id/original', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const file = await services.documents.openOriginal(ctx, id);
    return reply
      .header('content-type', file.contentType)
      .header('content-length', String(file.size))
      .header('content-disposition', contentDisposition(file.name))
      .header('x-content-type-options', 'nosniff')
      .send(file.stream);
  });

  // O conteúdo chega como fluxo bruto; o limite global de corpo não se aplica aqui, e o serviço impõe o tamanho declarado.
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
    scope.put('/api/v1/documents/:id/content', async (request) => {
      const ctx = auth(request);
      const { id } = parse(idParams, request.params);
      if (request.headers['content-type'] !== 'application/octet-stream') {
        throw new AppError(400, 'VALIDATION_FAILED', 'Envie o arquivo como application/octet-stream');
      }
      const length = request.headers['content-length'];
      const contentLength = length && /^\d+$/.test(length) ? Number(length) : undefined;
      return { document: await services.documents.uploadContent(ctx, id, request.body as Readable, contentLength) };
    });
  });

  // ---------- Traduções juramentadas (ADR-007) ----------
  const language = z.enum(LANGUAGES);
  const translationStatus = z.enum(['queued', 'processing', 'in_review', 'awaiting_approval', 'approved', 'failed', 'cancelled']);
  const optionalText = (max: number) =>
    z
      .string()
      .trim()
      .max(max)
      .transform((value) => value || null)
      .nullable();

  // Diagnóstico para a interface: há worker ativo, tradução automática disponível e tradutor público configurado?
  app.get('/api/v1/translation-capabilities', async (request) => {
    auth(request);
    return services.translations.capabilities();
  });

  app.put('/api/v1/machine-translation-settings', async (request) => {
    const ctx = auth(request);
    const body = parse(z.strictObject({ provider: z.enum(['libretranslate', 'deepl', 'none']) }), request.body);
    return services.translations.setMachineProvider(ctx, body.provider);
  });

  app.post('/api/v1/documents/:id/translations', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(
      z.strictObject({
        sourceLanguage: language,
        targetLanguage: language,
        mode: z.enum(['auto', 'manual']).default('auto'),
        translationMode: z.enum(MODES).optional(),
      }),
      request.body,
    );
    return reply.code(201).send(await services.translations.start(ctx, id, defined(body)));
  });

  // ---------- Modalidades e regras de tradução (ADR-015) ----------
  app.get('/api/v1/translation-profiles', async (request) => services.profiles.list(auth(request)));

  app.put('/api/v1/translation-profiles/:mode/:target', async (request) => {
    const ctx = auth(request);
    const params = parse(z.strictObject({ mode: z.enum(MODES), target: z.enum(LANGUAGES) }), request.params);
    const body = parse(z.strictObject({ rules: TranslationRules.nullable() }), request.body);
    return services.profiles.set(ctx, params.mode, params.target, body.rules);
  });

  app.put('/api/v1/translations/:id/checks', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(
      z.strictObject({
        keys: z
          .array(z.string().regex(/^[a-z]+:\d{1,3}$/))
          .min(1)
          .max(100),
        checked: z.boolean(),
      }),
      request.body,
    );
    return services.translations.setChecks(ctx, id, body);
  });

  app.get('/api/v1/translations', async (request) => {
    const ctx = auth(request);
    const query = parse(
      z.strictObject({
        status: csv(translationStatus).optional(),
        teamId: uuid.optional(),
        unassigned: flag.optional(),
        documentId: uuid.optional(),
        batchId: uuid.optional(),
        sourceLanguage: language.optional(),
        targetLanguage: language.optional(),
        tag: tag.optional(),
        documentType: z.string().trim().max(200).optional(),
        translationMode: z.enum(MODES).optional(),
        patternKnown: flag.optional(),
        approvedBy: uuid.optional(),
        mine: flag.optional(),
        assigneeId: uuid.optional(),
        unclaimed: flag.optional(),
        annulled: flag.optional(),
        uploadedBy: uuid.optional(),
        createdFrom: isoDate.optional(),
        createdTo: isoDate.optional(),
        approvedFrom: isoDate.optional(),
        approvedTo: isoDate.optional(),
        q: z.string().trim().max(100).optional(),
        ...pageQuery,
      }),
      request.query,
    );
    return services.translations.list(ctx, defined({ ...query, q: query.q || undefined, documentType: query.documentType || undefined }));
  });

  app.get('/api/v1/translation-facets', async (request) => services.translations.facets(auth(request)));

  app.get('/api/v1/translations/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translations.get(ctx, id);
  });

  app.get('/api/v1/translations/:id/revisions', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return { items: await services.translations.revisions(ctx, id) };
  });

  app.get('/api/v1/translations/:id/revisions/:revision', async (request) => {
    const ctx = auth(request);
    const params = parse(z.strictObject({ id: uuid, revision: z.coerce.number().int().min(1) }), request.params);
    return services.translations.revision(ctx, params.id, params.revision);
  });

  // Rascunhos de documentos longos passam do limite padrão de 64 KiB.
  app.put('/api/v1/translations/:id/draft', { bodyLimit: 2 * 1024 * 1024 }, async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ baseRevision: z.number().int().min(1), draft: Draft }), request.body);
    return services.translations.saveDraft(ctx, id, body);
  });

  app.post('/api/v1/translations/:id/submit', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translations.submit(ctx, id);
  });

  // Aprovar o Word (ADR-017): leva a tradução à próxima fase (pronta para conclusão, ou concluída por quem conclui).
  app.post('/api/v1/translations/:id/accept', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translations.accept(ctx, id);
  });

  // Revisão automática (ADR-016): corrige o rascunho atual e devolve o que mudou.
  app.post('/api/v1/translations/:id/auto-review', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translations.autoReviewDraft(ctx, id);
  });

  app.post('/api/v1/translations/:id/return', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ comment: z.string().trim().min(3).max(2000), reprocess: z.boolean().optional() }), request.body);
    return services.translations.returnForChanges(ctx, id, defined(body));
  });

  app.post('/api/v1/translations/:id/approve', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const label = z.string().trim().min(1).max(40);
    const body = parse(
      z.strictObject({
        overrideReason: z.string().trim().min(10).max(1000).optional(),
        // Tradutor juramentado e numeração dele, digitada conforme as regras do tradutor (ADR-012).
        translatorId: uuid.optional(),
        number: label.optional(),
        book: label.optional(),
        sheet: label.optional(),
      }),
      request.body,
    );
    return services.translations.approve(ctx, id, defined(body));
  });

  app.post('/api/v1/translations/:id/cancel', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translations.cancel(ctx, id);
  });

  app.post('/api/v1/translations/:id/claim', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translations.claim(ctx, id);
  });

  app.put('/api/v1/translations/:id/assignee', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ userId: uuid }), request.body);
    return services.translations.reassign(ctx, id, body.userId);
  });

  app.post('/api/v1/translations/:id/numbering-requests', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const positive = z.string().trim().min(1).max(40).optional();
    const body = parse(
      z
        .strictObject({
          kind: z.enum(['change', 'annul']),
          reason: z.string().trim().min(5).max(1000),
          number: positive,
          book: positive,
          sheet: positive,
        })
        .refine(
          (value) => value.kind === 'annul' || value.number || value.book || value.sheet,
          'Informe o número, o livro ou a folha corretos',
        ),
      request.body,
    );
    return reply.code(201).send(await services.numbering.createRequest(ctx, id, defined(body)));
  });

  // ---------- Numeração e painéis (plano de hierarquia) ----------
  const year = z.coerce.number().int().min(2000).max(2999);

  app.get('/api/v1/numbering', async (request) => {
    const ctx = auth(request);
    const query = parse(z.strictObject({ year: year.optional() }), request.query);
    return services.numbering.overview(ctx, query.year);
  });

  app.put('/api/v1/numbering/quotas', async (request) => {
    const ctx = auth(request);
    const body = parse(
      z.strictObject({
        year,
        scope: z.enum(['organization', 'team', 'user']),
        teamId: uuid.optional(),
        userId: uuid.optional(),
        quota: z.number().int().min(1).max(1_000_000).nullable(),
      }),
      request.body,
    );
    return services.numbering.setQuota(ctx, defined(body));
  });

  app.get('/api/v1/numbering-requests', async (request) => {
    const ctx = auth(request);
    const query = parse(z.strictObject({ status: z.enum(['pending', 'approved', 'rejected', 'reverted']).optional() }), request.query);
    return services.numbering.listRequests(ctx, defined(query));
  });

  app.post('/api/v1/numbering-requests/:id/decide', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ approve: z.boolean(), note: z.string().trim().min(1).max(1000).optional() }), request.body);
    return services.numbering.decide(ctx, id, defined(body));
  });

  app.post('/api/v1/numbering-requests/:id/revert', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.numbering.revert(ctx, id);
  });

  const period = { from: isoDate.optional(), to: isoDate.optional(), teamId: uuid.optional() };

  app.get('/api/v1/dashboards/organization', async (request) => {
    const ctx = auth(request);
    return services.dashboards.organization(ctx, defined(parse(z.strictObject(period), request.query)));
  });

  // Protocolos com IA × sem IA (ADR-022): Diretor e Supervisores.
  app.get('/api/v1/dashboards/ai-comparison', async (request) => {
    const ctx = auth(request);
    return services.dashboards.aiComparison(ctx, defined(parse(z.strictObject(period), request.query)));
  });

  app.get('/api/v1/dashboards/team', async (request) => {
    const ctx = auth(request);
    return services.dashboards.team(ctx, defined(parse(z.strictObject(period), request.query)));
  });

  app.post('/api/v1/translations/:id/reprocess', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translations.reprocess(ctx, id);
  });

  app.get('/api/v1/translations/:id/preview', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const query = parse(
      z.strictObject({
        revision: z.coerce.number().int().min(1).optional(),
        translatorId: uuid.optional(),
        // PDF do mesmo Word, para ver na tela ou baixar (ADR-017).
        format: z.enum(['docx', 'pdf']).optional(),
        download: flag.optional(),
      }),
      request.query,
    );
    const file = await services.translations.preview(ctx, id, query.revision, query.translatorId);
    if (query.format === 'pdf') {
      const pdf = await docxToPdf(config.CONVERTER_URL, file.docx, file.name);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', contentDisposition(pdfName(file.name), query.download ? 'attachment' : 'inline'))
        .header('x-content-type-options', 'nosniff')
        .send(pdf);
    }
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', contentDisposition(file.name))
      .header('x-content-type-options', 'nosniff')
      .send(file.docx);
  });

  app.get('/api/v1/translations/:id/final', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const query = parse(z.strictObject({ format: z.enum(['docx', 'pdf']).optional(), download: flag.optional() }), request.query);
    const file = await services.translations.openFinal(ctx, id);
    if (query.format === 'pdf') {
      const chunks: Buffer[] = [];
      for await (const chunk of file.stream as Readable) chunks.push(chunk as Buffer);
      const pdf = await docxToPdf(config.CONVERTER_URL, Buffer.concat(chunks), file.name);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', contentDisposition(pdfName(file.name), query.download ? 'attachment' : 'inline'))
        .header('x-content-type-options', 'nosniff')
        .send(pdf);
    }
    return reply
      .header('content-type', file.contentType)
      .header('content-disposition', contentDisposition(file.name))
      .header('x-content-type-options', 'nosniff')
      .send(file.stream);
  });

  // ---------- Tradutores juramentados (ADR-012) ----------
  const translatorBody = {
    name: z.string().trim().min(3).max(160),
    registration: optionalText(240).optional(),
    languages: optionalText(120).optional(),
    notes: optionalText(2000).optional(),
  };

  app.get('/api/v1/sworn-translators', async (request) => {
    const ctx = auth(request);
    const query = parse(z.strictObject({ active: flag.optional() }), request.query);
    return { items: await services.translators.list(ctx, defined(query)) };
  });

  app.post('/api/v1/sworn-translators', async (request, reply) => {
    const ctx = auth(request);
    const body = parse(z.strictObject({ ...translatorBody, active: z.boolean().optional() }), request.body);
    const input = {
      name: body.name,
      registration: body.registration ?? null,
      languages: body.languages ?? null,
      notes: body.notes ?? null,
      ...(body.active !== undefined ? { active: body.active } : {}),
    };
    return reply.code(201).send({ translator: await services.translators.create(ctx, input) });
  });

  // ---------- Regras de numeração por tradutor (ADR-014) ----------
  const entryText = (max: number) => z.string().trim().max(max).nullable().optional();
  const entryBody = z.strictObject({
    translatorId: uuid,
    number: entryText(40),
    book: entryText(40),
    pages: z.number().int().min(1).max(10_000).nullable().optional(),
    protocol: entryText(60),
    medium: z.enum(['digital', 'impresso']).nullable().optional(),
    language: entryText(40),
    free: z.boolean().optional(),
    protocolValue: z.number().min(0).max(1_000_000).nullable().optional(),
    translatorFee: z.number().min(0).max(1_000_000).nullable().optional(),
  });

  app.get('/api/v1/sworn-translators/:id/numbering', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translatorNumbering.getRule(ctx, id);
  });

  app.put('/api/v1/sworn-translators/:id/numbering', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ scheme: z.enum(SCHEMES), config: NumberingConfig }), request.body);
    return services.translatorNumbering.setRule(ctx, id, body);
  });

  // Planilha CSV lida pelo navegador e enviada como texto (até 5 MB).
  app.post('/api/v1/sworn-translators/:id/numbering/stock', { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(
      z.strictObject({
        fileName: z.string().trim().min(1).max(255),
        text: z
          .string()
          .min(1)
          .max(5 * 1024 * 1024),
        language: z.string().trim().max(40).optional(),
        free: z.boolean().optional(),
      }),
      request.body,
    );
    return reply.code(201).send(await services.translatorNumbering.importStock(ctx, id, defined(body)));
  });

  app.get('/api/v1/sworn-translators/:id/numbering/stock', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const query = parse(
      z.strictObject({
        status: z.enum(['available', 'reserved', 'blocked']).optional(),
        usage: z.enum(['unused', 'used', 'exhausted']).optional(),
        language: z.string().trim().max(40).optional(),
        free: flag.optional(),
        q: z.string().trim().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      }),
      request.query,
    );
    return services.translatorNumbering.listStock(ctx, id, defined({ ...query, q: query.q || undefined }));
  });

  app.patch('/api/v1/numbering-stock/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(
      z.strictObject({
        status: z.enum(['available', 'reserved', 'blocked']).optional(),
        reservedFor: uuid.nullable().optional(),
        notifyOnUse: z.boolean().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      }),
      request.body,
    );
    return services.translatorNumbering.updateStock(ctx, id, defined(body));
  });

  app.delete('/api/v1/numbering-stock/:id', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    await services.translatorNumbering.deleteStock(ctx, id);
    return reply.code(204).send();
  });

  app.get('/api/v1/sworn-translators/:id/numbering/books', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translatorNumbering.listBooks(ctx, id);
  });

  app.post('/api/v1/sworn-translators/:id/numbering/books', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(
      z.strictObject({
        book: z.string().trim().min(1).max(40),
        nextNumber: z.number().int().min(1).max(100_000_000),
        nextSheet: z.number().int().min(1).max(100_000).optional(),
      }),
      request.body,
    );
    return reply.code(201).send(await services.translatorNumbering.addBook(ctx, id, defined(body)));
  });

  app.delete('/api/v1/numbering-books/:id', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    await services.translatorNumbering.removeBook(ctx, id);
    return reply.code(204).send();
  });

  app.get('/api/v1/numbering/translators', async (request) => services.translatorNumbering.dashboard(auth(request)));

  app.get('/api/v1/translations/:id/numbering', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const query = parse(z.strictObject({ translatorId: uuid.optional() }), request.query);
    return services.translatorNumbering.getEntry(ctx, id, query.translatorId);
  });

  app.put('/api/v1/translations/:id/numbering', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(entryBody, request.body);
    return services.translatorNumbering.saveEntry(ctx, id, defined(body));
  });

  app.post('/api/v1/translations/:id/numbering/authorize-zero-protocol', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.translatorNumbering.authorizeZeroProtocol(ctx, id);
  });

  app.get('/api/v1/sworn-translators/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return { translator: await services.translators.get(ctx, id) };
  });

  app.patch('/api/v1/sworn-translators/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ ...translatorBody, active: z.boolean() }).partial(), request.body);
    return { translator: await services.translators.update(ctx, id, defined(body)) };
  });

  const sendFile = (reply: FastifyReply, file: { stream: Readable; name: string; contentType: string }) =>
    reply
      .header('content-type', file.contentType)
      .header('content-disposition', contentDisposition(file.name))
      .header('x-content-type-options', 'nosniff')
      .send(file.stream);

  // Edição da máscara em uso, uma edição específica e o PDF de referência (Supervisor e Diretor).
  app.get('/api/v1/sworn-translators/:id/mask', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    return sendFile(reply, await services.translators.openFile(auth(request), id, 'mask'));
  });
  const maskParams = z.strictObject({ id: uuid, maskId: uuid });
  app.get('/api/v1/sworn-translators/:id/masks/:maskId', async (request, reply) => {
    const { id, maskId } = parse(maskParams, request.params);
    return sendFile(reply, await services.translators.openFile(auth(request), id, 'mask', maskId));
  });
  app.get('/api/v1/sworn-translators/:id/reference-pdf', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    return sendFile(reply, await services.translators.openFile(auth(request), id, 'pdf'));
  });

  // Voltar a usar uma edição da máscara nas próximas conclusões (Supervisor).
  app.post('/api/v1/sworn-translators/:id/masks/:maskId/use', async (request) => {
    const ctx = auth(request);
    const { id, maskId } = parse(maskParams, request.params);
    return { translator: await services.translators.useMask(ctx, id, maskId) };
  });

  // ---------- Padrões de documento (ADR-017) ----------
  app.get('/api/v1/document-patterns', async (request) => services.patterns.list(auth(request)));

  // Teste de um documento novo: o arquivo chega como binário e não é guardado.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      ['application/octet-stream', 'application/pdf'],
      { parseAs: 'buffer', bodyLimit: config.UPLOAD_MAX_FILE_MB * 1024 * 1024 },
      (_request, payload, done) => done(null, payload),
    );
    scope.post('/api/v1/document-patterns/test', async (request) => {
      const ctx = auth(request);
      const query = parse(
        z.strictObject({ sourceLanguage: z.enum(LANGUAGES), targetLanguage: z.enum(LANGUAGES), mode: z.enum(MODES).default('sworn') }),
        request.query,
      );
      if (!Buffer.isBuffer(request.body) || !request.body.length)
        throw new AppError(400, 'VALIDATION_FAILED', 'Envie o arquivo do documento');
      const raw = request.headers['x-file-name'];
      const name = typeof raw === 'string' ? decodeURIComponent(raw).trim().slice(0, 255) : 'documento';
      return services.patterns.test(ctx, { data: request.body, name }, query);
    });
  });

  // ---------- Modelos de moldura do tradutor (ADR-019) ----------
  app.get('/api/v1/frame-models', async (request) => {
    auth(request);
    return { items: FRAME_MODELS.map((id) => ({ id, ...FRAME_MODEL_INFO[id] })) };
  });

  // Exemplo do modelo com os dados informados, em Word ou PDF, antes de gerar a máscara.
  app.get('/api/v1/frame-models/:model/preview', async (request, reply) => {
    auth(request);
    const { model } = parse(z.strictObject({ model: z.enum(FRAME_MODELS) }), request.params);
    const query = parse(
      z.strictObject({
        name: z.string().trim().min(3).max(160).default('Nome do Tradutor'),
        registration: z.string().trim().max(240).default('Matrícula nº 0000'),
        city: z.string().trim().min(2).max(80).default('Cidade'),
        state: z.string().trim().min(2).max(40).default('UF'),
        contact: z.string().trim().max(200).optional(),
        target: z.enum(LANGUAGES).default('en'),
        format: z.enum(['docx', 'pdf']).default('pdf'),
      }),
      request.query,
    );
    const source = query.target === 'pt' ? 'en' : 'pt';
    const mask = await renderFrameModel(model, { ...query, contact: query.contact ?? null }, source, query.target);
    const sample = await fillMask(
      new Uint8Array(mask),
      {
        sourceLanguage: source,
        targetLanguage: query.target,
        documentType: 'BIRTH CERTIFICATE',
        sourceTitle: 'CERTIDÃO DE NASCIMENTO',
        blocks: [
          { kind: 'heading', text: 'BIRTH CERTIFICATE', align: 'center', level: 'title', sourceText: null, origin: 'rules' },
          {
            kind: 'paragraph',
            text: '[Conteúdo traduzido do documento, no layout do original]',
            align: 'left',
            bold: false,
            size: 'normal',
            sourceText: null,
            origin: 'rules',
          },
        ],
      },
      { numero: '1201', livro: '7', folha: '1', data: new Date(), tradutor: query.name },
      query.name,
      { draft: true },
    );
    const name = `Modelo ${FRAME_MODEL_INFO[model].label}.docx`;
    if (query.format === 'pdf') {
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', contentDisposition(pdfName(name), 'inline'))
        .send(await docxToPdf(config.CONVERTER_URL, sample, name));
    }
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', contentDisposition(name))
      .send(sample);
  });

  app.post('/api/v1/sworn-translators/:id/masks/model', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(
      z.strictObject({
        model: z.enum(FRAME_MODELS),
        city: z.string().trim().min(2).max(80),
        state: z.string().trim().min(2).max(40),
        contact: optionalText(200).optional(),
        title: optionalText(120).optional(),
      }),
      request.body,
    );
    return reply
      .code(201)
      .send(await services.translators.maskFromModel(ctx, id, { ...body, contact: body.contact ?? null, title: body.title ?? null }));
  });

  // Máscara (Word) e PDF de referência chegam como binário; o nome do arquivo vem no cabeçalho X-File-Name.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      ['application/octet-stream', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      { parseAs: 'buffer', bodyLimit: MAX_MASK_BYTES },
      (_request, payload, done) => done(null, payload),
    );
    const fileName = (request: FastifyRequest, fallback: string) => {
      const raw = request.headers['x-file-name'];
      const name = typeof raw === 'string' ? decodeURIComponent(raw).trim() : '';
      return name && name.length <= 255 && !/[\\/\u0000-\u001f]/.test(name) ? name : fallback;
    };
    // Cada envio é uma nova edição numerada da máscara do tradutor.
    scope.post('/api/v1/sworn-translators/:id/masks', async (request, reply) => {
      const ctx = auth(request);
      const { id } = parse(idParams, request.params);
      if (!Buffer.isBuffer(request.body)) throw new AppError(400, 'VALIDATION_FAILED', 'Envie o arquivo Word da máscara');
      const rawNotes = request.headers['x-notes'];
      const notes = typeof rawNotes === 'string' ? decodeURIComponent(rawNotes).trim().slice(0, 500) || null : null;
      return reply.code(201).send(await services.translators.uploadMask(ctx, id, request.body, fileName(request, 'mascara.docx'), notes));
    });
    scope.put('/api/v1/sworn-translators/:id/reference-pdf', async (request) => {
      const ctx = auth(request);
      const { id } = parse(idParams, request.params);
      if (!Buffer.isBuffer(request.body)) throw new AppError(400, 'VALIDATION_FAILED', 'Envie o PDF do tradutor');
      return { translator: await services.translators.uploadReferencePdf(ctx, id, request.body, fileName(request, 'referencia.pdf')) };
    });
  });

  // ---------- Notificações (da própria pessoa) ----------
  app.get('/api/v1/notifications', async (request) => {
    const ctx = auth(request);
    const query = parse(
      z.strictObject({ unread: flag.optional(), kind: csv(z.string().regex(/^[a-z_]{1,64}$/)).optional(), ...pageQuery }),
      request.query,
    );
    return services.notifications.list(ctx, defined(query));
  });

  app.get('/api/v1/notifications/unread-count', async (request) => services.notifications.unreadCount(auth(request)));

  app.post('/api/v1/notifications/read', async (request) => {
    const ctx = auth(request);
    const body = parse(
      z.strictObject({
        ids: z
          .array(z.string().regex(/^\d{1,18}$/))
          .max(200)
          .optional(),
      }),
      request.body,
    );
    return services.notifications.markRead(ctx, body.ids);
  });

  app.get('/api/v1/glossary', async (request) => {
    const ctx = auth(request);
    const query = parse(
      z.strictObject({
        sourceLanguage: language.optional(),
        targetLanguage: language.optional(),
        teamId: uuid.optional(),
        q: z.string().trim().max(100).optional(),
      }),
      request.query,
    );
    return {
      items: await services.translations.listGlossary(ctx, {
        ...(query.sourceLanguage ? { sourceLanguage: query.sourceLanguage } : {}),
        ...(query.targetLanguage ? { targetLanguage: query.targetLanguage } : {}),
        ...(query.teamId ? { teamId: query.teamId } : {}),
        ...(query.q ? { q: query.q } : {}),
      }),
    };
  });

  app.post('/api/v1/glossary', async (request, reply) => {
    const ctx = auth(request);
    const body = parse(
      z.strictObject({
        sourceLanguage: language,
        targetLanguage: language,
        sourceTerm: z.string().trim().min(1).max(200),
        targetTerm: z.string().trim().min(1).max(200),
        note: z.string().trim().max(500).optional(),
        teamId: uuid.optional(),
      }),
      request.body,
    );
    return reply.code(201).send(
      await services.translations.addGlossary(ctx, {
        sourceLanguage: body.sourceLanguage,
        targetLanguage: body.targetLanguage,
        sourceTerm: body.sourceTerm,
        targetTerm: body.targetTerm,
        ...(body.note ? { note: body.note } : {}),
        ...(body.teamId ? { teamId: body.teamId } : {}),
      }),
    );
  });

  app.delete('/api/v1/glossary/:id', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    await services.translations.removeGlossary(ctx, id);
    return reply.code(204).send();
  });

  // ---------- Gerenciamento AI (ADR-021) ----------
  app.get('/api/v1/ai/status', async (request) => services.ai.status(auth(request)));
  // Escolha da pessoa: trabalhar com ou sem IA (ADR-022); vai para a auditoria.
  app.put('/api/v1/ai/choice', async (request) => {
    const ctx = auth(request);
    const body = parse(z.strictObject({ useAi: z.boolean() }), request.body);
    return services.ai.setChoice(ctx, body.useAi);
  });
  app.get('/api/v1/ai/settings', async (request) => services.ai.settings(auth(request)));

  app.patch('/api/v1/ai/settings', async (request) => {
    const ctx = auth(request);
    const body = parse(
      z.strictObject({
        enabled: z.boolean().optional(),
        model: z
          .string()
          .trim()
          .regex(/^gemini-[a-z0-9.-]{1,60}$/, 'Use um modelo Gemini (ex.: gemini-3.5-flash)')
          .optional(),
        // null volta ao prompt de governança padrão.
        governancePrompt: z.string().trim().min(20).max(8000).nullable().optional(),
      }),
      request.body,
    );
    return services.ai.updateSettings(ctx, defined(body));
  });

  const skillBody = z.strictObject({
    name: z.string().trim().min(2).max(80),
    content: z.string().trim().min(5).max(12_000),
    active: z.boolean().default(true),
  });
  app.post('/api/v1/ai/skills', async (request, reply) => {
    const ctx = auth(request);
    return reply.code(201).send(await services.ai.saveSkill(ctx, parse(skillBody, request.body)));
  });
  app.put('/api/v1/ai/skills/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.ai.saveSkill(ctx, { id, ...parse(skillBody, request.body) });
  });
  app.delete('/api/v1/ai/skills/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.ai.removeSkill(ctx, id);
  });

  app.get('/api/v1/ai/access', async (request) => services.ai.access(auth(request)));
  app.put('/api/v1/ai/access/:id', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const body = parse(z.strictObject({ allowed: z.boolean() }), request.body);
    return services.ai.setAccess(ctx, id, body.allowed);
  });
  app.get('/api/v1/ai/requests', async (request) => services.ai.requests(auth(request)));

  app.post('/api/v1/ai/ask', async (request) => {
    const ctx = auth(request);
    const body = parse(z.strictObject({ question: z.string().trim().min(3).max(1000), translationId: uuid.optional() }), request.body);
    return services.ai.ask(ctx, defined(body));
  });

  app.post('/api/v1/translations/:id/ai/glossary-check', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.ai.glossaryCheck(ctx, id);
  });
  app.post('/api/v1/translations/:id/ai/layout', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.ai.proposeLayout(ctx, id);
  });
  app.get('/api/v1/translations/:id/ai/layout', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.ai.pendingFor(ctx, id);
  });

  // Prévia da combinação proposta: o mesmo Word/PDF da tradução, com a combinação aplicada e nada gravado.
  app.get('/api/v1/ai/layout-combinations/:id/preview', async (request, reply) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    const query = parse(z.strictObject({ format: z.enum(['docx', 'pdf']).optional() }), request.query);
    const { job, draft } = await services.ai.proposedDraft(ctx, id);
    const file = await services.translations.preview(ctx, job.id, undefined, undefined, draft);
    if (query.format === 'pdf') {
      const pdf = await docxToPdf(config.CONVERTER_URL, file.docx, file.name);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', contentDisposition(pdfName(file.name), 'inline'))
        .header('x-content-type-options', 'nosniff')
        .send(pdf);
    }
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', contentDisposition(file.name))
      .header('x-content-type-options', 'nosniff')
      .send(file.docx);
  });
  app.post('/api/v1/ai/layout-combinations/:id/approve', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.ai.decide(ctx, id, true);
  });
  app.post('/api/v1/ai/layout-combinations/:id/reject', async (request) => {
    const ctx = auth(request);
    const { id } = parse(idParams, request.params);
    return services.ai.decide(ctx, id, false);
  });
}
