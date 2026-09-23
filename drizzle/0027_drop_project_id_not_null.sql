ALTER TABLE "codebase_sync_sessions" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "codebase_snapshots" ALTER COLUMN "project_id" DROP NOT NULL;
