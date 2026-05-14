import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUDIT_ENTITY_TYPES } from '../../utils/audit.ts';

// Mirror check: the frontend has its own `AUDIT_ENTITY_TYPES` const in `types.ts` because
// the server tsconfig's `rootDir` keeps it from importing across project roots. If the two
// lists drift, the frontend log viewer's entity-type dropdown won't show newly-added types.
// This test parses the frontend file at runtime and asserts set equality with the
// server-side canonical list.
const projectRoot = resolve(import.meta.dir, '..', '..', '..');
const frontendTypesPath = resolve(projectRoot, 'types.ts');

const parseFrontendEntityTypes = (): string[] => {
  const source = readFileSync(frontendTypesPath, 'utf8');
  const match = source.match(/export const AUDIT_ENTITY_TYPES = \[([\s\S]*?)\] as const;/);
  if (!match) {
    throw new Error('Could not locate `AUDIT_ENTITY_TYPES` literal in frontend types.ts');
  }
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
};

describe('AUDIT_ENTITY_TYPES sync', () => {
  test('frontend types.ts mirrors server/utils/audit.ts', () => {
    const frontend = parseFrontendEntityTypes();
    expect(frontend.sort()).toEqual([...AUDIT_ENTITY_TYPES].sort());
  });
});
