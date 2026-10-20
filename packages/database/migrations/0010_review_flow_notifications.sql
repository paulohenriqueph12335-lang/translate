-- Fluxo simplificado, etiquetas, notificações e fim do uso do Claude (ADR-010).

-- O Claude deixa de existir no produto; rascunhos antigos com origem 'claude' continuam válidos no histórico.
ALTER TABLE teams DROP COLUMN claude_enabled;
ALTER TABLE worker_heartbeats DROP COLUMN claude_available;

-- Etiquetas informadas no envio para classificar o documento antes do processamento.
ALTER TABLE documents ADD COLUMN tags text[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(tags) <= 10);
CREATE INDEX documents_tags_idx ON documents USING gin (tags);

-- O processamento informa se o sistema já conhecia o tipo de documento (exemplo aprovado do mesmo título ou etiqueta).
ALTER TABLE translation_jobs ADD COLUMN pattern_known boolean;
-- Tipo do documento traduzido, copiado do rascunho atual para filtros e para a área de downloads.
ALTER TABLE translation_jobs ADD COLUMN document_type text CHECK (char_length(document_type) <= 200);
UPDATE translation_jobs j SET document_type = nullif(d.content->>'documentType', '')
  FROM translation_drafts d WHERE d.job_id = j.id AND d.revision = j.current_revision;
CREATE INDEX translation_jobs_approved_idx ON translation_jobs (approved_at DESC) WHERE status = 'approved';

-- Notificações por pessoa; o conteúdo é curto e nunca inclui texto do documento.
CREATE TABLE notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text CHECK (char_length(body) <= 1000),
  team_id uuid REFERENCES teams (id),
  batch_id uuid REFERENCES batches (id),
  document_id uuid REFERENCES documents (id),
  translation_id uuid REFERENCES translation_jobs (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Filtros da auditoria.
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, id DESC);
CREATE INDEX audit_events_team_idx ON audit_events (team_id, id DESC);
