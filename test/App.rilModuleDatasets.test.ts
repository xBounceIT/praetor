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

  test('RIL view permission authorizes users and project catalogs used by the RIL page', () => {
    expect(initializerFor('canListProjects')).toContain(
      "buildPermission('timesheets.ril', 'view')",
    );
    expect(initializerFor('canListUsers')).toContain("buildPermission('timesheets.ril', 'view')");
  });

  test('RIL view permission does not enable the generic tracker entries preload', () => {
    expect(source).toContain(
      "const canListEntries = hasViewAccess(permissions, 'timesheets/tracker')",
    );

    const datasetStart = source.indexOf("dataset: 'entries'");
    expect(datasetStart).toBeGreaterThan(-1);
    const datasetEnd = source.indexOf('}', datasetStart);
    expect(source.slice(datasetStart, datasetEnd)).toContain(
      'enabled: requirements.entries && canListEntries',
    );
  });
});
