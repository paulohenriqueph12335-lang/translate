-- Ensaios persistem somente identidade por digest, propriedades de layout e decisões; nunca o arquivo ou texto.
CREATE TABLE pattern_trials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  team_id uuid REFERENCES teams(id),
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  file_digest text NOT NULL CHECK (file_digest ~ '^[a-f0-9]{64}$'),
  source_language text NOT NULL CHECK (source_language IN ('pt','en','fr','it','es')),
  target_language text NOT NULL CHECK (target_language IN ('pt','en','fr','it','es')),
  mode text NOT NULL CHECK (mode IN ('sworn','certified','technical','simple')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  consecutive_rejections integer NOT NULL DEFAULT 0 CHECK (consecutive_rejections BETWEEN 0 AND 3),
  format_generation integer NOT NULL DEFAULT 1 CHECK (format_generation > 0),
  layout_preset text NOT NULL DEFAULT 'source' CHECK (layout_preset IN ('source','left','justify','center')),
  result_digest text,
  source_layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_regeneration boolean NOT NULL DEFAULT false,
  decision text CHECK (decision IN ('approved','rejected')),
  failed_stages text[] NOT NULL DEFAULT '{}',
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_language <> target_language),
  CHECK (failed_stages <@ ARRAY['correction','translation','layout','review']::text[])
);
CREATE INDEX pattern_trials_scope_idx ON pattern_trials(team_id,owner_id,updated_at DESC);

CREATE TABLE pattern_trial_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_id uuid NOT NULL REFERENCES pattern_trials(id),
  revision integer NOT NULL,
  format_generation integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  failed_stages text[] NOT NULL DEFAULT '{}',
  comment text,
  reviewed_by uuid NOT NULL REFERENCES users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trial_id,revision),
  CHECK (failed_stages <@ ARRAY['correction','translation','layout','review']::text[]),
  CHECK (decision <> 'rejected' OR (cardinality(failed_stages)>0 AND char_length(trim(comment))>=3))
);
CREATE TABLE pattern_trial_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_id uuid NOT NULL REFERENCES pattern_trials(id),
  format_generation integer NOT NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 120),
  explanation text NOT NULL CHECK (char_length(trim(explanation)) BETWEEN 5 AND 2000),
  layout_preset text NOT NULL CHECK (layout_preset IN ('source','left','justify','center')),
  layout_digest text NOT NULL,
  registered_by uuid NOT NULL REFERENCES users(id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trial_id,format_generation)
);
