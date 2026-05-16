import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVER_ROOT = join(import.meta.dirname, '..', '..');

export const readSchemaFile = (name: string): string =>
  readFileSync(join(SERVER_ROOT, 'db', 'schema', name), 'utf-8');

export const readMigrationFile = (name: string): string =>
  readFileSync(join(SERVER_ROOT, 'db', 'migrations', name), 'utf-8');

export const listSchemaFiles = (): string[] =>
  readdirSync(join(SERVER_ROOT, 'db', 'schema')).filter(
    (name) => name.endsWith('.ts') && name !== 'index.ts',
  );
