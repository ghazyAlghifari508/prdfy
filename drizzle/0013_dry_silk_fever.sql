CREATE TABLE "credit_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"operation_id" text,
	"amount" integer NOT NULL,
	"entry_type" text NOT NULL,
	"source_category" text NOT NULL,
	"pricing_version" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_entries_amount_nonzero_check" CHECK (amount <> 0)
);
--> statement-breakpoint
CREATE TABLE "credit_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"stage" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text DEFAULT 'quoted' NOT NULL,
	"estimated_credits" integer NOT NULL,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"maximum_credits" integer NOT NULL,
	"final_charge" integer,
	"pricing_version" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"artifact_reference" text,
	"analysis_reference" text,
	"failure" jsonb,
	"reconciliation" jsonb,
	"expires_at" timestamp,
	"reserved_at" timestamp,
	"started_at" timestamp,
	"settled_at" timestamp,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_operations_credit_bounds_check" CHECK (estimated_credits >= 0 AND reserved_credits >= 0 AND maximum_credits >= 0 AND (final_charge IS NULL OR final_charge >= 0))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "credits_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_operation_id_credit_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."credit_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_entries_user_id_created_at_idx" ON "credit_ledger_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_entries_user_id_operation_id_idx" ON "credit_ledger_entries" USING btree ("user_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_operations_user_id_idempotency_key_unique" ON "credit_operations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_operations_user_id_created_at_idx" ON "credit_operations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_operations_user_project_id_stage_idx" ON "credit_operations" USING btree ("user_id","project_id","stage");--> statement-breakpoint
CREATE INDEX "credit_operations_state_expires_at_idx" ON "credit_operations" USING btree ("state","expires_at");