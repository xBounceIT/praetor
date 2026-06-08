import { describe, expect, test } from 'bun:test';

describe('ProjectsView (create-only dialog after detail-page revamp)', () => {
  test('modal title is the create-new-project label only', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    // Edit mode lives in ProjectDetailView now — the dialog must never render
    // the "Edit Project" title or branch on `editingProject` anywhere.
    expect(source).toContain("t('projects:projects.createNewProject')");
    expect(source).not.toMatch(/editProject/);
    expect(source).not.toMatch(/\beditingProject\b/);
  });

  test('table row click delegates to onNavigateToProject (no inline modal open)', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain('onNavigateToProject?: (projectId: string) => void');
    // The list's row click should fire navigation, not openEditModal (which no longer exists).
    expect(source).toContain(
      'onRowClick={onNavigateToProject ? (row) => onNavigateToProject(row.id) : undefined}',
    );
    expect(source).not.toContain('openEditModal');
  });

  test('onAddProject returns the created project so the caller can navigate to it', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain(
      'onAddProject: (input: AddProjectFormInput) => Promise<Project | null>',
    );
    // After submit, ProjectsView awaits the handler and navigates on success.
    expect(source).toMatch(/const result = await onAddProject\(/);
    expect(source).toContain('onNavigateToProject(result.id)');
  });
});

describe('ProjectsView create-form validation', () => {
  test('create form requires name, client, offer, and a date range', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain(
      "if (!name?.trim()) newErrors.name = t('common:validation.projectNameRequired')",
    );
    expect(source).toContain(
      "if (!clientId) newErrors.clientId = t('projects:projects.clientRequired')",
    );
    expect(source).toContain(
      "if (!offerId) newErrors.offerId = t('projects:projects.offerRequired')",
    );
    expect(source).toContain(
      "if (!startDate) newErrors.startDate = t('projects:projects.startDateRequired');",
    );
    expect(source).toContain(
      "if (!endDate) newErrors.endDate = t('projects:projects.endDateRequired');",
    );
    expect(source).toContain("newErrors.dateRange = t('projects:projects.dateRangeInvalid')");
  });

  test('exposes start date, end date, offer reference, and revenue inputs', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain('id="project-start-date"');
    expect(source).toContain('id="project-end-date"');
    expect(source).toContain('id="project-offer"');
    expect(source).toContain('id="project-revenue"');
  });

  test('revenue precedence: activity sum > order > manual, and read-only unless manual', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain('const resolveRevenueSource = (');
    expect(source).toContain("if (activitiesSum > 0) return 'activities';");
    expect(source).toContain("readOnly={revenueSource !== 'manual'}");
    expect(source).toContain(
      "const persistedRevenue = revenueSource === 'manual' && revenue ? parseFloat(revenue) : undefined;",
    );
  });

  test('order selector auto-fills the client and disables the client picker while bound', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain('const nextOrder = orders.find((o) => o.id === nextOrderId);');
    expect(source).toContain("dispatch({ type: 'setClientId', value: nextOrder.clientId });");
    expect(source).toContain('disabled={Boolean(selectedOrder)}');
  });

  test('offer selector filters by client and auto-fills client on select', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain(
      "if (offer.status !== 'sent' && offer.status !== 'accepted') return options;",
    );
    expect(source).toContain('if (clientId && offer.clientId !== clientId) return options;');
    expect(source).toContain("dispatch({ type: 'setClientId', value: nextOffer.clientId });");
  });

  test('changing the order or offer clears any stale sibling link via the shared helper', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toMatch(
      /setOrderId['"],\s*value:\s*nextOrderId\s*\}\)[\s\S]{0,900}['"]order['"]/,
    );
    expect(source).toMatch(
      /setOfferId['"],\s*value:\s*nextOfferId\s*\}\)[\s\S]{0,900}['"]offer['"]/,
    );
  });
});

describe('ProjectsView toolbar styling', () => {
  test('the draft-task add-row button uses the shared table toolbar button class', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain(
      "import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';",
    );
    expect(source.match(/className=\{TABLE_CONTROL_BUTTON_CLASSNAME\}/g) ?? []).toHaveLength(1);
  });
});

describe('ProjectsView draft-task delete action (issue #782)', () => {
  // StandardTable collapses an actions column into a "…" overflow menu and derives
  // each item's text from the control's tooltip / aria-label. The draft-task delete
  // button had neither, so the menu item rendered icon-only with no label text — the
  // blank space where "Elimina"/"Delete" belongs is what issue #782 reported as a
  // wrong font colour in light mode. It must carry the shared delete label (matching
  // ProjectTasksTable in the edit view) so the collapsed menu shows a labelled item.
  test('the remove-draft-task control is tooltip-wrapped and carries the delete label', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    // aria-label sits on the remove button itself (assistive-tech name + menu-label fallback).
    expect(source).toMatch(
      /onClick=\{\(\) => removeDraftTask\(row\._id\)\}[\s\S]{0,80}aria-label=\{t\('common:buttons\.delete'\)\}/,
    );
    // The same cell exposes the tooltip label StandardTable reads for the collapsed menu item.
    expect(source).toMatch(
      /removeDraftTask\(row\._id\)[\s\S]{0,400}<TooltipContent>\{t\('common:buttons\.delete'\)\}<\/TooltipContent>/,
    );
  });
});
