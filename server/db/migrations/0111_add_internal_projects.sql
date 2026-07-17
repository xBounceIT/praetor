ALTER TABLE "projects" ADD CONSTRAINT "projects_tipo_check_v2" CHECK ("projects"."tipo" IN ('attivo', 'passivo', 'interno')) NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" VALIDATE CONSTRAINT "projects_tipo_check_v2";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_tipo_check";--> statement-breakpoint
ALTER TABLE "projects" RENAME CONSTRAINT "projects_tipo_check_v2" TO "projects_tipo_check";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_internal_links_check" CHECK ("projects"."tipo" <> 'interno' OR ("projects"."order_id" IS NULL AND "projects"."offer_id" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" VALIDATE CONSTRAINT "projects_internal_links_check";
