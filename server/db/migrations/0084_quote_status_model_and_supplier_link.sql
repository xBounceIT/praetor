ALTER TABLE "quotes" DROP CONSTRAINT "quotes_status_check";--> statement-breakpoint
ALTER TABLE "supplier_quotes" DROP CONSTRAINT "supplier_quotes_status_check";--> statement-breakpoint
UPDATE "quotes" SET "status" = 'draft' WHERE "status" = 'quoted';--> statement-breakpoint
UPDATE "quotes" SET "status" = 'accepted' WHERE "status" = 'confirmed';--> statement-breakpoint
UPDATE "supplier_quotes" SET "status" = 'sent' WHERE "status" = 'received';--> statement-breakpoint
UPDATE "supplier_quotes" SET "status" = 'accepted' WHERE "status" = 'approved';--> statement-breakpoint
UPDATE "supplier_quotes" SET "status" = 'denied' WHERE "status" = 'rejected';--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "linked_supplier_quote_id" varchar(100);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_linked_supplier_quote_id_supplier_quotes_id_fk" FOREIGN KEY ("linked_supplier_quote_id") REFERENCES "public"."supplier_quotes"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_quotes_linked_supplier_quote_id_unique" ON "quotes" USING btree ("linked_supplier_quote_id") WHERE "quotes"."linked_supplier_quote_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" IN ('draft', 'sent', 'offer', 'accepted', 'denied'));--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_status_check" CHECK ("supplier_quotes"."status" IN ('draft', 'sent', 'offer', 'accepted', 'denied'));