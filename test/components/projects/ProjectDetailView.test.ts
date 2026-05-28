import { describe, expect, test } from 'bun:test';

const readSource = async () => {
  return Bun.file(
    new URL('../../../components/projects/ProjectDetailView.tsx', import.meta.url),
  ).text();
};

describe('ProjectDetailView wiring', () => {
  test('declares the expected ProjectDetailViewProps surface', async () => {
    const source = await readSource();
    expect(source).toContain('export interface ProjectDetailViewProps');
    for (const field of [
      'project: Project',
      'clients: Client[]',
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

  test('renders four analytics charts: by user, by task, cost vs revenue, by location', async () => {
    const source = await readSource();
    expect(source).toContain("t('projects:detail.charts.hoursByUser')");
    expect(source).toContain("t('projects:detail.charts.hoursByTask')");
    expect(source).toContain("t('projects:detail.charts.costVsRevenue')");
    expect(source).toContain("t('projects:detail.charts.locationSplit')");
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
    expect(source).toMatch(/canViewCost &&[\s\S]{0,80}<KpiCard[\s\S]{0,200}totalCost/);
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

  test('date-required validation skips legacy projects without stored dates', async () => {
    // Hard-requiring dates on save would block rename/recolor/disable for projects
    // created before the dates-required rule. Validation only fires when the project
    // already carries the corresponding date.
    const source = await readSource();
    expect(source).toContain('if (project.startDate && !startDate)');
    expect(source).toContain('if (project.endDate && !endDate)');
    // Required marker also tracks the stored value so the UI doesn't lie.
    expect(source).toContain('{project.startDate && <RequiredMark />}');
    expect(source).toContain('{project.endDate && <RequiredMark />}');
  });

  test('team-size KPI and assignment fetch are gated on canManageAssignments', async () => {
    // GET /projects/:id/users is server-gated on `projects.assignments.update`. Without
    // that permission the fetch 403s and the KPI would show a misleading "0".
    const source = await readSource();
    expect(source).toMatch(/if \(!canManageAssignments\)[\s\S]{0,200}setAssignedUserIds\(\[\]\)/);
    expect(source).toMatch(
      /\{canManageAssignments && \(\s*<KpiCard[\s\S]{0,400}detail\.kpi\.teamSize/,
    );
  });
});

describe('ProjectDetailView chart scaling on wide displays', () => {
  test('donut charts use a fluid square container, not a fixed 300px box', async () => {
    // On 2K monitors the old `mx-auto size-[300px]` left the donut floating in
    // empty card space and absolute-positioned the legend at `w-[170px]` in the
    // top-right corner. The fluid layout grows both pieces with the card.
    const source = await readSource();
    expect(source).not.toMatch(/size-\[300px\]/);
    expect(source).not.toMatch(/w-\[170px\]/);
    expect(source).toMatch(/aspect-square[^"']*max-w-\[320px\][^"']*sm:max-w-\[400px\]/);
    // Pie inner/outer radius switched to percentages so the hole scales with
    // the container. Hard-coded `innerRadius={70}` would not.
    expect(source).toContain('innerRadius="55%"');
    expect(source).toContain('outerRadius="85%"');
  });

  test('donut legends drop the compact mode at this scale', async () => {
    // Both donut callers were passing `compact` to shrink the legend to a
    // top-right annotation. With the chart and legend now sharing the card
    // width, neither caller should keep compact mode — text-xs (not text-[10px])
    // is the readable default.
    const source = await readSource();
    const legendCalls = source.match(/<PieLegend[\s\S]*?\/>/g) ?? [];
    expect(legendCalls).toHaveLength(2);
    for (const call of legendCalls) {
      expect(call).not.toMatch(/\bcompact\b/);
    }
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
    expect(partialIdx - titleIdx).toBeLessThan(3000);
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
    const kpiStart = source.indexOf('KPI cards + project timeline');
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
    expect(source).toMatch(/b\.hours - a\.hours \|\| a\.task\.localeCompare\(b\.task\)/);
  });

  test('donut legend value and share columns inherit the slice color', async () => {
    // The swatch already keys off `var(--color-${row.key})`. Coloring the
    // numeric columns the same way binds each row's value/share to its donut
    // wedge visually, not just to the small swatch chip.
    const source = await readSource();
    // Old neutral colors should be gone from the numeric columns.
    expect(source).not.toMatch(/tabular-nums text-muted-foreground \$\{valueCol\}/);
    expect(source).not.toMatch(/font-medium tabular-nums text-foreground \$\{shareCol\}/);
    // Both numeric columns now style their color from the row key.
    expect(source).toMatch(
      /className=\{`tabular-nums \$\{valueCol\}`\}\s*style=\{\{ color: `var\(--color-\$\{row\.key\}\)` \}\}/,
    );
    expect(source).toMatch(
      /className=\{`font-medium tabular-nums \$\{shareCol\}`\}\s*style=\{\{ color: `var\(--color-\$\{row\.key\}\)` \}\}/,
    );
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

  test('App.tsx clears selectedProjectId on navigation away from projects/detail', async () => {
    const source = await Bun.file(new URL('../../../App.tsx', import.meta.url)).text();
    expect(source).toContain("if (resolved !== 'projects/detail')");
    expect(source).toContain('setSelectedProjectId(null)');
  });
});
