import type { Queryable } from './pool.js';

/** Quem recebe: papéis na equipe do documento, Diretores e pessoas específicas (ativas). */
export interface NotificationAudience {
  teamId: string | null;
  leaders?: boolean;
  operators?: boolean;
  directors?: boolean;
  users?: Array<string | null | undefined>;
  /** Quem causou o evento não é notificado do próprio ato. */
  exclude?: string | null;
}

export interface NotificationEntry {
  kind: string;
  title: string;
  /** Texto curto; nunca incluir conteúdo do documento. */
  body?: string | null;
  batchId?: string | null;
  documentId?: string | null;
  translationId?: string | null;
}

/** Cria uma notificação para cada destinatário, sem repetir pessoas. Retorna quantas foram criadas. */
export async function notify(db: Queryable, audience: NotificationAudience, entry: NotificationEntry) {
  const users = (audience.users ?? []).filter((id): id is string => !!id);
  const result = await db.query(
    `INSERT INTO notifications (user_id, kind, title, body, team_id, batch_id, document_id, translation_id)
     SELECT u.id, $1, $2, $3, $4, $5, $6, $7 FROM users u
      WHERE u.status = 'active' AND u.id IS DISTINCT FROM $8::uuid
        AND (
          ($9 AND EXISTS (SELECT 1 FROM team_memberships m WHERE m.user_id = u.id AND m.team_id = $4 AND m.role = 'leader'))
          OR ($10 AND EXISTS (SELECT 1 FROM team_memberships m WHERE m.user_id = u.id AND m.team_id = $4 AND m.role = 'operator'))
          OR ($11 AND u.org_role = 'director')
          OR u.id = ANY($12::uuid[])
        )`,
    [
      entry.kind,
      entry.title,
      entry.body ?? null,
      audience.teamId,
      entry.batchId ?? null,
      entry.documentId ?? null,
      entry.translationId ?? null,
      audience.exclude ?? null,
      audience.leaders ?? false,
      audience.operators ?? false,
      audience.directors ?? false,
      users,
    ],
  );
  return result.rowCount ?? 0;
}
