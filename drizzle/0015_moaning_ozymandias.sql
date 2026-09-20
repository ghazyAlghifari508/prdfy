ALTER TABLE "credit_operations" DROP CONSTRAINT "credit_operations_credit_bounds_check";--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_user_operation_fk" FOREIGN KEY ("user_id","operation_id") REFERENCES "public"."credit_operations"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_user_project_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "public"."projects"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_operations_user_id_id_unique" ON "credit_operations" USING btree ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_user_id_id_unique" ON "projects" USING btree ("user_id","id");--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_credit_bounds_check" CHECK (estimated_credits >= 0 AND reserved_credits >= 0 AND maximum_credits >= 0 AND estimated_credits <= maximum_credits AND reserved_credits <= maximum_credits AND (final_charge IS NULL OR (final_charge >= 0 AND final_charge <= maximum_credits)));
--> statement-breakpoint
CREATE FUNCTION prevent_credit_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'credit ledger entries are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON "credit_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_credit_ledger_mutation();
