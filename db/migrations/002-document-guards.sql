-- Cross-row invariants not expressible in Drizzle CHECK constraints.
ALTER TABLE document_nodes ALTER CONSTRAINT document_nodes_parent_fk DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION document_image_ids(body jsonb) RETURNS SETOF integer
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; value text;
BEGIN
  FOR item IN SELECT DISTINCT x FROM jsonb_path_query(body, '$.** ? (@.type == "image").attrs.resourceId') x LOOP
    value := item #>> '{}';
    IF jsonb_typeof(item) <> 'number' OR value !~ '^[1-9][0-9]{0,9}$' OR value::bigint > 2147483647 THEN
      RAISE EXCEPTION 'DOCUMENT_INVALID_IMAGE_ID' USING ERRCODE = '23514';
    END IF;
    RETURN NEXT value::integer;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION document_assert_node(target integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n document_nodes%ROWTYPE; body jsonb; actual integer[]; expected integer[];
BEGIN
  SELECT * INTO n FROM document_nodes WHERE id=target;
  IF NOT FOUND THEN RETURN; END IF;
  IF (SELECT count(*) FROM document_bodies WHERE node_id=target) <> (CASE WHEN n.kind='document' THEN 1 ELSE 0 END)
    OR (SELECT count(*) FROM document_file_entries WHERE node_id=target) <> (CASE WHEN n.kind='file' THEN 1 ELSE 0 END)
    OR (SELECT count(*) FROM document_link_entries WHERE node_id=target) <> (CASE WHEN n.kind='link' THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'DOCUMENT_CONTENT_KIND_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF n.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM document_nodes p WHERE p.id=n.parent_id AND p.space_id=n.space_id AND p.kind='folder' AND (n.state<>'active' OR p.state='active')) THEN
    RAISE EXCEPTION 'DOCUMENT_INVALID_PARENT' USING ERRCODE='23514';
  END IF;
  IF EXISTS(WITH RECURSIVE parents AS (
    SELECT id,parent_id FROM document_nodes WHERE id=n.parent_id
    UNION SELECT p.id,p.parent_id FROM document_nodes p JOIN parents c ON p.id=c.parent_id
  ) SELECT 1 FROM parents WHERE id=n.id) THEN
    RAISE EXCEPTION 'DOCUMENT_DIRECTORY_CYCLE' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM document_versions WHERE node_id=target)>10 THEN
    RAISE EXCEPTION 'DOCUMENT_HISTORY_LIMIT' USING ERRCODE='23514';
  END IF;
  IF n.kind='file' AND NOT EXISTS(SELECT 1 FROM document_file_entries f JOIN document_resource_refs r ON r.node_id=f.node_id AND r.resource_id=f.resource_id AND r.role='file' WHERE f.node_id=target) THEN
    RAISE EXCEPTION 'DOCUMENT_FILE_REFERENCE_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM document_resource_refs r LEFT JOIN document_file_entries f ON f.node_id=r.node_id AND f.resource_id=r.resource_id WHERE r.node_id=target AND r.role='file' AND f.node_id IS NULL) THEN
    RAISE EXCEPTION 'DOCUMENT_FILE_REFERENCE_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF n.kind='document' THEN
    SELECT content_json INTO body FROM document_bodies WHERE node_id=target;
    SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO expected FROM document_image_ids(body) x;
    SELECT coalesce(array_agg(DISTINCT resource_id ORDER BY resource_id),'{}') INTO actual FROM document_resource_refs WHERE node_id=target AND role='body_image';
    IF actual<>expected THEN RAISE EXCEPTION 'DOCUMENT_BODY_IMAGE_REFERENCE_MISMATCH' USING ERRCODE='23514'; END IF;
  END IF;
  IF n.state='active' AND EXISTS(SELECT 1 FROM document_trash_items WHERE node_id=target) THEN
    RAISE EXCEPTION 'DOCUMENT_ACTIVE_TRASH_ITEM' USING ERRCODE='23514';
  END IF;
  IF n.state<>'active' AND NOT EXISTS(SELECT 1 FROM document_trash_items i JOIN document_trash_batches b ON b.id=i.batch_id WHERE i.node_id=target AND b.id=n.trash_batch_id AND b.space_id=n.space_id AND b.deleted_at=n.deleted_at AND b.expires_at=n.expires_at) THEN
    RAISE EXCEPTION 'DOCUMENT_TRASH_BATCH_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF n.state<>'active' AND EXISTS(SELECT 1 FROM document_associations WHERE node_id=target) THEN
    RAISE EXCEPTION 'DOCUMENT_REFERENCE_EXISTS' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM document_associations a JOIN document_spaces ds ON ds.id=n.space_id
    LEFT JOIN tasks t ON t.id=a.task_id LEFT JOIN milestones m ON m.id=a.milestone_id
    JOIN projects p ON p.id=coalesce(t.project_id,m.project_id)
    WHERE a.node_id=target AND (ds.team_id<>p.team_id OR (ds.project_id IS NOT NULL AND ds.project_id<>p.id))) THEN
    RAISE EXCEPTION 'DOCUMENT_ASSOCIATION_SCOPE' USING ERRCODE='23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION document_deferred_node_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE old_id integer; new_id integer; space integer; v record; expected integer[]; actual integer[];
BEGIN
  IF TG_TABLE_NAME='document_nodes' THEN
    IF TG_OP<>'INSERT' THEN old_id:=OLD.id; END IF;
    IF TG_OP<>'DELETE' THEN new_id:=NEW.id; END IF;
  ELSIF TG_TABLE_NAME='document_resource_refs' THEN
    IF TG_OP<>'INSERT' THEN old_id:=OLD.node_id; END IF;
    IF TG_OP<>'DELETE' THEN new_id:=NEW.node_id; END IF;
    FOR v IN SELECT id,node_id,content_json FROM document_versions WHERE id IN (
      (CASE WHEN TG_OP<>'INSERT' THEN OLD.version_id END), (CASE WHEN TG_OP<>'DELETE' THEN NEW.version_id END)
    ) LOOP
      PERFORM document_assert_node(v.node_id);
      SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO expected FROM document_image_ids(v.content_json) x;
      SELECT coalesce(array_agg(DISTINCT resource_id ORDER BY resource_id),'{}') INTO actual FROM document_resource_refs WHERE version_id=v.id;
      IF expected<>actual THEN RAISE EXCEPTION 'DOCUMENT_VERSION_IMAGE_REFERENCE_MISMATCH' USING ERRCODE='23514'; END IF;
    END LOOP;
  ELSE
    IF TG_OP<>'INSERT' THEN old_id:=OLD.node_id; END IF;
    IF TG_OP<>'DELETE' THEN new_id:=NEW.node_id; END IF;
  END IF;
  PERFORM document_assert_node(old_id); PERFORM document_assert_node(new_id);
  IF TG_TABLE_NAME='document_nodes' THEN
    FOR space IN SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP<>'INSERT' THEN OLD.space_id END, CASE WHEN TG_OP<>'DELETE' THEN NEW.space_id END
    ]) x WHERE x IS NOT NULL LOOP
      IF EXISTS(SELECT 1 FROM document_spaces WHERE id=space AND state<>'deleting') AND NOT EXISTS(SELECT 1 FROM document_nodes WHERE space_id=space AND parent_id IS NULL AND kind='folder' AND state='active') THEN
        RAISE EXCEPTION 'DOCUMENT_LAST_PARTITION' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  IF TG_TABLE_NAME='document_versions' AND TG_OP<>'DELETE' THEN
    SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO expected FROM document_image_ids(NEW.content_json) x;
    SELECT coalesce(array_agg(DISTINCT resource_id ORDER BY resource_id),'{}') INTO actual FROM document_resource_refs WHERE version_id=NEW.id;
    IF EXISTS(SELECT 1 FROM document_versions WHERE id=NEW.id) AND expected<>actual THEN
      RAISE EXCEPTION 'DOCUMENT_VERSION_IMAGE_REFERENCE_MISMATCH' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['document_nodes','document_bodies','document_file_entries','document_link_entries','document_versions','document_resource_refs','document_trash_items','document_associations'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION document_deferred_node_check()', t||'_final_check', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION document_node_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s integer; n integer; migrating boolean:=coalesce(current_setting('app.documents_migrating',true),'')='on';
BEGIN
  -- Serialize structural writes and lock acquisition on the same space.
  FOR s IN SELECT DISTINCT x FROM unnest(ARRAY[
    CASE WHEN TG_OP<>'INSERT' THEN OLD.space_id END, CASE WHEN TG_OP<>'DELETE' THEN NEW.space_id END
  ]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM 1 FROM document_spaces WHERE id=s FOR UPDATE;
    IF NOT migrating AND EXISTS(SELECT 1 FROM document_spaces WHERE id=s AND state<>'active') THEN
      RAISE EXCEPTION 'DOCUMENT_SPACE_READ_ONLY' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF TG_OP='UPDATE' AND OLD.kind<>NEW.kind THEN RAISE EXCEPTION 'DOCUMENT_KIND_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.space_id<>NEW.space_id AND
    (SELECT team_id FROM document_spaces WHERE id=OLD.space_id)<>(SELECT team_id FROM document_spaces WHERE id=NEW.space_id) THEN
    RAISE EXCEPTION 'DOCUMENT_CROSS_TEAM_MOVE' USING ERRCODE='23514';
  END IF;
  IF TG_OP<>'INSERT' AND NOT migrating THEN
    IF TG_OP='DELETE' OR OLD.parent_id IS DISTINCT FROM NEW.parent_id OR OLD.space_id<>NEW.space_id OR OLD.state<>NEW.state THEN
      IF EXISTS(WITH RECURSIVE subtree AS (
        SELECT id FROM document_nodes WHERE id=OLD.id
        UNION SELECT d.id FROM document_nodes d JOIN subtree p ON d.parent_id=p.id
      ) SELECT 1 FROM subtree JOIN document_edit_locks l ON l.node_id=subtree.id WHERE l.expires_at>clock_timestamp()) THEN
        RAISE EXCEPTION 'DOCUMENT_EDITING' USING ERRCODE='55000';
      END IF;
    ELSIF OLD.name<>NEW.name AND EXISTS(SELECT 1 FROM document_edit_locks WHERE node_id=OLD.id AND expires_at>clock_timestamp() AND session_token_hash IS DISTINCT FROM current_setting('app.document_lock_token_hash',true)) THEN
      RAISE EXCEPTION 'DOCUMENT_EDITING' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_nodes_write_guard BEFORE INSERT OR UPDATE OR DELETE ON document_nodes FOR EACH ROW EXECUTE FUNCTION document_node_write_guard();

CREATE OR REPLACE FUNCTION document_space_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND team_id=NEW.team_id) THEN
    RAISE EXCEPTION 'DOCUMENT_SPACE_PROJECT_TEAM_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.state<>OLD.state AND EXISTS(SELECT 1 FROM document_nodes n JOIN document_edit_locks l ON l.node_id=n.id WHERE n.space_id=NEW.id AND l.expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'DOCUMENT_EDITING' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_spaces_guard BEFORE INSERT OR UPDATE ON document_spaces FOR EACH ROW EXECUTE FUNCTION document_space_guard();

CREATE OR REPLACE FUNCTION document_space_final_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM document_spaces WHERE id=NEW.id AND state<>'deleting') AND NOT EXISTS(SELECT 1 FROM document_nodes WHERE space_id=NEW.id AND parent_id IS NULL AND state='active') THEN
    RAISE EXCEPTION 'DOCUMENT_LAST_PARTITION' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER document_spaces_final_check AFTER INSERT OR UPDATE ON document_spaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION document_space_final_check();

CREATE OR REPLACE FUNCTION document_ref_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource document_resources%ROWTYPE; owner_team integer; owner_kind text;
BEGIN
  SELECT * INTO resource FROM document_resources WHERE id=NEW.resource_id FOR UPDATE;
  IF NOT FOUND OR resource.state<>'ready' THEN RAISE EXCEPTION 'DOCUMENT_RESOURCE_NOT_READY' USING ERRCODE='23514'; END IF;
  IF NEW.node_id IS NOT NULL THEN
    SELECT s.team_id,n.kind INTO owner_team,owner_kind FROM document_nodes n JOIN document_spaces s ON s.id=n.space_id WHERE n.id=NEW.node_id;
    IF (NEW.role='file' AND owner_kind<>'file') OR (NEW.role='body_image' AND owner_kind<>'document') THEN RAISE EXCEPTION 'DOCUMENT_REFERENCE_KIND_MISMATCH' USING ERRCODE='23514'; END IF;
  ELSIF NEW.version_id IS NOT NULL THEN
    SELECT s.team_id INTO owner_team FROM document_versions v JOIN document_nodes n ON n.id=v.node_id JOIN document_spaces s ON s.id=n.space_id WHERE v.id=NEW.version_id;
  ELSE
    SELECT e.team_id INTO owner_team FROM document_export_items i JOIN document_exports e ON e.id=i.export_id WHERE i.id=NEW.export_item_id;
  END IF;
  IF owner_team IS NULL OR owner_team<>resource.team_id THEN RAISE EXCEPTION 'DOCUMENT_CROSS_TEAM_RESOURCE' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_resource_refs_guard BEFORE INSERT OR UPDATE ON document_resource_refs FOR EACH ROW EXECUTE FUNCTION document_ref_guard();

CREATE OR REPLACE FUNCTION document_resource_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.stored_name IS DISTINCT FROM NEW.stored_name OR OLD.size IS DISTINCT FROM NEW.size OR OLD.mime_type IS DISTINCT FROM NEW.mime_type OR OLD.team_id<>NEW.team_id) THEN
    RAISE EXCEPTION 'DOCUMENT_RESOURCE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' OR NEW.state='deleting' THEN
    IF EXISTS(SELECT 1 FROM document_resource_refs WHERE resource_id=OLD.id) OR EXISTS(SELECT 1 FROM document_image_grants WHERE resource_id=OLD.id AND expires_at>clock_timestamp()) THEN
      RAISE EXCEPTION 'DOCUMENT_RESOURCE_IN_USE' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_resources_guard BEFORE UPDATE OR DELETE ON document_resources FOR EACH ROW EXECUTE FUNCTION document_resource_guard();

CREATE OR REPLACE FUNCTION document_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n document_nodes%ROWTYPE; s document_spaces%ROWTYPE;
BEGIN
  SELECT ds.* INTO s FROM document_spaces ds JOIN document_nodes dn ON dn.space_id=ds.id WHERE dn.id=NEW.node_id FOR UPDATE OF ds;
  SELECT * INTO n FROM document_nodes WHERE id=NEW.node_id FOR UPDATE;
  IF n.kind IS DISTINCT FROM 'document' OR n.state IS DISTINCT FROM 'active' OR s.state IS DISTINCT FROM 'active' OR NOT EXISTS(SELECT 1 FROM team_members WHERE team_id=s.team_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'DOCUMENT_LOCK_NOT_ALLOWED' USING ERRCODE='23514';
  END IF;
  IF NEW.expires_at<=clock_timestamp() OR NEW.expires_at>clock_timestamp()+interval '2 minutes' THEN RAISE EXCEPTION 'DOCUMENT_LOCK_INVALID_EXPIRY' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (OLD.expires_at<=clock_timestamp() OR OLD.user_id<>NEW.user_id OR OLD.session_token_hash<>NEW.session_token_hash OR OLD.node_id<>NEW.node_id) THEN
    RAISE EXCEPTION 'DOCUMENT_LOCK_LOST' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_edit_locks_guard BEFORE INSERT OR UPDATE ON document_edit_locks FOR EACH ROW EXECUTE FUNCTION document_lock_guard();

CREATE OR REPLACE FUNCTION document_association_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n document_nodes%ROWTYPE; source document_spaces%ROWTYPE; project integer; target_team integer;
BEGIN
  SELECT * INTO n FROM document_nodes WHERE id=NEW.node_id;
  SELECT * INTO source FROM document_spaces WHERE id=n.space_id FOR UPDATE;
  IF NEW.task_id IS NOT NULL THEN SELECT project_id INTO project FROM tasks WHERE id=NEW.task_id;
  ELSE SELECT project_id INTO project FROM milestones WHERE id=NEW.milestone_id; END IF;
  SELECT team_id INTO target_team FROM projects WHERE id=project;
  IF n.kind='folder' OR n.state<>'active' OR target_team IS NULL OR target_team<>source.team_id OR (source.project_id IS NOT NULL AND source.project_id<>project) THEN
    RAISE EXCEPTION 'DOCUMENT_ASSOCIATION_SCOPE' USING ERRCODE='23514';
  END IF;
  IF coalesce(current_setting('app.documents_migrating',true),'')<>'on' AND
    (source.state<>'active' OR EXISTS(SELECT 1 FROM projects WHERE id=project AND status='archived')) THEN
    RAISE EXCEPTION 'DOCUMENT_SPACE_READ_ONLY' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_associations_guard BEFORE INSERT OR UPDATE ON document_associations FOR EACH ROW EXECUTE FUNCTION document_association_guard();

CREATE OR REPLACE FUNCTION document_member_left() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM document_edit_locks l USING document_nodes n,document_spaces s WHERE l.node_id=n.id AND n.space_id=s.id AND s.team_id=OLD.team_id AND l.user_id=OLD.user_id;
  RETURN OLD;
END $$;
CREATE TRIGGER document_member_left AFTER DELETE ON team_members FOR EACH ROW EXECUTE FUNCTION document_member_left();

CREATE OR REPLACE FUNCTION document_project_status_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE document_spaces SET state=CASE WHEN NEW.status='archived' THEN 'archived' ELSE 'active' END,version=version+1 WHERE project_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_project_status_sync AFTER UPDATE OF status ON projects FOR EACH ROW EXECUTE FUNCTION document_project_status_sync();

-- Transitional fail-closed protection until the legacy API adapter is implemented.
CREATE OR REPLACE FUNCTION document_legacy_attachment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM document_legacy_files WHERE legacy_attachment_id=OLD.id) AND coalesce(current_setting('app.documents_legacy_adapter',true),'')<>'on' THEN
    RAISE EXCEPTION 'DOCUMENT_LEGACY_ADAPTER_REQUIRED' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_legacy_attachment_guard BEFORE UPDATE OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION document_legacy_attachment_guard();

CREATE OR REPLACE FUNCTION document_image_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_team integer; resource_team integer; resource_state text;
BEGIN
  SELECT s.team_id INTO owner_team FROM document_nodes n JOIN document_spaces s ON s.id=n.space_id
    JOIN document_edit_locks l ON l.node_id=n.id WHERE n.id=NEW.node_id AND n.kind='document' AND n.state='active'
    AND s.state='active' AND l.user_id=NEW.user_id AND l.session_token_hash=NEW.lock_token_hash AND l.expires_at>clock_timestamp();
  SELECT team_id,state INTO resource_team,resource_state FROM document_resources WHERE id=NEW.resource_id FOR UPDATE;
  IF owner_team IS NULL OR owner_team IS DISTINCT FROM resource_team OR resource_state<>'ready' OR NEW.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'DOCUMENT_IMAGE_GRANT_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_image_grants_guard BEFORE INSERT OR UPDATE ON document_image_grants FOR EACH ROW EXECUTE FUNCTION document_image_grant_guard();

CREATE OR REPLACE FUNCTION document_assert_export_item(target integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item document_export_items%ROWTYPE; actual integer[]; expected integer[];
BEGIN
  SELECT * INTO item FROM document_export_items WHERE id=target;
  IF NOT FOUND THEN RETURN; END IF;
  IF item.kind='file' THEN expected:=ARRAY[item.resource_id];
  ELSIF item.kind='document' THEN
    SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO expected FROM document_image_ids(item.snapshot_body) x;
  ELSE expected:='{}'; END IF;
  SELECT coalesce(array_agg(DISTINCT resource_id ORDER BY resource_id),'{}') INTO actual FROM document_resource_refs WHERE export_item_id=target;
  IF actual<>expected THEN RAISE EXCEPTION 'DOCUMENT_EXPORT_RESOURCE_REFERENCE_MISMATCH' USING ERRCODE='23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION document_export_item_final_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE id integer; export integer;
BEGIN
  IF TG_TABLE_NAME='document_resource_refs' THEN
    IF TG_OP<>'INSERT' THEN PERFORM document_assert_export_item(OLD.export_item_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM document_assert_export_item(NEW.export_item_id); END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM document_assert_export_item(OLD.id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM document_assert_export_item(NEW.id); END IF;
    FOR export IN SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP<>'INSERT' THEN OLD.export_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.export_id END
    ]) x WHERE x IS NOT NULL LOOP
      IF (SELECT count(*) FROM document_export_items WHERE export_id=export)>500 OR
        (SELECT coalesce(sum(output_size),0) FROM document_export_items WHERE export_id=export)>524288000 THEN
        RAISE EXCEPTION 'DOCUMENT_EXPORT_LIMIT' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER document_export_items_final_check AFTER INSERT OR UPDATE OR DELETE ON document_export_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION document_export_item_final_check();
CREATE CONSTRAINT TRIGGER document_export_refs_final_check AFTER INSERT OR UPDATE OR DELETE ON document_resource_refs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION document_export_item_final_check();

CREATE OR REPLACE FUNCTION document_export_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM document_spaces WHERE id=NEW.space_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM document_spaces WHERE id=NEW.space_id AND team_id=NEW.team_id) THEN
    RAISE EXCEPTION 'DOCUMENT_EXPORT_SPACE_TEAM_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.snapshot_at<>OLD.snapshot_at OR NEW.expires_at<>OLD.expires_at OR NEW.space_id<>OLD.space_id OR NEW.team_id<>OLD.team_id OR NEW.format<>OLD.format) THEN
    RAISE EXCEPTION 'DOCUMENT_EXPORT_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_exports_guard BEFORE INSERT OR UPDATE ON document_exports FOR EACH ROW EXECUTE FUNCTION document_export_guard();

CREATE OR REPLACE FUNCTION document_export_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_team integer; export_team integer;
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM 1 FROM document_exports WHERE id=OLD.export_id FOR UPDATE;
    RETURN OLD;
  END IF;
  SELECT team_id INTO export_team FROM document_exports WHERE id=NEW.export_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    SELECT s.team_id INTO source_team FROM document_nodes n JOIN document_spaces s ON s.id=n.space_id WHERE n.id=NEW.node_id AND n.kind=NEW.kind AND n.state='active';
    IF source_team IS NULL OR source_team IS DISTINCT FROM export_team THEN
      RAISE EXCEPTION 'DOCUMENT_EXPORT_SOURCE_SCOPE' USING ERRCODE='23514';
    END IF;
  ELSIF ROW(NEW.export_id,NEW.node_id,NEW.relative_path,NEW.kind,NEW.snapshot_name,NEW.snapshot_body,NEW.snapshot_url,NEW.resource_id)
    IS DISTINCT FROM ROW(OLD.export_id,OLD.node_id,OLD.relative_path,OLD.kind,OLD.snapshot_name,OLD.snapshot_body,OLD.snapshot_url,OLD.resource_id) THEN
    RAISE EXCEPTION 'DOCUMENT_EXPORT_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_export_items_guard BEFORE INSERT OR UPDATE OR DELETE ON document_export_items FOR EACH ROW EXECUTE FUNCTION document_export_item_guard();
