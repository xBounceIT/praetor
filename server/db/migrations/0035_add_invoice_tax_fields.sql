ALTER TABLE "invoice_items" ADD COLUMN "tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_total" numeric(12, 2) DEFAULT '0' NOT NULL;