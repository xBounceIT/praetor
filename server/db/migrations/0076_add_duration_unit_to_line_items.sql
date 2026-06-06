ALTER TABLE "customer_offer_items" ADD COLUMN "duration_unit" text DEFAULT 'months' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "duration_unit" text DEFAULT 'months' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "duration_unit" text DEFAULT 'months' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "duration_unit" text DEFAULT 'months' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_offer_items" ADD CONSTRAINT "chk_customer_offer_items_duration_unit" CHECK ("customer_offer_items"."duration_unit" IN ('months', 'years'));--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "chk_invoice_items_duration_unit" CHECK ("invoice_items"."duration_unit" IN ('months', 'years'));--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "chk_quote_items_duration_unit" CHECK ("quote_items"."duration_unit" IN ('months', 'years'));--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "chk_sale_items_duration_unit" CHECK ("sale_items"."duration_unit" IN ('months', 'years'));