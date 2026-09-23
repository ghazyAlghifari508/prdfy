ALTER TABLE "projects" DROP CONSTRAINT "projects_codebase_id_codebases_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_codebase_id_codebases_id_fk" FOREIGN KEY ("codebase_id") REFERENCES "public"."codebases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_codebase_id_idx" ON "projects" USING btree ("codebase_id");