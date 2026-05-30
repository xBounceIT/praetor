// Dashboard layout model for the project-analytics visualizations section.
//
// Mirrors the StandardTable "custom views" concept (components/shared/
// customViewHelpers.ts) but for chart widgets instead of table columns: a
// layout is an ordered list of widget slots, each carrying a visibility flag
// and a grid span (half / full width). A saved "view" is a named snapshot of
// such a layout. Persistence is localStorage, scoped to a stable dashboard id
// so the same set of views applies to every project's analytics section (the
// layout is about presentation, not per-project data).
//
// Everything here is pure (no React, no direct DOM writes beyond the guarded
// localStorage key helper) so it can be unit-tested in isolation.

import { generateViewId, moveByDelta } from '../shared/customViewHelpers';

export type DashboardWidgetSpan = 1 | 2;

export type DashboardWidgetState = {
  id: string;
  hidden: boolean;
  // Grid column span on lg+ screens: 1 = half width, 2 = full width. Below lg
  // the grid collapses to a single column regardless, so span only affects
  // wide layouts.
  span: DashboardWidgetSpan;
};

// Render order is the array order.
export type DashboardLayout = DashboardWidgetState[];

export type DashboardView = {
  id: string;
  name: string;
  layout: DashboardLayout;
};

// Canonical definition of a widget: its stable id plus the span it occupies in
// the default layout. The order of the widget list is the default / reset
// render order.
export type DashboardWidgetDef = { id: string; defaultSpan: DashboardWidgetSpan };

const STORAGE_PREFIX = 'praetor_dashboard';
// 'layout' + 'views' are keyed by the global dashboard id (shared baseline +
// view library); 'override' + 'activeview' are keyed by a project id (the
// per-project layer).
export type DashboardStorageKind = 'layout' | 'views' | 'activeview' | 'override';

export const getDashboardStorageKey = (dashboardId: string, kind: DashboardStorageKind): string =>
  `${STORAGE_PREFIX}_${kind}_${dashboardId}`;

export const buildDefaultLayout = (widgets: readonly DashboardWidgetDef[]): DashboardLayout =>
  widgets.map((w) => ({ id: w.id, hidden: false, span: w.defaultSpan }));

const isSpan = (v: unknown): v is DashboardWidgetSpan => v === 1 || v === 2;

export const isValidWidgetState = (v: unknown): v is DashboardWidgetState => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && o.id !== '' && typeof o.hidden === 'boolean' && isSpan(o.span);
};

// Reconcile a stored / imported layout against the canonical widget set:
//   - keep only known widget ids, in their stored order
//   - drop duplicate ids (first occurrence wins)
//   - append any widget missing from the stored layout (e.g. a newly shipped
//     chart) at the end, visible, with its default span — so a new chart shows
//     up for users who already have an older layout persisted, instead of
//     silently vanishing.
// The result always covers exactly the canonical widget set, once each.
export const normalizeLayout = (
  raw: unknown,
  widgets: readonly DashboardWidgetDef[],
): DashboardLayout => {
  const known = new Map(widgets.map((w) => [w.id, w]));
  const result: DashboardLayout = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isValidWidgetState(item)) continue;
      if (!known.has(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push({ id: item.id, hidden: item.hidden, span: item.span });
    }
  }
  for (const w of widgets) {
    if (!seen.has(w.id)) result.push({ id: w.id, hidden: false, span: w.defaultSpan });
  }
  return result;
};

export const isValidStoredDashboardView = (v: unknown): v is DashboardView => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '') return false;
  if (typeof o.name !== 'string' || o.name.trim() === '') return false;
  if (!Array.isArray(o.layout)) return false;
  return o.layout.every(isValidWidgetState);
};

export const parseStoredDashboardViews = (
  raw: string | null,
  widgets: readonly DashboardWidgetDef[],
): DashboardView[] => {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidStoredDashboardView).map((v) => ({
    id: v.id,
    name: v.name,
    // Normalize so a view authored before a chart existed still renders the
    // new chart (appended) rather than dropping it.
    layout: normalizeLayout(v.layout, widgets),
  }));
};

export const parseStoredLayout = (
  raw: string | null,
  widgets: readonly DashboardWidgetDef[],
): DashboardLayout => {
  if (!raw) return buildDefaultLayout(widgets);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return buildDefaultLayout(widgets);
  }
  return normalizeLayout(parsed, widgets);
};

// A per-project override is optional: absent / corrupt storage means "no
// override" (the project follows the global default), NOT the built-in default.
// So this returns null rather than buildDefaultLayout on a miss.
export const parseStoredOverride = (
  raw: string | null,
  widgets: readonly DashboardWidgetDef[],
): DashboardLayout | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return normalizeLayout(parsed, widgets);
};

export const layoutsEqual = (a: DashboardLayout, b: DashboardLayout): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].hidden !== b[i].hidden || a[i].span !== b[i].span) {
      return false;
    }
  }
  return true;
};

// Move the widget with `id` by `delta` slots (negative = earlier). Returns the
// same reference on a no-op (unknown id, or move out of bounds) so callers can
// short-circuit re-renders. Delegates to the table's guarded splice-move.
export const moveWidget = (layout: DashboardLayout, id: string, delta: number): DashboardLayout =>
  moveByDelta(
    layout,
    layout.findIndex((w) => w.id === id),
    delta,
  );

// Shallow-merge a patch into one widget. Returns the same reference when nothing
// actually changed (unknown id, or patch matches current values) so callers can
// short-circuit re-renders.
const patchWidget = (
  layout: DashboardLayout,
  id: string,
  patch: Partial<Pick<DashboardWidgetState, 'hidden' | 'span'>>,
): DashboardLayout => {
  let changed = false;
  const next = layout.map((w) => {
    if (w.id !== id) return w;
    const merged = { ...w, ...patch };
    if (merged.hidden === w.hidden && merged.span === w.span) return w;
    changed = true;
    return merged;
  });
  return changed ? next : layout;
};

export const setWidgetHidden = (
  layout: DashboardLayout,
  id: string,
  hidden: boolean,
): DashboardLayout => patchWidget(layout, id, { hidden });

export const setWidgetSpan = (
  layout: DashboardLayout,
  id: string,
  span: DashboardWidgetSpan,
): DashboardLayout => patchWidget(layout, id, { span });

// Reuse the table's id generator (secure-context aware, with fallbacks) so both
// features mint ids the same way.
export const generateDashboardViewId = generateViewId;
