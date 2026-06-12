ALTER TABLE "tasks" ADD COLUMN "duration" numeric(10, 2) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_duration_non_negative_check" CHECK ("tasks"."duration" >= 0);
