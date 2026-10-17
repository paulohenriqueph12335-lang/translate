import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canAddMember,
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
    assert.equal(canAddMember(director, TEAM_B, 'leader', { ...activeUser, status: 'suspended' }), false);
  });

  it('líder remove somente operadores e nunca a si', () => {
    assert.equal(canRemoveMember(leaderA, TEAM_A, { userId: 'x', role: 'operator' }), true);
    assert.equal(canRemoveMember(leaderA, TEAM_A, { userId: 'other-leader', role: 'leader' }), false);
    assert.equal(canRemoveMember(leaderA, TEAM_A, { userId: leaderA.id, role: 'leader' }), false);
    assert.equal(canRemoveMember(leaderA, TEAM_B, { userId: 'x', role: 'operator' }), false);
    assert.equal(canRemoveMember(director, TEAM_A, { userId: 'x', role: 'leader' }), true);
  });

  it('revogação de sessões: própria ou pelo Diretor', () => {
    assert.equal(canRevokeSessionsOf(operatorA, operatorA.id), true);
    assert.equal(canRevokeSessionsOf(leaderA, operatorA.id), false);
    assert.equal(canRevokeSessionsOf(director, operatorA.id), true);
  });
});
