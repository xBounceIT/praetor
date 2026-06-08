import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

describe('migration 0078: add projects.tipo', () => {
  const MIGRATION = readMigrationFile('0078_add_projects_tipo.sql');

  test('adds tipo and tipo_confirmed columns with rollout defaults (issue #784)', () => {
    // Existing rows are backfilled to 'attivo' (the rollout default) and left unconfirmed
    // so the edit form can force a deliberate first choice.
    expect(MIGRATION).toContain(`ADD COLUMN "tipo" varchar(20) DEFAULT 'attivo' NOT NULL`);
    expect(MIGRATION).toContain(`ADD COLUMN "tipo_confirmed" boolean DEFAULT false NOT NULL`);
  });

  test('constrains tipo to attivo/passivo', () => {
    expect(MIGRATION).toContain('"projects_tipo_check"');
    expect(MIGRATION).toContain("IN ('attivo', 'passivo')");
  });
});
