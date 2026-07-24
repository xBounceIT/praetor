import { describe, expect, test } from 'bun:test';

const readProjectSource = (fileName: string) =>
  Bun.file(new URL(`../../../components/projects/${fileName}`, import.meta.url)).text();

describe('task progress hour keying', () => {
  test('all project task progress views use stable task ids', async () => {
    const [projectTasksTable, tasksView, projectsView] = await Promise.all([
      readProjectSource('ProjectTasksTable.tsx'),
      readProjectSource('TasksView.tsx'),
      readProjectSource('ProjectsView.tsx'),
    ]);

    expect(projectTasksTable).toContain('hoursState.hours[row.id]');
    expect(projectTasksTable).not.toContain('hoursState.hours[row.name]');
    expect(tasksView).toContain('projectHours[row.id]');
    expect(tasksView).not.toContain('projectHours[row.name]');
    expect(projectsView).toContain('hours[task.id]');
    expect(projectsView).not.toContain('hours[task.name]');
  });
});
