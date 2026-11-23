-- Generated from db/schema.ts; regenerate offline with node db/generate-document-ddl.mjs.
CREATE TABLE "document_spaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"state" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_spaces_project_uq" UNIQUE("project_id"),
	CONSTRAINT "document_spaces_state_ck" CHECK ("document_spaces"."state" IN ('active','archived','deleting')),
	CONSTRAINT "document_spaces_version_ck" CHECK ("document_spaces"."version" > 0)
);

--> statement-breakpoint
CREATE TABLE "document_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL,
	"parent_id" integer,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"system_role" text,
	"state" text DEFAULT 'active' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"trash_batch_id" integer,
	"deleted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_nodes_id_space_uq" UNIQUE("id","space_id"),
	CONSTRAINT "document_nodes_kind_ck" CHECK ("document_nodes"."kind" IN ('folder','document','file','link')),
	CONSTRAINT "document_nodes_state_ck" CHECK ("document_nodes"."state" IN ('active','trashed','purging')),
	CONSTRAINT "document_nodes_root_ck" CHECK ("document_nodes"."parent_id" IS NOT NULL OR "document_nodes"."kind" = 'folder'),
	CONSTRAINT "document_nodes_name_ck" CHECK (char_length("document_nodes"."name") BETWEEN 1 AND 200 AND "document_nodes"."name" = btrim("document_nodes"."name") AND "document_nodes"."name" !~ '[[:cntrl:]/]' AND position(chr(92) in "document_nodes"."name") = 0 AND "document_nodes"."name" NOT IN ('.','..')),
	CONSTRAINT "document_nodes_normalized_ck" CHECK ("document_nodes"."normalized_name" = translate("document_nodes"."name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')),
	CONSTRAINT "document_nodes_recovery_ck" CHECK ("document_nodes"."system_role" IS NULL OR ("document_nodes"."system_role" = 'recovery' AND "document_nodes"."kind" = 'folder' AND "document_nodes"."parent_id" IS NULL)),
	CONSTRAINT "document_nodes_trash_ck" CHECK (("document_nodes"."state" = 'active' AND "document_nodes"."trash_batch_id" IS NULL AND "document_nodes"."deleted_at" IS NULL AND "document_nodes"."expires_at" IS NULL) OR ("document_nodes"."state" IN ('trashed','purging') AND "document_nodes"."trash_batch_id" IS NOT NULL AND "document_nodes"."deleted_at" IS NOT NULL AND "document_nodes"."expires_at" IS NOT NULL AND "document_nodes"."expires_at" > "document_nodes"."deleted_at")),
	CONSTRAINT "document_nodes_version_ck" CHECK ("document_nodes"."version" > 0)
);

--> statement-breakpoint
CREATE TABLE "document_bodies" (
	"node_id" integer PRIMARY KEY NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"content_json" jsonb NOT NULL,
	"body_revision" bigint DEFAULT 1 NOT NULL,
	"content_hash" text NOT NULL,
	"last_checkpoint_at" timestamp with time zone,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_bodies_content_ck" CHECK (jsonb_typeof("document_bodies"."content_json") = 'object' AND ("document_bodies"."content_json"->>'type') IS NOT DISTINCT FROM 'doc' AND octet_length("document_bodies"."content_json"::text) <= 5242880),
	CONSTRAINT "document_bodies_hash_ck" CHECK ("document_bodies"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_bodies_revision_ck" CHECK ("document_bodies"."body_revision" > 0 AND "document_bodies"."format_version" > 0)
);

--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" integer NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"source_revision" bigint NOT NULL,
	"body_author_id" integer,
	"body_author_name" text NOT NULL,
	"created_by" integer,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_content_ck" CHECK (jsonb_typeof("document_versions"."content_json") = 'object' AND ("document_versions"."content_json"->>'type') IS NOT DISTINCT FROM 'doc' AND octet_length("document_versions"."content_json"::text) <= 5242880),
	CONSTRAINT "document_versions_hash_ck" CHECK ("document_versions"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_versions_revision_ck" CHECK ("document_versions"."source_revision" > 0 AND "document_versions"."format_version" > 0),
	CONSTRAINT "document_versions_reason_ck" CHECK ("document_versions"."reason" IN ('edit_start','periodic','manual','before_restore','before_draft_restore'))
);

--> statement-breakpoint
CREATE TABLE "document_edit_locks" (
	"node_id" integer PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_token_hash" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_edit_locks_token_ck" CHECK ("document_edit_locks"."session_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_edit_locks_time_ck" CHECK ("document_edit_locks"."expires_at" > "document_edit_locks"."acquired_at")
);

--> statement-breakpoint
CREATE TABLE "document_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"stored_name" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text,
	"size" bigint NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staged_for_node_id" integer,
	"orphan_not_before" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	CONSTRAINT "document_resources_stored_name_uq" UNIQUE("stored_name"),
	CONSTRAINT "document_resources_state_ck" CHECK ("document_resources"."state" IN ('staged','ready','deleting')),
	CONSTRAINT "document_resources_size_ck" CHECK ("document_resources"."size" >= 0),
	CONSTRAINT "document_resources_path_ck" CHECK (char_length("document_resources"."stored_name") BETWEEN 1 AND 255 AND "document_resources"."stored_name" NOT IN ('.','..') AND "document_resources"."stored_name" !~ '[[:cntrl:]/:]' AND position(chr(92) in "document_resources"."stored_name") = 0)
);

--> statement-breakpoint
CREATE TABLE "document_file_entries" (
	"node_id" integer PRIMARY KEY NOT NULL,
	"resource_id" integer NOT NULL
);

--> statement-breakpoint
CREATE TABLE "document_link_entries" (
	"node_id" integer PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "document_link_entries_url_ck" CHECK ("document_link_entries"."url" ~* '^https?://[^[:space:]]+$')
);

--> statement-breakpoint
CREATE TABLE "document_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"space_id" integer NOT NULL,
	"requested_by" integer,
	"state" text DEFAULT 'queued' NOT NULL,
	"format" text NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"request_id" text NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"artifact_name" text,
	"failure_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_exports_request_uq" UNIQUE("requested_by","request_id"),
	CONSTRAINT "document_exports_state_ck" CHECK ("document_exports"."state" IN ('queued','running','partial','completed','failed','cancelled','expired')),
	CONSTRAINT "document_exports_format_ck" CHECK ("document_exports"."format" IN ('pdf','markdown')),
	CONSTRAINT "document_exports_time_ck" CHECK ("document_exports"."expires_at" > "document_exports"."snapshot_at" AND "document_exports"."attempts" >= 0)
);

--> statement-breakpoint
CREATE TABLE "document_export_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"export_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"relative_path" text NOT NULL,
	"kind" text NOT NULL,
	"snapshot_name" text NOT NULL,
	"snapshot_body" jsonb,
	"snapshot_url" text,
	"resource_id" integer,
	"state" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"output_size" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "document_export_items_path_uq" UNIQUE("export_id","relative_path"),
	CONSTRAINT "document_export_items_kind_ck" CHECK ("document_export_items"."kind" IN ('document','file','link')),
	CONSTRAINT "document_export_items_state_ck" CHECK ("document_export_items"."state" IN ('pending','running','completed','failed')),
	CONSTRAINT "document_export_items_size_ck" CHECK ("document_export_items"."output_size" >= 0),
	CONSTRAINT "document_export_items_content_ck" CHECK (("document_export_items"."kind" = 'document' AND "document_export_items"."snapshot_body" IS NOT NULL AND "document_export_items"."snapshot_url" IS NULL AND "document_export_items"."resource_id" IS NULL) OR ("document_export_items"."kind" = 'file' AND "document_export_items"."resource_id" IS NOT NULL AND "document_export_items"."snapshot_body" IS NULL AND "document_export_items"."snapshot_url" IS NULL) OR ("document_export_items"."kind" = 'link' AND "document_export_items"."snapshot_url" IS NOT NULL AND "document_export_items"."snapshot_body" IS NULL AND "document_export_items"."resource_id" IS NULL)),
	CONSTRAINT "document_export_items_path_ck" CHECK ("document_export_items"."relative_path" <> '' AND "document_export_items"."relative_path" !~ '(^/|(^|/)[.][.](/|$)|[[:cntrl:]:])' AND position(chr(92) in "document_export_items"."relative_path") = 0)
);

--> statement-breakpoint
CREATE TABLE "document_resource_refs" (
	"id" serial PRIMARY KEY NOT NULL,
	"resource_id" integer NOT NULL,
	"node_id" integer,
	"version_id" integer,
	"export_item_id" integer,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_resource_refs_owner_ck" CHECK (num_nonnulls("document_resource_refs"."node_id", "document_resource_refs"."version_id", "document_resource_refs"."export_item_id") = 1),
	CONSTRAINT "document_resource_refs_role_ck" CHECK (("document_resource_refs"."node_id" IS NOT NULL AND "document_resource_refs"."role" IN ('file','body_image')) OR ("document_resource_refs"."version_id" IS NOT NULL AND "document_resource_refs"."role" = 'version_image') OR ("document_resource_refs"."export_item_id" IS NOT NULL AND "document_resource_refs"."role" = 'export'))
);

--> statement-breakpoint
CREATE TABLE "document_image_grants" (
	"node_id" integer NOT NULL,
	"resource_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"lock_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	CONSTRAINT "document_image_grants_node_id_resource_id_user_id_lock_token_hash_pk" PRIMARY KEY("node_id","resource_id","user_id","lock_token_hash"),
	CONSTRAINT "document_image_grants_token_ck" CHECK ("document_image_grants"."lock_token_hash" ~ '^[0-9a-f]{64}$')
);

--> statement-breakpoint
CREATE TABLE "document_associations" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" integer NOT NULL,
	"task_id" integer,
	"milestone_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_associations_target_ck" CHECK (num_nonnulls("document_associations"."task_id", "document_associations"."milestone_id") = 1)
);

--> statement-breakpoint
CREATE TABLE "document_legacy_files" (
	"legacy_attachment_id" integer PRIMARY KEY NOT NULL,
	"node_id" integer NOT NULL,
	"legacy_created_at" timestamp,
	CONSTRAINT "document_legacy_files_node_uq" UNIQUE("node_id")
);

--> statement-breakpoint
CREATE TABLE "document_legacy_links" (
	"legacy_resource_id" integer PRIMARY KEY NOT NULL,
	"node_id" integer NOT NULL,
	CONSTRAINT "document_legacy_links_node_uq" UNIQUE("node_id")
);

--> statement-breakpoint
CREATE TABLE "document_trash_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL,
	"root_node_id" integer,
	"deleted_by" integer,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	CONSTRAINT "document_trash_batches_time_ck" CHECK ("document_trash_batches"."expires_at" > "document_trash_batches"."deleted_at")
);

--> statement-breakpoint
CREATE TABLE "document_trash_items" (
	"node_id" integer PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"original_parent_id" integer,
	"original_path" jsonb NOT NULL,
	"original_space_id" integer NOT NULL,
	"original_name" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"operation" text NOT NULL,
	"request_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	CONSTRAINT "document_requests_key_uq" UNIQUE("user_id","operation","request_id"),
	CONSTRAINT "document_requests_state_ck" CHECK ("document_requests"."state" IN ('pending','completed','failed')),
	CONSTRAINT "document_requests_hash_ck" CHECK ("document_requests"."payload_hash" ~ '^[0-9a-f]{64}$')
);

--> statement-breakpoint
CREATE TABLE "document_cleanup_jobs" (
	"resource_id" integer PRIMARY KEY NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"lease_until" timestamp with time zone,
	CONSTRAINT "document_cleanup_jobs_attempts_ck" CHECK ("document_cleanup_jobs"."attempts" >= 0)
);

--> statement-breakpoint
CREATE TABLE "document_migration_roots" (
	"space_id" integer NOT NULL,
	"role" text NOT NULL,
	"node_id" integer,
	CONSTRAINT "document_migration_roots_space_id_role_pk" PRIMARY KEY("space_id","role")
);

--> statement-breakpoint
CREATE TABLE "document_migrations" (
	"key" text PRIMARY KEY NOT NULL,
	"checksum" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "document_spaces" ADD CONSTRAINT "document_spaces_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_spaces" ADD CONSTRAINT "document_spaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_nodes" ADD CONSTRAINT "document_nodes_space_id_document_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."document_spaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_nodes" ADD CONSTRAINT "document_nodes_trash_batch_id_document_trash_batches_id_fk" FOREIGN KEY ("trash_batch_id") REFERENCES "public"."document_trash_batches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_nodes" ADD CONSTRAINT "document_nodes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_nodes" ADD CONSTRAINT "document_nodes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_nodes" ADD CONSTRAINT "document_nodes_parent_fk" FOREIGN KEY ("parent_id","space_id") REFERENCES "public"."document_nodes"("id","space_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_bodies" ADD CONSTRAINT "document_bodies_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_bodies" ADD CONSTRAINT "document_bodies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_body_author_id_users_id_fk" FOREIGN KEY ("body_author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_edit_locks" ADD CONSTRAINT "document_edit_locks_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_edit_locks" ADD CONSTRAINT "document_edit_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_resources" ADD CONSTRAINT "document_resources_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_resources" ADD CONSTRAINT "document_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_resources" ADD CONSTRAINT "document_resources_staged_for_node_id_document_nodes_id_fk" FOREIGN KEY ("staged_for_node_id") REFERENCES "public"."document_nodes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_file_entries" ADD CONSTRAINT "document_file_entries_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_file_entries" ADD CONSTRAINT "document_file_entries_resource_id_document_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."document_resources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_link_entries" ADD CONSTRAINT "document_link_entries_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_space_id_document_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."document_spaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_export_items" ADD CONSTRAINT "document_export_items_export_id_document_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."document_exports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_export_items" ADD CONSTRAINT "document_export_items_resource_id_document_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."document_resources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_resource_refs" ADD CONSTRAINT "document_resource_refs_resource_id_document_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."document_resources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_resource_refs" ADD CONSTRAINT "document_resource_refs_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_resource_refs" ADD CONSTRAINT "document_resource_refs_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_resource_refs" ADD CONSTRAINT "document_resource_refs_export_item_id_document_export_items_id_fk" FOREIGN KEY ("export_item_id") REFERENCES "public"."document_export_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_image_grants" ADD CONSTRAINT "document_image_grants_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_image_grants" ADD CONSTRAINT "document_image_grants_resource_id_document_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."document_resources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_image_grants" ADD CONSTRAINT "document_image_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_associations" ADD CONSTRAINT "document_associations_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_associations" ADD CONSTRAINT "document_associations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_associations" ADD CONSTRAINT "document_associations_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_associations" ADD CONSTRAINT "document_associations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_legacy_files" ADD CONSTRAINT "document_legacy_files_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_legacy_links" ADD CONSTRAINT "document_legacy_links_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_trash_batches" ADD CONSTRAINT "document_trash_batches_space_id_document_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."document_spaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_trash_batches" ADD CONSTRAINT "document_trash_batches_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_trash_items" ADD CONSTRAINT "document_trash_items_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_trash_items" ADD CONSTRAINT "document_trash_items_batch_id_document_trash_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."document_trash_batches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_cleanup_jobs" ADD CONSTRAINT "document_cleanup_jobs_resource_id_document_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."document_resources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_migration_roots" ADD CONSTRAINT "document_migration_roots_space_id_document_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."document_spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_migration_roots" ADD CONSTRAINT "document_migration_roots_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "document_spaces_public_uq" ON "document_spaces" USING btree ("team_id") WHERE "document_spaces"."project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "document_nodes_root_name_uq" ON "document_nodes" USING btree ("space_id","normalized_name") WHERE "document_nodes"."parent_id" IS NULL AND "document_nodes"."state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "document_nodes_child_name_uq" ON "document_nodes" USING btree ("space_id","parent_id","normalized_name") WHERE "document_nodes"."parent_id" IS NOT NULL AND "document_nodes"."state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "document_nodes_recovery_uq" ON "document_nodes" USING btree ("space_id") WHERE "document_nodes"."system_role" = 'recovery' AND "document_nodes"."state" = 'active';
--> statement-breakpoint
CREATE INDEX "document_nodes_parent_idx" ON "document_nodes" USING btree ("space_id","parent_id");
--> statement-breakpoint
CREATE INDEX "document_nodes_expiry_idx" ON "document_nodes" USING btree ("expires_at") WHERE "document_nodes"."state" = 'trashed';
--> statement-breakpoint
CREATE INDEX "document_versions_node_idx" ON "document_versions" USING btree ("node_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "document_edit_locks_expiry_idx" ON "document_edit_locks" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "document_resources_orphan_idx" ON "document_resources" USING btree ("orphan_not_before");
--> statement-breakpoint
CREATE INDEX "document_exports_work_idx" ON "document_exports" USING btree ("state","lease_until");
--> statement-breakpoint
CREATE INDEX "document_resource_refs_resource_idx" ON "document_resource_refs" USING btree ("resource_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "document_resource_refs_node_uq" ON "document_resource_refs" USING btree ("node_id","resource_id","role") WHERE "document_resource_refs"."node_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "document_resource_refs_version_uq" ON "document_resource_refs" USING btree ("version_id","resource_id") WHERE "document_resource_refs"."version_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "document_resource_refs_export_uq" ON "document_resource_refs" USING btree ("export_item_id","resource_id") WHERE "document_resource_refs"."export_item_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "document_image_grants_resource_idx" ON "document_image_grants" USING btree ("resource_id","expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "document_associations_task_uq" ON "document_associations" USING btree ("node_id","task_id") WHERE "document_associations"."task_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "document_associations_milestone_uq" ON "document_associations" USING btree ("node_id","milestone_id") WHERE "document_associations"."milestone_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "document_trash_items_batch_idx" ON "document_trash_items" USING btree ("batch_id");
