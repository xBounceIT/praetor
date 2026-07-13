ALTER TABLE "users" ADD COLUMN "first_login_at" timestamp DEFAULT TIMESTAMP '1970-01-01 00:00:00';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "first_login_at" DROP DEFAULT;
