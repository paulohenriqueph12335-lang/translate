import { createHash, timingSafeEqual } from 'node:crypto';

export type MasterTokenRole = 'director' | 'leader';

/**
 * Tokens fixos (pedido do produto, 2026-10-28). O do Diretor cria o primeiro Diretor e autoriza a troca de senha de
 * qualquer pessoa; o do Líder libera o acesso de um Usuário por 24 horas. Só o SHA-256 fica no código: o valor foi
 * entregue ao responsável pelo sistema. DIRECTOR_TOKEN e LEADER_TOKEN, no ambiente, trocam os tokens sem mexer no código.
 */
const DEFAULT_HASHES: Record<MasterTokenRole, string> = {
  director: '397200b6a0474313da053353712e9b5875e6c89552c80aba6ef1bc9f442d3e28',
  leader: '81bff707fc55eb2ed925ee45f4abfc5140c57c2c7d628fbe3546d33e9956998b',
};

/** Maiúsculas, minúsculas, espaços e hífens não importam: vale como a pessoa digitar. */
const digest = (token: string) =>
  createHash('sha256')
    .update(token.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest();

export function createMasterTokens(config: { DIRECTOR_TOKEN?: string | undefined; LEADER_TOKEN?: string | undefined }) {
  const expected: Record<MasterTokenRole, Buffer> = {
    director: config.DIRECTOR_TOKEN ? digest(config.DIRECTOR_TOKEN) : Buffer.from(DEFAULT_HASHES.director, 'hex'),
    leader: config.LEADER_TOKEN ? digest(config.LEADER_TOKEN) : Buffer.from(DEFAULT_HASHES.leader, 'hex'),
  };
  return (role: MasterTokenRole, given: string | undefined) =>
    !!given && given.length <= 100 && timingSafeEqual(digest(given), expected[role]);
}

export type MasterTokenCheck = ReturnType<typeof createMasterTokens>;
