-- Criptografia em repouso (ADR-032): o conteúdo dos rascunhos passa a ser cifrado pela aplicação. As contagens que os
-- painéis e as listas usam ficam em colunas próprias, abertas.
ALTER TABLE translation_drafts
  ADD COLUMN error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  ADD COLUMN issue_count integer NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  ADD COLUMN correction_count integer NOT NULL DEFAULT 0 CHECK (correction_count >= 0);

ALTER TABLE translation_drafts DISABLE TRIGGER translation_drafts_no_update_delete;
UPDATE translation_drafts SET
  error_count = (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(issues) = 'array' THEN issues ELSE '[]' END) i
                  WHERE i->>'severity' = 'error'),
  issue_count = CASE WHEN jsonb_typeof(issues) = 'array' THEN jsonb_array_length(issues) ELSE 0 END,
  correction_count = CASE WHEN jsonb_typeof(corrections) = 'array' THEN jsonb_array_length(corrections) ELSE 0 END;
ALTER TABLE translation_drafts ENABLE TRIGGER translation_drafts_no_update_delete;

-- Memória de tradução cifrada: o trecho deixa de ser chave; a busca usa um índice cego (HMAC), preenchido pela aplicação.
ALTER TABLE translation_memory DROP CONSTRAINT translation_memory_pkey;
ALTER TABLE translation_memory ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
ALTER TABLE translation_memory ADD COLUMN source_digest bytea;
ALTER TABLE translation_memory DROP CONSTRAINT IF EXISTS translation_memory_source_text_check;
ALTER TABLE translation_memory DROP CONSTRAINT IF EXISTS translation_memory_target_text_check;
CREATE UNIQUE INDEX translation_memory_digest_idx ON translation_memory (source_language, target_language, source_digest);
