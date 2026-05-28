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
    // Donut sized 360/420/480 — large enough to dominate, small enough to leave
    // breathing room for the absolute-positioned legend at xl widths without
    // having the legend overlap the donut's right wedges on sub-2K displays.
    expect(source).toMatch(/aspect-square[^"']*max-w-\[360px\][^"']*sm:max-w-\[420px\]/);
    // Pie inner/outer radius switched to percentages so the hole scales with
    // the container. Hard-coded `innerRadius={70}` would not.
    expect(source).toContain('innerRadius="55%"');
    expect(source).toContain('outerRadius="85%"');
  });

  test('donut legends pass compact so the corner annotation reads as small', async () => {
    // The legend now floats in the top-right corner of the chart area as a
    // small annotation, so `compact` typography (text-[10px], tight gaps,
    // smaller swatch) is correct again. Without it the floating annotation
    // would render too loud relative to the centered donut.
    const source = await readSource();
    const legendCalls = source.match(/<PieLegend[\s\S]*?\/>/g) ?? [];
    expect(legendCalls).toHaveLength(2);
    for (const call of legendCalls) {
      expect(call).toMatch(/\bcompact\b/);
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
    expect(source).toMatch(
      /b\.hours - a\.hours \|\| a\.task\.localeCompare\(b\.task, i18n\.language\)/,
    );
  });

  test('donut legend rows carry an explicit color since they render outside ChartContainer', async () => {
    // shadcn's ChartContainer sets `--color-<key>` CSS vars on its own root —
    // those vars don't resolve outside it. The legend sits as a sibling div,
    // so it needs the slice color passed in explicitly (here we use the same
    // var(--chart-N) palette index the Pie Cells use).
    const source = await readSource();
    // Both callsites pass a color per row tied to the row's palette index.
    const callsites = source.match(/color: `var\(--chart-\$\{\(idx % 5\) \+ 1\}\)`/g) ?? [];
    expect(callsites.length).toBeGreaterThanOrEqual(2);
    // The PieLegend row type requires `color` (not optional) so callers can't
    // silently regress to the broken "no color in scope" state.
    expect(source).toMatch(
      /rows: ReadonlyArray<\{ key: string; label: string; value: number; color: string \}>/,
    );
  });

  test('donut legend numeric columns use muted-foreground, not the slice color', async () => {
    // The swatch chip carries the color signal per row; the numbers (hours
    // and %) read as secondary muted text so the legend doesn't compete
    // visually with the donut wedges. The earlier "values match slice color"
    // approach made the legend feel loud at the floating-corner size.
    const source = await readSource();
    // No more inline `color: row.color` on numeric columns. (Swatch's
    // `backgroundColor: row.color` is a different style key and unaffected.)
    expect(source).not.toMatch(/style=\{\{ color: row\.color \}\}/);
    // Both numeric columns use text-muted-foreground via className.
    expect(source).toMatch(/className=\{`tabular-nums text-muted-foreground \$\{valueCol\}`\}/);
    expect(source).toMatch(
      /className=\{`font-medium tabular-nums text-muted-foreground \$\{shareCol\}`\}/,
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
    expect(source).toMatch(/\)\s*:\s*!hasChartContent\s*\?\s*\(\s*<ChartEmpty/);
    // The Area / ReferenceLine renderers use the precomputed flags so the
    // visibility rules stay in one place.
    expect(source).toMatch(/\{canShowCostArea && \(/);
    expect(source).toMatch(/\{canShowRevenueLine && \(/);
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
    // All four chart sections use ChartLocked when entriesError is set.
    const lockedUses = source.match(/<ChartLocked variant=/g) ?? [];
    expect(lockedUses.length).toBe(4);
    // Both shapes are exercised (2 donuts, 2 rect for bar + area).
    const donutUses = source.match(/<ChartLocked[^/]*shape="donut"/g) ?? [];
    const rectUses = source.match(/<ChartLocked[^/]*shape="rect"/g) ?? [];
    expect(donutUses.length).toBe(2);
    expect(rectUses.length).toBe(2);
    // The placeholder visually echoes the live chart geometry (donut → dashed
    // ring sized to mx-auto; rect → dashed h-[260px] xl:h-[320px] box).
    expect(source).toMatch(/rounded-full border-\[26px\] border-dashed/);
    expect(source).toMatch(
      /h-\[260px\] w-full rounded-lg border-2 border-dashed border-muted\/40 xl:h-\[320px\]/,
    );
    // Warning chip uses the same forbidden/failed copy as the section-header chip.
    expect(source).toMatch(/detail\.notices\.forbiddenTitle/);
    expect(source).toMatch(/detail\.notices\.loadFailedTitle/);
  });

  test('donut chart is centered with a legend overlaid in the top-right corner', async () => {
    // The pair-with-justify-center layout still left visible empty bands on
    // both sides of the card on wide displays. New layout: the chart is the
    // dominant centered visual (mx-auto) inside a relative wrapper, and the
    // legend pops out of flow to overlay the top-right corner on sm+. On
    // mobile the legend stacks below the chart full-width.
    const source = await readSource();
    // Old flex-row pair layout is gone.
    expect(source).not.toMatch(/sm:flex-row sm:items-center sm:justify-center/);
    expect(source).not.toMatch(/w-full sm:w-72 xl:w-80/);
    // Donut max-w cap: 480px on xl (was 560px) so the absolute legend at
    // right-0 doesn't overlap the donut's right wedges on sub-2K cards.
    expect(source).not.toMatch(/xl:max-w-\[560px\]/);
    // Both ChartContainers + the ChartLocked donut placeholder share the same
    // geometry tokens so the locked state matches the live chart's footprint.
    const chartCtns =
      source.match(
        /mx-auto aspect-square[^"]*max-w-\[360px\][^"]*sm:max-w-\[420px\][^"]*xl:max-w-\[480px\]/g,
      ) ?? [];
    expect(chartCtns.length).toBe(3);
    // Both legend wrappers overlay the top-right corner on sm+ and stack on
    // mobile (mt-4 fallback gap).
    const overlayWrappers =
      source.match(/mt-4 w-full sm:absolute sm:right-0 sm:top-0 sm:mt-0 sm:w-56 xl:w-64/g) ?? [];
    expect(overlayWrappers.length).toBe(2);
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
    // role=status/aria-live=polite so SR users hear it when it appears.
    const source = await readSource();
    expect(source).toContain('detail.notices.forbiddenDescription');
    expect(source).toContain('detail.notices.loadFailedDescription');
    // ChartLocked block exposes both pieces of copy + the live-region role.
    const lockedStart = source.indexOf('const ChartLocked');
    const lockedEnd = source.indexOf('const ChartEmpty');
    const lockedRegion = source.slice(lockedStart, lockedEnd);
    expect(lockedRegion).toContain('detail.notices.forbiddenDescription');
    expect(lockedRegion).toContain('detail.notices.loadFailedDescription');
    expect(lockedRegion).toMatch(/role="status" aria-live="polite"/);
  });

  test('hours-by-task LabelList suppresses 0 labels on seeded zero-hour bars', async () => {
    // Seeding zero-hour tasks made <LabelList dataKey="hours" position="top">
    // render '0' above every empty bar — a project with many planned tasks
    // and no entries showed a forest of '0' texts instead of bars. The new
    // formatter returns '' for any zero/negative/non-finite value.
    const source = await readSource();
    // Signature widened to match Recharts LabelFormatter input type
    // (string | number | undefined) for TypeScript correctness.
    // Signature is `unknown` to satisfy Recharts' LabelFormatter via
    // contravariance — RenderableText's full union is verbose to spell out.
    expect(source).toMatch(/formatter=\{\(value: unknown\) => \{/);
    expect(source).toMatch(/Number\.isFinite\(n\) && n > 0 \? String\(n\) : ''/);
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
