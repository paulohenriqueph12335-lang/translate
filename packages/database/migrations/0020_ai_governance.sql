-- Gerenciamento AI (ADR-021): o Gemini como gestor de processo e orientador técnico, com escopo restrito.

-- Configuração única: ligada ou não, modelo e prompt de governança (editável por Líder e Diretor).
CREATE TABLE ai_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  model text NOT NULL DEFAULT 'gemini-2.5-flash' CHECK (char_length(model) BETWEEN 3 AND 80),
  governance_prompt text CHECK (char_length(governance_prompt) <= 8000),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Habilidades (instruções adicionais) que entram no prompt; só Líder e Diretor criam e editam.
CREATE TABLE ai_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 80),
  content text NOT NULL CHECK (char_length(content) BETWEEN 5 AND 12000),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users (id),
  updated_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Acesso por pessoa: sem registro, a pessoa usa; o Líder (da equipe) ou o Diretor pode bloquear.
CREATE TABLE ai_user_access (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  allowed boolean NOT NULL,
  set_by uuid NOT NULL REFERENCES users (id),
  set_at timestamptz NOT NULL DEFAULT now()
);

-- Cada chamada à IA, inclusive as barradas, para o Gerenciamento AI.
CREATE TABLE ai_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users (id),
  translation_id uuid REFERENCES translation_jobs (id),
  task text NOT NULL CHECK (task IN ('glossary_check', 'layout_combination', 'process_help')),
  status text NOT NULL CHECK (status IN ('ok', 'blocked', 'failed', 'unavailable', 'denied')),
  reason text CHECK (char_length(reason) <= 500),
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_requests_created_idx ON ai_requests (created_at DESC);

-- Combinações de diagramação propostas pela IA: só valem depois de aprovadas na prévia; aprovadas, entram no
-- conhecimento de diagramação (ADR-020) e são reaproveitadas em documentos parecidos.
CREATE TABLE ai_layout_combinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_id uuid NOT NULL REFERENCES translation_jobs (id),
  revision integer NOT NULL,
  sample jsonb NOT NULL,
  rationale text CHECK (char_length(rationale) <= 600),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  requested_by uuid REFERENCES users (id),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_layout_combinations_translation_idx ON ai_layout_combinations (translation_id, created_at DESC);
