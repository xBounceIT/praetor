ALTER TABLE "projects" ADD COLUMN "billing_type" varchar(30) DEFAULT 'time_and_materials' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "billing_frequency" varchar(20) DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "billing_type" varchar(30) DEFAULT 'time_and_materials' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "billing_frequency" varchar(20) DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "monthly_effort" numeric(10, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_billing_type_check" CHECK ("projects"."billing_type" IN ('retainer', 'time_and_materials'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_billing_frequency_check" CHECK ("projects"."billing_frequency" IN ('monthly', 'one_time'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_time_and_materials_monthly_check" CHECK ("projects"."billing_type" != 'time_and_materials' OR "projects"."billing_frequency" = 'monthly');--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_billing_type_check" CHECK ("tasks"."billing_type" IN ('retainer', 'time_and_materials'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_billing_frequency_check" CHECK ("tasks"."billing_frequency" IN ('monthly', 'one_time'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_time_and_materials_monthly_check" CHECK ("tasks"."billing_type" != 'time_and_materials' OR "tasks"."billing_frequency" = 'monthly');