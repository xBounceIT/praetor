CREATE TABLE "user_hourly_cost_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"effective_from" date,
	"cost_per_hour" numeric(10, 2) NOT NULL,
	CONSTRAINT "user_hourly_cost_periods_cost_non_negative" CHECK ("user_hourly_cost_periods"."cost_per_hour" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_hourly_cost_periods" ADD CONSTRAINT "user_hourly_cost_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_hourly_cost_periods_user_from_unique" ON "user_hourly_cost_periods" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_hourly_cost_periods_baseline_unique" ON "user_hourly_cost_periods" USING btree ("user_id") WHERE "user_hourly_cost_periods"."effective_from" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_user_hourly_cost_periods_lookup" ON "user_hourly_cost_periods" USING btree ("user_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
UPDATE "users"
SET "cost_per_hour" = 0
WHERE "cost_per_hour" IS NULL OR "cost_per_hour" < 0;
--> statement-breakpoint
INSERT INTO "user_hourly_cost_periods" ("user_id", "effective_from", "cost_per_hour")
SELECT "id", NULL, COALESCE("cost_per_hour", 0)
FROM "users"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_user_hourly_cost_periods_from_legacy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cost_per_hour IS NOT DISTINCT FROM OLD.cost_per_hour THEN
    RETURN NEW;
  END IF;

  DELETE FROM user_hourly_cost_periods WHERE user_id = NEW.id;
  INSERT INTO user_hourly_cost_periods (user_id, effective_from, cost_per_hour)
  VALUES (NEW.id, NULL, COALESCE(NEW.cost_per_hour, 0));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_sync_hourly_cost_periods_legacy
AFTER INSERT OR UPDATE OF cost_per_hour ON users
FOR EACH ROW
EXECUTE FUNCTION sync_user_hourly_cost_periods_from_legacy();
