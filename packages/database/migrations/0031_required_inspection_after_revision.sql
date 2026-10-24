-- Documentos antigos permanecem emitidos; qualquer nova revisão entra na conferência do fluxo atual.
CREATE FUNCTION translation_require_current_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.current_revision IS DISTINCT FROM NEW.current_revision THEN
    NEW.inspection_required := true;
    NEW.inspection_revision := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER translation_current_revision_inspection
  BEFORE UPDATE OF current_revision ON translation_jobs
  FOR EACH ROW EXECUTE FUNCTION translation_require_current_inspection();
