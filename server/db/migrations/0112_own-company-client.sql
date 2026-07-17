ALTER TABLE "clients" ADD COLUMN "is_own_company" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  company_display_name varchar(255);
  own_company_client_id varchar(50);
BEGIN
  SELECT COALESCE(NULLIF(BTRIM(company_name), ''), 'PRAETOR')
  INTO company_display_name
  FROM app_branding
  WHERE id = 1;

  company_display_name := COALESCE(company_display_name, 'PRAETOR');

  own_company_client_id := 'praetor-own-company';
  INSERT INTO clients (id, name, type, is_disabled, is_own_company, description)
  VALUES (
    own_company_client_id,
    company_display_name,
    'company',
    FALSE,
    TRUE,
    'Company identified by Praetor for internal projects.'
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    is_disabled = FALSE,
    is_own_company = TRUE;

  UPDATE projects
  SET client_id = own_company_client_id
  WHERE tipo = 'interno'
    AND client_id <> own_company_client_id;

  INSERT INTO user_clients (user_id, client_id, assignment_source)
  SELECT DISTINCT up.user_id, own_company_client_id, 'project_cascade'
  FROM user_projects up
  INNER JOIN projects p ON p.id = up.project_id
  WHERE p.tipo = 'interno'
  ON CONFLICT (user_id, client_id) DO NOTHING;

  DELETE FROM user_clients uc
  WHERE uc.assignment_source = 'project_cascade'
    AND uc.client_id <> own_company_client_id
    AND NOT EXISTS (
      SELECT 1
      FROM user_projects up
      INNER JOIN projects p ON p.id = up.project_id
      WHERE up.user_id = uc.user_id
        AND p.client_id = uc.client_id
    );
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_clients_one_own_company" ON "clients" USING btree ("is_own_company") WHERE "clients"."is_own_company" = TRUE;