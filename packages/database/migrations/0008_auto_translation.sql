-- Tradução automática (ADR-007, revisão de 2026-10-17): o lote define o par de idiomas e cada documento
-- armazenado entra sozinho na fila; o worker publica se o Claude está disponível.

ALTER TABLE batches ADD COLUMN source_language text CHECK (source_language IN ('pt', 'en'));
ALTER TABLE batches ADD COLUMN target_language text CHECK (target_language IN ('pt', 'en'));
ALTER TABLE batches ADD CONSTRAINT batches_translation_pair CHECK (
  (source_language IS NULL) = (target_language IS NULL) AND (source_language IS NULL OR source_language <> target_language)
);

-- Sinal de vida do worker: permite à interface explicar por que não houve tradução automática.
CREATE TABLE worker_heartbeats (
  worker_id text PRIMARY KEY CHECK (char_length(worker_id) BETWEEN 1 AND 200),
  claude_available boolean NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now()
);
