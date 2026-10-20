-- Plano de hierarquia (docs/planejamento-hierarquia, ADR-011): responsável por tradução, marcos de tempo,
-- cotas de numeração e pedidos de alteração/anulação de número. Cadastro sem mudança.

-- Responsável pela tradução: só ele e o Supervisor da equipe editam. Nulo = a equipe ainda não assumiu.
ALTER TABLE translation_jobs ADD COLUMN assignee_id uuid REFERENCES users (id);
UPDATE translation_jobs j SET assignee_id = coalesce(j.submitted_by, b.owner_id)
  FROM documents d JOIN batches b ON b.id = d.batch_id
 WHERE d.id = j.document_id;
CREATE INDEX translation_jobs_assignee_idx ON translation_jobs (assignee_id, created_at DESC);

-- Marcos para os painéis: primeiro rascunho pronto e quantas vezes voltou para refazer.
ALTER TABLE translation_jobs ADD COLUMN processed_at timestamptz;
ALTER TABLE translation_jobs ADD COLUMN redo_count integer NOT NULL DEFAULT 0 CHECK (redo_count >= 0);
UPDATE translation_jobs j SET processed_at = (SELECT min(r.created_at) FROM translation_drafts r WHERE r.job_id = j.id);
UPDATE translation_jobs j SET redo_count = (
  SELECT count(*) FROM audit_events a WHERE a.action = 'translation.returned' AND a.target_id = j.id::text
);

-- Número anulado: continua no livro (nunca é reutilizado), mas a tradução deixa de valer.
ALTER TABLE translation_jobs ADD COLUMN annulled_at timestamptz;
ALTER TABLE translation_jobs ADD COLUMN annulled_reason text CHECK (char_length(annulled_reason) <= 1000);
CREATE INDEX translation_jobs_approved_year_idx ON translation_jobs (translation_year, approved_at) WHERE translation_number IS NOT NULL;

-- Cotas anuais de numeração: da organização e da equipe (Diretor) e de cada Usuário (Supervisor, 1 a 1000).
-- Sem cota cadastrada, não há limite naquele nível.
CREATE TABLE numbering_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  scope text NOT NULL CHECK (scope IN ('organization', 'team', 'user')),
  team_id uuid REFERENCES teams (id),
  user_id uuid REFERENCES users (id),
  quota integer NOT NULL CHECK (quota BETWEEN 1 AND 1000000),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT numbering_quota_target CHECK (
    (scope = 'organization' AND team_id IS NULL AND user_id IS NULL)
    OR (scope = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
    OR (scope = 'user' AND user_id IS NOT NULL AND team_id IS NULL AND quota <= 1000)
  )
);
CREATE UNIQUE INDEX numbering_quotas_unique_idx ON numbering_quotas (
  year, scope, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Pedidos de alteração (livro, folha ou número livre) ou anulação de um número já emitido.
CREATE TABLE numbering_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES translation_jobs (id),
  kind text NOT NULL CHECK (kind IN ('change', 'annul')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  -- Valores pedidos (só em 'change') e os anteriores, para o Diretor poder reverter.
  requested_number integer CHECK (requested_number > 0),
  requested_book integer CHECK (requested_book > 0),
  requested_sheet integer CHECK (requested_sheet > 0),
  previous_number integer,
  previous_book integer,
  previous_sheet integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'reverted')),
  requested_by uuid NOT NULL REFERENCES users (id),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  decision_note text CHECK (char_length(decision_note) <= 1000),
  reverted_by uuid REFERENCES users (id),
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT numbering_change_has_value CHECK (
    kind = 'annul' OR requested_number IS NOT NULL OR requested_book IS NOT NULL OR requested_sheet IS NOT NULL
  )
);
-- Um pedido em aberto por tradução.
CREATE UNIQUE INDEX numbering_requests_pending_idx ON numbering_requests (job_id) WHERE status = 'pending';
CREATE INDEX numbering_requests_created_idx ON numbering_requests (created_at DESC);
