import { describe, expect, test } from 'bun:test';

describe('ProjectsView modal toolbar styling', () => {
  test('project modal add-activity actions use the shared table toolbar button class', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain(
      "import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';",
    );
    expect(source.match(/className=\{TABLE_CONTROL_BUTTON_CLASSNAME\}/g) ?? []).toHaveLength(2);
  });
});

describe('ProjectsView mixed billing edit behavior', () => {
  test('does not submit derived mixed project billing unless the user changes billing controls', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain(
      "if (editingProject.billingType !== 'mixed' || projectBillingChanged)",
    );
    expect(source.match(/setProjectBillingChanged\(true\)/g) ?? []).toHaveLength(2);
  });
});
