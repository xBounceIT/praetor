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

    expect(source).toContain('export type AddProjectFormInput');
    expect(source).toMatch(/clientId:\s*string;[\s\S]*orderId\?:\s*string;/);
    // Submit forwards orderId via the options-object contract, normalizing '' to undefined
    expect(source).toMatch(/orderId:\s*orderId\s*\|\|\s*undefined,/);
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

describe('ProjectsView lifecycle fields (issue #322)', () => {
  test('exposes start date, end date, offer reference, and revenue inputs', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain('id="project-start-date"');
    expect(source).toContain('id="project-end-date"');
    expect(source).toContain('id="project-offer"');
    expect(source).toContain('id="project-revenue"');
    expect(source).toContain("t('projects:projects.startDate')");
    expect(source).toContain("t('projects:projects.endDate')");
    expect(source).toContain("t('projects:projects.offerReference')");
    expect(source).toContain("t('projects:projects.projectRevenue')");
  });

  test('revenue precedence: activity sum > order > manual', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain(
      "activitiesRevenueSum > 0 ? 'activities' : effectiveOrder ? 'order' : 'manual'",
    );
    expect(source).toContain('calculatePricingTotals(');
    // Read-only when source is not manual
    expect(source).toContain("readOnly={revenueSource !== 'manual'}");
    // Submit path persists null when not manual
    expect(source).toContain("submitSource === 'manual' && revenue ? parseFloat(revenue) : null");
  });

  test('requires offer reference and validates date range on submit', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain("newErrors.offerId = t('projects:projects.offerRequired')");
    expect(source).toContain("newErrors.dateRange = t('projects:projects.dateRangeInvalid')");
  });

  test('passes new fields via the options-object onAddProject contract', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain('export type AddProjectFormInput');
    expect(source).toContain('onAddProject: (input: AddProjectFormInput) => void');
    // Make sure submit calls onAddProject with the new shape
    expect(source).toMatch(/onAddProject\(\s*\{[\s\S]*offerId,[\s\S]*\}\s*\)/);
  });

  test('edit-mode revenue uses editingProject.orderId, not the empty create-form orderId', async () => {
    // Regression for the order-derived branch silently falling back to "manual" on edit:
    // the form's `orderId` state is empty in openEditModal (no order selector is shown in the
    // edit modal — only a read-only linked-order chip), so we must resolve the effective order
    // from `editingProject.orderId` when in edit mode.
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain(
      'editingProject?.orderId\n    ? orders.find((o) => o.id === editingProject.orderId)',
    );
    // handleSubmit path mirrors the same resolution
    expect(source).toMatch(
      /const submitOrder = editingProject\?\.orderId\s*\?\s*orders\.find\(\(o\) => o\.id === editingProject\.orderId\)/,
    );
  });
});
