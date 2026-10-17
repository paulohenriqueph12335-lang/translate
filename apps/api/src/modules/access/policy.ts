/**
 * Políticas de autorização puras (ADR-005). Os serviços chamam estas funções;
 * nenhuma regra de acesso deve viver nos handlers HTTP ou na interface.
 */
export type UserStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type OrgRole = 'director' | 'member';
export type TeamRole = 'leader' | 'operator';

export interface Actor {
  readonly id: string;
  readonly status: UserStatus;
  readonly orgRole: OrgRole;
  readonly memberships: ReadonlyMap<string, TeamRole>;
}

export interface UserRef {
  readonly id: string;
  readonly status: UserStatus;
  readonly orgRole: OrgRole;
}

export type StatusAction = 'approve' | 'reject' | 'suspend' | 'reactivate';

const transitions: Record<StatusAction, { from: UserStatus; to: UserStatus }> = {
  approve: { from: 'pending', to: 'active' },
  reject: { from: 'pending', to: 'rejected' },
  suspend: { from: 'active', to: 'suspended' },
  reactivate: { from: 'suspended', to: 'active' },
};

export const statusTransition = (action: StatusAction) => transitions[action];

const isActive = (actor: Actor) => actor.status === 'active';

export const isDirector = (actor: Actor) => isActive(actor) && actor.orgRole === 'director';

export const canAdministerUsers = isDirector;
export const canReadAudit = isDirector;
export const canManageTeams = isDirector;
export const canChangeMemberRole = isDirector;

/** Diretor não altera o próprio status nem o próprio papel, evitando perder o último administrador. */
export const canChangeUserStatus = (actor: Actor, target: UserRef) => isDirector(actor) && actor.id !== target.id;
export const canChangeOrgRole = (actor: Actor, target: UserRef) =>
  isDirector(actor) && actor.id !== target.id && target.status === 'active';

export const canRevokeSessionsOf = (actor: Actor, userId: string) => isActive(actor) && (actor.id === userId || isDirector(actor));

export const teamRoleOf = (actor: Actor, teamId: string) => (isActive(actor) ? actor.memberships.get(teamId) : undefined);

/** Visibilidade: quem não vê a equipe recebe 404. */
export const canViewTeam = (actor: Actor, teamId: string) => isDirector(actor) || teamRoleOf(actor, teamId) !== undefined;

export const canListMembers = (actor: Actor, teamId: string) => isDirector(actor) || teamRoleOf(actor, teamId) === 'leader';

export function canAddMember(actor: Actor, teamId: string, role: TeamRole, target: UserRef) {
  if (target.status !== 'active') return false;
  if (isDirector(actor)) return true;
  return teamRoleOf(actor, teamId) === 'leader' && role === 'operator' && target.orgRole !== 'director' && target.id !== actor.id;
}

export function canRemoveMember(actor: Actor, teamId: string, member: { userId: string; role: TeamRole }) {
  if (isDirector(actor)) return true;
  return teamRoleOf(actor, teamId) === 'leader' && member.role === 'operator' && member.userId !== actor.id;
}
