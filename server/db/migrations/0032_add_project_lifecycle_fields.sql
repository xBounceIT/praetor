ALTER TABLE "projects" ADD COLUMN "offer_id" varchar(100);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "revenue" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_offer_id_customer_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."customer_offers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_date_range_check" CHECK ("projects"."start_date" IS NULL OR "projects"."end_date" IS NULL OR "projects"."start_date" <= "projects"."end_date");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_revenue_non_negative_check" CHECK ("projects"."revenue" IS NULL OR "projects"."revenue" >= 0);