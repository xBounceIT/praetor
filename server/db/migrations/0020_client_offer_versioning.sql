ALTER TABLE "customer_offers" ADD COLUMN IF NOT EXISTS "offer_code" varchar(100);--> statement-breakpoint
ALTER TABLE "customer_offers" ADD COLUMN IF NOT EXISTS "version_group_id" varchar(100);--> statement-breakpoint
ALTER TABLE "customer_offers" ADD COLUMN IF NOT EXISTS "version_parent_id" varchar(100);--> statement-breakpoint
ALTER TABLE "customer_offers" ADD COLUMN IF NOT EXISTS "version_number" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "customer_offers" ADD COLUMN IF NOT EXISTS "is_latest" boolean NOT NULL DEFAULT true;--> statement-breakpoint

UPDATE "customer_offers"
SET "offer_code" = "id"
WHERE "offer_code" IS NULL;--> statement-breakpoint

UPDATE "customer_offers"
SET "version_group_id" = "id"
WHERE "version_group_id" IS NULL;--> statement-breakpoint

ALTER TABLE "customer_offers" ALTER COLUMN "offer_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_offers" ALTER COLUMN "version_group_id" SET NOT NULL;--> statement-breakpoint

DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'customer_offers_version_parent_id_customer_offers_id_fk'
	) THEN
		ALTER TABLE "customer_offers" ADD CONSTRAINT "customer_offers_version_parent_id_customer_offers_id_fk"
			FOREIGN KEY ("version_parent_id") REFERENCES "public"."customer_offers"("id")
			ON DELETE SET NULL ON UPDATE CASCADE;
	END IF;
END $$;--> statement-breakpoint

ALTER TABLE "customer_offers" DROP CONSTRAINT IF EXISTS "chk_customer_offers_version_number_positive";--> statement-breakpoint
ALTER TABLE "customer_offers" ADD CONSTRAINT "chk_customer_offers_version_number_positive"
	CHECK ("customer_offers"."version_number" > 0);--> statement-breakpoint

DROP INDEX IF EXISTS "idx_customer_offers_linked_quote_id";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_offers_linked_quote_id"
	ON "customer_offers" USING btree ("linked_quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_offers_version_group_id"
	ON "customer_offers" USING btree ("version_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_customer_offers_offer_code_version"
	ON "customer_offers" USING btree ("offer_code","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_customer_offers_latest_version_group"
	ON "customer_offers" USING btree ("version_group_id")
	WHERE "is_latest" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_customer_offers_linked_quote_latest"
	ON "customer_offers" USING btree ("linked_quote_id")
	WHERE "is_latest" = true;
