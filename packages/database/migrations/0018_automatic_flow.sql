-- Fluxo automático até o Word (ADR-017): na juramentada, quem envia escolhe com ou sem máscara e o tradutor; o
-- número só é exigido quando há máscara. A quantidade de páginas do original alimenta a numeração por folhas.
ALTER TABLE batches
  ADD COLUMN use_mask boolean NOT NULL DEFAULT true,
  ADD COLUMN preferred_translator_id uuid REFERENCES sworn_translators (id);

ALTER TABLE translation_jobs
  ADD COLUMN use_mask boolean NOT NULL DEFAULT true,
  ADD COLUMN preferred_translator_id uuid REFERENCES sworn_translators (id),
  ADD COLUMN page_count integer CHECK (page_count IS NULL OR page_count > 0);

ALTER TABLE translation_jobs DROP CONSTRAINT approved_is_complete;
ALTER TABLE translation_jobs ADD CONSTRAINT approved_is_complete CHECK (
  status <> 'approved'
  OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND output_key IS NOT NULL
      AND (translation_mode <> 'sworn' OR NOT use_mask OR number_label IS NOT NULL))
);
