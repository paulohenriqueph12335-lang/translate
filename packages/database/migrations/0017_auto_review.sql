-- Revisão automática (ADR-016): cada revisão guarda as correções feitas pelo sistema; revisões geradas pela
-- revisão automática pedida por alguém têm origem própria.
ALTER TABLE translation_drafts ADD COLUMN corrections jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE translation_drafts DROP CONSTRAINT translation_drafts_origin_check;
ALTER TABLE translation_drafts ADD CONSTRAINT translation_drafts_origin_check
  CHECK (origin IN ('claude', 'machine', 'manual', 'human', 'review'));
ALTER TABLE translation_drafts DROP CONSTRAINT human_has_author;
ALTER TABLE translation_drafts ADD CONSTRAINT human_has_author CHECK (origin NOT IN ('human', 'review') OR author_id IS NOT NULL);
