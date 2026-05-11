import { describe, expect, test } from 'bun:test';

const readSource = () =>
  Bun.file(new URL('../../../components/projects/ProjectsView.tsx', import.meta.url)).text();

describe('<ProjectsView /> single-project hours fetch dedup', () => {
  test('openEditModal reuses cached allProjectHours when available', async () => {
    const source = await readSource();

    // The cached lookup variable is introduced and consulted.
    expect(source).toContain('const cachedHours = allProjectHours?.[project.id];');

    // When cached, set projectTaskHours from the cache and short-circuit the fetch.
    expect(source).toContain('if (cachedHours) {');
    expect(source).toContain('setProjectTaskHours(cachedHours);');

    // The early return must precede the call to tasksApi.getHours so the redundant fetch is skipped.
    const cachedBlockIndex = source.indexOf('if (cachedHours) {');
    const getHoursIndex = source.indexOf('tasksApi\n      .getHours(');
    expect(cachedBlockIndex).toBeGreaterThan(0);
    expect(getHoursIndex).toBeGreaterThan(cachedBlockIndex);

    // A return inside the cached branch ensures the fetch path is skipped entirely.
    const cachedBlock = source.slice(cachedBlockIndex, getHoursIndex);
    expect(cachedBlock).toContain('return;');
  });
});
