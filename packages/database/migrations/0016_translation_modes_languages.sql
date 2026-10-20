-- Modalidades de tradução (juramentada, certificada, técnica, simples), regras por modalidade e idioma, etapas com
-- checklist e os idiomas francês, italiano e espanhol (ADR-015).

-- Idiomas: português, inglês, francês, italiano e espanhol em todas as tabelas que guardam idioma.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.conrelid::regclass AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conrelid::regclass::text IN ('translation_jobs', 'glossary_entries', 'batches', 'translation_memory')
       AND c.conname ~ '_(source|target)_language_check$'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.tbl, item.conname);
  END LOOP;
END $$;

ALTER TABLE translation_jobs
  ADD CONSTRAINT translation_jobs_source_language_check CHECK (source_language IN ('pt', 'en', 'fr', 'it', 'es')),
  ADD CONSTRAINT translation_jobs_target_language_check CHECK (target_language IN ('pt', 'en', 'fr', 'it', 'es'));
ALTER TABLE glossary_entries
  ADD CONSTRAINT glossary_entries_source_language_check CHECK (source_language IN ('pt', 'en', 'fr', 'it', 'es')),
  ADD CONSTRAINT glossary_entries_target_language_check CHECK (target_language IN ('pt', 'en', 'fr', 'it', 'es'));
ALTER TABLE batches
  ADD CONSTRAINT batches_source_language_check CHECK (source_language IN ('pt', 'en', 'fr', 'it', 'es')),
  ADD CONSTRAINT batches_target_language_check CHECK (target_language IN ('pt', 'en', 'fr', 'it', 'es'));
ALTER TABLE translation_memory
  ADD CONSTRAINT translation_memory_source_language_check CHECK (source_language IN ('pt', 'en', 'fr', 'it', 'es')),
  ADD CONSTRAINT translation_memory_target_language_check CHECK (target_language IN ('pt', 'en', 'fr', 'it', 'es'));

-- Modalidade escolhida no envio do lote; cada tradução guarda a sua (a juramentada é a de sempre).
ALTER TABLE batches ADD COLUMN translation_mode text NOT NULL DEFAULT 'sworn'
  CHECK (translation_mode IN ('sworn', 'certified', 'technical', 'simple'));
ALTER TABLE translation_jobs ADD COLUMN translation_mode text NOT NULL DEFAULT 'sworn'
  CHECK (translation_mode IN ('sworn', 'certified', 'technical', 'simple'));
CREATE INDEX translation_jobs_mode_idx ON translation_jobs (translation_mode, created_at DESC);

-- Itens de checklist confirmados nas etapas manuais (correção, diagramação, revisão): chave → quem e quando.
ALTER TABLE translation_jobs ADD COLUMN stage_checks jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Ajustes do Supervisor ou do Diretor às regras padrão (das skills), por modalidade e idioma de destino.
CREATE TABLE translation_profiles (
  mode text NOT NULL CHECK (mode IN ('sworn', 'certified', 'technical', 'simple')),
  target_language text NOT NULL CHECK (target_language IN ('pt', 'en', 'fr', 'it', 'es')),
  rules jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mode, target_language)
);

-- Só a juramentada leva número de Tradução Pública; as demais concluem sem numeração.
ALTER TABLE translation_jobs DROP CONSTRAINT approved_is_complete;
ALTER TABLE translation_jobs ADD CONSTRAINT approved_is_complete CHECK (
  status <> 'approved'
  OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND output_key IS NOT NULL
      AND (translation_mode <> 'sworn' OR number_label IS NOT NULL))
);

-- De onde veio o termo do glossário (ex.: a skill de tradução da organização), para o filtro e a manutenção.
ALTER TABLE glossary_entries ADD COLUMN origin text CHECK (char_length(origin) <= 60);
