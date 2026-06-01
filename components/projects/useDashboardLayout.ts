import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../services/api/client';
import { type SavedViewDto, viewsApi } from '../../services/api/views';
import {
  type DashboardLayout,
  type DashboardWidgetDef,
  getDashboardStorageKey,
  layoutsEqual,
  moveWidgetTo,
  parseServerViewConfig,
  parseServerViewRawLayout,
  parseStoredLayout,
  parseStoredOverride,
  resizeWidgetTo,
  type ServerDashboardView,
  toggleWidgetHidden,
} from './dashboardLayout';

const readLS = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLS = (key: string, value: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Quota / disabled storage — layout customization is best-effort, so a
    // failed persist must never break the page.
  }
};

// Snapshot helper: copy each slot so a stored layout never aliases the live
// draft/applied arrays (defensive against a future in-place mutator).
const cloneLayout = (layout: DashboardLayout): DashboardLayout => layout.map((w) => ({ ...w }));

const isForbidden = (err: unknown): boolean => err instanceof ApiError && err.status === 403;

// Map a server DTO (own + shared-with-me, merged server-side) onto the local
// view shape, normalizing the raw author layout against the live widget set so
// the row always renders against the viewer's permitted widgets.
const mapServerView = (
  dto: SavedViewDto,
  widgets: readonly DashboardWidgetDef[],
): ServerDashboardView => ({
  id: dto.id,
  name: dto.name,
  layout: parseServerViewConfig(dto.config, widgets),
  rawLayout: parseServerViewRawLayout(dto.config),
  isOwner: dto.access === 'owner',
  permission: dto.access === 'owner' ? 'write' : dto.access,
  ownerName: dto.ownerName,
});

export interface UseDashboardLayout {
  // The layout to render: the in-progress draft while editing, otherwise the
  // effective layout (per-project override if set, else the global default).
  layout: DashboardLayout;
  editing: boolean;
  views: ServerDashboardView[];
  activeViewId: string | null;
  // Server-view library lifecycle (the named views moved server-side):
  // `viewsLoading` is the initial / reload fetch in flight; `viewsError` is true
  // after a failed load (drives the error + retry row); `savingView` covers the
  // create round-trip behind "Save as new view" (the modal stays open until it
  // resolves). The local global/override tiers never enter these states.
  viewsLoading: boolean;
  viewsError: boolean;
  savingView: boolean;
  reloadViews: () => void;
  // True when this project has NO override and simply follows the global
  // default — drives the check mark on the "Use global default" menu item.
  followingGlobal: boolean;
  // Edit lifecycle
  startEditing: () => void;
  cancelEditing: () => void;
  doneEditing: () => void;
  // Draft mutators (meaningful only while editing) — the grid commits one of
  // these at the end of each drag / resize gesture.
  moveWidget: (id: string, x: number, y: number) => void;
  resizeWidget: (id: string, w: number, h: number) => void;
  toggleHidden: (id: string) => void;
  // Views (a server-backed library: own + shared). Mutations are async and round
  // trip through `viewsApi`; the resolve/reject conveys success to the caller.
  saveAsView: (name: string) => Promise<boolean>;
  applyView: (viewId: string) => void;
  deleteView: (viewId: string) => Promise<void>; // owner-only
  renameView: (viewId: string, name: string) => Promise<boolean>; // owner or write
  resaveView: (viewId: string) => Promise<boolean>; // owner or write — overwrite layout
  duplicateView: (viewId: string, name: string) => Promise<boolean>; // any access → own copy
  // Tiers
  followGlobalDefault: () => void; // clear this project's override
  setAsGlobalDefault: () => void; // promote the current layout to the global default
}

// Three-tier layout, with the named-view library now server-backed:
//   - `globalId` keys the shared baseline layout AND is the server `scopeKey`
//     for the named-view library (kind `'dashboard'`).
//   - `projectId` keys this project's optional override + which view it's on.
// The effective layout for the project = override ?? globalLayout.
//
// Reconciliation: ONLY the named `views` library is server-backed + shareable.
// The `globalLayout` baseline (+ `setAsGlobalDefault`/`followGlobalDefault`), the
// per-project `override`, and `activeViewId` all stay localStorage, per-user —
// untouched by this hook's server wiring. `widgets` must be a stable reference
// across renders (its identity is captured by callbacks) — memoize it in the
// caller. `currentUserId` gates the load (no authenticated user → no fetch) and
// re-triggers it when the viewer changes; ownership of each row is still computed
// server-side via `access`.
export const useDashboardLayout = (
  globalId: string,
  projectId: string,
  widgets: readonly DashboardWidgetDef[],
  currentUserId: string | undefined,
): UseDashboardLayout => {
  const globalLayoutKey = getDashboardStorageKey(globalId, 'layout');
  const overrideKey = getDashboardStorageKey(projectId, 'override');
  const activeKey = getDashboardStorageKey(projectId, 'activeview');
  // The server namespace for this dashboard's named-view library.
  const scopeKey = globalId;

  const [globalLayout, setGlobalLayout] = useState<DashboardLayout>(() =>
    parseStoredLayout(readLS(globalLayoutKey), widgets),
  );
  const [override, setOverride] = useState<DashboardLayout | null>(() =>
    parseStoredOverride(readLS(overrideKey), widgets),
  );
  const [views, setViews] = useState<ServerDashboardView[]>([]);
  const [viewsLoading, setViewsLoading] = useState(true);
  const [viewsError, setViewsError] = useState(false);
  const [savingView, setSavingView] = useState(false);
  // The active-view id is per-project UI state and stays local. It is reconciled
  // against the loaded server views below: a dangling id (its view deleted by the
  // owner, or unshared from this user) drops to null so no inactive marker lingers.
  const [activeViewId, setActiveViewId] = useState<string | null>(() => readLS(activeKey) || null);
  const [editing, setEditing] = useState(false);

  const effectiveLayout = useMemo(() => override ?? globalLayout, [override, globalLayout]);
  const [draft, setDraft] = useState<DashboardLayout>(effectiveLayout);

  // Per-widget minimum sizes, looked up when committing a resize.
  const minSizes = useMemo(
    () => new Map(widgets.map((w) => [w.id, { minW: w.minW, minH: w.minH }])),
    [widgets],
  );

  // The permission-filtered `widgets` identity changes whenever the viewer's
  // permitted-card set is re-derived, but the server library is keyed only by
  // `scopeKey` — capture `widgets` in a ref so normalization reads the live set
  // without making it a fetch dependency (which would re-load on every render).
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  // Live refs so the async load reconcile reads fresh values without making them
  // fetch dependencies (which would re-load the library on every render).
  const activeViewIdRef = useRef(activeViewId);
  activeViewIdRef.current = activeViewId;
  const overrideRef = useRef(override);
  overrideRef.current = override;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const persistGlobalLayout = useCallback(
    (next: DashboardLayout) => writeLS(globalLayoutKey, JSON.stringify(next)),
    [globalLayoutKey],
  );
  const persistOverride = useCallback(
    (next: DashboardLayout | null) => writeLS(overrideKey, next ? JSON.stringify(next) : null),
    [overrideKey],
  );
  const persistActiveView = useCallback((id: string | null) => writeLS(activeKey, id), [activeKey]);

  // Reconcile the active marker AND its override against a freshly loaded library:
  //  - active view gone (deleted / unshared elsewhere) → drop the marker; the override
  //    layout stays put as a now-custom layout.
  //  - active view still present → re-apply its loaded layout so a re-save by the owner
  //    or another write recipient propagates to viewers who already had it active. Without
  //    this, the per-project override cloned at apply-time (and persisted to localStorage)
  //    keeps showing the stale layout, so "re-save changes it for everyone" wouldn't hold.
  // Skipped mid-edit so an in-progress draft isn't disturbed (it re-syncs on the next load).
  const reconcileAfterLoad = useCallback(
    (loaded: ServerDashboardView[]) => {
      const activeId = activeViewIdRef.current;
      if (!activeId) return;
      const active = loaded.find((v) => v.id === activeId);
      if (!active) {
        setActiveViewId(null);
        persistActiveView(null);
        return;
      }
      if (editingRef.current) return;
      const next = cloneLayout(active.layout);
      if (!overrideRef.current || !layoutsEqual(overrideRef.current, next)) {
        setOverride(next);
        persistOverride(next);
      }
    },
    [persistActiveView, persistOverride],
  );

  // Load the server view library for this scope. Guarded by a per-call token so a
  // stale response (scope changed, or a manual reload superseded it) can't clobber
  // fresh state. Re-runs the dangling-activeViewId guard after a successful load.
  // No authenticated user (no provider / pre-auth) → nothing to fetch: clear the
  // library and settle into the resolved state rather than calling the API.
  const loadSeqRef = useRef(0);
  const loadViews = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!currentUserId) {
      setViews([]);
      setViewsError(false);
      setViewsLoading(false);
      return;
    }
    setViewsLoading(true);
    setViewsError(false);
    try {
      const dtos = await viewsApi.list('dashboard', scopeKey);
      if (seq !== loadSeqRef.current) return;
      const mapped = dtos.map((dto) => mapServerView(dto, widgetsRef.current));
      setViews(mapped);
      reconcileAfterLoad(mapped);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error('Failed to load dashboard views', err);
      setViewsError(true);
    } finally {
      if (seq === loadSeqRef.current) setViewsLoading(false);
    }
  }, [currentUserId, scopeKey, reconcileAfterLoad]);

  // Initial load + reload whenever the scope or viewer changes. The list is
  // intentionally NOT a function of `widgets`: the permission-filtered def set
  // re-derives often, but the server library is scope-keyed and normalized
  // per-viewer via the ref.
  useEffect(() => {
    loadViews();
  }, [loadViews]);

  const reloadViews = useCallback(() => {
    void loadViews();
  }, [loadViews]);

  // Set this project's override layer + which view it's on (or null = custom).
  const applyOverride = useCallback(
    (next: DashboardLayout, viewId: string | null) => {
      setOverride(next);
      persistOverride(next);
      setActiveViewId(viewId);
      persistActiveView(viewId);
    },
    [persistOverride, persistActiveView],
  );

  const startEditing = useCallback(() => {
    setDraft(effectiveLayout);
    setEditing(true);
  }, [effectiveLayout]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setDraft(effectiveLayout);
  }, [effectiveLayout]);

  const doneEditing = useCallback(() => {
    setEditing(false);
    // Applying an edited draft makes this project's layout custom (an override).
    // Keep the active view only if the draft still matches it exactly.
    const active = activeViewId ? views.find((v) => v.id === activeViewId) : undefined;
    const keepActive = active && layoutsEqual(active.layout, draft) ? activeViewId : null;
    applyOverride(cloneLayout(draft), keepActive);
  }, [draft, activeViewId, views, applyOverride]);

  const moveWidget = useCallback((id: string, x: number, y: number) => {
    setDraft((prev) => moveWidgetTo(prev, id, x, y));
  }, []);

  const resizeWidget = useCallback(
    (id: string, w: number, h: number) => {
      const min = minSizes.get(id);
      setDraft((prev) => resizeWidgetTo(prev, id, w, h, min?.minW ?? 1, min?.minH ?? 1));
    },
    [minSizes],
  );

  const toggleHidden = useCallback((id: string) => {
    setDraft((prev) => toggleWidgetHidden(prev, id));
  }, []);

  // Persist the current (draft or effective) layout as a NEW server view. Async:
  // we wait for the server id before inserting — no optimistic row — so the caller
  // (the save modal) can stay open on failure. On success the new view is appended
  // and this project is pinned to it.
  const saveAsView = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const snapshot = cloneLayout(editing ? draft : effectiveLayout);
      setSavingView(true);
      try {
        const dto = await viewsApi.create({
          kind: 'dashboard',
          scopeKey,
          name: trimmed,
          config: { layout: snapshot },
        });
        const view = mapServerView(dto, widgetsRef.current);
        setViews((prev) => [...prev, view]);
        setEditing(false);
        // Saving a view also pins this project to it (as an override).
        applyOverride(cloneLayout(view.layout), view.id);
        return true;
      } catch (err) {
        console.error('Failed to save dashboard view', err);
        return false;
      } finally {
        setSavingView(false);
      }
    },
    [editing, draft, effectiveLayout, scopeKey, applyOverride],
  );

  // Apply a saved view as this project's override. Sync (no server call): re-
  // normalize against the LIVE widget set so a view authored against a different
  // permitted-card set still renders correctly for this viewer.
  const applyView = useCallback(
    (viewId: string) => {
      const view = views.find((v) => v.id === viewId);
      if (!view) return;
      setEditing(false);
      applyOverride(parseServerViewConfig({ layout: view.layout }, widgetsRef.current), view.id);
    },
    [views, applyOverride],
  );

  // Owner-only. Optimistic remove + rollback on failure. A 403 (ownership lost
  // mid-session) self-corrects via reloadViews rather than a silent rollback.
  // Errors are handled internally (callers fire-and-forget), so this never rejects.
  const deleteView = useCallback(
    async (viewId: string): Promise<void> => {
      const previous = views;
      const target = previous.find((v) => v.id === viewId);
      if (!target) return;
      setViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeViewId === viewId) {
        setActiveViewId(null);
        persistActiveView(null);
      }
      try {
        await viewsApi.remove(viewId);
      } catch (err) {
        console.error('Failed to delete dashboard view', err);
        if (isForbidden(err)) {
          reloadViews();
        } else {
          // Roll back to the pre-delete library (and restore the active marker).
          setViews(previous);
          if (activeViewId === viewId) {
            setActiveViewId(viewId);
            persistActiveView(viewId);
          }
        }
      }
    },
    [views, activeViewId, persistActiveView, reloadViews],
  );

  // Owner or write. Optimistic name swap + rollback. 403 → reloadViews.
  const renameView = useCallback(
    async (viewId: string, name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const previous = views;
      const target = previous.find((v) => v.id === viewId);
      if (!target) return false;
      setViews((prev) => prev.map((v) => (v.id === viewId ? { ...v, name: trimmed } : v)));
      try {
        await viewsApi.update(viewId, { name: trimmed });
        return true;
      } catch (err) {
        console.error('Failed to rename dashboard view', err);
        if (isForbidden(err)) reloadViews();
        else setViews(previous);
        return false;
      }
    },
    [views, reloadViews],
  );

  // Owner or write — overwrite the view's stored layout with the current (draft
  // or effective) layout, changing it for everyone it's shared with. Optimistic +
  // rollback. 403 → reloadViews.
  const resaveView = useCallback(
    async (viewId: string): Promise<boolean> => {
      const target = views.find((v) => v.id === viewId);
      if (!target) return false;
      const snapshot = cloneLayout(editing ? draft : effectiveLayout);
      // Preserve widget states the current viewer can't render (filtered out of their
      // permission-scoped widget set) from the view's raw stored layout, so re-saving doesn't
      // overwrite the shared view for everyone by dropping cards this user can't see.
      const visibleIds = new Set(widgetsRef.current.map((w) => w.id));
      const merged = [...snapshot, ...target.rawLayout.filter((w) => !visibleIds.has(w.id))];
      try {
        await viewsApi.update(viewId, { config: { layout: merged } });
        // Commit only after the server confirms, so a failed save never leaves the
        // library, the editing flag, and the override in a half-applied state.
        setViews((prev) =>
          prev.map((v) => (v.id === viewId ? { ...v, layout: snapshot, rawLayout: merged } : v)),
        );
        setEditing(false);
        applyOverride(cloneLayout(snapshot), viewId);
        return true;
      } catch (err) {
        console.error('Failed to re-save dashboard view', err);
        if (isForbidden(err)) reloadViews();
        return false;
      }
    },
    [views, editing, draft, effectiveLayout, applyOverride, reloadViews],
  );

  // Any access level → fork the view's layout into a NEW view owned by the caller.
  // The escape hatch for read recipients to get an editable copy. Waits for the
  // server id (no optimistic row), then pins this project to the new copy.
  const duplicateView = useCallback(
    async (viewId: string, name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const source = views.find((v) => v.id === viewId);
      if (!source) return false;
      // Copy the author's raw layout (not this viewer's permission-filtered one) so the duplicate
      // is a faithful copy that keeps cards the duplicator can't render.
      const snapshot = cloneLayout(source.rawLayout.length > 0 ? source.rawLayout : source.layout);
      setSavingView(true);
      try {
        const dto = await viewsApi.create({
          kind: 'dashboard',
          scopeKey,
          name: trimmed,
          config: { layout: snapshot },
        });
        const view = mapServerView(dto, widgetsRef.current);
        setViews((prev) => [...prev, view]);
        setEditing(false);
        applyOverride(cloneLayout(view.layout), view.id);
        return true;
      } catch (err) {
        console.error('Failed to duplicate dashboard view', err);
        return false;
      } finally {
        setSavingView(false);
      }
    },
    [views, scopeKey, applyOverride],
  );

  // Drop this project's override so it follows the shared global default again.
  const followGlobalDefault = useCallback(() => {
    setEditing(false);
    setOverride(null);
    persistOverride(null);
    setActiveViewId(null);
    persistActiveView(null);
    setDraft(globalLayout);
  }, [globalLayout, persistOverride, persistActiveView]);

  // Promote the current layout to the shared global default (affecting every
  // project that has no override of its own), then drop this project's override
  // so it follows that new default.
  const setAsGlobalDefault = useCallback(() => {
    const promoted = cloneLayout(editing ? draft : effectiveLayout);
    setEditing(false);
    setGlobalLayout(promoted);
    persistGlobalLayout(promoted);
    setOverride(null);
    persistOverride(null);
    setActiveViewId(null);
    persistActiveView(null);
    setDraft(promoted);
  }, [editing, draft, effectiveLayout, persistGlobalLayout, persistOverride, persistActiveView]);

  return {
    layout: editing ? draft : effectiveLayout,
    editing,
    views,
    activeViewId,
    viewsLoading,
    viewsError,
    savingView,
    reloadViews,
    followingGlobal: override === null,
    startEditing,
    cancelEditing,
    doneEditing,
    moveWidget,
    resizeWidget,
    toggleHidden,
    saveAsView,
    applyView,
    deleteView,
    renameView,
    resaveView,
    duplicateView,
    followGlobalDefault,
    setAsGlobalDefault,
  };
};
