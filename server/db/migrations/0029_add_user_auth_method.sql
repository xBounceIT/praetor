ALTER TABLE "users" ADD COLUMN "auth_method" varchar(20) DEFAULT 'local';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider_id" varchar(50);--> statement-breakpoint
WITH latest_external_identity AS (
  SELECT
    "user_id",
    "provider_id",
    "protocol",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "updated_at" DESC NULLS LAST, "created_at" DESC NULLS LAST, "id" DESC
    ) AS "rank"
  FROM "external_identities"
  WHERE "protocol" IN ('oidc', 'saml')
)
UPDATE "users"
SET
  "auth_method" = latest_external_identity."protocol",
  "auth_provider_id" = latest_external_identity."provider_id"
FROM latest_external_identity
WHERE latest_external_identity."rank" = 1
  AND latest_external_identity."user_id" = "users"."id"
  AND COALESCE("users"."employee_type", 'app_user') = 'app_user';--> statement-breakpoint
UPDATE "users"
SET "auth_method" = 'ldap', "auth_provider_id" = NULL
WHERE "auth_provider_id" IS NULL
  AND "password_hash" = '$2a$10$invalidpasswordhashforldapuser00000000000000'
  AND COALESCE("employee_type", 'app_user') = 'app_user';--> statement-breakpoint
UPDATE "users" SET "auth_method" = 'local' WHERE "auth_method" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_provider_id_sso_providers_id_fk" FOREIGN KEY ("auth_provider_id") REFERENCES "public"."sso_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_auth_provider_id" ON "users" USING btree ("auth_provider_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_method_check" CHECK ("users"."auth_method" IN ('local', 'ldap', 'oidc', 'saml'));
