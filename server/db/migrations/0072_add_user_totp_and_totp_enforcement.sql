ALTER TABLE "general_settings" ADD COLUMN "enforce_totp_for_admins" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_backup_codes" jsonb;