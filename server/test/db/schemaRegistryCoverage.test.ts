import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { schemaReadinessProbes } from '../../db/readiness.ts';
import * as schema from '../../db/schema/index.ts';

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SCHEMA_DIR = join(SERVER_ROOT, 'db', 'schema');
const SCHEMA_INDEX = readFileSync(join(SCHEMA_DIR, 'index.ts'), 'utf8');
const DRIZZLE_SOURCE = readFileSync(join(SERVER_ROOT, 'db', 'drizzle.ts'), 'utf8');

const schemaModules = readdirSync(SCHEMA_DIR)
  .filter((fileName) => fileName.endsWith('.ts'))
  .filter((fileName) => fileName !== 'index.ts' && !fileName.startsWith('_'))
  .map((fileName) => basename(fileName, '.ts'))
  .sort();

const exportedSchemaModules = Array.from(
  SCHEMA_INDEX.matchAll(/export \* from '\.\/([^']+)\.ts';/g),
  (match) => match[1],
).sort();

describe('Drizzle schema registry coverage', () => {
  test('the canonical schema barrel exports every persistent schema module', () => {
    expect(exportedSchemaModules).toEqual(schemaModules);
  });

  test('the runtime registry consumes the canonical schema barrel instead of a manual copy', () => {
    expect(DRIZZLE_SOURCE).toContain("import * as schema from './schema/index.ts';");
    expect(DRIZZLE_SOURCE).not.toMatch(/import \* as \w+Schema from '\.\/schema\/[^']+\.ts';/);
  });

  test('database readiness probes every table in the canonical schema registry', () => {
    const expectedTables = (Object.values(schema) as unknown[])
      .filter((value): value is PgTable => value instanceof PgTable)
      .map((table) => getTableName(table))
      .sort();
    const probedTables = schemaReadinessProbes.map((probe) => probe.name).sort();

    expect(probedTables).toEqual(expectedTables);
  });
});
