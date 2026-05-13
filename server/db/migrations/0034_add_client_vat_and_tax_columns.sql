ALTER TABLE "clients" ADD COLUMN "vat_number" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tax_code" varchar(50);--> statement-breakpoint
-- Type-aware backfill from the legacy combined fiscal_code column so existing rows keep
-- their identifier on the semantically-correct column. The route layer's resolveFiscalCode()
-- collapsed vatNumber/fiscalCode/taxCode into fiscal_code on write, so the stored value could
-- be either a Partita IVA (P.IVA) or a Codice Fiscale. We use the row's `type` to decide:
--   - 'individual' rows: fiscal_code is almost certainly a Codice Fiscale, so backfill tax_code.
--   - Everything else  (company/null/etc): fiscal_code is almost certainly a P.IVA, so backfill vat_number.
-- Admins can still correct mismatches per-row; this just gets the bulk of rows right.
UPDATE "clients" SET "tax_code" = "fiscal_code"
  WHERE "tax_code" IS NULL AND "fiscal_code" IS NOT NULL AND "type" = 'individual';--> statement-breakpoint
UPDATE "clients" SET "vat_number" = "fiscal_code"
  WHERE "vat_number" IS NULL AND "fiscal_code" IS NOT NULL AND ("type" IS NULL OR "type" <> 'individual');--> statement-breakpoint
-- Partial unique indexes (mirrors idx_clients_fiscal_code_unique) so vat_number and tax_code
-- are race-safe on their own — not just via the fiscal_code shadow. Without these, a code
-- path that writes vat_number/tax_code without keeping fiscal_code in sync could create
-- duplicate Partita IVA / Codice Fiscale silently. Backfill above keeps these values 1-to-1
-- with the already-unique fiscal_code on each type-slice, so the indexes won't fail on data.
CREATE UNIQUE INDEX "idx_clients_vat_number_unique" ON "clients" USING btree (LOWER("vat_number")) WHERE "clients"."vat_number" IS NOT NULL AND "clients"."vat_number" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_clients_tax_code_unique" ON "clients" USING btree (LOWER("tax_code")) WHERE "clients"."tax_code" IS NOT NULL AND "clients"."tax_code" <> '';
