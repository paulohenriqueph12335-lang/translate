-- Configuração inicial pela interface (ADR-004, revisão de 2026-10-22): o primeiro Diretor pode ser criado no navegador
-- com o código de configuração de uso único que a API escreve no próprio log. Uma conta criada como teste pode ser
-- excluída depois: os dados pessoais saem, o histórico de auditoria fica, e sem Diretor a configuração inicial volta.
ALTER TABLE users
  ADD COLUMN test_account boolean NOT NULL DEFAULT false,
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT deleted_is_not_director CHECK (deleted_at IS NULL OR (org_role = 'member' AND status = 'rejected'));
