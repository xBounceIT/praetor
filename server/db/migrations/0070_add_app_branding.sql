CREATE TABLE "app_branding" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" varchar(120),
	"logo_stored_name" varchar(255),
	"logo_mime_type" varchar(100),
	"logo_file_size" integer,
	"logo_updated_at" timestamp,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "app_branding_id_check" CHECK ("app_branding"."id" = 1)
);
