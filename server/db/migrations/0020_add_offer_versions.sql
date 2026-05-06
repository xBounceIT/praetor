CREATE TABLE "offer_versions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"offer_id" varchar(100) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" varchar(20) DEFAULT 'update' NOT NULL,
	"created_by_user_id" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_offer_versions_reason" CHECK ("offer_versions"."reason" IN ('update', 'restore'))
);
--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_offer_id_customer_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."customer_offers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_offer_versions_offer_id_created_at" ON "offer_versions" USING btree ("offer_id","created_at" DESC NULLS LAST);