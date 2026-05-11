import { describe, expect, test } from 'bun:test';

const readSource = () =>
  Bun.file(new URL('../../../components/projects/ProjectsView.tsx', import.meta.url)).text();

describe('<ProjectsView /> single-project hours stale-while-revalidate', () => {
  test('openEditModal seeds projectTaskHours from cache before fetching', async () => {
    const source = await readSource();

    // The cached lookup variable is introduced and consulted.
    expect(source).toContain('const cachedHours = allProjectHours?.[project.id];');

    // Seed the displayed hours from the cache so the modal paints immediately.
    expect(source).toContain('setProjectTaskHours(cachedHours ?? {});');

    // The fetch must still run so stale cached hours get refreshed against
    // server truth — there must be no early `return` between the cache seed
    // and the tasksApi.getHours call.
    const cacheSeedIndex = source.indexOf('setProjectTaskHours(cachedHours ?? {});');
    const getHoursIndex = source.indexOf('tasksApi\n      .getHours(');
    expect(cacheSeedIndex).toBeGreaterThan(0);
    expect(getHoursIndex).toBeGreaterThan(cacheSeedIndex);
    const between = source.slice(cacheSeedIndex, getHoursIndex);
    expect(between.includes('return;')).toBe(false);
  });
});
