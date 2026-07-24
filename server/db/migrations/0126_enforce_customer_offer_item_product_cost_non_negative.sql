-- Migration 0126: reject negative customer offer product costs at the database layer.
--
-- Application create/update already validates productCost as non-negative (mirroring client
-- quotes). Legacy rows written before that guard could still hold product_cost < 0, which
-- would block ADD CONSTRAINT and keep poisoning margin calculations.
--
-- Order matters: clamp first, then add the CHECK. Clamping to 0 matches the column default
-- and the API omitted-cost behavior; the original negative magnitude is meaningless for cost.

UPDATE "customer_offer_items" SET "product_cost" = 0 WHERE "product_cost" < 0;--> statement-breakpoint

-- Idempotent ADD CONSTRAINT pattern — see server/db/README.md "Idempotent guards".
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		WHERE c.contype = 'c'
			AND c.conname = 'chk_customer_offer_items_product_cost_non_negative'
			AND t.relname = 'customer_offer_items'
	) THEN
		ALTER TABLE "customer_offer_items" ADD CONSTRAINT "chk_customer_offer_items_product_cost_non_negative" CHECK ("customer_offer_items"."product_cost" >= 0);
	END IF;
END $$;
