import { describe, expect, test } from 'bun:test';

const getHrRoutesSource = async () => {
  const source = await Bun.file(new URL('../App.tsx', import.meta.url)).text();
  const start = source.indexOf('const HrRoutes:');
  const end = source.indexOf('const ProjectRoutes:', start);
  if (start === -1 || end === -1) throw new Error('HrRoutes source block not found');
  return source.slice(start, end);
};

describe('App.tsx HR work unit routing', () => {
  test('passes scoped work-unit data through to employee views for derived departments', async () => {
    const source = await getHrRoutesSource();

    expect(source).not.toContain('visibleWorkUnits');
    expect(source).not.toContain(
      "hasPermission(currentUser.permissions, 'hr.work_units_all.view')",
    );
    expect(source.match(/workUnits=\{workUnits\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
