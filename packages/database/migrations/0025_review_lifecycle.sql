-- Revisão comparativa humana, tentativas por formato e marcos operacionais.
ALTER TABLE translation_jobs
  ADD COLUMN inspection_required boolean NOT NULL DEFAULT false,
  ADD COLUMN inspection_revision integer,
  ADD COLUMN consecutive_rejections integer NOT NULL DEFAULT 0 CHECK (consecutive_rejections BETWEEN 0 AND 3),
  ADD COLUMN format_generation integer NOT NULL DEFAULT 1 CHECK (format_generation > 0),
  ADD COLUMN failed_stages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN first_downloaded_at timestamptz,
  ADD COLUMN last_downloaded_at timestamptz,
  ADD COLUMN download_count integer NOT NULL DEFAULT 0 CHECK (download_count >= 0);
-- Trabalhos legados continuam acessíveis; todo novo trabalho exige inspeção.
UPDATE translation_jobs SET last_activity_at = updated_at;
-- Recupera os marcos que a versão anterior registrava somente na auditoria. Apenas eventos posteriores à
-- conclusão corrente contam; sem metadado de exibição, o histórico antigo pode incluir leitura inline do PDF.
WITH downloads AS (
  SELECT j.id,min(a.occurred_at) AS first_at,max(a.occurred_at) AS last_at,count(*)::int AS total
    FROM translation_jobs j JOIN audit_events a ON a.target_id=j.id::text
   WHERE j.status='approved' AND a.action='translation.downloaded' AND a.occurred_at>=j.approved_at
     AND coalesce(a.metadata->>'inline','false')<>'true'
   GROUP BY j.id
)
UPDATE translation_jobs j SET first_downloaded_at=d.first_at,last_downloaded_at=d.last_at,
  download_count=d.total,last_activity_at=greatest(j.last_activity_at,d.last_at)
FROM downloads d WHERE d.id=j.id;
ALTER TABLE translation_jobs ALTER COLUMN inspection_required SET DEFAULT true;

CREATE TABLE translation_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES translation_jobs(id),
  revision integer NOT NULL,
  format_generation integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'sample')),
  failed_stages text[] NOT NULL DEFAULT '{}',
  comment text CHECK (char_length(comment) <= 2000),
  inspected_by uuid NOT NULL REFERENCES users(id),
  inspected_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, revision) REFERENCES translation_drafts(job_id, revision),
  CHECK (failed_stages <@ ARRAY['correction', 'translation', 'layout', 'review']::text[]),
  CHECK (decision <> 'rejected' OR (cardinality(failed_stages) > 0 AND char_length(trim(comment)) >= 3))
);
CREATE INDEX translation_inspections_history_idx ON translation_inspections(job_id, inspected_at DESC);

-- Um formato novo é uma revisão de diagramação real, com rascunho completo e fonte rastreável.
CREATE TABLE translation_format_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES translation_jobs(id),
  generation integer NOT NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 120),
  explanation text NOT NULL CHECK (char_length(trim(explanation)) BETWEEN 5 AND 2000),
  source_revision integer NOT NULL,
  revision integer NOT NULL,
  draft jsonb NOT NULL,
  registered_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, generation),
  FOREIGN KEY(job_id, revision) REFERENCES translation_drafts(job_id, revision)
);

-- Saídas concluídas permanecem recuperáveis após uma reabertura confirmada.
CREATE TABLE translation_completed_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES translation_jobs(id),
  revision integer NOT NULL,
  output_key text NOT NULL,
  source_language text NOT NULL,
  target_language text NOT NULL,
  translator_id uuid REFERENCES sworn_translators(id),
  number_label text,
  approved_at timestamptz NOT NULL,
  approved_by uuid REFERENCES users(id),
  invalidated_by uuid NOT NULL REFERENCES users(id),
  invalidated_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  UNIQUE(job_id, output_key)
);

CREATE FUNCTION translation_lifecycle_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.status, NEW.current_revision, NEW.stage_checks, NEW.source_language, NEW.target_language,
         NEW.assignee_id, NEW.consecutive_rejections, NEW.format_generation, NEW.inspection_revision,
         NEW.last_downloaded_at, NEW.download_count, NEW.output_key, NEW.number_label, NEW.book_label, NEW.sheet_label, NEW.approved_at, NEW.annulled_at)
     IS DISTINCT FROM
     ROW(OLD.status, OLD.current_revision, OLD.stage_checks, OLD.source_language, OLD.target_language,
         OLD.assignee_id, OLD.consecutive_rejections, OLD.format_generation, OLD.inspection_revision,
         OLD.last_downloaded_at, OLD.download_count, OLD.output_key, OLD.number_label, OLD.book_label, OLD.sheet_label, OLD.approved_at, OLD.annulled_at) THEN
    NEW.last_activity_at := now();
  END IF;
  IF ROW(NEW.current_revision, NEW.source_language, NEW.target_language)
     IS DISTINCT FROM ROW(OLD.current_revision, OLD.source_language, OLD.target_language) THEN
    NEW.inspection_revision := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER translation_lifecycle_activity BEFORE UPDATE ON translation_jobs
  FOR EACH ROW EXECUTE FUNCTION translation_lifecycle_activity();

-- A migração antiga comparava regclass::text com nomes sem schema; em conexões com search_path customizado
-- isso deixava as restrições pt/en antigas. Resolver pelo nome real da relação permite as 20 direções.
DO $$ DECLARE item record; BEGIN
  FOR item IN
    SELECT c.conrelid::regclass AS tbl, c.conname FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.contype = 'c' AND t.relnamespace=current_schema()::regnamespace
       AND t.relname IN ('translation_jobs', 'glossary_entries', 'batches', 'translation_memory')
       AND c.conname ~ '_(source|target)_language_check$'
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.tbl, item.conname); END LOOP;
END $$;
ALTER TABLE translation_jobs ADD CHECK (source_language IN ('pt','en','fr','it','es')), ADD CHECK (target_language IN ('pt','en','fr','it','es'));
ALTER TABLE glossary_entries ADD CHECK (source_language IN ('pt','en','fr','it','es')), ADD CHECK (target_language IN ('pt','en','fr','it','es'));
ALTER TABLE batches ADD CHECK (source_language IN ('pt','en','fr','it','es')), ADD CHECK (target_language IN ('pt','en','fr','it','es'));
ALTER TABLE translation_memory ADD CHECK (source_language IN ('pt','en','fr','it','es')), ADD CHECK (target_language IN ('pt','en','fr','it','es'));

CREATE INDEX translation_jobs_download_wait_idx ON translation_jobs(approved_at) WHERE status = 'approved' AND first_downloaded_at IS NULL;

-- Números de saídas revogadas continuam reservados, mesmo se o trabalho emitir outra versão depois.
CREATE FUNCTION translation_preserve_issued_numbers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number_label IS NOT NULL AND NEW.translator_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM sworn_translators s WHERE s.id=NEW.translator_id AND s.numbering_scheme<>'reusable_stock')
    AND EXISTS (
    SELECT 1 FROM translation_completed_versions v WHERE v.translator_id=NEW.translator_id
      AND v.number_label=NEW.number_label AND v.job_id<>NEW.id
  ) THEN RAISE EXCEPTION 'Número reservado por uma versão anterior' USING ERRCODE='23505'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER translation_preserve_issued_numbers BEFORE INSERT OR UPDATE OF number_label, translator_id ON translation_jobs
  FOR EACH ROW EXECUTE FUNCTION translation_preserve_issued_numbers();
