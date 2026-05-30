import { describe, expect, test } from 'bun:test';
import {
  buildDefaultLayout,
  type DashboardLayout,
  type DashboardWidgetDef,
  generateDashboardViewId,
  getDashboardStorageKey,
  isValidStoredDashboardView,
  isValidWidgetState,
  layoutsEqual,
  moveWidget,
  normalizeLayout,
  parseStoredDashboardViews,
  parseStoredLayout,
  parseStoredOverride,
  setWidgetHidden,
  setWidgetSpan,
} from '../../../components/projects/dashboardLayout';

const WIDGETS: readonly DashboardWidgetDef[] = [
  { id: 'hoursByUser', defaultSpan: 2 },
  { id: 'hoursByTask', defaultSpan: 1 },
  { id: 'costVsRevenue', defaultSpan: 1 },
  { id: 'monthlyActivity', defaultSpan: 2 },
];

const ids = (layout: DashboardLayout) => layout.map((w) => w.id);

describe('getDashboardStorageKey', () => {
  test('namespaces by kind and dashboard id', () => {
    expect(getDashboardStorageKey('project-analytics', 'layout')).toBe(
      'praetor_dashboard_layout_project-analytics',
    );
    expect(getDashboardStorageKey('project-analytics', 'views')).toBe(
      'praetor_dashboard_views_project-analytics',
    );
    expect(getDashboardStorageKey('project-analytics', 'activeview')).toBe(
      'praetor_dashboard_activeview_project-analytics',
    );
    // The per-project override layer is keyed by project id.
    expect(getDashboardStorageKey('proj-123', 'override')).toBe(
      'praetor_dashboard_override_proj-123',
    );
  });
});

describe('parseStoredOverride', () => {
  test('returns null (no override → follow global) for null, bad JSON, or non-array', () => {
    expect(parseStoredOverride(null, WIDGETS)).toBeNull();
    expect(parseStoredOverride('not json', WIDGETS)).toBeNull();
    expect(parseStoredOverride('{}', WIDGETS)).toBeNull();
  });

  test('normalizes a valid stored override against the widget set', () => {
    const raw = JSON.stringify([{ id: 'costVsRevenue', hidden: true, span: 2 }]);
    const override = parseStoredOverride(raw, WIDGETS);
    expect(override).not.toBeNull();
    expect(override?.[0]).toEqual({ id: 'costVsRevenue', hidden: true, span: 2 });
    expect(override).toHaveLength(WIDGETS.length);
  });
});

describe('buildDefaultLayout', () => {
  test('keeps order, makes every widget visible, and honors default spans', () => {
    const layout = buildDefaultLayout(WIDGETS);
    expect(ids(layout)).toEqual(['hoursByUser', 'hoursByTask', 'costVsRevenue', 'monthlyActivity']);
    expect(layout.every((w) => !w.hidden)).toBe(true);
    expect(layout.map((w) => w.span)).toEqual([2, 1, 1, 2]);
  });
});

describe('isValidWidgetState', () => {
  test('accepts a well-formed widget state', () => {
    expect(isValidWidgetState({ id: 'x', hidden: false, span: 1 })).toBe(true);
    expect(isValidWidgetState({ id: 'x', hidden: true, span: 2 })).toBe(true);
  });

  test('rejects bad shapes', () => {
    expect(isValidWidgetState(null)).toBe(false);
    expect(isValidWidgetState({ id: '', hidden: false, span: 1 })).toBe(false);
    expect(isValidWidgetState({ id: 'x', hidden: 'no', span: 1 })).toBe(false);
    expect(isValidWidgetState({ id: 'x', hidden: false, span: 3 })).toBe(false);
    expect(isValidWidgetState({ id: 'x', hidden: false })).toBe(false);
  });
});

describe('normalizeLayout', () => {
  test('non-array input yields the full default layout', () => {
    expect(normalizeLayout(null, WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
    expect(normalizeLayout('garbage', WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
    expect(normalizeLayout({}, WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
  });

  test('preserves stored order, hidden flags and spans for known widgets', () => {
    const stored = [
      { id: 'monthlyActivity', hidden: false, span: 1 },
      { id: 'hoursByUser', hidden: true, span: 2 },
    ];
    const result = normalizeLayout(stored, WIDGETS);
    // Stored entries come first in their stored order...
    expect(result[0]).toEqual({ id: 'monthlyActivity', hidden: false, span: 1 });
    expect(result[1]).toEqual({ id: 'hoursByUser', hidden: true, span: 2 });
    // ...then the widgets missing from storage are appended (visible, default span).
    expect(ids(result).slice(2)).toEqual(['hoursByTask', 'costVsRevenue']);
    expect(result.find((w) => w.id === 'hoursByTask')).toEqual({
      id: 'hoursByTask',
      hidden: false,
      span: 1,
    });
  });

  test('drops unknown widget ids', () => {
    const stored = [
      { id: 'ghost', hidden: false, span: 2 },
      { id: 'hoursByTask', hidden: true, span: 1 },
    ];
    const result = normalizeLayout(stored, WIDGETS);
    expect(ids(result)).not.toContain('ghost');
    expect(result[0]).toEqual({ id: 'hoursByTask', hidden: true, span: 1 });
  });

  test('drops duplicate ids, first occurrence wins', () => {
    const stored = [
      { id: 'hoursByUser', hidden: true, span: 1 },
      { id: 'hoursByUser', hidden: false, span: 2 },
    ];
    const result = normalizeLayout(stored, WIDGETS);
    expect(result.filter((w) => w.id === 'hoursByUser')).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'hoursByUser', hidden: true, span: 1 });
  });

  test('always covers exactly the canonical widget set once each', () => {
    const result = normalizeLayout([], WIDGETS);
    expect(result).toHaveLength(WIDGETS.length);
    expect(new Set(ids(result))).toEqual(new Set(WIDGETS.map((w) => w.id)));
  });
});

describe('isValidStoredDashboardView', () => {
  test('accepts a valid view', () => {
    expect(
      isValidStoredDashboardView({
        id: 'v1',
        name: 'Compact',
        layout: [{ id: 'hoursByUser', hidden: false, span: 2 }],
      }),
    ).toBe(true);
  });

  test('rejects missing/blank name, missing id, or non-array layout', () => {
    expect(isValidStoredDashboardView({ id: 'v1', name: '  ', layout: [] })).toBe(false);
    expect(isValidStoredDashboardView({ id: '', name: 'x', layout: [] })).toBe(false);
    expect(isValidStoredDashboardView({ id: 'v1', name: 'x', layout: {} })).toBe(false);
    expect(
      isValidStoredDashboardView({
        id: 'v1',
        name: 'x',
        layout: [{ id: 'a', hidden: 1, span: 1 }],
      }),
    ).toBe(false);
  });
});

describe('parseStoredDashboardViews', () => {
  test('returns [] for null, bad JSON, or non-array', () => {
    expect(parseStoredDashboardViews(null, WIDGETS)).toEqual([]);
    expect(parseStoredDashboardViews('{not json', WIDGETS)).toEqual([]);
    expect(parseStoredDashboardViews('{}', WIDGETS)).toEqual([]);
  });

  test('keeps valid views, drops invalid ones, and normalizes their layouts', () => {
    const raw = JSON.stringify([
      { id: 'v1', name: 'Compact', layout: [{ id: 'hoursByTask', hidden: true, span: 1 }] },
      { id: '', name: 'broken', layout: [] },
    ]);
    const views = parseStoredDashboardViews(raw, WIDGETS);
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe('v1');
    // Layout normalized to cover the full widget set (missing ones appended).
    expect(views[0].layout).toHaveLength(WIDGETS.length);
    expect(views[0].layout[0]).toEqual({ id: 'hoursByTask', hidden: true, span: 1 });
  });
});

describe('parseStoredLayout', () => {
  test('null or bad JSON falls back to the default layout', () => {
    expect(parseStoredLayout(null, WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
    expect(parseStoredLayout('nope', WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
  });

  test('valid JSON is normalized against the widget set', () => {
    const raw = JSON.stringify([{ id: 'costVsRevenue', hidden: true, span: 2 }]);
    const layout = parseStoredLayout(raw, WIDGETS);
    expect(layout[0]).toEqual({ id: 'costVsRevenue', hidden: true, span: 2 });
    expect(layout).toHaveLength(WIDGETS.length);
  });
});

describe('layoutsEqual', () => {
  test('true for identical layouts, false on any difference', () => {
    const a = buildDefaultLayout(WIDGETS);
    expect(layoutsEqual(a, buildDefaultLayout(WIDGETS))).toBe(true);
    expect(layoutsEqual(a, setWidgetHidden(a, 'hoursByUser', true))).toBe(false);
    expect(layoutsEqual(a, moveWidget(a, 'hoursByUser', 1))).toBe(false);
    expect(layoutsEqual(a, a.slice(0, 3))).toBe(false);
  });
});

describe('moveWidget', () => {
  test('moves a widget by delta', () => {
    const a = buildDefaultLayout(WIDGETS);
    expect(ids(moveWidget(a, 'hoursByUser', 1))).toEqual([
      'hoursByTask',
      'hoursByUser',
      'costVsRevenue',
      'monthlyActivity',
    ]);
    expect(ids(moveWidget(a, 'monthlyActivity', -1))).toEqual([
      'hoursByUser',
      'hoursByTask',
      'monthlyActivity',
      'costVsRevenue',
    ]);
  });

  test('returns the same reference on a no-op (out of bounds or unknown id)', () => {
    const a = buildDefaultLayout(WIDGETS);
    expect(moveWidget(a, 'hoursByUser', -1)).toBe(a);
    expect(moveWidget(a, 'monthlyActivity', 1)).toBe(a);
    expect(moveWidget(a, 'ghost', 1)).toBe(a);
  });
});

describe('setWidgetHidden / setWidgetSpan', () => {
  test('setWidgetHidden flips the flag and is immutable', () => {
    const a = buildDefaultLayout(WIDGETS);
    const b = setWidgetHidden(a, 'hoursByTask', true);
    expect(b).not.toBe(a);
    expect(b.find((w) => w.id === 'hoursByTask')?.hidden).toBe(true);
    expect(a.find((w) => w.id === 'hoursByTask')?.hidden).toBe(false);
  });

  test('setWidgetSpan changes the span and is immutable', () => {
    const a = buildDefaultLayout(WIDGETS);
    const b = setWidgetSpan(a, 'hoursByTask', 2);
    expect(b).not.toBe(a);
    expect(b.find((w) => w.id === 'hoursByTask')?.span).toBe(2);
  });

  test('returns the same reference when nothing changes', () => {
    const a = buildDefaultLayout(WIDGETS);
    expect(setWidgetHidden(a, 'hoursByTask', false)).toBe(a);
    expect(setWidgetSpan(a, 'hoursByTask', 1)).toBe(a);
    expect(setWidgetHidden(a, 'ghost', true)).toBe(a);
  });
});

describe('generateDashboardViewId', () => {
  test('produces unique non-empty ids', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateDashboardViewId()));
    expect(set.size).toBe(50);
    for (const id of set) expect(id.length).toBeGreaterThan(0);
  });
});
