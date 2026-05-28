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
