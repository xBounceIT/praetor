import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

describe('migration 0087: add resales', () => {
  const MIGRATION = readMigrationFile('0087_add_resales.sql');

  test('creates resales, resale activities, and dedicated categories', () => {
    expect(MIGRATION).toContain('CREATE TABLE "resales"');
    expect(MIGRATION).toContain('CREATE TABLE "resale_activities"');
    expect(MIGRATION).toContain('CREATE TABLE "resale_categories"');
    expect(MIGRATION).toContain('"billing_frequency" varchar(20) DEFAULT \'one_time\' NOT NULL');
    expect(MIGRATION).toContain(
      "\"resale_activities\".\"billing_frequency\" IN ('monthly', 'quarterly', 'annual', 'one_time')",
    );
    expect(MIGRATION).toContain('ON DELETE cascade ON UPDATE cascade');
    expect(MIGRATION).toContain('ON DELETE restrict ON UPDATE cascade');
  });

  test('pins one resale per client/supplier order pair', () => {
    expect(MIGRATION).toContain(
      'CREATE UNIQUE INDEX "idx_resales_client_supplier_order_unique" ON "resales" USING btree ("client_order_id","supplier_order_id")',
    );
  });

  test('seeds default resale categories idempotently', () => {
    expect(MIGRATION).toContain('INSERT INTO "resale_categories" ("id", "name")');
    for (const name of ['Hardware', 'Sottoscrizione', 'Licenza']) {
      expect(MIGRATION).toContain(`'${name}'`);
    }
    expect(MIGRATION).toMatch(/ON CONFLICT DO NOTHING/i);
  });

  test('grants resale CRUD permissions to shipped manager roles only', () => {
    expect(MIGRATION).toContain('INSERT INTO "role_permissions" ("role_id", "permission")');
    expect(MIGRATION).toContain('CROSS JOIN');
    expect(MIGRATION).toContain('"roles"."id" IN (\'manager\', \'top_manager\')');
    for (const action of ['view', 'create', 'update', 'delete']) {
      expect(MIGRATION).toContain(`('projects.resales.${action}')`);
    }
    expect(MIGRATION).toContain('ON CONFLICT ("role_id", "permission") DO NOTHING');
  });
});
