-- Historical operations have no persisted subscription relationship. Keep them
-- unbound and make reconciliation explicitly require manual resolution instead
-- of guessing an origin from the user's subscription history.
ALTER TABLE "credit_operations" ADD COLUMN "subscription_id" text;--> statement-breakpoint
UPDATE "credit_operations"
SET "reconciliation" = jsonb_build_object(
	'status', 'pending',
	'code', 'historical_subscription_unresolved'
)
WHERE "subscription_id" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD COLUMN "cap_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_user_subscription_fk" FOREIGN KEY ("user_id","subscription_id") REFERENCES "public"."subscriptions"("user_id","id") ON DELETE no action ON UPDATE no action;
