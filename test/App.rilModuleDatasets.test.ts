import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('App.tsx RIL module dataset permissions', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');

  const initializerFor = (name: string) => {
    const start = source.indexOf(`const ${name} = hasAnyPermission(permissions, [`);
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf(']);', start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  test('RIL view permission enters the timesheets module loader', () => {
    expect(initializerFor('canViewTimesheets')).toContain(
      "buildPermission('timesheets.ril', 'view')",
    );
  });

  test('RIL view permission loads users and projects used by the RIL page', () => {
    expect(initializerFor('canListProjects')).toContain(
      "buildPermission('timesheets.ril', 'view')",
    );
    expect(initializerFor('canListUsers')).toContain("buildPermission('timesheets.ril', 'view')");
  });
});
