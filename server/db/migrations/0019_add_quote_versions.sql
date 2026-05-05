CREATE TABLE "quote_versions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"quote_id" varchar(100) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" varchar(20) DEFAULT 'update' NOT NULL,
	"created_by_user_id" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_quote_versions_reason" CHECK ("quote_versions"."reason" IN ('update', 'restore'))
);
--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quote_versions_quote_id_created_at" ON "quote_versions" USING btree ("quote_id","created_at" DESC NULLS LAST);