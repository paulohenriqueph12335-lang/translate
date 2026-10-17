import type { PoolClient } from 'pg';
import {
  canAddMember,
  canChangeMemberRole,
  canListMembers,
  canManageTeams,
  canRemoveMember,
  canViewTeam,
  isDirector,
  type OrgRole,
  type TeamRole,
  type UserStatus,
} from '../access/policy.js';
import { recordAudit } from '../audit/audit.js';
import { withTransaction } from '../../db/pool.js';
import { conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';

interface TeamRow {
  id: string;
  name: string;
  created_at: Date;
  member_count: string;
}

const toTeam = (row: TeamRow, myRole: TeamRole | null) => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at.toISOString(),
  memberCount: Number(row.member_count),
  myRole,
});

const TEAM_SELECT = `SELECT t.id, t.name, t.created_at, (SELECT count(*) FROM team_memberships m WHERE m.team_id = t.id) AS member_count FROM teams t`;

const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === '23505';

export function createTeamService({ pool }: ServiceDeps) {
  /** Diretor vê todas as equipes; demais pessoas veem apenas as equipes em que estão. */
  async function list(ctx: AuthenticatedContext) {
    const result = isDirector(ctx.actor)
      ? await pool.query<TeamRow>(`${TEAM_SELECT} ORDER BY t.name LIMIT 500`)
      : await pool.query<TeamRow>(`${TEAM_SELECT} WHERE t.id = ANY($1::uuid[]) ORDER BY t.name`, [[...ctx.actor.memberships.keys()]]);
    return result.rows.map((row) => toTeam(row, ctx.actor.memberships.get(row.id) ?? null));
  }

  async function get(ctx: AuthenticatedContext, teamId: string) {
    if (!canViewTeam(ctx.actor, teamId)) throw notFound('Equipe não encontrada');
    const result = await pool.query<TeamRow>(`${TEAM_SELECT} WHERE t.id = $1`, [teamId]);
    const row = result.rows[0];
    if (!row) throw notFound('Equipe não encontrada');
    return toTeam(row, ctx.actor.memberships.get(row.id) ?? null);
  }

  async function create(ctx: AuthenticatedContext, name: string) {
    if (!canManageTeams(ctx.actor)) throw forbidden();
    try {
      return await withTransaction(pool, async (db) => {
        const created = await db.query<{ id: string }>('INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id', [
          name,
          ctx.actor.id,
        ]);
        const id = created.rows[0]!.id;
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'team.created',
          targetType: 'team',
          targetId: id,
          teamId: id,
          correlationId: ctx.correlationId,
        });
        const result = await db.query<TeamRow>(`${TEAM_SELECT} WHERE t.id = $1`, [id]);
        return toTeam(result.rows[0]!, null);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Já existe uma equipe com esse nome');
      throw error;
    }
  }

  async function rename(ctx: AuthenticatedContext, teamId: string, name: string) {
    if (!canViewTeam(ctx.actor, teamId)) throw notFound('Equipe não encontrada');
    if (!canManageTeams(ctx.actor)) throw forbidden();
    try {
      return await withTransaction(pool, async (db) => {
        const updated = await db.query('UPDATE teams SET name = $2 WHERE id = $1', [teamId, name]);
        if (updated.rowCount === 0) throw notFound('Equipe não encontrada');
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'team.renamed',
          targetType: 'team',
          targetId: teamId,
          teamId,
          correlationId: ctx.correlationId,
        });
        const result = await db.query<TeamRow>(`${TEAM_SELECT} WHERE t.id = $1`, [teamId]);
        return toTeam(result.rows[0]!, ctx.actor.memberships.get(teamId) ?? null);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Já existe uma equipe com esse nome');
      throw error;
    }
  }

  async function assertTeamExists(db: PoolClient, teamId: string) {
    const found = await db.query('SELECT 1 FROM teams WHERE id = $1 FOR SHARE', [teamId]);
    if (found.rowCount === 0) throw notFound('Equipe não encontrada');
  }

  async function listMembers(ctx: AuthenticatedContext, teamId: string) {
    if (!canViewTeam(ctx.actor, teamId)) throw notFound('Equipe não encontrada');
    if (!canListMembers(ctx.actor, teamId)) throw forbidden();
    const result = await pool.query<{
      user_id: string;
      email: string;
      display_name: string;
      status: UserStatus;
      role: TeamRole;
      created_at: Date;
    }>(
      `SELECT m.user_id, u.email, u.display_name, u.status, m.role, m.created_at
         FROM team_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = $1 ORDER BY m.role, u.display_name, u.id`,
      [teamId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      role: row.role,
      addedAt: row.created_at.toISOString(),
    }));
  }

  async function addMember(ctx: AuthenticatedContext, teamId: string, input: { email: string; role: TeamRole }) {
    if (!canViewTeam(ctx.actor, teamId)) throw notFound('Equipe não encontrada');
    if (!canListMembers(ctx.actor, teamId)) throw forbidden();
    return withTransaction(pool, async (db) => {
      await assertTeamExists(db, teamId);
      const found = await db.query<{ id: string; status: UserStatus; org_role: OrgRole }>(
        'SELECT id, status, org_role FROM users WHERE email = $1',
        [input.email],
      );
      const target = found.rows[0];
      // Contas inexistentes e não ativas recebem a mesma resposta.
      if (!target || target.status !== 'active') throw notFound('Usuário não encontrado ou indisponível');
      if (!canAddMember(ctx.actor, teamId, input.role, { id: target.id, status: target.status, orgRole: target.org_role }))
        throw forbidden();
      const inserted = await db.query(
        `INSERT INTO team_memberships (team_id, user_id, role, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [teamId, target.id, input.role, ctx.actor.id],
      );
      if (inserted.rowCount === 0) throw conflict('Usuário já pertence à equipe');
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'team.member_added',
        targetType: 'user',
        targetId: target.id,
        teamId,
        correlationId: ctx.correlationId,
        metadata: { role: input.role },
      });
      return { userId: target.id, role: input.role };
    });
  }

  async function lockMembership(db: PoolClient, teamId: string, userId: string) {
    const found = await db.query<{ role: TeamRole }>('SELECT role FROM team_memberships WHERE team_id = $1 AND user_id = $2 FOR UPDATE', [
      teamId,
      userId,
    ]);
    const membership = found.rows[0];
    if (!membership) throw notFound('Associação não encontrada');
    return membership;
  }

  async function removeMember(ctx: AuthenticatedContext, teamId: string, userId: string) {
    if (!canViewTeam(ctx.actor, teamId)) throw notFound('Equipe não encontrada');
    if (!canListMembers(ctx.actor, teamId)) throw forbidden();
    await withTransaction(pool, async (db) => {
      const membership = await lockMembership(db, teamId, userId);
      if (!canRemoveMember(ctx.actor, teamId, { userId, role: membership.role })) throw forbidden();
      await db.query('DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'team.member_removed',
        targetType: 'user',
        targetId: userId,
        teamId,
        correlationId: ctx.correlationId,
        metadata: { role: membership.role },
      });
    });
  }

  async function changeMemberRole(ctx: AuthenticatedContext, teamId: string, userId: string, role: TeamRole) {
    if (!canViewTeam(ctx.actor, teamId)) throw notFound('Equipe não encontrada');
    if (!canChangeMemberRole(ctx.actor)) throw forbidden();
    return withTransaction(pool, async (db) => {
      const membership = await lockMembership(db, teamId, userId);
      if (membership.role !== role) {
        await db.query('UPDATE team_memberships SET role = $3 WHERE team_id = $1 AND user_id = $2', [teamId, userId, role]);
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'team.member_role_changed',
          targetType: 'user',
          targetId: userId,
          teamId,
          correlationId: ctx.correlationId,
          metadata: { from: membership.role, to: role },
        });
      }
      return { userId, role };
    });
  }

  return { list, get, create, rename, listMembers, addMember, removeMember, changeMemberRole };
}

export type TeamService = ReturnType<typeof createTeamService>;
