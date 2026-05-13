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

    expect(source).toContain("if (displayProjectBillingType !== 'mixed' || projectBillingChanged)");
    expect(source).toContain('const getDerivedProjectBillingType = (project: Project)');
    expect(source.match(/setProjectBillingChanged\(true\)/g) ?? []).toHaveLength(2);
  });
});

describe('ProjectsView optional order on create (#319)', () => {
  test('create form does not require orderId — only name + clientId are validated', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).not.toContain('orderRequired');
    expect(source).toContain(
      "if (!clientId) newErrors.clientId = t('projects:projects.clientRequired')",
    );
  });

  test('onAddProject signature exposes clientId and an optional orderId', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain(
      'onAddProject: (\n    name: string,\n    clientId: string,\n    orderId: string | undefined,',
    );
    expect(source).toContain(
      'onAddProject(\n        name,\n        clientId,\n        orderId || undefined,',
    );
  });

  test('order selector auto-fills client from the selected order', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain('const nextOrder = orders.find((o) => o.id === nextOrderId);');
    expect(source).toContain('setClientId(nextOrder.clientId);');
    expect(source).toContain('disabled={Boolean(selectedOrder)}');
  });
});
