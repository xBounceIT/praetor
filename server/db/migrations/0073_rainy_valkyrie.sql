ALTER TABLE "general_settings" ADD COLUMN "enable_totp" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "general_settings" ADD COLUMN "totp_enforced_role_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "general_settings" ADD COLUMN "totp_exempt_role_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_totp_enforced_role_ids_array_check" CHECK (jsonb_typeof("general_settings"."totp_enforced_role_ids") = 'array');--> statement-breakpoint
ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_totp_exempt_role_ids_array_check" CHECK (jsonb_typeof("general_settings"."totp_exempt_role_ids") = 'array');