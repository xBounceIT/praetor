ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_method" varchar(20) DEFAULT 'local';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_provider_id" varchar(50);--> statement-breakpoint
UPDATE "users" SET "auth_method" = 'local' WHERE "auth_method" IS NULL;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_auth_method_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_method_check" CHECK ("users"."auth_method" IN ('local', 'ldap', 'oidc', 'saml'));--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_auth_provider_id_sso_providers_id_fk";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_provider_id_sso_providers_id_fk" FOREIGN KEY ("auth_provider_id") REFERENCES "public"."sso_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_auth_provider_id" ON "users" USING btree ("auth_provider_id");
