CREATE TABLE "codebase_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"output" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "codebase_generation_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"analysis_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "codebase_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sync_session_id" text NOT NULL,
	"branch" text,
	"commit_sha" text,
	"manifest" jsonb,
	"file_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"content_size" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "codebase_sync_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_hash" text NOT NULL,
	"status" text DEFAULT 'waiting_for_cli' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"cli_min_version" text DEFAULT '2.0.0' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_mode" text DEFAULT 'greenfield' NOT NULL;--> statement-breakpoint
ALTER TABLE "codebase_analyses" ADD CONSTRAINT "codebase_analyses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_analyses" ADD CONSTRAINT "codebase_analyses_snapshot_id_codebase_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."codebase_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_generation_contexts" ADD CONSTRAINT "codebase_generation_contexts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_generation_contexts" ADD CONSTRAINT "codebase_generation_contexts_snapshot_id_codebase_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."codebase_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_generation_contexts" ADD CONSTRAINT "codebase_generation_contexts_analysis_id_codebase_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."codebase_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_snapshots" ADD CONSTRAINT "codebase_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_snapshots" ADD CONSTRAINT "codebase_snapshots_sync_session_id_codebase_sync_sessions_id_fk" FOREIGN KEY ("sync_session_id") REFERENCES "public"."codebase_sync_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_sync_sessions" ADD CONSTRAINT "codebase_sync_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_sync_sessions" ADD CONSTRAINT "codebase_sync_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codebase_analyses_project_id_idx" ON "codebase_analyses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "codebase_analyses_snapshot_id_idx" ON "codebase_analyses" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "codebase_generation_contexts_project_id_idx" ON "codebase_generation_contexts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "codebase_generation_contexts_snapshot_id_idx" ON "codebase_generation_contexts" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "codebase_generation_contexts_analysis_id_idx" ON "codebase_generation_contexts" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "codebase_snapshots_project_id_idx" ON "codebase_snapshots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "codebase_snapshots_sync_session_id_idx" ON "codebase_snapshots" USING btree ("sync_session_id");--> statement-breakpoint
CREATE INDEX "codebase_sync_sessions_project_id_idx" ON "codebase_sync_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "codebase_sync_sessions_user_id_idx" ON "codebase_sync_sessions" USING btree ("user_id");