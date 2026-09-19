CREATE TABLE "codebase_snapshot_files" (
	"snapshot_id" text NOT NULL,
	"path" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_total" integer NOT NULL,
	"content_hash" text NOT NULL,
	"encoding" text DEFAULT 'base64' NOT NULL,
	"data" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "codebase_snapshot_files_pkey" PRIMARY KEY("snapshot_id","path","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "codebase_sync_idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"kind" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "codebase_snapshot_files" ADD CONSTRAINT "codebase_snapshot_files_snapshot_id_codebase_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."codebase_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_sync_idempotency_keys" ADD CONSTRAINT "codebase_sync_idempotency_keys_session_id_codebase_sync_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."codebase_sync_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_sync_idempotency_keys" ADD CONSTRAINT "codebase_sync_idempotency_keys_snapshot_id_codebase_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."codebase_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codebase_snapshot_files_snapshot_id_idx" ON "codebase_snapshot_files" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "codebase_sync_idempotency_keys_session_id_idx" ON "codebase_sync_idempotency_keys" USING btree ("session_id");