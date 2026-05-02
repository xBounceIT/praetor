-- First-time-modeling migration for clients (carry-forward pattern, see db/README.md).

CREATE TABLE IF NOT EXISTS "clients" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_disabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"type" varchar(20) DEFAULT 'company',
	"contact_name" varchar(255),
	"client_code" varchar(50),
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"description" text,
	"ateco_code" varchar(50),
	"website" varchar(255),
	"sector" varchar(50),
	"number_of_employees" varchar(20),
	"revenue" varchar(20),
	"fiscal_code" varchar(50),
	"office_count_range" varchar(10),
	"contacts" jsonb DEFAULT '[]'::jsonb,
	"address_country" varchar(100),
	"address_state" varchar(100),
	"address_cap" varchar(20),
	"address_province" varchar(100),
	"address_civic_number" varchar(30),
	"address_line" text
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "type" varchar(20) DEFAULT 'company';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "contact_name" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "client_code" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "email" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "phone" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "ateco_code" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "website" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "sector" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "number_of_employees" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "revenue" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "fiscal_code" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "office_count_range" varchar(10);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "contacts" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address_country" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address_state" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address_cap" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address_province" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address_civic_number" varchar(30);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address_line" text;
