CREATE TABLE "offer_revisions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"revision_number" integer NOT NULL,
	"revision_code" varchar(50) NOT NULL,
	"created_by_user_id" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"offer_id" varchar(100) NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "chk_offer_revisions_number" CHECK ("offer_revisions"."revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_revisions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"revision_number" integer NOT NULL,
	"revision_code" varchar(50) NOT NULL,
	"created_by_user_id" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"quote_id" varchar(100) NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "chk_quote_revisions_number" CHECK ("quote_revisions"."revision_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "revision_code_template" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"prefix" varchar(20) DEFAULT 'REV' NOT NULL,
	"template" varchar(100) DEFAULT '{PREFIX}{SEQ}' NOT NULL,
	"sequence_padding" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_revision_code_template_singleton" CHECK ("revision_code_template"."id" = 'default'),
	CONSTRAINT "chk_revision_code_template_padding" CHECK ("revision_code_template"."sequence_padding" BETWEEN 1 AND 12),
	CONSTRAINT "chk_revision_code_template_sequence" CHECK ("revision_code_template"."template" LIKE '%{SEQ}%')
);
--> statement-breakpoint
CREATE TABLE "supplier_quote_revisions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"revision_number" integer NOT NULL,
	"revision_code" varchar(50) NOT NULL,
	"created_by_user_id" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"quote_id" varchar(100) NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "chk_supplier_quote_revisions_number" CHECK ("supplier_quote_revisions"."revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_offers" ADD COLUMN "revision_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_offers" ADD COLUMN "revision_code" varchar(50);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "revision_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "revision_code" varchar(50);--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD COLUMN "revision_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD COLUMN "revision_code" varchar(50);--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_offer_id_customer_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."customer_offers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_revisions" ADD CONSTRAINT "quote_revisions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "supplier_quote_revisions" ADD CONSTRAINT "supplier_quote_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_revisions" ADD CONSTRAINT "supplier_quote_revisions_quote_id_supplier_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."supplier_quotes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_offer_revisions_number" ON "offer_revisions" USING btree ("offer_id","revision_number");--> statement-breakpoint
CREATE INDEX "idx_offer_revisions_offer_created" ON "offer_revisions" USING btree ("offer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quote_revisions_number" ON "quote_revisions" USING btree ("quote_id","revision_number");--> statement-breakpoint
CREATE INDEX "idx_quote_revisions_quote_created" ON "quote_revisions" USING btree ("quote_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_quote_revisions_number" ON "supplier_quote_revisions" USING btree ("quote_id","revision_number");--> statement-breakpoint
CREATE INDEX "idx_supplier_quote_revisions_quote_created" ON "supplier_quote_revisions" USING btree ("quote_id","created_at" DESC NULLS LAST);--> statement-breakpoint
INSERT INTO "revision_code_template" ("id", "prefix", "template", "sequence_padding")
VALUES ('default', 'REV', '{PREFIX}{SEQ}', 1)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "quote_revisions" (
  "id", "revision_number", "revision_code", "created_by_user_id", "created_at", "quote_id", "snapshot"
)
SELECT
  'qr_backfill_' || md5(q.id),
  1,
  'REV1',
  NULL,
  COALESCE(q.updated_at, q.created_at, CURRENT_TIMESTAMP),
  q.id,
  jsonb_build_object(
    'schemaVersion', 2,
    'quote', jsonb_build_object(
      'id', q.id,
      'linkedOfferId', (SELECT co.id FROM customer_offers co WHERE co.linked_quote_id = q.id LIMIT 1),
      'clientId', q.client_id,
      'clientName', q.client_name,
      'paymentTerms', q.payment_terms,
      'discount', q.discount,
      'discountType', q.discount_type,
      'status', q.status,
      'expirationDate', q.expiration_date,
      'communicationChannelId', q.communication_channel_id,
      'communicationChannelName', COALESCE((SELECT c.name FROM quote_communication_channels c WHERE c.id = q.communication_channel_id), ''),
      'notes', q.notes,
      'createdAt', (EXTRACT(EPOCH FROM COALESCE(q.created_at, CURRENT_TIMESTAMP)) * 1000)::bigint,
      'updatedAt', (EXTRACT(EPOCH FROM COALESCE(q.updated_at, q.created_at, CURRENT_TIMESTAMP)) * 1000)::bigint,
      'linkedSupplierQuoteId', q.linked_supplier_quote_id,
      'linkedSupplierQuoteExpiration', NULL
    ),
    'candidates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qc.id,
        'quoteId', qc.quote_id,
        'name', qc.name,
        'position', qc.position,
        'state', qc.state,
        'paymentTerms', qc.payment_terms,
        'discount', qc.discount,
        'discountType', qc.discount_type,
        'expirationDate', qc.expiration_date,
        'communicationChannelId', qc.communication_channel_id,
        'communicationChannelName', COALESCE((SELECT c.name FROM quote_communication_channels c WHERE c.id = qc.communication_channel_id), ''),
        'notes', qc.notes,
        'createdAt', (EXTRACT(EPOCH FROM COALESCE(qc.created_at, CURRENT_TIMESTAMP)) * 1000)::bigint,
        'updatedAt', (EXTRACT(EPOCH FROM COALESCE(qc.updated_at, qc.created_at, CURRENT_TIMESTAMP)) * 1000)::bigint
      ) ORDER BY qc.position, qc.id)
      FROM quote_candidates qc WHERE qc.quote_id = q.id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qi.id,
        'quoteId', qi.quote_id,
        'candidateId', COALESCE(qi.candidate_id, (
          SELECT qc_default.id
          FROM quote_candidates qc_default
          WHERE qc_default.quote_id = qi.quote_id
          ORDER BY qc_default.position, qc_default.id
          LIMIT 1
        )),
        'productId', qi.product_id,
        'productName', qi.product_name,
        'quantity', qi.quantity,
        'unitPrice', qi.unit_price,
        'productCost', qi.product_cost,
        'productMolPercentage', qi.product_mol_percentage,
        'supplierQuoteId', qi.supplier_quote_id,
        'supplierQuoteItemId', qi.supplier_quote_item_id,
        'supplierQuoteSupplierName', qi.supplier_quote_supplier_name,
        'supplierQuoteUnitPrice', qi.supplier_quote_unit_price,
        'discount', qi.discount,
        'note', qi.note,
        'unitType', qi.unit_type,
        'durationMonths', qi.duration_months,
        'durationUnit', qi.duration_unit
      ) ORDER BY qi.position, qi.id)
      FROM quote_items qi WHERE qi.quote_id = q.id
    ), '[]'::jsonb)
  )
FROM quotes q
WHERE q.status <> 'draft'
ON CONFLICT ("quote_id", "revision_number") DO NOTHING;--> statement-breakpoint

UPDATE quotes q
SET revision_number = 1, revision_code = 'REV1'
WHERE q.status <> 'draft';--> statement-breakpoint

INSERT INTO "offer_revisions" (
  "id", "revision_number", "revision_code", "created_by_user_id", "created_at", "offer_id", "snapshot"
)
SELECT
  'or_backfill_' || md5(o.id),
  1,
  'REV1',
  NULL,
  COALESCE(o.updated_at, o.created_at, CURRENT_TIMESTAMP),
  o.id,
  jsonb_build_object(
    'schemaVersion', 1,
    'offer', jsonb_build_object(
      'id', o.id,
      'linkedQuoteId', o.linked_quote_id,
      'linkedQuoteCandidateId', o.linked_quote_candidate_id,
      'clientId', o.client_id,
      'clientName', o.client_name,
      'paymentTerms', o.payment_terms,
      'discount', o.discount,
      'discountType', o.discount_type,
      'status', o.status,
      'deliveryDate', o.delivery_date,
      'expirationDate', o.expiration_date,
      'notes', o.notes,
      'createdAt', (EXTRACT(EPOCH FROM COALESCE(o.created_at, CURRENT_TIMESTAMP)) * 1000)::bigint,
      'updatedAt', (EXTRACT(EPOCH FROM COALESCE(o.updated_at, o.created_at, CURRENT_TIMESTAMP)) * 1000)::bigint
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'offerId', oi.offer_id,
        'productId', oi.product_id,
        'productName', oi.product_name,
        'quantity', oi.quantity,
        'unitPrice', oi.unit_price,
        'productCost', oi.product_cost,
        'productMolPercentage', oi.product_mol_percentage,
        'supplierQuoteId', oi.supplier_quote_id,
        'supplierQuoteItemId', oi.supplier_quote_item_id,
        'supplierQuoteSupplierName', oi.supplier_quote_supplier_name,
        'supplierQuoteUnitPrice', oi.supplier_quote_unit_price,
        'unitType', oi.unit_type,
        'note', oi.note,
        'discount', oi.discount,
        'durationMonths', oi.duration_months,
        'durationUnit', oi.duration_unit
      ) ORDER BY oi.created_at, oi.id)
      FROM customer_offer_items oi WHERE oi.offer_id = o.id
    ), '[]'::jsonb)
  )
FROM customer_offers o
WHERE o.status <> 'draft'
ON CONFLICT ("offer_id", "revision_number") DO NOTHING;--> statement-breakpoint

UPDATE customer_offers o
SET revision_number = 1, revision_code = 'REV1'
WHERE o.status <> 'draft';--> statement-breakpoint

WITH revisable_supplier_quotes AS (
  SELECT DISTINCT sq.id
  FROM supplier_quotes sq
  WHERE EXISTS (
    SELECT 1
    FROM quotes q
    LEFT JOIN customer_offers o ON o.linked_quote_id = q.id
    WHERE (q.status <> 'draft' OR o.id IS NOT NULL)
      AND (
        EXISTS (
          SELECT 1 FROM quote_items qi
          WHERE qi.quote_id = q.id
            AND (qi.supplier_quote_id = sq.id OR qi.supplier_quote_item_id IN (
              SELECT sqi.id FROM supplier_quote_items sqi WHERE sqi.quote_id = sq.id
            ))
        )
        OR EXISTS (
          SELECT 1 FROM customer_offer_items oi
          WHERE oi.offer_id = o.id
            AND (oi.supplier_quote_id = sq.id OR oi.supplier_quote_item_id IN (
              SELECT sqi.id FROM supplier_quote_items sqi WHERE sqi.quote_id = sq.id
            ))
        )
      )
  )
)
INSERT INTO "supplier_quote_revisions" (
  "id", "revision_number", "revision_code", "created_by_user_id", "created_at", "quote_id", "snapshot"
)
SELECT
  'sqr_backfill_' || md5(sq.id),
  1,
  'REV1',
  NULL,
  COALESCE(sq.updated_at, sq.created_at, CURRENT_TIMESTAMP),
  sq.id,
  jsonb_build_object(
    'schemaVersion', 1,
    'quote', jsonb_build_object(
      'id', sq.id,
      'supplierId', sq.supplier_id,
      'supplierName', sq.supplier_name,
      'clientId', sq.client_id,
      'clientName', sq.client_name,
      'paymentTerms', sq.payment_terms,
      'status', sq.status,
      'expirationDate', sq.expiration_date,
      'communicationChannelId', sq.communication_channel_id,
      'communicationChannelName', COALESCE((SELECT c.name FROM quote_communication_channels c WHERE c.id = sq.communication_channel_id), ''),
      'linkedOrderId', (SELECT ss.id FROM supplier_sales ss WHERE ss.linked_quote_id = sq.id LIMIT 1),
      'notes', sq.notes,
      'createdAt', (EXTRACT(EPOCH FROM COALESCE(sq.created_at, CURRENT_TIMESTAMP)) * 1000)::bigint,
      'updatedAt', (EXTRACT(EPOCH FROM COALESCE(sq.updated_at, sq.created_at, CURRENT_TIMESTAMP)) * 1000)::bigint,
      'linkedClientQuoteId', NULL,
      'linkedClientQuoteStatus', NULL,
      'linkedClientQuoteExpiration', NULL,
      'linkedOfferStatus', NULL,
      'linkedOfferExpiration', NULL
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', si.id,
        'quoteId', si.quote_id,
        'productId', si.product_id,
        'productName', si.product_name,
        'quantity', si.quantity,
        'listPrice', si.list_price,
        'discountPercent', si.discount_percent,
        'unitPrice', si.unit_price,
        'note', si.note,
        'unitType', si.unit_type,
        'durationMonths', si.duration_months,
        'durationUnit', si.duration_unit
      ) ORDER BY si.created_at, si.id)
      FROM supplier_quote_items si WHERE si.quote_id = sq.id
    ), '[]'::jsonb)
  )
FROM supplier_quotes sq
JOIN revisable_supplier_quotes rsq ON rsq.id = sq.id
ON CONFLICT ("quote_id", "revision_number") DO NOTHING;--> statement-breakpoint

UPDATE supplier_quotes sq
SET revision_number = 1, revision_code = 'REV1'
WHERE EXISTS (SELECT 1 FROM supplier_quote_revisions r WHERE r.quote_id = sq.id);--> statement-breakpoint

ALTER TABLE "customer_offers" ADD CONSTRAINT "chk_customer_offers_revision" CHECK (("customer_offers"."revision_number" = 0 AND "customer_offers"."revision_code" IS NULL) OR ("customer_offers"."revision_number" > 0 AND "customer_offers"."revision_code" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "chk_quotes_revision" CHECK (("quotes"."revision_number" = 0 AND "quotes"."revision_code" IS NULL) OR ("quotes"."revision_number" > 0 AND "quotes"."revision_code" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "chk_supplier_quotes_revision" CHECK (("supplier_quotes"."revision_number" = 0 AND "supplier_quotes"."revision_code" IS NULL) OR ("supplier_quotes"."revision_number" > 0 AND "supplier_quotes"."revision_code" IS NOT NULL));
