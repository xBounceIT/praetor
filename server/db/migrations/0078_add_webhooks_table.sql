CREATE TABLE "webhooks" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"url" varchar(2000) NOT NULL,
	"http_method" varchar(10) DEFAULT 'POST' NOT NULL,
	"auth_type" varchar(20) DEFAULT 'none' NOT NULL,
	"auth_username" varchar(255) DEFAULT '',
	"auth_header_name" varchar(255) DEFAULT '',
	"auth_secret" text DEFAULT '',
	"custom_headers" jsonb DEFAULT '[]'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "webhooks_http_method_check" CHECK ("webhooks"."http_method" IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
	CONSTRAINT "webhooks_auth_type_check" CHECK ("webhooks"."auth_type" IN ('none', 'basic', 'bearer', 'api_key'))
);
--> statement-breakpoint
CREATE INDEX "idx_webhooks_created_at" ON "webhooks" USING btree ("created_at");