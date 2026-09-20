ALTER TABLE "credit_operations" ADD COLUMN "subscription_id" text;--> statement-breakpoint
UPDATE "credit_operations" AS operation
SET "subscription_id" = subscription.id
FROM LATERAL (
	SELECT id
	FROM "subscriptions"
	WHERE "subscriptions"."user_id" = operation."user_id"
	ORDER BY "subscriptions"."created_at" DESC NULLS LAST
	LIMIT 1
) AS subscription
WHERE operation."subscription_id" IS NULL;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "credit_operations" WHERE "subscription_id" IS NULL) THEN
		RAISE EXCEPTION 'Cannot bind existing credit operations to subscriptions';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "credit_operations" ALTER COLUMN "subscription_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD COLUMN "cap_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_user_subscription_fk" FOREIGN KEY ("user_id","subscription_id") REFERENCES "public"."subscriptions"("user_id","id") ON DELETE no action ON UPDATE no action;
