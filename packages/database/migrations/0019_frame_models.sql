-- Modelos de moldura do tradutor (ADR-019): a edição da máscara pode ser um modelo do sistema com os dados do
-- tradutor; o Word é gerado no idioma de cada tradução. O arquivo guardado é um exemplo para download.
ALTER TABLE sworn_translator_masks
  ADD COLUMN frame jsonb CHECK (frame IS NULL OR (frame ? 'model' AND frame ? 'city' AND frame ? 'state'));
