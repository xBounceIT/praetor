ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check_v2" CHECK ("projects"."status" IN ('da_fare', 'in_corso', 'in_pausa', 'terminato', 'perpetuo')) NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" VALIDATE CONSTRAINT "projects_status_check_v2";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_status_check";--> statement-breakpoint
ALTER TABLE "projects" RENAME CONSTRAINT "projects_status_check_v2" TO "projects_status_check";
