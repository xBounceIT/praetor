import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

describe('migration 0112: add internal projects', () => {
  const migration = readMigrationFile('0112_add_internal_projects.sql');

  test('expands the project type check without rewriting existing rows', () => {
    expect(migration).toContain(
      "CHECK (\"projects\".\"tipo\" IN ('attivo', 'passivo', 'interno'))",
    );
    expect(migration).not.toMatch(/UPDATE\s+"?projects"?/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN\s+"?tipo"?\s+SET\s+DEFAULT/i);
  });

  test('uses a low-lock add, validate, and contract sequence for the type constraint', () => {
    const addIndex = migration.indexOf('ADD CONSTRAINT "projects_tipo_check_v2"');
    const validateIndex = migration.indexOf('VALIDATE CONSTRAINT "projects_tipo_check_v2"');
    const dropIndex = migration.indexOf('DROP CONSTRAINT "projects_tipo_check"');
    const renameIndex = migration.indexOf(
      'RENAME CONSTRAINT "projects_tipo_check_v2" TO "projects_tipo_check"',
    );

    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(migration.slice(addIndex, validateIndex)).toContain('NOT VALID');
    expect(validateIndex).toBeGreaterThan(addIndex);
    expect(dropIndex).toBeGreaterThan(validateIndex);
    expect(renameIndex).toBeGreaterThan(dropIndex);
  });

  test('allows internal rows only when order and offer are both absent', () => {
    expect(migration).toContain('ADD CONSTRAINT "projects_internal_links_check"');
    expect(migration).toContain(
      'CHECK ("projects"."tipo" <> \'interno\' OR ("projects"."order_id" IS NULL AND "projects"."offer_id" IS NULL))',
    );
    expect(migration).toContain('VALIDATE CONSTRAINT "projects_internal_links_check"');
  });
});
