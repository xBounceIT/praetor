ALTER TABLE "general_settings" ADD COLUMN "ril_company_name" varchar(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE "general_settings" ADD COLUMN "ril_default_start_time" varchar(5) DEFAULT '09:00';--> statement-breakpoint
ALTER TABLE "general_settings" ADD COLUMN "ril_lunch_break_minutes" integer DEFAULT 60;--> statement-breakpoint
ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_ril_default_start_time_check" CHECK ("general_settings"."ril_default_start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "general_settings" ADD CONSTRAINT "general_settings_ril_lunch_break_minutes_check" CHECK ("general_settings"."ril_lunch_break_minutes" >= 0 AND "general_settings"."ril_lunch_break_minutes" <= 240);--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission)
SELECT role_id, 'timesheets.ril.view'
FROM role_permissions
WHERE permission IN ('timesheets.tracker.view', 'timesheets.tracker_all.view')
ON CONFLICT DO NOTHING;
