import { describe, expect, test } from 'bun:test';
import {
  bottom,
  buildDefaultLayout,
  collides,
  compactLayout,
  type DashboardLayout,
  type DashboardWidgetDef,
  generateDashboardViewId,
  getDashboardStorageKey,
  isValidStoredDashboardView,
  isValidWidgetState,
  layoutsEqual,
  moveWidgetTo,
  normalizeLayout,
  parseStoredDashboardViews,
  parseStoredLayout,
  parseStoredOverride,
  resizeWidgetTo,
  setWidgetHidden,
  toggleWidgetHidden,
  visibleLayout,
} from '../../../components/projects/dashboardLayout';

const WIDGETS: readonly DashboardWidgetDef[] = [
  { id: 'a', x: 0, y: 0, w: 6, h: 2, minW: 3, minH: 2 },
  { id: 'b', x: 6, y: 0, w: 6, h: 2, minW: 3, minH: 2 },
  { id: 'c', x: 0, y: 2, w: 4, h: 3, minW: 2, minH: 2 },
  { id: 'd', x: 4, y: 2, w: 8, h: 3, minW: 4, minH: 2 },
];

const ids = (layout: DashboardLayout) => layout.map((w) => w.id);
const find = (layout: DashboardLayout, id: string) => layout.find((w) => w.id === id);
const visible = (id: string, x: number, y: number, w: number, h: number) => ({
  id,
  x,
  y,
  w,
  h,
  hidden: false,
});

describe('getDashboardStorageKey', () => {
  test('namespaces by kind and dashboard id under the v2 prefix', () => {
    expect(getDashboardStorageKey('project-analytics', 'layout')).toBe(
      'praetor_dashboard_v2_layout_project-analytics',
    );
    expect(getDashboardStorageKey('project-analytics', 'views')).toBe(
      'praetor_dashboard_v2_views_project-analytics',
    );
    expect(getDashboardStorageKey('proj-123', 'override')).toBe(
      'praetor_dashboard_v2_override_proj-123',
    );
    expect(getDashboardStorageKey('proj-123', 'activeview')).toBe(
      'praetor_dashboard_v2_activeview_proj-123',
    );
  });
});

describe('collides', () => {
  test('detects rectangle overlap and adjacency', () => {
    const a = visible('a', 0, 0, 4, 2);
    expect(collides(a, visible('b', 2, 1, 4, 2))).toBe(true); // overlapping
    expect(collides(a, visible('b', 4, 0, 4, 2))).toBe(false); // side by side
    expect(collides(a, visible('b', 0, 2, 4, 2))).toBe(false); // stacked, touching
  });
});

describe('bottom', () => {
  test('is the lowest y + h across the layout', () => {
    expect(bottom([visible('a', 0, 0, 4, 2), visible('b', 4, 3, 4, 5)])).toBe(8);
    expect(bottom([])).toBe(0);
  });
});

describe('compactLayout', () => {
  test('floats widgets up to fill vertical gaps, preserving x and input order', () => {
    const layout: DashboardLayout = [visible('a', 0, 0, 6, 2), visible('b', 0, 5, 6, 2)];
    const result = compactLayout(layout);
    expect(ids(result)).toEqual(['a', 'b']); // order preserved
    expect(find(result, 'a')).toEqual(visible('a', 0, 0, 6, 2));
    // b rests directly on a (a ends at row 2), keeping its column.
    expect(find(result, 'b')).toEqual(visible('b', 0, 2, 6, 2));
  });

  test('resolves a starting overlap by dropping the later widget down', () => {
    const layout: DashboardLayout = [visible('a', 0, 0, 6, 2), visible('b', 0, 0, 6, 2)];
    const result = compactLayout(layout);
    const ys = [find(result, 'a')?.y, find(result, 'b')?.y].sort();
    expect(ys).toEqual([0, 2]);
  });
});

describe('buildDefaultLayout', () => {
  test('places every widget visible at its default rectangle, compacted', () => {
    const layout = buildDefaultLayout(WIDGETS);
    expect(ids(layout)).toEqual(['a', 'b', 'c', 'd']);
    expect(layout.every((w) => !w.hidden)).toBe(true);
    expect(find(layout, 'a')).toEqual(visible('a', 0, 0, 6, 2));
    expect(find(layout, 'c')).toEqual(visible('c', 0, 2, 4, 3));
    expect(find(layout, 'd')).toEqual(visible('d', 4, 2, 8, 3));
  });
});

describe('moveWidgetTo', () => {
  test('moving a widget onto another pushes the other down, then compacts', () => {
    const layout = buildDefaultLayout([
      { id: 'a', x: 0, y: 0, w: 6, h: 2, minW: 3, minH: 2 },
      { id: 'b', x: 0, y: 2, w: 6, h: 2, minW: 3, minH: 2 },
    ]);
    const result = moveWidgetTo(layout, 'b', 0, 0);
    expect(find(result, 'b')?.y).toBe(0);
    expect(find(result, 'a')?.y).toBe(2);
  });

  test('clamps the target inside the grid', () => {
    const layout = buildDefaultLayout(WIDGETS);
    const result = moveWidgetTo(layout, 'a', 99, 0); // a is w6 → max x is 6
    expect(find(result, 'a')?.x).toBe(6);
  });

  test('returns the same reference on a no-op or unknown id', () => {
    const layout = buildDefaultLayout(WIDGETS);
    expect(moveWidgetTo(layout, 'a', 0, 0)).toBe(layout);
    expect(moveWidgetTo(layout, 'ghost', 1, 1)).toBe(layout);
  });
});

describe('resizeWidgetTo', () => {
  test('clamps width to the widget minimum and the grid edge', () => {
    const layout = buildDefaultLayout(WIDGETS);
    expect(find(resizeWidgetTo(layout, 'a', 1, 2, 3, 2), 'a')?.w).toBe(3); // minW
    expect(find(resizeWidgetTo(layout, 'a', 99, 2, 3, 2), 'a')?.w).toBe(12); // grid edge (x=0)
  });

  test('clamps height to the widget minimum', () => {
    const layout = buildDefaultLayout(WIDGETS);
    expect(find(resizeWidgetTo(layout, 'c', 4, 1, 2, 2), 'c')?.h).toBe(2);
  });

  test('returns the same reference on a no-op or unknown id', () => {
    const layout = buildDefaultLayout(WIDGETS);
    expect(resizeWidgetTo(layout, 'a', 6, 2, 3, 2)).toBe(layout);
    expect(resizeWidgetTo(layout, 'ghost', 4, 4, 2, 2)).toBe(layout);
  });

  test('never extends a near-edge widget past the grid even if minW exceeds the clearance', () => {
    // A widget at x=10 has only 2 columns of clearance; a minW of 4 must NOT
    // push its right edge off the 12-column grid.
    const layout: DashboardLayout = [{ id: 'a', x: 10, y: 0, w: 2, h: 2, hidden: false }];
    const result = resizeWidgetTo(layout, 'a', 4, 2, 4, 2);
    const a = find(result, 'a');
    expect(a?.x).toBe(10);
    expect((a?.x ?? 0) + (a?.w ?? 0)).toBeLessThanOrEqual(12);
  });

  test('ignores non-finite sizes (keeps the current size) instead of writing NaN', () => {
    const layout = buildDefaultLayout(WIDGETS);
    expect(resizeWidgetTo(layout, 'a', Number.NaN, Number.NaN, 3, 2)).toBe(layout);
    expect(find(moveWidgetTo(layout, 'a', Number.NaN, 0), 'a')?.x).toBe(0);
  });
});

describe('setWidgetHidden / toggleWidgetHidden', () => {
  test('flips the flag immutably and short-circuits no-ops', () => {
    const layout = buildDefaultLayout(WIDGETS);
    const hidden = setWidgetHidden(layout, 'a', true);
    expect(hidden).not.toBe(layout);
    expect(find(hidden, 'a')?.hidden).toBe(true);
    expect(find(layout, 'a')?.hidden).toBe(false); // original untouched

    expect(setWidgetHidden(layout, 'a', false)).toBe(layout); // already false → same ref
    expect(setWidgetHidden(layout, 'ghost', true)).toBe(layout);

    expect(find(toggleWidgetHidden(layout, 'b'), 'b')?.hidden).toBe(true);
    expect(toggleWidgetHidden(layout, 'ghost')).toBe(layout);
  });
});

describe('visibleLayout', () => {
  test('drops hidden widgets and floats the survivors up', () => {
    const layout: DashboardLayout = [
      visible('a', 0, 0, 6, 2),
      { ...visible('b', 6, 0, 6, 2), hidden: true },
      visible('c', 0, 2, 12, 3),
    ];
    const result = visibleLayout(layout);
    expect(ids(result)).toEqual(['a', 'c']);
    // c floats up to rest on a (a ends at row 2).
    expect(find(result, 'c')?.y).toBe(2);
  });
});

describe('isValidWidgetState', () => {
  test('accepts a well-formed state', () => {
    expect(isValidWidgetState(visible('x', 0, 0, 1, 1))).toBe(true);
  });

  test('rejects bad shapes', () => {
    expect(isValidWidgetState(null)).toBe(false);
    expect(isValidWidgetState({ id: '', x: 0, y: 0, w: 1, h: 1, hidden: false })).toBe(false);
    expect(isValidWidgetState({ id: 'x', x: -1, y: 0, w: 1, h: 1, hidden: false })).toBe(false);
    expect(isValidWidgetState({ id: 'x', x: 0, y: 0, w: 0, h: 1, hidden: false })).toBe(false);
    expect(isValidWidgetState({ id: 'x', x: 0, y: 0, w: 1, h: 1, hidden: 'no' })).toBe(false);
    expect(isValidWidgetState({ id: 'x', x: 0, y: 0, w: 1 })).toBe(false);
  });
});

describe('normalizeLayout', () => {
  test('non-array input yields the full default layout', () => {
    expect(normalizeLayout(null, WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
    expect(normalizeLayout('garbage', WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
    expect(normalizeLayout({}, WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
  });

  test('drops unknown ids and duplicates, first occurrence wins', () => {
    const stored = [
      visible('ghost', 0, 0, 4, 2),
      visible('a', 0, 0, 6, 2),
      visible('a', 6, 0, 6, 2),
    ];
    const result = normalizeLayout(stored, WIDGETS);
    expect(ids(result)).not.toContain('ghost');
    expect(result.filter((w) => w.id === 'a')).toHaveLength(1);
  });

  test('appends widgets missing from storage, visible at their default size', () => {
    const stored = [visible('a', 0, 0, 6, 2)];
    const result = normalizeLayout(stored, WIDGETS);
    // Covers exactly the canonical set, once each.
    expect(new Set(ids(result))).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(find(result, 'd')?.hidden).toBe(false);
    expect(find(result, 'd')?.w).toBe(8);
  });

  test('clamps stored sizes to the widget minimum and the grid width', () => {
    const stored = [{ id: 'a', x: 0, y: 0, w: 1, h: 1, hidden: false }];
    const result = normalizeLayout(stored, WIDGETS);
    expect(find(result, 'a')?.w).toBe(3); // minW
    expect(find(result, 'a')?.h).toBe(2); // minH
  });
});

describe('isValidStoredDashboardView', () => {
  test('accepts a valid view, rejects bad ones', () => {
    expect(
      isValidStoredDashboardView({ id: 'v1', name: 'Compact', layout: [visible('a', 0, 0, 6, 2)] }),
    ).toBe(true);
    expect(isValidStoredDashboardView({ id: 'v1', name: '  ', layout: [] })).toBe(false);
    expect(isValidStoredDashboardView({ id: '', name: 'x', layout: [] })).toBe(false);
    expect(isValidStoredDashboardView({ id: 'v1', name: 'x', layout: {} })).toBe(false);
  });
});

describe('parseStoredDashboardViews', () => {
  test('returns [] for null, bad JSON, or non-array', () => {
    expect(parseStoredDashboardViews(null, WIDGETS)).toEqual([]);
    expect(parseStoredDashboardViews('{not json', WIDGETS)).toEqual([]);
    expect(parseStoredDashboardViews('{}', WIDGETS)).toEqual([]);
  });

  test('keeps valid views, drops invalid, and normalizes layouts', () => {
    const raw = JSON.stringify([
      { id: 'v1', name: 'Compact', layout: [visible('a', 0, 0, 6, 2)] },
      { id: '', name: 'broken', layout: [] },
    ]);
    const views = parseStoredDashboardViews(raw, WIDGETS);
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe('v1');
    // Normalized to cover the full widget set.
    expect(new Set(ids(views[0].layout))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });
});

describe('parseStoredLayout', () => {
  test('null or bad JSON falls back to the default layout', () => {
    expect(parseStoredLayout(null, WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
    expect(parseStoredLayout('nope', WIDGETS)).toEqual(buildDefaultLayout(WIDGETS));
  });

  test('valid JSON is normalized against the widget set', () => {
    const raw = JSON.stringify([visible('a', 0, 0, 6, 2)]);
    const layout = parseStoredLayout(raw, WIDGETS);
    expect(new Set(ids(layout))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });
});

describe('parseStoredOverride', () => {
  test('returns null (no override → follow global) for null, bad JSON, or non-array', () => {
    expect(parseStoredOverride(null, WIDGETS)).toBeNull();
    expect(parseStoredOverride('not json', WIDGETS)).toBeNull();
    expect(parseStoredOverride('{}', WIDGETS)).toBeNull();
  });

  test('normalizes a valid stored override', () => {
    const raw = JSON.stringify([visible('a', 0, 0, 6, 2)]);
    const override = parseStoredOverride(raw, WIDGETS);
    expect(override).not.toBeNull();
    expect(new Set(ids(override ?? []))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });
});

describe('layoutsEqual', () => {
  test('true for identical layouts, false on any difference', () => {
    const a = buildDefaultLayout(WIDGETS);
    expect(layoutsEqual(a, buildDefaultLayout(WIDGETS))).toBe(true);
    expect(layoutsEqual(a, setWidgetHidden(a, 'a', true))).toBe(false);
    expect(layoutsEqual(a, moveWidgetTo(a, 'd', 0, 9))).toBe(false);
    expect(layoutsEqual(a, a.slice(0, 3))).toBe(false);
  });
});

describe('generateDashboardViewId', () => {
  test('produces unique non-empty ids', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateDashboardViewId()));
    expect(set.size).toBe(50);
    for (const id of set) expect(id.length).toBeGreaterThan(0);
  });
});
