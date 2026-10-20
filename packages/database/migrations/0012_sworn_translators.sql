-- Tradutores juramentados com máscara própria e numeração própria (ADR-012).
-- Substitui o tradutor público único (translation_settings) e o contador anual da organização (translation_counters),
-- que ficam só como histórico das traduções já concluídas.

CREATE TABLE sworn_translators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 160),
  registration text CHECK (char_length(registration) <= 240),
  languages text CHECK (char_length(languages) <= 120),
  -- Regras de numeração do tradutor, em texto, até serem definidas e automatizadas.
  numbering_rules text CHECK (char_length(numbering_rules) <= 4000),
  notes text CHECK (char_length(notes) <= 2000),
  active boolean NOT NULL DEFAULT true,
  -- Máscara em Word (com os marcadores) e, opcionalmente, o PDF entregue pelo tradutor como referência.
  mask_key text,
  mask_name text,
  mask_sha256 bytea CHECK (octet_length(mask_sha256) = 32),
  mask_size bigint,
  mask_markers text[] NOT NULL DEFAULT '{}',
  mask_uploaded_at timestamptz,
  reference_pdf_key text,
  reference_pdf_name text,
  reference_pdf_size bigint,
  created_by uuid NOT NULL REFERENCES users (id),
  updated_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sworn_translators_name_idx ON sworn_translators (lower(name));

-- A numeração agora é a do tradutor escolhido na conclusão, digitada como ele usa (texto livre).
ALTER TABLE translation_jobs ADD COLUMN translator_id uuid REFERENCES sworn_translators (id);
ALTER TABLE translation_jobs ADD COLUMN number_label text CHECK (char_length(number_label) BETWEEN 1 AND 40);
ALTER TABLE translation_jobs ADD COLUMN book_label text CHECK (char_length(book_label) BETWEEN 1 AND 40);
ALTER TABLE translation_jobs ADD COLUMN sheet_label text CHECK (char_length(sheet_label) BETWEEN 1 AND 40);
UPDATE translation_jobs
   SET number_label = lpad(translation_number::text, 4, '0') || '/' || translation_year,
       book_label = lpad(book::text, 3, '0'),
       sheet_label = lpad(sheet::text, 3, '0')
 WHERE translation_number IS NOT NULL;
ALTER TABLE translation_jobs DROP CONSTRAINT approved_is_complete;
ALTER TABLE translation_jobs ADD CONSTRAINT approved_is_complete CHECK (
  status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND output_key IS NOT NULL AND number_label IS NOT NULL)
);
-- O mesmo número não se repete no livro do mesmo tradutor.
CREATE UNIQUE INDEX translation_jobs_translator_number_idx ON translation_jobs (translator_id, number_label)
  WHERE translator_id IS NOT NULL AND number_label IS NOT NULL;
CREATE INDEX translation_jobs_issued_idx ON translation_jobs (translation_year) WHERE number_label IS NOT NULL;

-- Pedidos de alteração passam a usar os mesmos valores em texto.
ALTER TABLE numbering_requests DROP CONSTRAINT numbering_requests_requested_number_check;
ALTER TABLE numbering_requests DROP CONSTRAINT numbering_requests_requested_book_check;
ALTER TABLE numbering_requests DROP CONSTRAINT numbering_requests_requested_sheet_check;
ALTER TABLE numbering_requests
  ALTER COLUMN requested_number TYPE text USING requested_number::text,
  ALTER COLUMN requested_book TYPE text USING requested_book::text,
  ALTER COLUMN requested_sheet TYPE text USING requested_sheet::text,
  ALTER COLUMN previous_number TYPE text USING previous_number::text,
  ALTER COLUMN previous_book TYPE text USING previous_book::text,
  ALTER COLUMN previous_sheet TYPE text USING previous_sheet::text;
ALTER TABLE numbering_requests ADD CONSTRAINT numbering_requests_values_length CHECK (
  coalesce(char_length(requested_number), 1) BETWEEN 1 AND 40
  AND coalesce(char_length(requested_book), 1) BETWEEN 1 AND 40
  AND coalesce(char_length(requested_sheet), 1) BETWEEN 1 AND 40
);
UPDATE numbering_requests nr
   SET previous_number = lpad(nr.previous_number, 4, '0') || '/' || j.translation_year
  FROM translation_jobs j
 WHERE j.id = nr.job_id AND nr.previous_number IS NOT NULL AND nr.previous_number ~ '^\d+$';
