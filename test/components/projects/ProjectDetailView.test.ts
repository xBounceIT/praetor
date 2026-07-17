import { describe, expect, test } from 'bun:test';

const readSource = async () => {
  return Bun.file(
    new URL('../../../components/projects/ProjectDetailView.tsx', import.meta.url),
  ).text();
};

const readProjectTasksTableSource = async () => {
  return Bun.file(
    new URL('../../../components/projects/ProjectTasksTable.tsx', import.meta.url),
  ).text();
};

describe('ProjectDetailView wiring', () => {
  test('declares the expected ProjectDetailViewProps surface', async () => {
    const source = await readSource();
    expect(source).toContain('export interface ProjectDetailViewProps');
    for (const field of [
      'project: Project',
      'clients: Client[]',
      'companyName: string | null',
      'orders: ClientsOrder[]',
      'offers: ClientOffer[]',
      'users: User[]',
      'roles: Role[]',
      'permissions: string[]',
      'currency: string',
      'tasks: ProjectTask[]',
      'onBack: () => void',
      'onUpdateProject:',
      'onDeleteProject: (id: string) => void',
      'onAddTask:',
      'onUpdateTask:',
      'onDeleteTask:',
    ]) {
      expect(source).toContain(field);
    }
  });

  test('inline tasks table edits duration and renders derived totals as non-interactive output', async () => {
    const source = await readProjectTasksTableSource();
    expect(source).toContain("header: t('projects:projects.duration')");
    expect(source).toContain(
      "onValueChange={(value) => setTaskFieldValue(row.id, 'duration', value)}",
    );
    expect(source).not.toContain("commitTaskField(row, 'expectedEffort'");
    expect(source).toContain(
      "parseTaskNumber(row, 'monthlyEffort', 0) * parseTaskNumber(row, 'duration', 1)",
    );
    expect(source).toContain('projects:projects.taskTotalRevenue');
    expect(source).toContain('<output className="flex h-8');
  });

  test('fetches time entries server-side filtered by projectId for chart aggregations', async () => {
    const source = await readSource();
    // Must use the new projectId filter on entriesApi (added in the same change) so
    // the page doesn't pull every entry in the system to aggregate one project.
    expect(source).toMatch(/entriesApi\.listPage\(\{\s*[\s\S]*projectId:\s*project\.id/);
  });

  test('loads assigned users via projectsApi.getUsers for the team-size KPI', async () => {
    const source = await readSource();
    // Biome may reflow the call across lines; match the call shape leniently.
    expect(source).toMatch(/projectsApi[\s\S]{0,20}getUsers\(project\.id,\s*ac\.signal\)/);
  });

  test('uses the shadcn Chart wrapper (theme-aware) instead of raw recharts containers', async () => {
    const source = await readSource();
    expect(source).toContain("from '@/components/ui/chart'");
    expect(source).toContain('ChartContainer');
    expect(source).toContain('ChartTooltipContent');
  });

  test('renders four analytics charts: by user, by task, cost vs revenue, monthly activity', async () => {
    const source = await readSource();
    expect(source).toContain("t('projects:detail.charts.hoursByUser')");
    expect(source).toContain("t('projects:detail.charts.hoursByTask')");
    expect(source).toContain("t('projects:detail.charts.costVsRevenue')");
    // The hours-by-location donut was replaced with a monthly-activity bar chart.
    expect(source).toContain("t('projects:detail.charts.monthlyActivity')");
    expect(source).not.toContain('locationSplit');
  });

  test('falls back to a shadcn Empty placeholder per chart when there are no entries', async () => {
    const source = await readSource();
    expect(source).toContain("from '@/components/ui/empty'");
    expect(source).toContain('const ChartEmpty');
    expect(source.match(/<ChartEmpty\s*\/>/g) ?? []).toHaveLength(4);
  });

  test('cost KPI is gated on reports.cost.view permission', async () => {
    const source = await readSource();
    expect(source).toContain("const canViewCost = permissions.includes('reports.cost.view')");
    expect(source).toMatch(/widgetPermitted\('totalCost'\) && \(\s*<DashboardItem id="totalCost"/);
    // The gate predicate maps the cost cards to the cost permission.
    expect(source).toMatch(/id === 'totalCost' \|\| id === 'budgetUsed'\) return canViewCost/);
  });

  test('sticky save bar appears only when there are unsaved changes and update is permitted', async () => {
    const source = await readSource();
    expect(source).toContain('hasChanges && canUpdateProjects');
    expect(source).toContain("t('projects:detail.unsavedChanges')");
  });

  test('back button calls onBack', async () => {
    const source = await readSource();
    expect(source).toMatch(/onClick=\{onBack\}/);
  });

  test('delete action prompts a DeleteConfirmModal and returns to the list via onBack', async () => {
    const source = await readSource();
    expect(source).toContain('DeleteConfirmModal');
    expect(source).toContain('isOpen={isDeleteConfirmOpen}');
    expect(source).toMatch(/onDeleteProject\(project\.id\);[\s\S]{0,80}onBack\(\)/);
  });

  test('date validation stays legacy-compatible and allows open-ended internal projects', async () => {
    const source = await readSource();
    expect(source).toContain("project.tipo === 'interno' && !isInternalProject");
    expect(source).toMatch(
      /if \(\s*!isInternalProject &&\s*\(project\.startDate \|\| isConvertingInternalToCommercial\) &&\s*!startDate\s*\)/,
    );
    expect(source).toMatch(
      /if \(\s*!isInternalProject &&\s*\(project\.endDate \|\| isConvertingInternalToCommercial\) &&\s*!endDate\s*\)/,
    );
    expect(source).toContain('{isRequired && <RequiredMark />}');
    expect(source).toContain('required={isRequired}');
    expect(source).toContain('<FieldLabel htmlFor="detail-name" required>');
  });

  test('forces an explicit tipo confirmation on first edit of a rollout-defaulted project (issue #784)', async () => {
    const source = await readSource();
    // Unconfirmed (rollout-defaulted) projects need a deliberate choice; the selector
    // baseline starts EMPTY rather than silently pre-filling the 'attivo' default.
    expect(source).toContain('const tipoNeedsConfirmation = !project.tipoConfirmed;');
    expect(source).toContain('const baselineTipo = getProjectDetailBaselineTipo(project);');
    // Save is blocked until a tipo is chosen.
    expect(source).toContain(
      "if (!tipo) newErrors.tipo = t('projects:projects.tipoConfirmRequired')",
    );
    // The chosen value is sent so the server confirms the field (tipo_confirmed = true).
    expect(source).toContain('tipo: tipo as ProjectTipo,');
    // The selector + the explanatory hint render in the detail form.
    expect(source).toContain('id="detail-tipo"');
    expect(source).toContain("t('projects:projects.tipoConfirmHint')");
    // Picking a value (or any other edit) raises the save bar via the baseline comparison.
    expect(source).toContain('tipo !== baselineTipo');
  });

  test('project status selector saves status and shows the help tooltip', async () => {
    const source = await readSource();

    expect(source).toContain('const baselineStatus = project.status ?? LEGACY_PROJECT_STATUS;');
    expect(source).toContain('status !== baselineStatus');
    expect(source).toContain('id="detail-status"');
    expect(source).toContain('labelAccessory={<ProjectStatusInfoTooltip t={t} />}');
    expect(source).toContain('ProjectStatusInfoTooltip');
    expect(source).toContain('status,');
    expect(source).toContain('type={getProjectStatusBadgeType(project.status)}');
    expect(source).toContain("icon={getProjectStatusIcon(project.status, 'size-[1em]')}");
  });
  test('requires commercial links conditionally and confirms their removal for internal jobs', async () => {
    const source = await readSource();
    expect(source).toContain("const [orderId, setOrderId] = useState(project.orderId ?? '')");
    expect(source).toContain('id="detail-order"');
    expect(source).toContain(
      "if (!isInternalProject && !orderId) newErrors.orderId = t('projects:projects.orderRequired')",
    );
    expect(source).toContain("orderId !== (project.orderId ?? '')");
    expect(source).toContain('orderId: isInternalProject ? null : orderId,');
    expect(source).toContain('clientId: isInternalProject ? undefined : clientId');
    expect(source).toContain("const companyDisplayName = companyName?.trim() || 'PRAETOR'");
    expect(source).toContain('<output\n          id="detail-client"');
    expect(source).toContain('cursor-default select-none');
    expect(source).toContain('{controller.companyDisplayName}');
    expect(source).not.toContain('<Input\n          id="detail-client"');
    expect(source).not.toContain('aria-readonly="true"');
    expect(source).toContain("t('projects:projects.internalClientHint')");
    expect(source).toContain('offerId: isInternalProject ? null : offerId || null,');
    expect(source).toContain("label={t('projects:projects.offerOptionalLabel')}");
    expect(source).toContain("{ id: '', name: t('projects:projects.noOfferLinked') }");
    expect(source).toContain("nextTipo === 'interno' && (orderId || offerId)");
    expect(source).toContain('onChange={(val) => requestTipoChange(val as ProjectTipo)}');
    expect(source).toContain('<ModalDescription className="mt-0">');
    expect(source).not.toContain('requestTipoChange(val as ProjectTipo);');
    expect(source).toContain("setTipo('interno')");
    expect(source).toContain("setOrderId('')");
    expect(source).toContain("setOfferId('')");
    expect(source).toContain('isOpen={isInternalConversionOpen}');
    expect(source).toContain('internalConversionDescription');
    expect(source).toContain('isInternalProject || !linkedOrder');
  });

  test('project revenue no longer falls back to the linked order total', async () => {
    const source = await readSource();
    expect(source).toContain('const resolveRevenueSource = (');
    expect(source).toContain("if (activitiesSum > 0) return 'activities';");
    expect(source).not.toContain("return 'order';");
    expect(source).not.toContain('calculatePricingTotals');
    const removedOrderHint = "order: t('projects:projects.revenueFrom" + "Order')";
    expect(source).not.toContain(removedOrderHint);
  });

  test('team-size KPI and assignment fetch are gated on canManageAssignments', async () => {
    // GET /projects/:id/users is server-gated on `projects.assignments.update`. Without
    // that permission the fetch 403s and the KPI would show a misleading "0".
    const source = await readSource();
    expect(source).toMatch(
      /loadedAssignedKey !== assignedLoadKey[\s\S]{0,160}setAssignedUserIds\(\[\]\)/,
    );
    expect(source).toMatch(/if \(!canManageAssignments\) \{\s*return;\s*\}/);
    // The team-size card is gated via the predicate and placed via its grid item.
    expect(source).toMatch(/widgetPermitted\('teamSize'\) && \(\s*<DashboardItem id="teamSize"/);
    expect(source).toMatch(/id === 'teamSize'\) return canManageAssignments/);
  });

  test('team-size member avatars expose the full name via a hover tooltip', async () => {
    // Each assigned-user circle in the team-size KPI is wrapped in a shadcn Tooltip so the
    // initials reveal the full name on hover (and carry it as the avatar's accessible name).
    const source = await readSource();
    expect(source).toMatch(
      /assignedUsers\.slice\(0, 6\)\.map\(\(u\) => \(\s*<Tooltip key=\{u\.id\}>\s*<TooltipTrigger asChild>/,
    );
    expect(source).toMatch(/<Avatar\s+role="img"\s+aria-label=\{u\.name\}/);
    expect(source).toMatch(/<TooltipContent>\{u\.name\}<\/TooltipContent>/);
  });
});

describe('ProjectDetailView chart scaling on wide displays', () => {
  test('hours-by-user is a grouped histogram: one bar per task within each user', async () => {
    // Refactored from a donut to a grouped bar chart — X-axis groups by user,
    // and within each user one bar per task (users × tasks bars). Tasks are the
    // colored series via the shared legend.
    const source = await readSource();
    // Donut machinery is fully gone.
    expect(source).not.toMatch(/\bPieLegend\b|<Pie\b|PieChart|innerRadius/);
    // Cell / Pie / PieChart are no longer imported from recharts.
    const rechartsImport = source.match(/import \{([\s\S]*?)\} from 'recharts';/)?.[1] ?? '';
    expect(rechartsImport).not.toMatch(/\b(Cell|Pie|PieChart)\b/);
    // New per-(user,task) aggregation with capped series + groups.
    expect(source).toContain('const hoursByUserTask');
    expect(source).toMatch(/const TOP_TASK_SERIES = \d+/);
    expect(source).toMatch(/const TOP_USER_GROUPS = \d+/);
    // X-axis groups by user; tasks become synthetic series keys (t0, t1, …) so a
    // task name with dots can't be misread as a Recharts nested-path accessor.
    expect(source).toMatch(/seriesKey: `t\$\{i\}`/);
    expect(source).toMatch(/<XAxis\s+dataKey="userName"/);
    // One <Bar> per task series, grouped (no stackId), driven by the config var.
    expect(source).toMatch(/hoursByUserTask\.series\.map\(\(s\) => \(/);
    expect(source).toMatch(
      /dataKey=\{s\.seriesKey\}\s+fill=\{`var\(--color-\$\{s\.seriesKey\}\)`\}/,
    );
    expect(source).not.toMatch(/stackId="user/); // grouped, not stacked
    // Legend distinguishes the task series.
    expect(source).toMatch(/<ChartLegend content=\{<ChartLegendContent \/>\}/);
    // Task-series cap matches the 5-color chart palette so no two task series
    // collide on var(--chart-1) (a 6th series would wrap to chart-1).
    expect(source).toMatch(/const TOP_TASK_SERIES = 5;/);
    // Missing users fall back to the translated "unknown" label, not a raw UUID.
    expect(source).toMatch(
      /userName: users\.find\(\(u\) => u\.id === userId\)\?\.name \?\? unknownLabel/,
    );
    // Custom tooltip lists only non-zero tasks (+ total), not a row per series.
    expect(source).toContain('const UserTaskTooltip');
    expect(source).toMatch(/<UserTaskTooltip\s+series=\{hoursByUserTask\.series\}/);
    expect(source).toMatch(/if \(typeof p\.value !== 'number' \|\| p\.value <= 0\) return acc/);
    expect(source).toContain("t('projects:detail.charts.totalLabel')");
  });

  test('hours-by-user seeds assigned members so 0-hour users still appear', async () => {
    // Users who are on the project but haven't logged time should still show
    // (as 0-hour bars), like hours-by-task seeds planned tasks. The old
    // `total > 0` filter dropped them entirely.
    const source = await readSource();
    // Candidate set = assigned roster ∪ users who logged time.
    expect(source).toMatch(
      /const candidateIds = new Set<string>\(\[\.\.\.assignedUserIds, \.\.\.byUser\.keys\(\)\]\)/,
    );
    // The 0-hour exclusion is gone.
    expect(source).not.toMatch(/if \(total > 0\) userTotals\.set/);
    // Active users first, 0-hour members last in stable name order.
    expect(source).toMatch(
      /b\.total - a\.total \|\| a\.userName\.localeCompare\(b\.userName, i18n\.language\)/,
    );
    // assignedUserIds is now a dependency so the chart updates when the roster loads.
    expect(source).toMatch(/\}, \[entries, tasks, users, assignedUserIds, t, i18n\.language\]\)/);
    // Empty when nobody logged hours (no task series) even if members are seeded.
    expect(source).toMatch(
      /hoursByUserTask\.rows\.length === 0 \|\| hoursByUserTask\.series\.length === 0/,
    );
  });

  test('the two wide charts default to a 6-of-12 column footprint to scale', async () => {
    // The per-user grouped histogram (users × tasks bars) and the monthly
    // timeline are the wide charts; they default to a 6-column width on the
    // 12-column grid so the bars have room. Size is now owned by the dashboard
    // layout (the widget registry's default rectangle) and freely resizable by
    // dragging. Long user names are truncated on the axis (full name in tooltip).
    const source = await readSource();
    expect(source).toMatch(/id: 'hoursByUser', x: \d+, y: \d+, w: 6,/);
    expect(source).toMatch(/id: 'monthlyActivity', x: \d+, y: \d+, w: 6,/);
    expect(source).toMatch(/tickFormatter=\{\(v: string\) => \(v\.length > 16 \?/);
  });

  test('monthly-activity falls back to ChartEmpty when all months are zero', async () => {
    // The replaced location chart guarded the all-zero case; the new monthly
    // chart must too — only zero-duration entries should read as no data, not a
    // flat empty plot.
    const source = await readSource();
    expect(source).toMatch(
      /monthlyActivity\.rows\.length === 0 \|\|\s*monthlyActivity\.rows\.every\(\(r\) => r\.hours === 0\)/,
    );
  });

  test('analytics section gets a header with the scope notice inlined beside it', async () => {
    // Previously the partial-scope warning sat as a full-width banner above the
    // KPIs with no header pointing at the section it qualified. The new layout
    // adds a "Project analytics" header that mirrors the "Project tasks" pattern
    // and places the scope notice on the right side of the same row.
    const source = await readSource();
    expect(source).toContain("t('projects:detail.analyticsTitle')");
    expect(source).toContain("t('projects:detail.analyticsDescription')");
    // The notice that holds `partialScope` should now render inside the header
    // row's right column. We assert the partialScope notice comes AFTER the
    // analytics title (not before, as it used to as a full-width banner).
    const titleIdx = source.indexOf("t('projects:detail.analyticsTitle')");
    const partialIdx = source.indexOf('detail.notices.partialScope');
    expect(titleIdx).toBeGreaterThan(0);
    expect(partialIdx).toBeGreaterThan(titleIdx);
    // And the gap between them is small enough to belong to the same section
    // (the whole header + notices stack), not a different region of the file.
    // Three notice chips with tabIndex/role/aria-label + joined fallback text
    // expanded the header region — 4500 chars covers it.
    expect(partialIdx - titleIdx).toBeLessThan(4500);
  });

  test('scope notice renders as a one-line chip with a Tooltip for the full text', async () => {
    // Previously the notice was a multi-line bordered card that pushed the right
    // column tall (3 wrapped lines on 1440px). The redesign collapses it to a
    // single-line truncating chip; the full message moves into a Tooltip so the
    // header row keeps the same height as the header itself.
    const source = await readSource();
    // The header row is vertically centered (sm:items-center) so the chip
    // aligns with the title beside the 2-line header.
    expect(source).toMatch(
      /sm:flex-row sm:items-center sm:justify-between[\s\S]{0,200}analyticsTitle/,
    );
    // Scope the rest of the assertions to the header region so we don't pick
    // up unrelated `Tooltip` / `truncate` usage elsewhere in the file.
    const headerStart = source.indexOf('Analytics section header');
    const kpiStart = source.indexOf('Free-form analytics grid');
    expect(headerStart).toBeGreaterThan(0);
    expect(kpiStart).toBeGreaterThan(headerStart);
    const headerRegion = source.slice(headerStart, kpiStart);
    // No more px-4 py-3 multi-line boxes — chips use px-2.5 py-1.5.
    expect(headerRegion).not.toMatch(/px-4 py-3/);
    // The chip text span truncates instead of wrapping.
    expect(headerRegion).toMatch(/<span className="truncate/);
    // Tooltip is the disclosure mechanism for the full description.
    expect(headerRegion).toContain('<Tooltip>');
    expect(headerRegion).toContain('<TooltipContent>');
    // partialScope appears at least twice: once in the chip's text, once
    // inside the tooltip content (so the full message stays accessible).
    const partialMatches = headerRegion.match(/detail\.notices\.partialScope/g) ?? [];
    expect(partialMatches.length).toBeGreaterThanOrEqual(2);
  });

  test('hours-by-task seeds aggregation with project tasks so 0-hour bars surface', async () => {
    // Without seeding, the aggregation iterates only entries — so a task that
    // has never been worked on never appears. Users expect "hours by task" to
    // list every task on the project, with the unworked ones at 0.
    const source = await readSource();
    expect(source).toMatch(
      /for \(const pt of tasks\)\s*\{\s*if \(pt\.projectId === project\.id\) hoursByKey\.set\(pt\.id, 0\)/,
    );
    // And the empty-state guard no longer fires when every row is 0 — that
    // case is exactly the "tasks exist but no entries yet" case we want to
    // surface, not hide behind ChartEmpty.
    expect(source).not.toMatch(/hoursByTask\.every\(\(r\) => r\.hours === 0\)/);
    // Secondary sort by name keeps the 0-hour tail stable instead of relying
    // on Map insertion order.
    expect(source).toMatch(
      /b\.hours - a\.hours \|\| a\.task\.localeCompare\(b\.task, i18n\.language\)/,
    );
  });

  test('cost-vs-revenue card is always rendered, even with no entries and no revenue', async () => {
    // Two `return null` short-circuits at the top of the IIFE used to hide the
    // whole card when the project had no cost data AND no displayed revenue —
    // so a freshly-created project (no entries, no revenue) silently lost the
    // chart. Users expect to see "Cost vs Revenue" listed regardless; ChartEmpty
    // covers the "nothing to plot yet" state inside the card.
    const source = await readSource();
    expect(source).not.toMatch(
      /if \(!hasEntryTimeline && !canViewCost && displayedRevenue === 0\) return null/,
    );
    expect(source).not.toMatch(
      /if \(canViewCost && !hasEntryTimeline && displayedRevenue === 0\) return null/,
    );
    // The new flag drives the empty-state guard instead of the raw chartData length.
    expect(source).toMatch(
      /const hasChartContent = canShowCostArea \|\| \(canShowRevenueLine && chartData\.length > 0\)/,
    );
    // Empty branch now distinguishes the no-cost-permission case (cost-hidden
    // placeholder) from the genuine no-data case (ChartEmpty).
    expect(source).toMatch(/!hasChartContent\s*\?\s*\(\s*\/\/[\s\S]*?!canViewCost\s*\?\s*\(/);
    // The Area / ReferenceLine renderers use the precomputed flags so the
    // visibility rules stay in one place.
    expect(source).toMatch(/\{canShowCostArea && \(/);
    expect(source).toMatch(/\{canShowRevenueLine && \(/);
  });

  test('cost-vs-revenue YAxis domain extends to include the revenue reference line', async () => {
    // The revenue line sat above the cost-only auto-scaled domain, so Recharts
    // discarded it (revenue never appeared on the chart). The YAxis domain max
    // must fold in displayedRevenue so the line is always within range.
    const source = await readSource();
    expect(source).toMatch(
      /domain=\{\[\s*0,\s*\(dataMax: number\) =>[\s\S]*?Math\.max\(dataMax, canShowRevenueLine \? displayedRevenue : 0\)/,
    );
  });

  test('cost-vs-revenue tooltip formats values with the currency symbol', async () => {
    // Default ChartTooltipContent renders a bare value with no currency and crams it
    // against the label ("Costo cumulato2505"). A localized formatter
    // adds the project currency and proper spacing.
    const source = await readSource();
    // A formatter is passed to the cost-vs-revenue tooltip.
    expect(source).toMatch(/formatter=\{\(value, name, item\) =>/);
    // The formatted numeric value appends the currency with a space.
    expect(source).toMatch(
      /formatNumber\(value, \{ maximumFractionDigits: 0 \}\)\}\s*\$\{currency\}/,
    );
  });

  test('missing-rights / load-failed charts render a locked placeholder, not a generic empty state', async () => {
    // The user still wants to perceive that "a chart is here" even when their
    // role can't load the entries — replacing the chart with a generic
    // ChartEmpty hides the page structure and forces the user to read the
    // copy to understand the chart even existed. New pattern: a chart-shaped
    // dashed placeholder + a centered warning chip that mirrors the analytics
    // section header chip style.
    const source = await readSource();
    // The new component is defined.
    expect(source).toContain('const ChartLocked');
    // ChartEmpty is no longer used for the error/permission variants — only
    // the bare `<ChartEmpty />` (genuine "no entries" empty state) remains.
    expect(source).not.toMatch(/<ChartEmpty variant=/);
    // All four data-driven chart sections use ChartLocked when entriesError is
    // set: by-user, by-task, cost-vs-revenue, monthly-activity. (The 5th use is
    // the cost-hidden variant, asserted separately.)
    const lockedUses = source.match(/<ChartLocked variant=\{entriesError\}/g) ?? [];
    expect(lockedUses.length).toBe(4);
    // Now that every chart is rectangular (no donuts left), ChartLocked dropped
    // its `shape` prop and always renders the rect dashed placeholder.
    expect(source).not.toMatch(/shape="(donut|rect)"/);
    expect(source).not.toMatch(/rounded-full border-\[26px\]/);
    expect(source).toMatch(
      /h-\[260px\] w-full rounded-lg border-2 border-dashed border-muted\/40 xl:h-\[320px\]/,
    );
    // Warning chip uses the same forbidden/failed copy as the section-header chip.
    expect(source).toMatch(/detail\.notices\.forbiddenTitle/);
    expect(source).toMatch(/detail\.notices\.loadFailedTitle/);
  });

  test('cost-vs-revenue shows a cost-hidden placeholder (not "no hours") when the user lacks cost permission', async () => {
    // Repro: a user without reports.cost.view (e.g. a top manager whose role
    // wasn't granted it) sees the server strip cost to 0 → hasEntryTimeline
    // false → with no revenue, hasChartContent false → the card used to render
    // ChartEmpty ("no hours logged yet") even though entries exist (the Total
    // Hours KPI above shows them), AND the costHiddenNote rendered beside it.
    // The two messages contradicted each other. Fix: a dedicated cost-hidden
    // ChartLocked variant replaces the misleading empty state, and the
    // standalone note only renders when the chart actually has content.
    const source = await readSource();
    // New ChartLocked variant + its cost-specific copy.
    expect(source).toMatch(/variant: 'forbidden' \| 'failed' \| 'cost-hidden';/);
    expect(source).toContain('detail.empty.costHiddenTitle');
    expect(source).toMatch(/<ChartLocked variant="cost-hidden" \/>/);
    // The empty branch chooses cost-hidden vs ChartEmpty on !canViewCost.
    expect(source).toMatch(/!canViewCost \? \(\s*<ChartLocked variant="cost-hidden"/);
    // The standalone note is now gated on hasChartContent so it never shows
    // alongside the cost-hidden placeholder (no double / contradictory message).
    expect(source).toMatch(
      /!canViewCost &&\s*!entriesLoading &&\s*entriesError === null &&\s*hasChartContent &&/,
    );
  });

  test('costHiddenTitle exists in both locales', async () => {
    const en = await Bun.file(new URL('../../../locales/en/projects.json', import.meta.url)).json();
    const it = await Bun.file(new URL('../../../locales/it/projects.json', import.meta.url)).json();
    expect(en.detail.empty.costHiddenTitle).toBeTruthy();
    expect(it.detail.empty.costHiddenTitle).toBeTruthy();
  });

  test('scope-notice chips are keyboard-focusable and carry an aria-label fallback', async () => {
    // <TooltipTrigger asChild> on a plain <div> isn't focusable — keyboard
    // and SR users couldn't access the full notice description that the
    // pre-chip banner exposed inline. Each of the three chip variants
    // (forbidden, failed, partial-scope) is now a <button type="button">
    // — naturally focusable, Radix Tooltip opens on focus, and Biome's
    // a11y/noNoninteractiveTabindex rule is satisfied.
    const source = await readSource();
    const headerStart = source.indexOf('Analytics section header');
    const kpiStart = source.indexOf('KPI cards + project timeline');
    const headerRegion = source.slice(headerStart, kpiStart);
    const buttonElements = headerRegion.match(/<button\s/g) ?? [];
    expect(buttonElements.length).toBe(3);
    const buttonTypes = headerRegion.match(/type="button"/g) ?? [];
    expect(buttonTypes.length).toBe(3);
    expect(headerRegion).toContain(
      "aria-label={t('projects:detail.notices.forbiddenDescription')}",
    );
    expect(headerRegion).toContain(
      "aria-label={t('projects:detail.notices.loadFailedDescription')}",
    );
  });

  test('scope-notice chip joins truncated + partialScope when both are active', async () => {
    // The old ternary `entriesTruncated ? truncated : partialScope` hid one
    // message behind hover-only Tooltip when both flags were true. The new
    // chip joins both with ' · ' so the visible text always reflects all
    // active warnings.
    const source = await readSource();
    expect(source).not.toMatch(
      /<span className="truncate">\s*\{entriesTruncated\s*\?\s*t\('projects:detail\.notices\.truncated'/,
    );
    // The chip text array contains both messages and joins on ' · '. Biome may
    // reflow .filter(Boolean) and .join('·') onto separate lines, so allow
    // whitespace between the two calls.
    expect(source).toMatch(/\.filter\(Boolean\)\s*\.join\(' · '\)/);
  });

  test('ChartLocked renders the description copy inline, not just the title', async () => {
    // Old ChartEmpty variant='forbidden|failed' rendered EmptyTitle AND
    // EmptyDescription. ChartLocked initially only rendered the title chip
    // — sighted and SR users lost the "why" context. The chip now shows
    // title + description as a two-line callout, and the wrapper is
    // <output>/aria-live=polite so SR users hear it when it appears.
    const source = await readSource();
    expect(source).toContain('detail.notices.forbiddenDescription');
    expect(source).toContain('detail.notices.loadFailedDescription');
    // ChartLocked block exposes both pieces of copy + the live region.
    const lockedStart = source.indexOf('const ChartLocked');
    const lockedEnd = source.indexOf('const ChartEmpty');
    const lockedRegion = source.slice(lockedStart, lockedEnd);
    expect(lockedRegion).toContain('detail.notices.forbiddenDescription');
    expect(lockedRegion).toContain('detail.notices.loadFailedDescription');
    expect(lockedRegion).toMatch(/<output className="relative block" aria-live="polite"/);
  });

  test('hours-by-task is a planned-vs-actual utilization stack (logged + remaining + over)', async () => {
    // Each bar shows logged hours filling the available effort (expectedEffort),
    // with overrun on top — so users see actual against the budget in one bar.
    const source = await readSource();
    // Aggregation derives the three segments from actual hours vs expectedEffort.
    expect(source).toMatch(/expectedEffort/);
    expect(source).toMatch(/const logged = expected > 0 \? Math\.min\(actual, expected\) : actual/);
    expect(source).toMatch(/const remaining = Math\.max\(0, round\(expected - actual\)\)/);
    expect(source).toMatch(
      /const over = expected > 0 \? Math\.max\(0, round\(actual - expected\)\) : 0/,
    );
    // Three Bars share one stackId so the segments form a single column.
    // (Match dataKey + stackId independently — Biome may reflow a <Bar> across
    // lines, so don't require them on the same physical line.)
    expect((source.match(/stackId="effort"/g) ?? []).length).toBe(3);
    for (const seg of ['logged', 'remaining', 'over']) {
      expect(source).toContain(`dataKey="${seg}"`);
    }
    // Config exposes the three semantic series (not a per-task palette).
    expect(source).toMatch(/logged: \{ label: t\('projects:detail\.charts\.loggedLabel'\)/);
    expect(source).toMatch(/remainingEffortLabel/);
    expect(source).toMatch(/overBudgetLabel/);
    // A legend distinguishes the segments.
    expect(source).toMatch(/<ChartLegend content=\{<ChartLegendContent \/>\}/);
  });

  test('hours-by-task top label shows actual hours and is suppressed at 0', async () => {
    // The numeric label sits at the top of the stack showing actual logged hours
    // (read from the row by index), and renders nothing for zero-hour bars so a
    // project of planned-but-unworked tasks doesn't show a forest of '0's.
    const source = await readSource();
    expect(source).toMatch(/const row = hoursByTask\[index\]/);
    expect(source).toMatch(/if \(!row \|\| row\.hours <= 0\) return null/);
  });

  test('hours-by-task tooltip summarises logged vs total effort, not raw stack values', async () => {
    const source = await readSource();
    expect(source).toContain('const TaskEffortTooltip');
    expect(source).toMatch(/content=\{<TaskEffortTooltip t=\{t\} \/>\}/);
    expect(source).toContain("t('projects:detail.charts.totalEffortLabel')");
  });

  test('monthly-activity chart replaces hours-by-location with a cadence bar chart', async () => {
    // The hours-by-location donut was low value; it's replaced by a monthly
    // logged-hours bar chart (project pace/momentum) with a dashed average line.
    const source = await readSource();
    // Location machinery is fully removed.
    expect(source).not.toMatch(/locationSplit|locationConfig|hoveredLocationKey/);
    // New monthly aggregation: chronological buckets + a mean baseline.
    expect(source).toContain('const monthlyActivity');
    expect(source).toMatch(/const avg = rows\.length > 0 \?/);
    // Chronological (left-to-right trend), not sorted by size.
    expect(source).toMatch(/\.sort\(\(\[a\], \[b\]\) => a\.localeCompare\(b\)\)/);
    // Renders a bar chart driven by the new config + the avg ReferenceLine.
    expect(source).toContain("t('projects:detail.charts.monthlyActivity')");
    expect(source).toMatch(/config=\{activityChartConfig\}/);
    expect(source).toMatch(/monthlyActivity\.avg > 0 && \(/);
    expect(source).toContain("t('projects:detail.charts.avgMonthlyLabel')");
  });

  test('bar and area charts grow taller on xl screens', async () => {
    // 260px is fine on a laptop; on a 2K monitor the chart looks squat. Bump
    // height at xl while keeping the original height for smaller viewports.
    const source = await readSource();
    expect(source).toMatch(/h-\[260px\][^"']*xl:h-\[320px\]/);
    expect(source).toMatch(/max-h-\[260px\][^"']*xl:max-h-\[320px\]/);
  });
});

describe('ProjectDetailView wired into App.tsx', () => {
  test("'projects/detail' is a valid view in App.tsx routing", async () => {
    const source = await Bun.file(new URL('../../../App.tsx', import.meta.url)).text();
    expect(source.match(/'projects\/detail'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain('selectedProjectId');
  });

  test('gates row navigation and loads the full project from the detail endpoint', async () => {
    const source = await Bun.file(new URL('../../../App.tsx', import.meta.url)).text();
    expect(source).toContain('const canOpenProjectDetails = canViewProjectDetails');
    expect(source).toMatch(/onNavigateToProject=\{[\s\S]*canOpenProjectDetails/);
    expect(source).toContain('.get(selectedProjectId, abortController.signal)');
    expect(source).toContain('if (!selectedProject) return <ModulePendingScreen />');
    expect(source).toContain("toastError(t('projects:detail.loadFailed'))");
    expect(source).toContain("setActiveView('projects/manage')");
  });

  test('App.tsx clears selectedProjectId on navigation away from projects/detail', async () => {
    const source = await Bun.file(new URL('../../../App.tsx', import.meta.url)).text();
    expect(source).toContain("if (resolved !== 'projects/detail')");
    expect(source).toContain('setSelectedProjectId(null)');
  });
});

describe('ProjectDetailView dashboard customization', () => {
  test('renders the Edit + Views controls in the analytics header', async () => {
    const source = await readSource();
    // The toolbar is delegated to DashboardControls, fed by the layout hook.
    expect(source).toContain("import DashboardControls from './DashboardControls'");
    expect(source).toContain('<DashboardControls controls={dashboard} />');
    // Two-tier: global default id + the per-project override key (project.id).
    // Permission-gated cards are filtered out of the active def set first. The hook
    // now also takes the authenticated user id (server-backed shareable views) so
    // ownership/share access is resolved per viewer.
    expect(source).toContain(
      'useDashboardLayout(DASHBOARD_ID, project.id, activeWidgetDefs, currentUserId)',
    );
    // currentUserId flows from the CurrentUserId context — the same source the
    // DashboardControls views menu (and the ShareViewModal it opens) reads to gate
    // owner-only actions — rather than being prop-drilled through the page.
    expect(source).toContain("import { useCurrentUserId } from '../../contexts/useCurrentUserId'");
    expect(source).toContain('const currentUserId = useCurrentUserId();');
  });

  test('declares the canonical widget set as grid rectangles (x/y/w/h + minimums)', async () => {
    const source = await readSource();
    // Every placeable card — the four KPIs, the timeline, and the four charts.
    for (const id of [
      'totalHours',
      'totalCost',
      'teamSize',
      'budgetUsed',
      'timeline',
      'hoursByUser',
      'hoursByTask',
      'costVsRevenue',
      'monthlyActivity',
    ]) {
      expect(source).toMatch(
        new RegExp(`id: '${id}', x: \\d+, y: \\d+, w: \\d+, h: \\d+, minW: \\d+, minH: \\d+`),
      );
    }
  });

  test('places every card through a DashboardItem inside the DashboardGrid', async () => {
    const source = await readSource();
    expect(source).toContain("import DashboardGrid, { DashboardItem } from './DashboardGrid'");
    // The old per-chart frame component is gone.
    expect(source).not.toContain('DashboardWidgetFrame');
    // One grid wrapping all nine placeable cards.
    expect(source.match(/<DashboardGrid/g)?.length ?? 0).toBe(1);
    for (const id of [
      'totalHours',
      'totalCost',
      'teamSize',
      'budgetUsed',
      'timeline',
      'hoursByUser',
      'hoursByTask',
      'costVsRevenue',
      'monthlyActivity',
    ]) {
      expect(source).toContain(`<DashboardItem id="${id}"`);
    }
  });

  test('permission-gated cards are filtered out of the active layout defs', async () => {
    const source = await readSource();
    // A single `widgetPermitted` predicate is the source of truth for the gate,
    // used both to filter the def set and to gate the JSX (so they can't drift).
    expect(source).toContain('const widgetPermitted = useCallback(');
    expect(source).toContain('const activeWidgetDefs = useMemo(');
    expect(source).toContain('DASHBOARD_WIDGETS.filter((d) => widgetPermitted(d.id))');
  });

  test('drag/resize is wired from the grid back to the layout hook', async () => {
    const source = await readSource();
    expect(source).toContain('onMove={dashboard.moveWidget}');
    expect(source).toContain('onResize={dashboard.resizeWidget}');
    expect(source).toContain('onToggleHidden={dashboard.toggleHidden}');
  });

  test('every dashboard card fills its grid cell (h-full) so no black strip shows below it', async () => {
    const source = await readSource();
    // KPI stat cards and the timeline card must stretch to the cell height, like
    // the charts already do — otherwise short content leaves a transparent gap.
    expect(source).toContain('<Card className="h-full gap-3">'); // KpiCard
    expect(source).toMatch(/id="timeline"[\s\S]{0,120}<Card className="h-full">/); // timeline
    // KPI cells are tall enough (h3 + minH3) to fit the team-size avatar footer.
    expect(source).toMatch(/id: 'teamSize', x: \d+, y: \d+, w: \d+, h: 3, minW: \d+, minH: 3/);
  });

  test('mixed projects can still see and edit the project-level billing frequency (issue #785)', async () => {
    const source = await readSource();
    // The frequency is a single project-level value new quick-added tasks inherit, so unlike the
    // billing TYPE it must NOT be gated on `mixed`: it shows the real stored value and stays
    // editable. (The value/disabled props are bound to the detail-billing-frequency control.)
    expect(source).toMatch(/id="detail-billing-frequency"[\s\S]{0,140}value=\{billingFrequency\}/);
    expect(source).toMatch(
      /id="detail-billing-frequency"[\s\S]{0,400}disabled=\{!canUpdateProjects\}/,
    );
    // Saving a frequency edit on a mixed project persists only the frequency (the local
    // billingType is a coerced default for a mixed project, so it must not be written).
    expect(source).toContain('} else if (projectBillingChanged) {');
    expect(source).toMatch(
      /else if \(projectBillingChanged\) \{[\s\S]{0,260}updates\.billingFrequency = billingFrequency;/,
    );
  });
});
