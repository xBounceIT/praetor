CREATE TABLE "supplier_quote_versions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"quote_id" varchar(100) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" varchar(20) DEFAULT 'update' NOT NULL,
	"created_by_user_id" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_supplier_quote_versions_reason" CHECK ("supplier_quote_versions"."reason" IN ('update', 'restore'))
);
--> statement-breakpoint
ALTER TABLE "supplier_quote_versions" ADD CONSTRAINT "supplier_quote_versions_quote_id_supplier_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."supplier_quotes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "supplier_quote_versions" ADD CONSTRAINT "supplier_quote_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_supplier_quote_versions_quote_id_created_at" ON "supplier_quote_versions" USING btree ("quote_id","created_at" DESC NULLS LAST);
