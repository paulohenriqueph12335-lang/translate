import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canAddMember,
  canAssignBatch,
  canApproveTranslation,
  canAuthorizePasswordReset,
  canCancelInBatch,
  canConcludeTranslation,
  canClaimTranslation,
  canDecideNumberingRequest,
  canEditTranslation,
  canReadAudit,
  canReadTeamAudit,
  canReassignTranslation,
  canSetUserQuota,
  canViewOrganizationDashboard,
  canViewTeamDashboard,
  canCreateBatch,
  canUploadToBatch,
  canViewBatch,
  canChangeMemberRole,
  canAdministerUsers,
  canChangeOrgRole,
  canChangeUserStatus,
  canListMembers,
  canRemoveMember,
  canRevokeSessionsOf,
  canViewTeam,
  type Actor,
  type TeamRole,
} from './policy.js';

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

const actor = (overrides: Partial<Actor> & { teams?: Record<string, TeamRole> } = {}): Actor => ({
  id: overrides.id ?? 'actor',
  status: overrides.status ?? 'active',
  orgRole: overrides.orgRole ?? 'member',
  memberships: new Map(Object.entries(overrides.teams ?? {})),
});

const director = actor({ id: 'director', orgRole: 'director' });
const leaderA = actor({ id: 'leader-a', teams: { [TEAM_A]: 'leader' } });
const operatorA = actor({ id: 'operator-a', teams: { [TEAM_A]: 'operator' } });
const activeUser = { id: 'someone', status: 'active', orgRole: 'member' } as const;

describe('políticas de acesso', () => {
  it('somente Diretor ativo administra usuários', () => {
    assert.equal(canAdministerUsers(director), true);
    assert.equal(canAdministerUsers(leaderA), false);
    assert.equal(canAdministerUsers(operatorA), false);
    assert.equal(canAdministerUsers(actor({ orgRole: 'director', status: 'suspended' })), false);
  });

  it('conta não ativa não recebe permissões mesmo com associação', () => {
    const pendingLeader = actor({ status: 'pending', teams: { [TEAM_A]: 'leader' } });
    assert.equal(canViewTeam(pendingLeader, TEAM_A), false);
    assert.equal(canListMembers(pendingLeader, TEAM_A), false);
    assert.equal(canAddMember(pendingLeader, TEAM_A, 'operator', activeUser), false);
  });

  it('Diretor não altera o próprio status nem o próprio papel', () => {
    assert.equal(canChangeUserStatus(director, { id: director.id, status: 'active', orgRole: 'director' }), false);
    assert.equal(canChangeOrgRole(director, { id: director.id, status: 'active', orgRole: 'director' }), false);
    assert.equal(canChangeUserStatus(director, activeUser), true);
    assert.equal(canChangeOrgRole(director, { ...activeUser, status: 'pending' }), false);
  });

  it('visibilidade de equipe respeita associação', () => {
    assert.equal(canViewTeam(director, TEAM_B), true);
    assert.equal(canViewTeam(leaderA, TEAM_A), true);
    assert.equal(canViewTeam(leaderA, TEAM_B), false);
    assert.equal(canViewTeam(operatorA, TEAM_A), true);
  });

  it('operador não lista membros; líder lista apenas a própria equipe', () => {
    assert.equal(canListMembers(operatorA, TEAM_A), false);
    assert.equal(canListMembers(leaderA, TEAM_A), true);
    assert.equal(canListMembers(leaderA, TEAM_B), false);
  });

  it('líder adiciona somente operador ativo, não Diretor, na própria equipe', () => {
    assert.equal(canAddMember(leaderA, TEAM_A, 'operator', activeUser), true);
    assert.equal(canAddMember(leaderA, TEAM_A, 'leader', activeUser), false);
    assert.equal(canAddMember(leaderA, TEAM_B, 'operator', activeUser), false);
    assert.equal(canAddMember(leaderA, TEAM_A, 'operator', { ...activeUser, status: 'pending' }), false);
    assert.equal(canAddMember(leaderA, TEAM_A, 'operator', { ...activeUser, orgRole: 'director' }), false);
    assert.equal(canAddMember(operatorA, TEAM_A, 'operator', activeUser), false);
    assert.equal(canAddMember(director, TEAM_B, 'leader', activeUser), true);
    assert.equal(canAddMember(director, TEAM_B, 'operator', { id: director.id, status: 'active', orgRole: 'director' }), false);
    assert.equal(canAddMember(director, TEAM_B, 'leader', { ...activeUser, orgRole: 'director' }), false);
    assert.equal(canAddMember(director, TEAM_B, 'leader', { ...activeUser, status: 'suspended' }), false);
  });

  it('líder remove somente operadores e nunca a si', () => {
    assert.equal(canRemoveMember(leaderA, TEAM_A, { userId: 'x', role: 'operator' }), true);
    assert.equal(canRemoveMember(leaderA, TEAM_A, { userId: 'other-leader', role: 'leader' }), false);
    assert.equal(canRemoveMember(leaderA, TEAM_A, { userId: leaderA.id, role: 'leader' }), false);
    assert.equal(canRemoveMember(leaderA, TEAM_B, { userId: 'x', role: 'operator' }), false);
    assert.equal(canRemoveMember(director, TEAM_A, { userId: 'x', role: 'leader' }), true);
  });

  it('ninguém altera o próprio cargo de equipe', () => {
    assert.equal(canRemoveMember(director, TEAM_A, { userId: director.id, role: 'operator' }), false);
    assert.equal(canChangeMemberRole(director, { userId: 'x' }), true);
    assert.equal(canChangeMemberRole(director, { userId: director.id }), false);
    assert.equal(canChangeMemberRole(leaderA, { userId: leaderA.id }), false);
    assert.equal(canChangeMemberRole(leaderA, { userId: operatorA.id }), false);
  });

  it('revogação de sessões: própria ou pelo Diretor', () => {
    assert.equal(canRevokeSessionsOf(operatorA, operatorA.id), true);
    assert.equal(canRevokeSessionsOf(leaderA, operatorA.id), false);
    assert.equal(canRevokeSessionsOf(director, operatorA.id), true);
  });
});

describe('políticas de lotes', () => {
  const teamBatch = { teamId: TEAM_A, ownerId: leaderA.id };
  const directorInbox = { teamId: null, ownerId: director.id };

  it('Diretor cria lote sem equipe; Supervisor e Usuário só na própria equipe', () => {
    assert.equal(canCreateBatch(director, null), true);
    assert.equal(canCreateBatch(leaderA, TEAM_A), true);
    assert.equal(canCreateBatch(leaderA, TEAM_B), false);
    assert.equal(canCreateBatch(leaderA, null), false);
    assert.equal(canCreateBatch(operatorA, TEAM_A), true);
    assert.equal(canCreateBatch(operatorA, TEAM_B), false);
    assert.equal(canCreateBatch(operatorA, null), false);
  });

  it('toda a equipe vê os lotes dela; lote sem equipe só o Diretor', () => {
    assert.equal(canViewBatch(operatorA, teamBatch), true);
    assert.equal(canViewBatch(leaderA, teamBatch), true);
    assert.equal(canViewBatch(actor({ teams: { [TEAM_B]: 'operator' } }), teamBatch), false);
    assert.equal(canViewBatch(leaderA, directorInbox), false);
    assert.equal(canViewBatch(director, directorInbox), true);
  });

  it('só quem criou envia conteúdo; Usuário cancela só o próprio lote e não direciona', () => {
    assert.equal(canUploadToBatch(leaderA, teamBatch), true);
    assert.equal(canUploadToBatch(operatorA, teamBatch), false);
    assert.equal(canUploadToBatch(operatorA, { teamId: TEAM_A, ownerId: operatorA.id }), true);
    assert.equal(canUploadToBatch(director, teamBatch), false);
    assert.equal(canUploadToBatch(director, directorInbox), true);
    assert.equal(canCancelInBatch(operatorA, teamBatch), false);
    assert.equal(canCancelInBatch(operatorA, { teamId: TEAM_A, ownerId: operatorA.id }), true);
    assert.equal(canCancelInBatch(leaderA, teamBatch), true);
    assert.equal(canAssignBatch(director), true);
    assert.equal(canAssignBatch(leaderA), false);
  });
});

describe('o trabalho de cada usuário é dele', () => {
  const batch = { teamId: TEAM_A, ownerId: operatorA.id };
  const otherOperator = actor({ teams: { [TEAM_A]: 'operator' } });

  it('edita só o responsável e o Supervisor da equipe; o Diretor só autoriza', () => {
    assert.equal(canEditTranslation(operatorA, batch, operatorA.id), true);
    assert.equal(canEditTranslation(otherOperator, batch, operatorA.id), false);
    assert.equal(canEditTranslation(leaderA, batch, operatorA.id), true);
    assert.equal(canEditTranslation(director, batch, operatorA.id), false);
    assert.equal(canEditTranslation(director, { teamId: null, ownerId: director.id }, director.id), true);
    assert.equal(canEditTranslation(operatorA, batch, null), false);
    assert.equal(canApproveTranslation(director, batch), true);
    assert.equal(canApproveTranslation(operatorA, batch), false);
  });

  it('conclui o responsável e a liderança; colega e quem saiu da equipe não', () => {
    assert.equal(canConcludeTranslation(operatorA, batch, operatorA.id), true);
    assert.equal(canConcludeTranslation(otherOperator, batch, operatorA.id), false);
    assert.equal(canConcludeTranslation(operatorA, batch, null), false);
    assert.equal(canConcludeTranslation(leaderA, batch, operatorA.id), true);
    assert.equal(canConcludeTranslation(director, batch, operatorA.id), true);
    assert.equal(canConcludeTranslation(actor({ id: operatorA.id }), batch, operatorA.id), false);
  });

  it('senha nova: o Diretor autoriza qualquer um, menos a si; o Líder, só Usuário da equipe dele', () => {
    const target = (teams: Record<string, TeamRole>, id = 'alvo') => ({ id, memberships: new Map(Object.entries(teams)) });
    assert.equal(canAuthorizePasswordReset(director, target({ [TEAM_A]: 'leader' })), true);
    assert.equal(canAuthorizePasswordReset(director, target({}, director.id)), false);
    assert.equal(canAuthorizePasswordReset(leaderA, target({ [TEAM_A]: 'operator' })), true);
    assert.equal(canAuthorizePasswordReset(leaderA, target({ [TEAM_A]: 'leader' })), false);
    assert.equal(canAuthorizePasswordReset(leaderA, target({ [TEAM_B]: 'operator' })), false);
    assert.equal(canAuthorizePasswordReset(otherOperator, target({ [TEAM_A]: 'operator' })), false);
  });

  it('sem responsável, a equipe assume; reatribuir é do Supervisor e do Diretor', () => {
    assert.equal(canClaimTranslation(otherOperator, batch, null), true);
    assert.equal(canClaimTranslation(otherOperator, batch, operatorA.id), false);
    assert.equal(canClaimTranslation(actor({ teams: { [TEAM_B]: 'operator' } }), batch, null), false);
    assert.equal(canReassignTranslation(leaderA, batch), true);
    assert.equal(canReassignTranslation(operatorA, batch), false);
    assert.equal(canReassignTranslation(director, batch), true);
  });

  it('cotas, pedidos de número, painéis e auditoria da equipe', () => {
    assert.equal(canSetUserQuota(leaderA, new Map([[TEAM_A, 'operator']])), true);
    assert.equal(canSetUserQuota(leaderA, new Map([[TEAM_B, 'operator']])), false);
    assert.equal(canSetUserQuota(leaderA, new Map([[TEAM_A, 'leader']])), false);
    assert.equal(canSetUserQuota(director, new Map()), true);
    assert.equal(canSetUserQuota(operatorA, new Map([[TEAM_A, 'operator']])), false);
    assert.equal(canDecideNumberingRequest(leaderA, batch), true);
    assert.equal(canDecideNumberingRequest(operatorA, batch), false);
    assert.equal(canViewTeamDashboard(leaderA, TEAM_A), true);
    assert.equal(canViewTeamDashboard(leaderA, TEAM_B), false);
    assert.equal(canViewTeamDashboard(operatorA, TEAM_A), false);
    assert.equal(canViewOrganizationDashboard(leaderA), false);
    assert.equal(canReadTeamAudit(leaderA), true);
    assert.equal(canReadTeamAudit(operatorA), false);
    assert.equal(canReadAudit(leaderA), false);
  });
});
