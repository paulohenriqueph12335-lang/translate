-- Fase 3: tradução juramentada assistida com revisão humana obrigatória (ADR-007).

-- Tradutor público da organização (linha única) e numeração do livro.
CREATE TABLE translation_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  translator_name text NOT NULL CHECK (char_length(translator_name) BETWEEN 3 AND 120),
  title_pt text NOT NULL CHECK (char_length(title_pt) BETWEEN 3 AND 120),
  language_pt text NOT NULL CHECK (char_length(language_pt) BETWEEN 2 AND 40),
  registration text NOT NULL CHECK (char_length(registration) BETWEEN 3 AND 160),
  registration_en text NOT NULL CHECK (char_length(registration_en) BETWEEN 3 AND 240),
  registration_pt text NOT NULL CHECK (char_length(registration_pt) BETWEEN 3 AND 240),
  city text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 80),
  state_pt text NOT NULL CHECK (char_length(state_pt) BETWEEN 2 AND 80),
  state_en text NOT NULL CHECK (char_length(state_en) BETWEEN 2 AND 80),
  letterhead_note text CHECK (char_length(letterhead_note) <= 160),
  fee_note text CHECK (char_length(fee_note) <= 200),
  current_book integer NOT NULL DEFAULT 1 CHECK (current_book > 0),
  next_sheet integer NOT NULL DEFAULT 1 CHECK (next_sheet > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users (id)
);

-- Número sequencial da tradução por ano.
CREATE TABLE translation_counters (
  year integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 2999),
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

-- Uso do Claude habilitado por equipe pelo Diretor; desligado por padrão.
ALTER TABLE teams ADD COLUMN claude_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE translation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents (id),
  source_language text NOT NULL CHECK (source_language IN ('pt', 'en')),
  target_language text NOT NULL CHECK (target_language IN ('pt', 'en')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'in_review', 'awaiting_approval', 'approved', 'failed', 'cancelled')),
  -- Pedido de rascunho: automático (Claude se habilitado), manual, ou nova tentativa com o Claude a partir da revisão.
  requested_mode text NOT NULL DEFAULT 'auto' CHECK (requested_mode IN ('auto', 'manual', 'claude')),
  requested_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Fila: lease com prazo, tentativas limitadas e espera entre tentativas.
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  failure_code text,
  -- Texto extraído do original (para checagens e revisão lado a lado).
  extracted_text text,
  source_title text,
  current_revision integer,
  -- Aviso quando o Claude foi pedido mas não pôde ajudar (o rascunho seguiu manual).
  assist_notice text,
  submitted_by uuid REFERENCES users (id),
  submitted_at timestamptz,
  review_comment text,
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  approval_override_reason text,
  translation_number integer,
  translation_year integer,
  book integer,
  sheet integer,
  output_key text UNIQUE,
  output_sha256 bytea CHECK (octet_length(output_sha256) = 32),
  output_size bigint,
  CONSTRAINT languages_differ CHECK (source_language <> target_language),
  CONSTRAINT approved_is_complete CHECK (
    status <> 'approved'
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND output_key IS NOT NULL AND translation_number IS NOT NULL)
  ),
  CONSTRAINT failed_has_code CHECK (status <> 'failed' OR failure_code IS NOT NULL)
);
-- Um trabalho ativo por documento e idioma de destino.
CREATE UNIQUE INDEX translation_jobs_active_idx ON translation_jobs (document_id, target_language)
  WHERE status NOT IN ('failed', 'cancelled');
CREATE INDEX translation_jobs_queue_idx ON translation_jobs (run_after, created_at) WHERE status = 'queued';
CREATE INDEX translation_jobs_lease_idx ON translation_jobs (lease_expires_at) WHERE status = 'processing';
CREATE INDEX translation_jobs_examples_idx ON translation_jobs (source_language, target_language, approved_at DESC) WHERE status = 'approved';
CREATE UNIQUE INDEX translation_jobs_number_idx ON translation_jobs (translation_year, translation_number) WHERE translation_number IS NOT NULL;

-- Revisões imutáveis do rascunho.
CREATE TABLE translation_drafts (
  job_id uuid NOT NULL REFERENCES translation_jobs (id),
  revision integer NOT NULL CHECK (revision > 0),
  content jsonb NOT NULL,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  origin text NOT NULL CHECK (origin IN ('claude', 'manual', 'human')),
  author_id uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, revision),
  CONSTRAINT human_has_author CHECK (origin <> 'human' OR author_id IS NOT NULL)
);

CREATE FUNCTION translation_drafts_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'translation_drafts é imutável';
END;
$$;
CREATE TRIGGER translation_drafts_no_update_delete
  BEFORE UPDATE OR DELETE ON translation_drafts
  FOR EACH ROW EXECUTE FUNCTION translation_drafts_immutable();

-- Glossário aprovado por pessoas: da organização (team_id nulo) ou de uma equipe.
CREATE TABLE glossary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_language text NOT NULL CHECK (source_language IN ('pt', 'en')),
  target_language text NOT NULL CHECK (target_language IN ('pt', 'en')),
  source_term citext NOT NULL CHECK (char_length(source_term) BETWEEN 1 AND 200),
  target_term text NOT NULL CHECK (char_length(target_term) BETWEEN 1 AND 200),
  note text CHECK (char_length(note) <= 500),
  team_id uuid REFERENCES teams (id),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT glossary_languages_differ CHECK (source_language <> target_language)
);
CREATE UNIQUE INDEX glossary_entries_unique_idx ON glossary_entries (
  source_language, target_language, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), source_term
);
