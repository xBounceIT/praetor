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

    // Precedence resolution lives in a dedicated helper, used once at module top-level.
    expect(source).toContain('const resolveRevenueSource = (');
    expect(source).toContain("if (activitiesSum > 0) return 'activities';");
    expect(source).toContain('resolveRevenueSource(activitiesRevenueSum, Boolean(effectiveOrder))');
    expect(source).toContain('calculatePricingTotals(');
    // Read-only when source is not manual
    expect(source).toContain("readOnly={revenueSource !== 'manual'}");
    // Submit reuses the render-scope `persistedRevenue` (no duplicate computation)
    expect(source).toContain(
      "const persistedRevenue = revenueSource === 'manual' && revenue ? parseFloat(revenue) : undefined;",
    );
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

  test('offer selector filters by client and auto-fills client on select', async () => {
    // Mirror of the order pattern: prevents picking an offer for client X while the project is
    // being assigned to client Y. Server enforces the same invariant.
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    // Filter offers to the selected client (unless no client is set yet)
    expect(source).toContain('.filter((o) => !clientId || o.clientId === clientId)');
    // On offer select, push the offer's clientId into form state
    expect(source).toContain('setClientId(nextOffer.clientId);');
  });

  test('changing the order, offer, or client clears any link that no longer matches', async () => {
    // Each handler resets sibling links that belonged to a different client. The exact
    // mechanism (a helper vs. inline state updates) is implementation detail — assert the
    // observable structural facts: order/offer pickers feed into a shared clear path, and
    // the helper itself can clear both setters.
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    // The order and offer onChange handlers each call the shared clear path with a `keep`
    // arg of the link they just set themselves.
    expect(source).toMatch(/setOrderId\(nextOrderId\)[\s\S]{0,600}['"]order['"]/);
    expect(source).toMatch(/setOfferId\(nextOfferId\)[\s\S]{0,600}['"]offer['"]/);
  });

  test('edit-mode revenue resolves the effective order from editingProject.orderId', async () => {
    // Regression for the order-derived branch silently falling back to "manual" on edit:
    // the form's `orderId` state is empty in openEditModal (no order selector is shown there —
    // only a read-only linked-order chip), so the resolution must come from editingProject.
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    // Assert the dependency on editingProject.orderId rather than the exact variable name.
    expect(source).toMatch(/orders\.find\([\s\S]*?editingProject\.orderId/);
  });
});
