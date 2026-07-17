import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

describe('migration 0113: own-company client', () => {
  const migration = readMigrationFile('0113_own-company-client.sql');

  test('adds an explicit, unique own-company marker', () => {
    expect(migration).toContain('ADD COLUMN "is_own_company" boolean DEFAULT false NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX "idx_clients_one_own_company"');
    expect(migration).toContain('WHERE "clients"."is_own_company" = TRUE');
  });

  test('uses the configured branding name with a Praetor fallback', () => {
    expect(migration).toContain("NULLIF(BTRIM(company_name), '')");
    expect(migration).toContain("COALESCE(company_display_name, 'PRAETOR')");
    expect(migration).toContain("own_company_client_id := 'praetor-own-company'");
  });

  test('moves internal projects and their assignees to the own-company client', () => {
    expect(migration).toMatch(/UPDATE projects[\s\S]*WHERE tipo = 'interno'/);
    expect(migration).toContain(
      "SELECT DISTINCT up.user_id, own_company_client_id, 'project_cascade'",
    );
    expect(migration).toContain('ON CONFLICT (user_id, client_id) DO NOTHING');
    expect(migration).toMatch(
      /DELETE FROM user_clients uc[\s\S]*uc\.assignment_source = 'project_cascade'[\s\S]*NOT EXISTS/,
    );
  });
});
