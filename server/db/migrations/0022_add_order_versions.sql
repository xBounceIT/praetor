CREATE TABLE "order_versions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"order_id" varchar(100) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" varchar(20) DEFAULT 'update' NOT NULL,
	"created_by_user_id" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_order_versions_reason" CHECK ("order_versions"."reason" IN ('update', 'restore'))
);
--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_order_id_sales_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_order_versions_order_id_created_at" ON "order_versions" USING btree ("order_id","created_at" DESC NULLS LAST);