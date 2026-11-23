ALTER TABLE document_exports ADD COLUMN snapshot_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE FUNCTION document_export_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.snapshot_metadata IS DISTINCT FROM OLD.snapshot_metadata THEN
  RAISE EXCEPTION 'DOCUMENT_EXPORT_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_export_metadata_guard BEFORE UPDATE ON document_exports FOR EACH ROW EXECUTE FUNCTION document_export_metadata_guard();
