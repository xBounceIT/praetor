-- First-time-modeling migration for the suppliers table (see db/README.md). All statements
-- are guarded with IF NOT EXISTS so this is a no-op on existing dev/prod DBs (which already
-- have suppliers from schema.sql) while still bootstrapping a fresh DB cleanly.

CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_disabled" boolean DEFAULT false,
	"supplier_code" varchar(50),
	"contact_name" varchar(255),
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"vat_number" varchar(50),
	"tax_code" varchar(50),
	"payment_terms" text,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_suppliers_name" ON "suppliers" USING btree ("name");
