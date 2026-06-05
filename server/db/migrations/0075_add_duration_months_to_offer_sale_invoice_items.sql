ALTER TABLE "customer_offer_items" ADD COLUMN "duration_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "duration_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "duration_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_offer_items" ADD CONSTRAINT "chk_customer_offer_items_duration_months" CHECK ("customer_offer_items"."duration_months" >= 1);--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "chk_invoice_items_duration_months" CHECK ("invoice_items"."duration_months" >= 1);--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "chk_sale_items_duration_months" CHECK ("sale_items"."duration_months" >= 1);