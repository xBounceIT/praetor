import { describe, expect, test } from 'bun:test';

describe('ProjectsView (create-only dialog after detail-page revamp)', () => {
  test('renders commesse and task tabs while reusing the task view internally', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain('import { Tabs, TabsContent, TabsList, TabsTrigger }');
    expect(source).toContain("import { Folder, ListChecks } from 'lucide-react'");
    expect(source).toContain("export type ProjectsViewTab = 'commissions' | 'tasks'");
    expect(source).toContain('activeTab?: ProjectsViewTab');
    expect(source).toContain(
      "const canViewCommissions = hasScopedActionPermission(permissions, 'projects.manage', 'view')",
    );
    expect(source).toContain(
      "const canViewTasks = hasScopedActionPermission(permissions, 'projects.tasks', 'view')",
    );
    expect(source).toContain('{controller.canViewCommissions && (');
    expect(source).toContain('{controller.canViewTasks && (');
    expect(source).toContain('value="commissions"');
    expect(source).toContain('value="tasks"');
    expect(source).toContain('<Folder className="size-4" aria-hidden="true" />');
    expect(source).toContain('<ListChecks className="size-4" aria-hidden="true" />');
    expect(source).toContain('<TasksView');
  });

  test('loads project progress hours only for the commissions tab', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();

    expect(source).toContain(
      "const shouldLoadProjectHours = selectedTab === 'commissions' && canViewCommissions;",
    );
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*if \(!shouldLoadProjectHours\) return;[\s\S]*tasksApi\.getHoursForProjects/,
    );
    expect(source).toContain('}, [projectIdsKey, shouldLoadProjectHours]);');
  });

  test('modal title is the create-new-project label only', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    // Edit mode lives in ProjectDetailView now — the dialog must never render
    // the "Edit Project" title or branch on `editingProject` anywhere.
    expect(source).toContain("controller.t('projects:projects.createNewProject')");
    expect(source).not.toMatch(/editProject/);
    expect(source).not.toMatch(/\beditingProject\b/);
  });

  test('table row click delegates to onNavigateToProject (no inline modal open)', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain('onNavigateToProject?: (projectId: string) => void');
    // The list's row click should fire navigation, not openEditModal (which no longer exists).
    expect(source).toContain('controller.onNavigateToProject');
    expect(source).toContain('(row) => controller.onNavigateToProject?.(row.id)');
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
  test('create form requires name, client, order, and a date range', async () => {
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
      "if (!orderId) newErrors.orderId = t('projects:projects.orderRequired')",
    );
    expect(source).toContain(
      "if (!startDate) newErrors.startDate = t('projects:projects.startDateRequired');",
    );
    expect(source).toContain(
      "if (!endDate) newErrors.endDate = t('projects:projects.endDateRequired');",
    );
    expect(source).toContain("newErrors.dateRange = t('projects:projects.dateRangeInvalid')");
  });

  test('exposes start date, end date, order, optional offer, and revenue inputs', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain("'project-start-date'");
    expect(source).toContain("'project-end-date'");
    expect(source).toContain('id="project-order"');
    expect(source).toContain('id="project-offer"');
    expect(source).toContain('id="project-revenue"');
    expect(source).toContain("label={controller.t('projects:projects.offerOptionalLabel')}");
  });

  test('requires a Tipo (Attivo/Passivo), exposes the selector, and forwards it (issue #784)', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    // Mandatory: submit is blocked until a value is chosen.
    expect(source).toContain("if (!tipo) newErrors.tipo = t('projects:projects.tipoRequired')");
    // The create dialog renders the required Tipo selector with a placeholder (starts empty).
    expect(source).toContain('id="project-tipo"');
    expect(source).toContain("placeholder={controller.t('projects:projects.selectTipo')}");
    // The chosen value is forwarded to the create handler.
    expect(source).toContain('tipo: tipo as ProjectTipo,');
    // And the projects list surfaces the value in its own column.
    expect(source).toContain('accessorFn: (row) => formatTipo(row.tipo)');
  });

  test('shows localized start and end dates in the commissions archive', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain(
      "import { formatDateOnlyForLocale, formatInsertDate } from '../../utils/date'",
    );
    expect(source).toContain("header: t('projects:projects.tableHeaders.startDate')");
    expect(source).toContain("header: t('projects:projects.tableHeaders.endDate')");
    expect(source).toContain("accessorKey: 'startDate'");
    expect(source).toContain("accessorKey: 'endDate'");
    expect(source).toContain('formatDateOnlyForLocale(row.startDate, i18n.language)');
    expect(source).toContain('formatDateOnlyForLocale(row.endDate, i18n.language)');
    expect(source).toContain('formatDateOnlyForLocale(String(value), i18n.language)');
  });

  test('tipo labels and values exist in both locales (issue #784)', async () => {
    const en = await Bun.file(new URL('../../../locales/en/projects.json', import.meta.url)).json();
    const it = await Bun.file(new URL('../../../locales/it/projects.json', import.meta.url)).json();
    for (const loc of [en, it]) {
      expect(loc.projects.tipo).toBeTruthy();
      expect(loc.projects.selectTipo).toBeTruthy();
      expect(loc.projects.tipoRequired).toBeTruthy();
      expect(loc.projects.tipoConfirmRequired).toBeTruthy();
      expect(loc.projects.orderRequired).toBeTruthy();
      expect(loc.projects.offerOptionalLabel).toBeTruthy();
      expect(loc.projects.noOfferLinked).toBeTruthy();
      expect(loc.projects.entityLabel).toBeTruthy();
      expect(loc.projects.tableHeaders.startDate).toBeTruthy();
      expect(loc.projects.tableHeaders.endDate).toBeTruthy();
      expect(loc.tabs.commissions).toBeTruthy();
      expect(loc.tabs.tasks).toBeTruthy();
      expect(loc.projects.tipoValues.attivo).toBeTruthy();
      expect(loc.projects.tipoValues.passivo).toBeTruthy();
      expect(loc.resales.columns.startDate).toBeTruthy();
      expect(loc.resales.columns.endDate).toBeTruthy();
      expect(loc.resales.tabs.activities).toBeTruthy();
      expect(loc.resales.selectResaleForActivities).toBeTruthy();
    }
    expect(en.resales.tabs.archive).toBe('Resales');
    expect(it.resales.tabs.archive).toBe('Rivendite');
  });

  test('revenue precedence: activity sum > manual, and read-only unless manual', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain('const resolveRevenueSource = (');
    expect(source).toContain("if (activitiesSum > 0) return 'activities';");
    expect(source).not.toContain("return 'order';");
    expect(source).toContain("readOnly={controller.revenueSource !== 'manual'}");
    expect(source).toContain(
      "const persistedRevenue = revenueSource === 'manual' && revenue ? parseFloat(revenue) : undefined;",
    );
  });

  test('manual revenue source shows no helper hint, but activities still do', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    // The manual source is omitted from the hint map (Partial) — no redundant helper text.
    expect(source).toContain('Partial<Record<RevenueSource, string>>');
    expect(source).not.toContain("manual: t('projects:projects.revenueManualHint')");
    // Informative source hints remain.
    expect(source).toContain("activities: t('projects:projects.revenueFromActivities')");
    const removedOrderHint = "order: t('projects:projects.revenueFrom" + "Order')";
    expect(source).not.toContain(removedOrderHint);
    // The hint renders through the shared FieldDescription primitive, only when present.
    expect(source).toContain('{controller.revenueHintBySource[controller.revenueSource] && (');
    expect(source).toContain('<FieldDescription className="text-xs">');
  });

  test('draft task table has editable duration and non-interactive derived totals', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain("header: t('projects:projects.duration')");
    expect(source).toContain(
      "onChange={(e) => updateDraftTask(row._id, 'duration', e.target.value)}",
    );
    expect(source).toContain("header: t('projects:projects.expectedEffort')");
    expect(source).toContain(
      'parseDraftNumber(row.monthlyEffort) * parseDraftNumber(row.duration, 1)',
    );
    expect(source).toContain('projects:projects.taskTotalRevenue');
    expect(source).toContain('<output className="flex h-8');
  });

  test('order selector auto-fills the client and disables the client picker while bound', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain(
      'const nextOrder = controller.orders.find((order) => order.id === nextOrderId);',
    );
    expect(source).toContain(
      "controller.dispatch({ type: 'setClientId', value: nextOrder.clientId });",
    );
    expect(source).toContain('disabled={Boolean(controller.selectedOrder)}');
  });

  test('offer selector filters by client and auto-fills client on select', async () => {
    const source = await Bun.file(
      new URL('../../../components/projects/ProjectsView.tsx', import.meta.url),
    ).text();
    expect(source).toContain(
      "if (offer.status !== 'sent' && offer.status !== 'accepted') return options;",
    );
    expect(source).toContain('if (clientId && offer.clientId !== clientId) return options;');
    expect(source).toContain(
      "controller.dispatch({ type: 'setClientId', value: nextOffer.clientId });",
    );
    expect(source).toContain("{ id: '', name: t('projects:projects.noOfferLinked') }");
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
