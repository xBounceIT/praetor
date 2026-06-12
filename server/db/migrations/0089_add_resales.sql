CREATE TABLE "resale_activities" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"resale_id" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"billing_frequency" varchar(20) DEFAULT 'one_time' NOT NULL,
	"category_id" varchar(50) NOT NULL,
	"cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"revenue" numeric(15, 2) DEFAULT '0' NOT NULL,
	"released" boolean DEFAULT false NOT NULL,
	"due_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "resale_activities_billing_frequency_check" CHECK ("resale_activities"."billing_frequency" IN ('monthly', 'quarterly', 'annual', 'one_time')),
	CONSTRAINT "resale_activities_cost_non_negative_check" CHECK ("resale_activities"."cost" >= 0),
	CONSTRAINT "resale_activities_revenue_non_negative_check" CHECK ("resale_activities"."revenue" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resale_categories" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE "resales" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"client_order_id" varchar(100) NOT NULL,
	"supplier_order_id" varchar(100) NOT NULL,
	"due_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE "resale_activities" ADD CONSTRAINT "resale_activities_resale_id_resales_id_fk" FOREIGN KEY ("resale_id") REFERENCES "public"."resales"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "resale_activities" ADD CONSTRAINT "resale_activities_category_id_resale_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."resale_categories"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "resales" ADD CONSTRAINT "resales_client_order_id_sales_id_fk" FOREIGN KEY ("client_order_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "resales" ADD CONSTRAINT "resales_supplier_order_id_supplier_sales_id_fk" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_sales"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_resale_activities_resale_id" ON "resale_activities" USING btree ("resale_id");--> statement-breakpoint
CREATE INDEX "idx_resale_activities_category_id" ON "resale_activities" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_resale_categories_name_unique" ON "resale_categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_resales_client_order_id" ON "resales" USING btree ("client_order_id");--> statement-breakpoint
CREATE INDEX "idx_resales_supplier_order_id" ON "resales" USING btree ("supplier_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_resales_client_supplier_order_unique" ON "resales" USING btree ("client_order_id","supplier_order_id");
--> statement-breakpoint
INSERT INTO "resale_categories" ("id", "name")
VALUES
	('rvc-hardware', 'Hardware'),
	('rvc-sottoscrizione', 'Sottoscrizione'),
	('rvc-licenza', 'Licenza')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", "permissions"."permission"
FROM "roles"
CROSS JOIN (
	VALUES
		('projects.resales.view'),
		('projects.resales.create'),
		('projects.resales.update'),
		('projects.resales.delete')
) AS "permissions"("permission")
WHERE "roles"."id" IN ('manager', 'top_manager')
ON CONFLICT ("role_id", "permission") DO NOTHING;
