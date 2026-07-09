ALTER TABLE "users" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "responsible_user_id" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_responsible_user_id" ON "users" USING btree ("responsible_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_responsible_not_self_check" CHECK ("users"."responsible_user_id" IS NULL OR "users"."responsible_user_id" <> "users"."id");