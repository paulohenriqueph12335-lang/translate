-- Máscaras por edição (ADR-012, revisão de 2026-10-19): cada envio do Supervisor é uma nova edição numerada da
-- máscara do tradutor; a tradução concluída guarda a edição usada. As regras de numeração saem do cadastro: serão
-- programadas no sistema por tradutor.

CREATE TABLE sworn_translator_masks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translator_id uuid NOT NULL REFERENCES sworn_translators (id),
  edition integer NOT NULL CHECK (edition > 0),
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  markers text[] NOT NULL DEFAULT '{}',
  notes text CHECK (char_length(notes) <= 500),
  uploaded_by uuid NOT NULL REFERENCES users (id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (translator_id, edition)
);

-- Máscaras já enviadas viram a edição 1.
INSERT INTO sworn_translator_masks (translator_id, edition, object_key, file_name, sha256, size_bytes, markers, uploaded_by, uploaded_at)
SELECT id, 1, mask_key, coalesce(mask_name, 'mascara.docx'), mask_sha256, mask_size, mask_markers, updated_by, coalesce(mask_uploaded_at, updated_at)
  FROM sworn_translators WHERE mask_key IS NOT NULL;

-- Edição em uso nas próximas conclusões (a mais recente, ou outra escolhida pelo Supervisor).
ALTER TABLE sworn_translators ADD COLUMN current_mask_id uuid REFERENCES sworn_translator_masks (id);
UPDATE sworn_translators s SET current_mask_id = m.id FROM sworn_translator_masks m WHERE m.translator_id = s.id AND m.edition = 1;

-- A tradução guarda a edição da máscara com que foi gerada.
ALTER TABLE translation_jobs ADD COLUMN mask_id uuid REFERENCES sworn_translator_masks (id);
UPDATE translation_jobs j SET mask_id = s.current_mask_id FROM sworn_translators s WHERE s.id = j.translator_id;

ALTER TABLE sworn_translators
  DROP COLUMN numbering_rules,
  DROP COLUMN mask_key,
  DROP COLUMN mask_name,
  DROP COLUMN mask_sha256,
  DROP COLUMN mask_size,
  DROP COLUMN mask_markers,
  DROP COLUMN mask_uploaded_at;
