ALTER TABLE "supplier_invoice_items" ADD COLUMN "duration_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice_items" ADD COLUMN "duration_unit" text DEFAULT 'months' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ADD COLUMN "duration_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ADD COLUMN "duration_unit" text DEFAULT 'months' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_sale_items" ADD COLUMN "duration_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_sale_items" ADD COLUMN "duration_unit" text DEFAULT 'months' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "chk_supplier_invoice_items_duration_months" CHECK ("supplier_invoice_items"."duration_months" >= 1);--> statement-breakpoint
ALTER TABLE "supplier_invoice_items" ADD CONSTRAINT "chk_supplier_invoice_items_duration_unit" CHECK ("supplier_invoice_items"."duration_unit" IN ('months', 'years', 'na'));--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "chk_supplier_quote_items_duration_months" CHECK ("supplier_quote_items"."duration_months" >= 1);--> statement-breakpoint
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "chk_supplier_quote_items_duration_unit" CHECK ("supplier_quote_items"."duration_unit" IN ('months', 'years', 'na'));--> statement-breakpoint
ALTER TABLE "supplier_sale_items" ADD CONSTRAINT "chk_supplier_sale_items_duration_months" CHECK ("supplier_sale_items"."duration_months" >= 1);--> statement-breakpoint
ALTER TABLE "supplier_sale_items" ADD CONSTRAINT "chk_supplier_sale_items_duration_unit" CHECK ("supplier_sale_items"."duration_unit" IN ('months', 'years', 'na'));