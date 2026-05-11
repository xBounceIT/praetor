import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { customerOfferItems } from '../../db/schema/customerOfferItems.ts';
import { roles, userRoles } from '../../db/schema/roles.ts';
import { tasks } from '../../db/schema/tasks.ts';
import { users } from '../../db/schema/users.ts';

// Drift guard for the schema/migration parity fixes in 0025_align_schema_sql_parity.sql.
// If a future schema edit weakens any of these constraints (e.g. drops ON UPDATE CASCADE
// on users.role, or flips user_roles.role_id back to CASCADE), these tests fail before the
// regression ships. Each assertion mirrors a bullet in the unit description backing the
// migration, so a failure points directly at the policy that drifted.

function findFk(table: ReturnType<typeof getTableConfig>, columnName: string) {
  return table.foreignKeys.find((fk) => {
    const ref = fk.reference();
    return ref.columns.some((col) => col.name === columnName);
  });
}

describe('users.role → roles.id FK', () => {
  test('uses ON DELETE RESTRICT', () => {
    const fk = findFk(getTableConfig(users), 'role');
    expect(fk?.onDelete).toBe('restrict');
  });

  test('uses ON UPDATE CASCADE (drift guard — matches schema.sql:281)', () => {
    const fk = findFk(getTableConfig(users), 'role');
    expect(fk?.onUpdate).toBe('cascade');
  });
});

describe('user_roles.role_id → roles.id FK', () => {
  test('uses ON DELETE RESTRICT so role deletion cannot silently wipe assignments', () => {
    const fk = findFk(getTableConfig(userRoles), 'role_id');
    expect(fk?.onDelete).toBe('restrict');
  });

  test('user_roles.user_id retains ON DELETE CASCADE (sanity check)', () => {
    const fk = findFk(getTableConfig(userRoles), 'user_id');
    expect(fk?.onDelete).toBe('cascade');
  });
});

describe('customer_offer_items.product_id → products.id FK', () => {
  test('uses ON DELETE RESTRICT (open-document policy, matching quote_items/sale_items)', () => {
    const fk = findFk(getTableConfig(customerOfferItems), 'product_id');
    expect(fk?.onDelete).toBe('restrict');
  });
});

describe('tasks.project_id index', () => {
  test('idx_tasks_project_id is declared so it lands in Drizzle-only bootstraps', () => {
    const config = getTableConfig(tasks);
    const idx = config.indexes.find((i) => i.config.name === 'idx_tasks_project_id');
    expect(idx).toBeDefined();
    expect(idx?.config.columns.map((c) => 'name' in c && c.name)).toEqual(['project_id']);
  });
});

describe('roles table sanity', () => {
  test('roles.id is the primary key (used as FK target)', () => {
    const config = getTableConfig(roles);
    const idCol = config.columns.find((c) => c.name === 'id');
    expect(idCol?.primary).toBe(true);
  });
});

describe('migration 0025_align_schema_sql_parity.sql', () => {
  const migrationPath = join(
    import.meta.dir,
    '../../db/migrations/0025_align_schema_sql_parity.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');

  test('adds projects.order_id → sales.id FK named projects_order_id_fkey idempotently', () => {
    // The repo (projectsRepo.ts) keys off the auto-generated `_fkey` name when translating
    // FK-violation errors — if the constraint name drifts here, those error paths regress.
    expect(sql).toContain("conname = 'projects_order_id_fkey'");
    expect(sql).toMatch(/ADD CONSTRAINT "projects_order_id_fkey"/);
    expect(sql).toMatch(/REFERENCES "public"\."sales"\("id"\) ON DELETE SET NULL/);
  });

  test('creates idx_tasks_project_id with IF NOT EXISTS guard', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_tasks_project_id"/);
  });

  test('drops legacy + Drizzle-named customer_offer_items.product_id FKs before re-adding RESTRICT', () => {
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "customer_offer_items_product_id_fkey"');
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS "customer_offer_items_product_id_products_id_fk"',
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT "customer_offer_items_product_id_products_id_fk"[\s\S]*ON DELETE RESTRICT/,
    );
  });

  test('re-adds users.role FK with ON UPDATE CASCADE', () => {
    expect(sql).toMatch(
      /ADD CONSTRAINT "users_role_roles_id_fk"[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
  });

  test('re-adds user_roles.role_id FK with ON DELETE RESTRICT', () => {
    expect(sql).toMatch(/ADD CONSTRAINT "user_roles_role_id_roles_id_fk"[\s\S]*ON DELETE RESTRICT/);
  });
});
