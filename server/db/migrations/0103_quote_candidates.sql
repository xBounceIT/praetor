CREATE TABLE "quote_candidates" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"quote_id" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"state" varchar(20) DEFAULT 'active' NOT NULL,
	"payment_terms" varchar(20) DEFAULT 'immediate' NOT NULL,
	"discount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_type" varchar(10) DEFAULT 'percentage' NOT NULL,
	"expiration_date" date NOT NULL,
	"communication_channel_id" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "quote_candidates_state_check" CHECK ("quote_candidates"."state" IN ('active', 'selected', 'discarded')),
	CONSTRAINT "chk_quote_candidates_discount_type" CHECK ("quote_candidates"."discount_type" IN ('percentage', 'currency'))
);
--> statement-breakpoint
ALTER TABLE "customer_offers" ADD COLUMN "linked_quote_candidate_id" varchar(100);--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "candidate_id" varchar(100);--> statement-breakpoint
INSERT INTO "quote_candidates" (
  "id", "quote_id", "name", "position", "state", "payment_terms", "discount",
  "discount_type", "expiration_date", "communication_channel_id", "notes", "created_at", "updated_at"
)
SELECT
  q."id", q."id", 'Variante A', 0,
  CASE WHEN EXISTS (
    SELECT 1 FROM "customer_offers" co WHERE co."linked_quote_id" = q."id"
  ) THEN 'selected' ELSE 'active' END,
  q."payment_terms", q."discount", q."discount_type", q."expiration_date",
  q."communication_channel_id", q."notes", q."created_at", q."updated_at"
FROM "quotes" q;--> statement-breakpoint
UPDATE "quote_items" SET "candidate_id" = "quote_id";--> statement-breakpoint
UPDATE "customer_offers" SET "linked_quote_candidate_id" = "linked_quote_id";--> statement-breakpoint
-- Expand phase: keep candidate_id nullable until every deployed writer supplies it. Existing rows
-- are backfilled above; new code always writes it, while a previous server can continue inserting
-- legacy rows during a rolling deployment. A later contract migration may enforce NOT NULL.
ALTER TABLE "quote_candidates" ADD CONSTRAINT "quote_candidates_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_candidates" ADD CONSTRAINT "quote_candidates_communication_channel_id_quote_communication_channels_id_fk" FOREIGN KEY ("communication_channel_id") REFERENCES "public"."quote_communication_channels"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_quote_candidates_quote_id_position" ON "quote_candidates" USING btree ("quote_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_quote_candidates_quote_name_unique" ON "quote_candidates" USING btree ("quote_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "idx_quote_candidates_one_selected" ON "quote_candidates" USING btree ("quote_id") WHERE "quote_candidates"."state" = 'selected';--> statement-breakpoint
ALTER TABLE "customer_offers" ADD CONSTRAINT "customer_offers_linked_quote_candidate_id_quote_candidates_id_fk" FOREIGN KEY ("linked_quote_candidate_id") REFERENCES "public"."quote_candidates"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_candidate_id_quote_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."quote_candidates"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customer_offers_linked_quote_candidate_id" ON "customer_offers" USING btree ("linked_quote_candidate_id") WHERE "customer_offers"."linked_quote_candidate_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_quote_items_candidate_id" ON "quote_items" USING btree ("candidate_id");--> statement-breakpoint
CREATE FUNCTION "ensure_legacy_quote_item_candidate"() RETURNS trigger AS $$
DECLARE
  resolved_candidate_id varchar(100);
BEGIN
  IF NEW."candidate_id" IS NULL THEN
    INSERT INTO "quote_candidates" (
      "id", "quote_id", "name", "position", "state", "payment_terms", "discount",
      "discount_type", "expiration_date", "communication_channel_id", "notes", "created_at", "updated_at"
    )
    SELECT
      'qc_legacy_' || md5(q."id" || ':' || COALESCE(q."created_at"::text, '')),
      q."id", 'Variante A', 0, 'active', q."payment_terms", q."discount",
      q."discount_type", q."expiration_date", q."communication_channel_id", q."notes",
      q."created_at", q."updated_at"
    FROM "quotes" q
    WHERE q."id" = NEW."quote_id"
      AND NOT EXISTS (
        SELECT 1 FROM "quote_candidates" qc WHERE qc."quote_id" = NEW."quote_id"
      )
    ON CONFLICT DO NOTHING;

    SELECT qc."id" INTO resolved_candidate_id
    FROM "quote_candidates" qc
    WHERE qc."quote_id" = NEW."quote_id"
    ORDER BY
      CASE qc."state" WHEN 'selected' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      qc."position",
      qc."id"
    LIMIT 1;

    IF resolved_candidate_id IS NULL THEN
      RAISE EXCEPTION 'No quote candidate available for legacy quote item %', NEW."quote_id";
    END IF;

    UPDATE "quote_candidates" qc
    SET
      "payment_terms" = q."payment_terms",
      "discount" = q."discount",
      "discount_type" = q."discount_type",
      "expiration_date" = q."expiration_date",
      "communication_channel_id" = q."communication_channel_id",
      "notes" = q."notes",
      "updated_at" = q."updated_at"
    FROM "quotes" q
    WHERE qc."id" = resolved_candidate_id
      AND qc."state" = 'active'
      AND q."id" = NEW."quote_id";

    NEW."candidate_id" := resolved_candidate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "quote_items_legacy_candidate_trigger"
BEFORE INSERT ON "quote_items"
FOR EACH ROW
WHEN (NEW."candidate_id" IS NULL)
EXECUTE FUNCTION "ensure_legacy_quote_item_candidate"();--> statement-breakpoint
CREATE FUNCTION "ensure_legacy_customer_offer_candidate"() RETURNS trigger AS $$
DECLARE
  resolved_candidate_id varchar(100);
BEGIN
  IF NEW."linked_quote_candidate_id" IS NULL THEN
    INSERT INTO "quote_candidates" (
      "id", "quote_id", "name", "position", "state", "payment_terms", "discount",
      "discount_type", "expiration_date", "communication_channel_id", "notes", "created_at", "updated_at"
    )
    SELECT
      'qc_legacy_' || md5(q."id" || ':' || COALESCE(q."created_at"::text, '')),
      q."id", 'Variante A', 0, 'active', q."payment_terms", q."discount",
      q."discount_type", q."expiration_date", q."communication_channel_id", q."notes",
      q."created_at", q."updated_at"
    FROM "quotes" q
    WHERE q."id" = NEW."linked_quote_id"
      AND NOT EXISTS (
        SELECT 1 FROM "quote_candidates" qc WHERE qc."quote_id" = NEW."linked_quote_id"
      )
    ON CONFLICT DO NOTHING;

    SELECT qc."id" INTO resolved_candidate_id
    FROM "quote_candidates" qc
    WHERE qc."quote_id" = NEW."linked_quote_id"
    ORDER BY
      CASE qc."state" WHEN 'selected' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      qc."position",
      qc."id"
    LIMIT 1
    FOR UPDATE;

    IF resolved_candidate_id IS NULL THEN
      RAISE EXCEPTION 'No quote candidate available for legacy customer offer %', NEW."linked_quote_id";
    END IF;

    UPDATE "quote_candidates"
    SET "state" = 'discarded', "updated_at" = CURRENT_TIMESTAMP
    WHERE "quote_id" = NEW."linked_quote_id"
      AND "id" <> resolved_candidate_id;

    UPDATE "quote_candidates" qc
    SET
      "state" = 'selected',
      "payment_terms" = q."payment_terms",
      "discount" = q."discount",
      "discount_type" = q."discount_type",
      "expiration_date" = q."expiration_date",
      "communication_channel_id" = q."communication_channel_id",
      "notes" = q."notes",
      "updated_at" = q."updated_at"
    FROM "quotes" q
    WHERE qc."id" = resolved_candidate_id
      AND q."id" = NEW."linked_quote_id";

    NEW."linked_quote_candidate_id" := resolved_candidate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "customer_offers_legacy_candidate_trigger"
BEFORE INSERT ON "customer_offers"
FOR EACH ROW
WHEN (NEW."linked_quote_candidate_id" IS NULL)
EXECUTE FUNCTION "ensure_legacy_customer_offer_candidate"();
