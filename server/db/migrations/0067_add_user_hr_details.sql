ALTER TABLE "users" ADD COLUMN "phone" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "job_title" varchar(150);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department" varchar(150);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "employee_code" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hire_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "termination_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contract_type" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "employment_status" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_location" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "emergency_contact_name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "emergency_contact_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notes" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_employee_code_unique" ON "users" USING btree ("employee_code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_contract_type_check" CHECK ("users"."contract_type" IS NULL OR "users"."contract_type" IN ('permanent', 'fixed_term', 'contractor', 'internship', 'consultant', 'other'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employment_status_check" CHECK ("users"."employment_status" IS NULL OR "users"."employment_status" IN ('active', 'onboarding', 'on_leave', 'terminated'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_work_location_check" CHECK ("users"."work_location" IS NULL OR "users"."work_location" IN ('office', 'remote', 'hybrid', 'customer_site', 'other'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_hr_date_range_check" CHECK ("users"."hire_date" IS NULL OR "users"."termination_date" IS NULL OR "users"."hire_date" <= "users"."termination_date");