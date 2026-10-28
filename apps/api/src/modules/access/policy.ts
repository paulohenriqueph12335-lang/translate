/**
 * Políticas de autorização puras (ADR-005). Os serviços chamam estas funções;
 * nenhuma regra de acesso deve viver nos handlers HTTP ou na interface.
 *
 * Invariantes da hierarquia:
 * - ninguém altera o próprio cargo (status, papel na organização ou associação a equipe);
 * - Diretor não ocupa cargo de equipe: já administra todas e não pode ser rebaixado a Líder/Operador.
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

/** Equipes que o ator supervisiona (Líder/Supervisor). */
export const ledTeams = (actor: Actor) =>
  isActive(actor) ? [...actor.memberships].filter(([, role]) => role === 'leader').map(([teamId]) => teamId) : [];

/** Auditoria da equipe (plano de hierarquia): Diretor vê tudo; Supervisor, os eventos das equipes que supervisiona. */
export const canReadTeamAudit = (actor: Actor) => isDirector(actor) || ledTeams(actor).length > 0;

/** Diretor não altera o próprio status nem o próprio papel, evitando perder o último administrador. */
export const canChangeUserStatus = (actor: Actor, target: UserRef) => isDirector(actor) && actor.id !== target.id;
export const canChangeOrgRole = (actor: Actor, target: UserRef) =>
  isDirector(actor) && actor.id !== target.id && target.status === 'active';

export const canRevokeSessionsOf = (actor: Actor, userId: string) => isActive(actor) && (actor.id === userId || isDirector(actor));

export const teamRoleOf = (actor: Actor, teamId: string) => (isActive(actor) ? actor.memberships.get(teamId) : undefined);

/** Visibilidade: quem não vê a equipe recebe 404. */
export const canViewTeam = (actor: Actor, teamId: string) => isDirector(actor) || teamRoleOf(actor, teamId) !== undefined;

export const canListMembers = (actor: Actor, teamId: string) => isDirector(actor) || teamRoleOf(actor, teamId) === 'leader';

/** Quem pode receber cargo de equipe: conta ativa, que não seja Diretor e não seja quem está agindo. */
export const canHoldTeamRole = (actor: Actor, target: UserRef) =>
  target.status === 'active' && target.orgRole !== 'director' && target.id !== actor.id;

export function canAddMember(actor: Actor, teamId: string, role: TeamRole, target: UserRef) {
  if (!canHoldTeamRole(actor, target)) return false;
  if (isDirector(actor)) return true;
  return teamRoleOf(actor, teamId) === 'leader' && role === 'operator';
}

export function canRemoveMember(actor: Actor, teamId: string, member: { userId: string; role: TeamRole }) {
  if (member.userId === actor.id) return false;
  if (isDirector(actor)) return true;
  return teamRoleOf(actor, teamId) === 'leader' && member.role === 'operator';
}

export const canChangeMemberRole = (actor: Actor, member: { userId: string }) => isDirector(actor) && member.userId !== actor.id;

// ---------- Lotes e documentos (ADR-006) ----------

export interface BatchRef {
  /** `null` enquanto o lote do Diretor aguarda direcionamento. */
  readonly teamId: string | null;
  readonly ownerId: string;
}

/**
 * Quem envia: o Diretor (lote nasce sem equipe, `teamId = null`), o Supervisor e o Usuário (lote vai direto para a
 * própria equipe). Cada Usuário trabalha no próprio workspace.
 */
export const canCreateBatch = (actor: Actor, teamId: string | null) =>
  teamId === null ? isDirector(actor) : teamRoleOf(actor, teamId) !== undefined;

/** Todos da equipe veem os lotes dela, enquanto pertencerem a ela; lote sem equipe só o Diretor vê. */
export const canViewBatch = (actor: Actor, batch: BatchRef) =>
  isDirector(actor) || (batch.teamId !== null && teamRoleOf(actor, batch.teamId) !== undefined);

/** Conteúdo só é enviado por quem criou o lote, se ainda for da equipe do lote (ou Diretor, no lote sem equipe). */
export const canUploadToBatch = (actor: Actor, batch: BatchRef) =>
  batch.ownerId === actor.id && (isDirector(actor) || (batch.teamId !== null && teamRoleOf(actor, batch.teamId) !== undefined));

/** Cancelar itens pendentes: Diretor, Supervisor da equipe do lote ou quem enviou. */
export const canCancelInBatch = (actor: Actor, batch: BatchRef) =>
  isDirector(actor) ||
  (batch.teamId !== null && teamRoleOf(actor, batch.teamId) === 'leader') ||
  (batch.ownerId === actor.id && batch.teamId !== null && teamRoleOf(actor, batch.teamId) !== undefined);

/** Direcionar (ou redirecionar) um lote para uma equipe é decisão do Diretor. */
export const canAssignBatch = isDirector;

// ---------- Traduções (ADR-007) ----------

/** Trabalhar na tradução (iniciar, revisar, enviar para aprovação): quem vê o lote. */
export const canWorkOnTranslation = canViewBatch;

/** Liderança da tradução (devolver, cancelar, reprocessar, autorizar exceções de numeração): Diretor ou Líder da equipe. */
export const canApproveTranslation = (actor: Actor, batch: BatchRef) =>
  isDirector(actor) || (batch.teamId !== null && teamRoleOf(actor, batch.teamId) === 'leader');

/**
 * Conclusão (pedido do produto, 2026-10-28): o responsável conclui a própria tradução, de qualquer modalidade.
 * Supervisor e Diretor continuam podendo concluir e só precisam agir em problemas de numeração.
 */
export const canConcludeTranslation = (actor: Actor, batch: BatchRef, assigneeId: string | null) =>
  canApproveTranslation(actor, batch) || (assigneeId !== null && assigneeId === actor.id && canViewBatch(actor, batch));

const supervises = (actor: Actor, batch: BatchRef) => batch.teamId !== null && teamRoleOf(actor, batch.teamId) === 'leader';

/**
 * O trabalho de cada usuário é dele (plano de hierarquia): edita a tradução só o responsável e o Supervisor da equipe.
 * O Diretor só edita o que é dele; no trabalho dos outros, autoriza (conclui, pede para refazer, reatribui).
 * Sem responsável, ninguém edita até alguém assumir.
 */
export const canEditTranslation = (actor: Actor, batch: BatchRef, assigneeId: string | null) =>
  canViewBatch(actor, batch) && assigneeId !== null && (assigneeId === actor.id || supervises(actor, batch));

/** Assumir uma tradução sem responsável: qualquer pessoa da equipe ou o Diretor. */
export const canClaimTranslation = (actor: Actor, batch: BatchRef, assigneeId: string | null) =>
  assigneeId === null && canViewBatch(actor, batch);

/** Reatribuir: Supervisor da equipe ou Diretor; o novo responsável precisa ser da equipe (ou o próprio Diretor). */
export const canReassignTranslation = (actor: Actor, batch: BatchRef) => isDirector(actor) || supervises(actor, batch);

// ---------- Numeração e painéis (plano de hierarquia) ----------

/** Limites da organização e das equipes: Diretor. */
export const canManageNumberingLimits = isDirector;

/** Cota de um usuário (1 a 1000 por ano): Diretor, ou Supervisor de uma equipe em que a pessoa é Usuário. */
export const canSetUserQuota = (actor: Actor, targetMemberships: ReadonlyMap<string, TeamRole>) =>
  isDirector(actor) || ledTeams(actor).some((teamId) => targetMemberships.get(teamId) === 'operator');

/**
 * Pedido de senha nova (2026-10-28): o Diretor autoriza de qualquer pessoa, menos o próprio; o Líder libera por 24 horas
 * só quem é Usuário numa equipe que ele supervisiona.
 */
export const canAuthorizePasswordReset = (actor: Actor, target: { id: string; memberships: ReadonlyMap<string, TeamRole> }) =>
  actor.id !== target.id && (isDirector(actor) || ledTeams(actor).some((teamId) => target.memberships.get(teamId) === 'operator'));

/** Pedidos de alteração/anulação de número: decide o Supervisor da equipe ou o Diretor. */
export const canDecideNumberingRequest = (actor: Actor, batch: BatchRef) => isDirector(actor) || supervises(actor, batch);

/** Painel da organização: Diretor. Painel de equipe: Diretor ou Supervisor dela. */
export const canViewOrganizationDashboard = isDirector;
export const canViewTeamDashboard = (actor: Actor, teamId: string) => isDirector(actor) || teamRoleOf(actor, teamId) === 'leader';

/** Tradutor público, numeração e provedor de tradução automática: decisões do Diretor. */
export const canManageTranslationSettings = isDirector;

/** Glossário da organização: Diretor; glossário de equipe: Diretor ou Líder da equipe. */
export const canManageGlossary = (actor: Actor, teamId: string | null) =>
  isDirector(actor) || (teamId !== null && teamRoleOf(actor, teamId) === 'leader');
