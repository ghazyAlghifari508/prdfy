CREATE TABLE "codebases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "codebase_snapshots" ADD COLUMN "codebase_id" text;--> statement-breakpoint
ALTER TABLE "codebase_sync_sessions" ADD COLUMN "codebase_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "codebase_id" text;--> statement-breakpoint
ALTER TABLE "codebases" ADD CONSTRAINT "codebases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codebases_user_id_idx" ON "codebases" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "codebase_snapshots" ADD CONSTRAINT "codebase_snapshots_codebase_id_codebases_id_fk" FOREIGN KEY ("codebase_id") REFERENCES "public"."codebases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_sync_sessions" ADD CONSTRAINT "codebase_sync_sessions_codebase_id_codebases_id_fk" FOREIGN KEY ("codebase_id") REFERENCES "public"."codebases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_codebase_id_codebases_id_fk" FOREIGN KEY ("codebase_id") REFERENCES "public"."codebases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codebase_snapshots_codebase_id_idx" ON "codebase_snapshots" USING btree ("codebase_id");--> statement-breakpoint
CREATE INDEX "codebase_sync_sessions_codebase_id_idx" ON "codebase_sync_sessions" USING btree ("codebase_id");