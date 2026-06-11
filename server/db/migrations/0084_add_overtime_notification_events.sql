CREATE TABLE "overtime_notification_events" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"event_date" date NOT NULL,
	"source" varchar(20) NOT NULL,
	"hours" numeric(10, 2) NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "overtime_notification_events_user_date_source_unique" UNIQUE("user_id","event_date","source"),
	CONSTRAINT "overtime_notification_events_source_check" CHECK ("overtime_notification_events"."source" IN ('tracker', 'ril_manual')),
	CONSTRAINT "overtime_notification_events_hours_check" CHECK ("overtime_notification_events"."hours" >= 0),
	CONSTRAINT "overtime_notification_events_reasons_array_check" CHECK (jsonb_typeof("overtime_notification_events"."reasons") = 'array')
);
--> statement-breakpoint
ALTER TABLE "overtime_notification_events" ADD CONSTRAINT "overtime_notification_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_notification_events" ADD CONSTRAINT "overtime_notification_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_overtime_notification_events_user_date" ON "overtime_notification_events" USING btree ("user_id","event_date");