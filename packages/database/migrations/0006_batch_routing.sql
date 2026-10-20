-- Lotes do Diretor nascem sem equipe e são direcionados depois (ADR-006, revisão de 2026-10-17).
ALTER TABLE batches ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE batches ADD COLUMN assigned_at timestamptz;
ALTER TABLE batches ADD COLUMN assigned_by uuid REFERENCES users (id);

-- Lotes já criados com equipe contam como direcionados na criação.
UPDATE batches SET assigned_at = created_at, assigned_by = owner_id WHERE team_id IS NOT NULL AND assigned_at IS NULL;

ALTER TABLE batches ADD CONSTRAINT batches_assignment_consistent
  CHECK ((team_id IS NULL) = (assigned_at IS NULL) AND (assigned_at IS NULL) = (assigned_by IS NULL));

CREATE INDEX batches_unassigned_idx ON batches (created_at DESC, id DESC) WHERE team_id IS NULL;
