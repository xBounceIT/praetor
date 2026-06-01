// Dashboard layout model for the project-analytics visualizations section.
//
// A free-form grid (Grafana style): each widget occupies a rectangle on a
// fixed 12-column grid — `x`/`y` are the top-left cell, `w`/`h` the size in
// grid units. Widgets can be dragged to any cell and resized from their edges;
// the layout is kept tidy with *vertical compaction* (cards float up to fill
// the gaps above them), exactly like react-grid-layout's `compactType:
// 'vertical'`. A saved "view" is a named snapshot of such a layout.
//
// Everything here is pure (no React, no DOM beyond the guarded localStorage key
// helper) so the geometry can be unit-tested in isolation. The interactive
// drag/resize lives in DashboardGrid.tsx; the persistence/two-tier wiring lives
// in useDashboardLayout.ts.

import { generateViewId } from '../shared/customViewHelpers';

// The grid is always 12 columns wide; below the `singleColumn` breakpoint the
// grid component stacks widgets instead, but the stored model stays 12-col.
export const DASHBOARD_COLS = 12;

export type DashboardWidgetState = {
  id: string;
  x: number; // left column, 0 .. COLS-w
  y: number; // top row (unbounded downward)
  w: number; // width in columns, 1 .. COLS
  h: number; // height in row units, >= 1
  hidden: boolean;
};

// Render placement is the rectangle; array order is incidental (the grid reads
// x/y), but we preserve input order so React keys stay stable.
export type DashboardLayout = DashboardWidgetState[];

export type DashboardView = {
  id: string;
  name: string;
  layout: DashboardLayout;
};

// Per-viewer access to a server-backed named view: the granted share permission
// (`read` = apply-only, `write` = can edit/rename/re-save) or `owner` for views
// the caller created. Mirrors `SavedViewAccess` from `services/api/views`.
export type DashboardViewPermission = 'read' | 'write';

// A named dashboard view loaded from the server (own + shared-with-me, already
// merged server-side). The raw author `layout` is normalized per-viewer against
// the live widget set on load/apply, so a recipient missing a permitted widget
// still renders the shared layout. `permission` is the granted share level;
// `isOwner` gates owner-only actions (delete / manage sharing); `ownerName`
// drives the "Shared by {ownerName}" badge on non-owned rows.
export type ServerDashboardView = {
  id: string;
  name: string;
  // `layout` is normalized for the current viewer; `rawLayout` is the author's stored widget
  // states verbatim (including cards this viewer can't render). Re-saving / duplicating uses
  // `rawLayout` to preserve placements outside the viewer's permitted widget set.
  layout: DashboardLayout;
  rawLayout: DashboardLayout;
  isOwner: boolean;
  permission: DashboardViewPermission;
  ownerName: string;
};

// Canonical definition of a widget: its stable id, the default rectangle it
// occupies in a fresh layout, and the minimum size it may be resized to.
export type DashboardWidgetDef = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
};

const STORAGE_PREFIX = 'praetor_dashboard_v2';
// 'layout' + 'views' are keyed by the global dashboard id (shared baseline +
// view library); 'override' + 'activeview' are keyed by a project id (the
// per-project layer).
export type DashboardStorageKind = 'layout' | 'views' | 'activeview' | 'override';

export const getDashboardStorageKey = (dashboardId: string, kind: DashboardStorageKind): string =>
  `${STORAGE_PREFIX}_${kind}_${dashboardId}`;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

// Round to an integer, falling back to a safe value for NaN / Infinity so a bad
// caller can never write a non-finite coordinate into the persisted layout.
const safeRound = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.round(value) : fallback;

// ----------------------------------------------------------------------------
// Geometry primitives
// ----------------------------------------------------------------------------

// True when two rectangles overlap. Pure rectangle test — callers exclude self
// by id where needed.
export const collides = (a: DashboardWidgetState, b: DashboardWidgetState): boolean =>
  a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h;

const firstCollision = (
  layout: DashboardLayout,
  item: DashboardWidgetState,
): DashboardWidgetState | undefined =>
  layout.find((other) => other.id !== item.id && collides(other, item));

// The first free row below everything in the layout.
export const bottom = (layout: DashboardLayout): number =>
  layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);

// Reading order on the grid: top-to-bottom, then left-to-right. Used by both
// the compactor here and the single-column stack in DashboardGrid.
export const sortByRowCol = (layout: DashboardLayout): DashboardLayout =>
  [...layout].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

// Vertical compaction: float every widget up as far as it can go without
// colliding, processing top-to-bottom so each rests on the ones above it. The
// result is returned in the SAME order as the input so React keys are stable.
export const compactLayout = (layout: DashboardLayout): DashboardLayout => {
  const placed: DashboardLayout = [];
  for (const item of sortByRowCol(layout)) {
    const moved: DashboardWidgetState = { ...item };
    // Float up while the slot directly above is free.
    while (moved.y > 0 && !firstCollision(placed, { ...moved, y: moved.y - 1 })) {
      moved.y -= 1;
    }
    // Guard against a starting overlap (e.g. imported data): drop down until clear.
    while (firstCollision(placed, moved)) {
      moved.y += 1;
    }
    placed.push(moved);
  }
  // Re-emit in the caller's original order.
  const byId = new Map(placed.map((w) => [w.id, w]));
  return layout.map((orig) => byId.get(orig.id) ?? orig);
};

// Push every widget that overlaps the just-moved/resized widget straight down,
// cascading so a chain of overlaps all resolve. Returns a fresh array.
const resolveCollisions = (layout: DashboardLayout, movedId: string): DashboardLayout => {
  const result = layout.map((w) => ({ ...w }));
  const start = result.find((w) => w.id === movedId);
  if (!start) return result;
  const queue: DashboardWidgetState[] = [start];
  // Bounded so a pathological input can never spin forever.
  const guard = result.length * result.length + result.length + 1;
  let steps = 0;
  while (queue.length > 0 && steps < guard) {
    steps += 1;
    const current = queue.shift();
    if (!current) break;
    for (const other of result) {
      if (other.id === current.id) continue;
      if (collides(current, other)) {
        other.y = current.y + current.h;
        queue.push(other);
      }
    }
  }
  return result;
};

// Move a widget to (x, y), clamped into the grid, then resolve overlaps and
// compact. Returns the same reference on an unknown id.
export const moveWidgetTo = (
  layout: DashboardLayout,
  id: string,
  x: number,
  y: number,
): DashboardLayout => {
  const target = layout.find((w) => w.id === id);
  if (!target) return layout;
  const nx = clamp(safeRound(x, target.x), 0, DASHBOARD_COLS - target.w);
  const ny = Math.max(0, safeRound(y, target.y));
  if (nx === target.x && ny === target.y) return layout;
  const moved = layout.map((w) => (w.id === id ? { ...w, x: nx, y: ny } : { ...w }));
  return compactLayout(resolveCollisions(moved, id));
};

// Resize a widget to (w, h), clamped to [min, grid edge], then resolve overlaps
// and compact. Returns the same reference on an unknown id.
export const resizeWidgetTo = (
  layout: DashboardLayout,
  id: string,
  w: number,
  h: number,
  minW: number,
  minH: number,
): DashboardLayout => {
  const target = layout.find((it) => it.id === id);
  if (!target) return layout;
  // A widget resizes from its top-left corner, so its right edge can't pass the
  // grid. `maxW` is that hard cap; the minimum is the widget's own min width,
  // but never larger than maxW (a near-edge widget yields rather than overflow).
  const maxW = Math.max(1, DASHBOARD_COLS - target.x);
  const minWClamped = Math.min(Math.max(1, minW), maxW);
  const nw = clamp(safeRound(w, target.w), minWClamped, maxW);
  const nh = Math.max(Math.max(1, minH), safeRound(h, target.h));
  if (nw === target.w && nh === target.h) return layout;
  const resized = layout.map((it) => (it.id === id ? { ...it, w: nw, h: nh } : { ...it }));
  return compactLayout(resolveCollisions(resized, id));
};

// ----------------------------------------------------------------------------
// Hidden flag
// ----------------------------------------------------------------------------

export const setWidgetHidden = (
  layout: DashboardLayout,
  id: string,
  hidden: boolean,
): DashboardLayout => {
  let changed = false;
  const next = layout.map((w) => {
    if (w.id !== id || w.hidden === hidden) return w;
    changed = true;
    return { ...w, hidden };
  });
  return changed ? next : layout;
};

export const toggleWidgetHidden = (layout: DashboardLayout, id: string): DashboardLayout => {
  const current = layout.find((w) => w.id === id);
  if (!current) return layout;
  return setWidgetHidden(layout, id, !current.hidden);
};

// The layout to actually render outside edit mode: drop hidden widgets so they
// take no space, then compact the survivors so the visible cards float up to
// fill the holes the hidden ones left behind.
export const visibleLayout = (layout: DashboardLayout): DashboardLayout =>
  compactLayout(layout.filter((w) => !w.hidden));

// ----------------------------------------------------------------------------
// Validation / normalization
// ----------------------------------------------------------------------------

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isValidWidgetState = (v: unknown): v is DashboardWidgetState => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.id !== '' &&
    isFiniteNumber(o.x) &&
    isFiniteNumber(o.y) &&
    isFiniteNumber(o.w) &&
    isFiniteNumber(o.h) &&
    o.x >= 0 &&
    o.y >= 0 &&
    o.w >= 1 &&
    o.h >= 1 &&
    typeof o.hidden === 'boolean'
  );
};

export const buildDefaultLayout = (widgets: readonly DashboardWidgetDef[]): DashboardLayout =>
  compactLayout(widgets.map((d) => ({ id: d.id, x: d.x, y: d.y, w: d.w, h: d.h, hidden: false })));

// Reconcile a stored / imported layout against the canonical widget set:
//   - keep only known widget ids (in stored order), clamped into the grid and
//     to each widget's minimum size; drop duplicates (first wins)
//   - append any widget missing from storage (e.g. a newly shipped chart) below
//     everything, visible, at its default size — so a new widget shows up for
//     users who already have an older layout persisted
//   - compact, so the result has no gaps and no overlaps
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
      const def = known.get(item.id);
      if (!def || seen.has(item.id)) continue;
      seen.add(item.id);
      // Width first (never wider than the grid even if minW is misconfigured),
      // then x so the right edge always lands inside the grid.
      const w = clamp(
        safeRound(item.w, def.w),
        Math.min(Math.max(1, def.minW), DASHBOARD_COLS),
        DASHBOARD_COLS,
      );
      const x = clamp(safeRound(item.x, def.x), 0, DASHBOARD_COLS - w);
      const h = Math.max(Math.max(1, def.minH), safeRound(item.h, def.h));
      const y = Math.max(0, safeRound(item.y, def.y));
      result.push({ id: item.id, x, y, w, h, hidden: item.hidden });
    }
  }
  let yCursor = bottom(result);
  for (const def of widgets) {
    if (seen.has(def.id)) continue;
    result.push({
      id: def.id,
      x: clamp(def.x, 0, DASHBOARD_COLS - def.w),
      y: yCursor,
      w: def.w,
      h: def.h,
      hidden: false,
    });
    yCursor += def.h;
  }
  return compactLayout(result);
};

export const isValidStoredDashboardView = (v: unknown): v is DashboardView => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '') return false;
  if (typeof o.name !== 'string' || o.name.trim() === '') return false;
  if (!Array.isArray(o.layout)) return false;
  return o.layout.every(isValidWidgetState);
};

// Parse a stored JSON string into an array, or null when it's missing,
// unparseable, or not an array. Centralizes the guard the three parsers share;
// each then applies its own miss-value and mapping.
const parseJsonArray = (raw: string | null): unknown[] | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const parseStoredDashboardViews = (
  raw: string | null,
  widgets: readonly DashboardWidgetDef[],
): DashboardView[] => {
  const arr = parseJsonArray(raw);
  if (!arr) return [];
  return arr.filter(isValidStoredDashboardView).map((v) => ({
    id: v.id,
    name: v.name,
    // Normalize so a view authored before a widget existed still renders it.
    layout: normalizeLayout(v.layout, widgets),
  }));
};

// Normalize the opaque `config` payload of a server-backed dashboard view into a
// renderable layout. The dashboard `config` is `{ layout: DashboardWidgetState[] }`
// (the raw author snapshot); we run it through `normalizeLayout` against the live
// widget set so unknown widget ids are dropped and missing ones appended — i.e. a
// shared view always renders against the viewer's permitted widgets. A missing /
// malformed `layout` degrades to the default layout rather than throwing.
export const parseServerViewConfig = (
  config: Record<string, unknown> | null | undefined,
  widgets: readonly DashboardWidgetDef[],
): DashboardLayout => normalizeLayout(config?.layout, widgets);

// The author's stored widget states verbatim — VALIDATED but NOT normalized against the live
// widget set, so cards the current viewer can't render are kept. Used when re-saving / duplicating
// a shared view to preserve placements outside the viewer's permitted widget set.
export const parseServerViewRawLayout = (
  config: Record<string, unknown> | null | undefined,
): DashboardLayout => {
  const raw = config?.layout;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidWidgetState).map((w) => ({ ...w }));
};

export const parseStoredLayout = (
  raw: string | null,
  widgets: readonly DashboardWidgetDef[],
): DashboardLayout => {
  const arr = parseJsonArray(raw);
  return arr ? normalizeLayout(arr, widgets) : buildDefaultLayout(widgets);
};

// A per-project override is optional: absent / corrupt storage means "no
// override" (the project follows the global default), NOT the built-in default.
// So this returns null rather than buildDefaultLayout on a miss.
export const parseStoredOverride = (
  raw: string | null,
  widgets: readonly DashboardWidgetDef[],
): DashboardLayout | null => {
  const arr = parseJsonArray(raw);
  return arr ? normalizeLayout(arr, widgets) : null;
};

export const layoutsEqual = (a: DashboardLayout, b: DashboardLayout): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (
      p.id !== q.id ||
      p.x !== q.x ||
      p.y !== q.y ||
      p.w !== q.w ||
      p.h !== q.h ||
      p.hidden !== q.hidden
    ) {
      return false;
    }
  }
  return true;
};

// Reuse the table's id generator (secure-context aware, with fallbacks) so both
// features mint ids the same way.
export const generateDashboardViewId = generateViewId;
