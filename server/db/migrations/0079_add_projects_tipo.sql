ALTER TABLE "projects" ADD COLUMN "tipo" varchar(20) DEFAULT 'attivo' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tipo_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tipo_check" CHECK ("projects"."tipo" IN ('attivo', 'passivo'));