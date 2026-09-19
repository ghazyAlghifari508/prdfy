CREATE TABLE "codebase_ask_handoffs" (
	"project_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"snapshot_id" text,
	"answers" jsonb,
	"compiled_prompt" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "codebase_ask_handoffs" ADD CONSTRAINT "codebase_ask_handoffs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_ask_handoffs" ADD CONSTRAINT "codebase_ask_handoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;