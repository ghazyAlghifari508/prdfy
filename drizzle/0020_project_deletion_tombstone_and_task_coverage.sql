ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "covers" jsonb;--> statement-breakpoint
CREATE INDEX "projects_user_id_deleted_at_idx" ON "projects" USING btree ("user_id","deleted_at");