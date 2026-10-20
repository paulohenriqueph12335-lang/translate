-- Tradução automática gratuita e memória de tradução (ADR-008).

-- Provedor gratuito escolhido pelo Diretor (linha única); sem linha, vale o LibreTranslate local.
CREATE TABLE machine_translation_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  provider text NOT NULL CHECK (provider IN ('libretranslate', 'deepl', 'none')),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Pares aprovados (trecho do original → tradução), reaproveitados antes de chamar qualquer provedor.
CREATE TABLE translation_memory (
  source_language text NOT NULL CHECK (source_language IN ('pt', 'en')),
  target_language text NOT NULL CHECK (target_language IN ('pt', 'en')),
  source_text text NOT NULL CHECK (char_length(source_text) BETWEEN 1 AND 4000),
  target_text text NOT NULL CHECK (char_length(target_text) BETWEEN 1 AND 8000),
  last_job_id uuid REFERENCES translation_jobs (id),
  uses integer NOT NULL DEFAULT 1 CHECK (uses > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_language, target_language, source_text)
);

-- Rascunhos gerados por tradução automática gratuita.
ALTER TABLE translation_drafts DROP CONSTRAINT translation_drafts_origin_check;
ALTER TABLE translation_drafts ADD CONSTRAINT translation_drafts_origin_check CHECK (origin IN ('claude', 'machine', 'manual', 'human'));

-- O sinal do worker passa a informar também os provedores gratuitos disponíveis.
ALTER TABLE worker_heartbeats ADD COLUMN machine_providers text[] NOT NULL DEFAULT '{}';
