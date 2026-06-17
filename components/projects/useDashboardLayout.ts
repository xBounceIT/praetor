import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ApiError } from '../../services/api/client';
import { type SavedViewDto, viewsApi } from '../../services/api/views';
import {
  type DashboardLayout,
  type DashboardView,
  type DashboardWidgetDef,
  getDashboardStorageKey,
  layoutsEqual,
  moveWidgetTo,
  parseServerViewConfig,
  parseServerViewRawLayout,
  parseStoredDashboardViews,
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

type DashboardViewLibraryState = {
  dtos: SavedViewDto[];
  loading: boolean;
  error: boolean;
  saving: boolean;
};

type DashboardViewLibraryAction =
  | { type: 'load-start' }
  | { type: 'load-success'; dtos: SavedViewDto[] }
  | { type: 'load-empty' }
  | { type: 'load-error' }
  | { type: 'saving'; saving: boolean }
  | { type: 'append'; dto: SavedViewDto }
  | { type: 'remove'; id: string }
  | { type: 'replace'; dto: SavedViewDto }
  | { type: 'restore'; dtos: SavedViewDto[] };

const dashboardViewLibraryReducer = (
  state: DashboardViewLibraryState,
  action: DashboardViewLibraryAction,
): DashboardViewLibraryState => {
  switch (action.type) {
    case 'load-start':
      return { ...state, loading: true, error: false };
    case 'load-success':
      return { ...state, dtos: action.dtos, loading: false, error: false };
    case 'load-empty':
      return { ...state, dtos: [], loading: false, error: false };
    case 'load-error':
      return { ...state, loading: false, error: true };
    case 'saving':
      return state.saving === action.saving ? state : { ...state, saving: action.saving };
    case 'append':
      return { ...state, dtos: [...state.dtos, action.dto] };
    case 'remove':
      return { ...state, dtos: state.dtos.filter((dto) => dto.id !== action.id) };
    case 'replace':
      return {
        ...state,
        dtos: state.dtos.map((dto) => (dto.id === action.dto.id ? action.dto : dto)),
      };
    case 'restore':
      return { ...state, dtos: action.dtos };
  }
};

const resolveStateAction = <Value,>(value: SetStateAction<Value>, previous: Value): Value =>
  typeof value === 'function' ? (value as (prev: Value) => Value)(previous) : value;

type DashboardEditSessionState =
  | { editing: false }
  | { editing: true; draft: DashboardLayout };

type DashboardEditSessionAction =
  | { type: 'start'; layout: DashboardLayout }
  | { type: 'close' }
  | { type: 'update-draft'; value: SetStateAction<DashboardLayout> };

const dashboardEditSessionReducer = (
  state: DashboardEditSessionState,
  action: DashboardEditSessionAction,
): DashboardEditSessionState => {
  switch (action.type) {
    case 'start':
      return { editing: true, draft: action.layout };
    case 'close':
      return { editing: false };
    case 'update-draft':
      if (!state.editing) return state;
      return { editing: true, draft: resolveStateAction(action.value, state.draft) };
  }
};

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
  const [viewLibraryState, dispatchViewLibrary] = useReducer(dashboardViewLibraryReducer, {
    dtos: [],
    loading: true,
    error: false,
    saving: false,
  });
  // The active-view id is per-project UI state and stays local. It is reconciled
  // against the loaded server views below: a dangling id (its view deleted by the
  // owner, or unshared from this user) drops to null so no inactive marker lingers.
  const [activeViewId, setActiveViewId] = useReducer(
    (previous: string | null, value: SetStateAction<string | null>) =>
      resolveStateAction(value, previous),
    null,
    () => readLS(activeKey) || null,
  );
  const [editSession, dispatchEditSession] = useReducer(dashboardEditSessionReducer, {
    editing: false,
  });

  const views = useMemo(
    () => viewLibraryState.dtos.map((dto) => mapServerView(dto, widgets)),
    [viewLibraryState.dtos, widgets],
  );
  const activeViewLayout = useMemo(
    () => views.find((view) => view.id === activeViewId)?.layout ?? null,
    [views, activeViewId],
  );
  const effectiveLayout = useMemo(
    () => activeViewLayout ?? override ?? globalLayout,
    [activeViewLayout, override, globalLayout],
  );
  const editing = editSession.editing;
  const draft = editSession.editing ? editSession.draft : effectiveLayout;

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
  const persistGlobalLayout = useCallback(
    (next: DashboardLayout) => writeLS(globalLayoutKey, JSON.stringify(next)),
    [globalLayoutKey],
  );
  const persistOverride = useCallback(
    (next: DashboardLayout | null) => writeLS(overrideKey, next ? JSON.stringify(next) : null),
    [overrideKey],
  );
  const persistActiveView = useCallback((id: string | null) => writeLS(activeKey, id), [activeKey]);

  // Reconcile the active marker against a freshly loaded library:
  //  - active view gone (deleted / unshared elsewhere) → drop the marker; the override
  //    layout stays put as a now-custom layout.
  //  - active view still present → no state copy is needed; `effectiveLayout`
  //    resolves the current server layout directly from `views`.
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
    },
    [persistActiveView],
  );

  // One-time, best-effort migration of legacy localStorage dashboard views (the pre-server
  // `praetor_dashboard_v2_views_*` library) into the server store on the first server-backed load.
  // Mirrors the table migration: a per-scope sentinel tracks progress ('pending' → 'done'); a view
  // is dropped from localStorage only once uploaded and the sentinel reaches 'done' only after all
  // upload, so a transient failure retries the leftovers. If THIS project had a legacy view active,
  // its marker is re-pointed at the new server id so the preset stays applied after upgrade.
  const migrateLegacyDashboardViews = useCallback(
    async (key: string, noOwnViews: boolean, isCurrent: () => boolean): Promise<boolean> => {
      const sentinelKey = `praetor_dashboard_v2_viewsmigrated_${key}`;
      const legacyViewsKey = getDashboardStorageKey(key, 'views');
      const state = readLS(sentinelKey);
      if (state === 'done') return false;

      const legacy = parseStoredDashboardViews(readLS(legacyViewsKey), widgetsRef.current);

      if (state !== 'pending') {
        // First attempt: nothing to migrate, or the user already has OWN views on the server
        // (migrated on another device) → mark done. Shared-with-me views don't count, so another
        // user's shared view can't suppress migrating this user's local presets.
        if (legacy.length === 0 || !noOwnViews) {
          writeLS(sentinelKey, 'done');
          return false;
        }
        // Commit to migrating: 'pending' resumes a transient failure on a later load.
        writeLS(sentinelKey, 'pending');
      }

      const activeId = activeViewIdRef.current;
      const uploadResults = await Promise.all(
        legacy.map(async (view) => {
          if (!isCurrent()) return { status: 'skipped' as const, view };
          try {
            const dto = await viewsApi.create({
              kind: 'dashboard',
              scopeKey: key,
              name: view.name,
              config: { layout: view.layout },
            });
            return { status: 'uploaded' as const, view, dto };
          } catch (err) {
            console.error('Failed to migrate a legacy dashboard view', err);
            return { status: 'failed' as const, view };
          }
        }),
      );

      const remaining: DashboardView[] = [];
      let uploaded = false;
      for (const result of uploadResults) {
        if (result.status !== 'uploaded') {
          remaining.push(result.view);
          continue;
        }
        uploaded = true;
        // If this project had the legacy view active, re-point its marker at the new server id
        // (and the ref, so the post-load reconcile matches it instead of clearing a dangling id).
        const uploadedViewId = result.dto.id;
        if (result.view.id === activeId && isCurrent()) {
          setActiveViewId(uploadedViewId);
          persistActiveView(uploadedViewId);
          activeViewIdRef.current = uploadedViewId;
        }
      }

      if (remaining.length === 0) {
        writeLS(sentinelKey, 'done');
        writeLS(legacyViewsKey, null);
      } else {
        // Keep only the not-yet-uploaded views; the 'pending' sentinel stays so a later load retries.
        writeLS(legacyViewsKey, JSON.stringify(remaining));
      }
      return uploaded;
    },
    [persistActiveView],
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
      dispatchViewLibrary({ type: 'load-empty' });
      return;
    }
    dispatchViewLibrary({ type: 'load-start' });
    try {
      let dtos = await viewsApi.list('dashboard', scopeKey);
      if (seq === loadSeqRef.current) {
        // One-time migration of pre-upgrade localStorage dashboard views; re-list if anything uploaded.
        const migrated = await migrateLegacyDashboardViews(
          scopeKey,
          !dtos.some((d) => d.access === 'owner'),
          () => seq === loadSeqRef.current,
        );
        if (seq === loadSeqRef.current && migrated) {
          dtos = await viewsApi.list('dashboard', scopeKey);
        }
      }
      if (seq === loadSeqRef.current) {
        const mapped = dtos.map((dto) => mapServerView(dto, widgetsRef.current));
        dispatchViewLibrary({ type: 'load-success', dtos });
        reconcileAfterLoad(mapped);
      }
    } catch (err) {
      if (seq === loadSeqRef.current) {
        console.error('Failed to load dashboard views', err);
        dispatchViewLibrary({ type: 'load-error' });
      }
    }
  }, [currentUserId, scopeKey, reconcileAfterLoad, migrateLegacyDashboardViews]);

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
    dispatchEditSession({ type: 'start', layout: effectiveLayout });
  }, [effectiveLayout]);

  const cancelEditing = useCallback(() => {
    dispatchEditSession({ type: 'close' });
  }, []);

  const doneEditing = useCallback(() => {
    dispatchEditSession({ type: 'close' });
    // Applying an edited draft makes this project's layout custom (an override).
    // Keep the active view only if the draft still matches it exactly.
    const active = activeViewId ? views.find((v) => v.id === activeViewId) : undefined;
    const keepActive = active && layoutsEqual(active.layout, draft) ? activeViewId : null;
    applyOverride(cloneLayout(draft), keepActive);
  }, [draft, activeViewId, views, applyOverride]);

  const moveWidget = useCallback((id: string, x: number, y: number) => {
    dispatchEditSession({
      type: 'update-draft',
      value: (prev) => moveWidgetTo(prev, id, x, y),
    });
  }, []);

  const resizeWidget = useCallback(
    (id: string, w: number, h: number) => {
      const min = minSizes.get(id);
      dispatchEditSession({
        type: 'update-draft',
        value: (prev) => resizeWidgetTo(prev, id, w, h, min?.minW ?? 1, min?.minH ?? 1),
      });
    },
    [minSizes],
  );

  const toggleHidden = useCallback((id: string) => {
    dispatchEditSession({
      type: 'update-draft',
      value: (prev) => toggleWidgetHidden(prev, id),
    });
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
      dispatchViewLibrary({ type: 'saving', saving: true });
      try {
        const dto = await viewsApi.create({
          kind: 'dashboard',
          scopeKey,
          name: trimmed,
          config: { layout: snapshot },
        });
        const view = mapServerView(dto, widgetsRef.current);
        dispatchViewLibrary({ type: 'append', dto });
        dispatchEditSession({ type: 'close' });
        // Saving a view also pins this project to it (as an override).
        applyOverride(cloneLayout(view.layout), view.id);
        return true;
      } catch (err) {
        console.error('Failed to save dashboard view', err);
        return false;
      } finally {
        dispatchViewLibrary({ type: 'saving', saving: false });
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
      dispatchEditSession({ type: 'close' });
      applyOverride(parseServerViewConfig({ layout: view.layout }, widgetsRef.current), view.id);
    },
    [views, applyOverride],
  );

  // Owner-only. Optimistic remove + rollback on failure. A 403 (ownership lost
  // mid-session) self-corrects via reloadViews rather than a silent rollback.
  // Errors are handled internally (callers fire-and-forget), so this never rejects.
  const deleteView = useCallback(
    async (viewId: string): Promise<void> => {
      const previous = viewLibraryState.dtos;
      const target = previous.find((v) => v.id === viewId);
      if (!target) return;
      dispatchViewLibrary({ type: 'remove', id: viewId });
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
          dispatchViewLibrary({ type: 'restore', dtos: previous });
          if (activeViewId === viewId) {
            setActiveViewId(viewId);
            persistActiveView(viewId);
          }
        }
      }
    },
    [viewLibraryState.dtos, activeViewId, persistActiveView, reloadViews],
  );

  // Owner or write. Optimistic name swap + rollback. 403 → reloadViews.
  const renameView = useCallback(
    async (viewId: string, name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const previous = viewLibraryState.dtos;
      const target = previous.find((v) => v.id === viewId);
      if (!target) return false;
      dispatchViewLibrary({ type: 'replace', dto: { ...target, name: trimmed } });
      try {
        const dto = await viewsApi.update(viewId, { name: trimmed });
        dispatchViewLibrary({ type: 'replace', dto });
        return true;
      } catch (err) {
        console.error('Failed to rename dashboard view', err);
        if (isForbidden(err)) reloadViews();
        else dispatchViewLibrary({ type: 'restore', dtos: previous });
        return false;
      }
    },
    [viewLibraryState.dtos, reloadViews],
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
        const dto = await viewsApi.update(viewId, { config: { layout: merged } });
        // Commit only after the server confirms, so a failed save never leaves the
        // library, the editing flag, and the override in a half-applied state.
        dispatchViewLibrary({ type: 'replace', dto });
        dispatchEditSession({ type: 'close' });
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
      dispatchViewLibrary({ type: 'saving', saving: true });
      try {
        const dto = await viewsApi.create({
          kind: 'dashboard',
          scopeKey,
          name: trimmed,
          config: { layout: snapshot },
        });
        const view = mapServerView(dto, widgetsRef.current);
        dispatchViewLibrary({ type: 'append', dto });
        dispatchEditSession({ type: 'close' });
        applyOverride(cloneLayout(view.layout), view.id);
        return true;
      } catch (err) {
        console.error('Failed to duplicate dashboard view', err);
        return false;
      } finally {
        dispatchViewLibrary({ type: 'saving', saving: false });
      }
    },
    [views, scopeKey, applyOverride],
  );

  // Drop this project's override so it follows the shared global default again.
  const followGlobalDefault = useCallback(() => {
    dispatchEditSession({ type: 'close' });
    setOverride(null);
    persistOverride(null);
    setActiveViewId(null);
    persistActiveView(null);
  }, [persistOverride, persistActiveView]);

  // Promote the current layout to the shared global default (affecting every
  // project that has no override of its own), then drop this project's override
  // so it follows that new default.
  const setAsGlobalDefault = useCallback(() => {
    const promoted = cloneLayout(editing ? draft : effectiveLayout);
    dispatchEditSession({ type: 'close' });
    setGlobalLayout(promoted);
    persistGlobalLayout(promoted);
    setOverride(null);
    persistOverride(null);
    setActiveViewId(null);
    persistActiveView(null);
  }, [editing, draft, effectiveLayout, persistGlobalLayout, persistOverride, persistActiveView]);

  return {
    layout: editing ? draft : effectiveLayout,
    editing,
    views,
    activeViewId,
    viewsLoading: viewLibraryState.loading,
    viewsError: viewLibraryState.error,
    savingView: viewLibraryState.saving,
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
