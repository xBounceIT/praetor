CREATE OR REPLACE FUNCTION "bump_project_rules_config_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."config_version" := OLD."config_version" + 1;
  IF (
    OLD."field" IS DISTINCT FROM NEW."field"
    OR OLD."operator" IS DISTINCT FROM NEW."operator"
    OR OLD."value" IS DISTINCT FROM NEW."value"
    OR OLD."condition_logic" IS DISTINCT FROM NEW."condition_logic"
    OR OLD."conditions" IS DISTINCT FROM NEW."conditions"
    OR OLD."evaluation_mode" IS DISTINCT FROM NEW."evaluation_mode"
    OR OLD."schedule_config" IS DISTINCT FROM NEW."schedule_config"
    OR (OLD."is_enabled" = false AND NEW."is_enabled" = true)
  ) THEN
    NEW."condition_met" := false;
    NEW."last_triggered_at" := NULL;
    NEW."last_evaluated_period" := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "project_rules_config_version_trigger" ON "project_rules";--> statement-breakpoint
CREATE TRIGGER "project_rules_config_version_trigger"
BEFORE UPDATE OF
  "name",
  "field",
  "operator",
  "value",
  "condition_logic",
  "conditions",
  "action_type",
  "action_config",
  "evaluation_mode",
  "schedule_config",
  "is_enabled"
ON "project_rules"
FOR EACH ROW
EXECUTE FUNCTION "bump_project_rules_config_version"();
