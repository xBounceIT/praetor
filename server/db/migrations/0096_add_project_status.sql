ALTER TABLE "projects" ADD COLUMN "status" varchar(20);--> statement-breakpoint
UPDATE "projects" SET "status" = 'in_corso' WHERE "status" IS NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'da_fare';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check" CHECK ("projects"."status" IN ('da_fare', 'in_corso', 'in_pausa', 'terminato'));--> statement-breakpoint
UPDATE "project_rules"
SET "value" = CASE "value"
  WHEN 'active' THEN 'in_corso'
  WHEN 'disabled' THEN 'in_pausa'
  ELSE "value"
END
WHERE "field" = 'status'
  AND "value" IN ('active', 'disabled');--> statement-breakpoint
UPDATE "project_rules"
SET "conditions" = (
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN condition ->> 'field' = 'status' AND condition ->> 'value' = 'active'
          THEN jsonb_set(condition, '{value}', to_jsonb('in_corso'::text), false)
        WHEN condition ->> 'field' = 'status' AND condition ->> 'value' = 'disabled'
          THEN jsonb_set(condition, '{value}', to_jsonb('in_pausa'::text), false)
        ELSE condition
      END
      ORDER BY ordinality
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements("project_rules"."conditions") WITH ORDINALITY AS item(condition, ordinality)
)
WHERE "conditions" @> '[{"field":"status","value":"active"}]'::jsonb
   OR "conditions" @> '[{"field":"status","value":"disabled"}]'::jsonb;
