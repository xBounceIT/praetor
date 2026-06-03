CREATE TABLE "ril_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"month_key" varchar(7) NOT NULL,
	"rows" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "ril_drafts_user_month_unique" UNIQUE("user_id","month_key"),
	CONSTRAINT "ril_drafts_month_key_check" CHECK ("ril_drafts"."month_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ril_drafts_rows_object_check" CHECK (jsonb_typeof("ril_drafts"."rows") = 'object')
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ril_weekday_transfer_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ril_drafts" ADD CONSTRAINT "ril_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ril_weekday_transfer_defaults_object_check" CHECK (jsonb_typeof("settings"."ril_weekday_transfer_defaults") = 'object');