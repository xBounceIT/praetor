import { useCallback, useMemo, useState } from 'react';
import {
  type DashboardLayout,
  type DashboardView,
  type DashboardWidgetDef,
  type DashboardWidgetSpan,
  generateDashboardViewId,
  getDashboardStorageKey,
  layoutsEqual,
  moveWidget,
  parseStoredDashboardViews,
  parseStoredLayout,
  parseStoredOverride,
  setWidgetHidden,
  setWidgetSpan,
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

export interface UseDashboardLayout {
  // The layout to render: the in-progress draft while editing, otherwise the
  // effective layout (per-project override if set, else the global default).
  layout: DashboardLayout;
  editing: boolean;
  views: DashboardView[];
  activeViewId: string | null;
  // True when this project has NO override and simply follows the global
  // default — drives the check mark on the "Use global default" menu item.
  followingGlobal: boolean;
  // Edit lifecycle
  startEditing: () => void;
  cancelEditing: () => void;
  doneEditing: () => void;
  // Draft mutators (meaningful only while editing)
  moveWidgetBy: (id: string, delta: number) => void;
  toggleHidden: (id: string) => void;
  setSpan: (id: string, span: DashboardWidgetSpan) => void;
  // Views (a global library shared across projects)
  saveAsView: (name: string) => void;
  applyView: (viewId: string) => void;
  deleteView: (viewId: string) => void;
  // Tiers
  followGlobalDefault: () => void; // clear this project's override
  setAsGlobalDefault: () => void; // promote the current layout to the global default
}

// Two-tier layout:
//   - `globalId` keys the shared baseline layout + the view library.
//   - `projectId` keys this project's optional override + which view it's on.
// The effective layout for the project = override ?? globalLayout. `widgets`
// must be a stable module constant (its identity is captured by callbacks).
export const useDashboardLayout = (
  globalId: string,
  projectId: string,
  widgets: readonly DashboardWidgetDef[],
): UseDashboardLayout => {
  const globalLayoutKey = getDashboardStorageKey(globalId, 'layout');
  const viewsKey = getDashboardStorageKey(globalId, 'views');
  const overrideKey = getDashboardStorageKey(projectId, 'override');
  const activeKey = getDashboardStorageKey(projectId, 'activeview');

  const [globalLayout, setGlobalLayout] = useState<DashboardLayout>(() =>
    parseStoredLayout(readLS(globalLayoutKey), widgets),
  );
  const [override, setOverride] = useState<DashboardLayout | null>(() =>
    parseStoredOverride(readLS(overrideKey), widgets),
  );
  const [views, setViews] = useState<DashboardView[]>(() =>
    parseStoredDashboardViews(readLS(viewsKey), widgets),
  );
  // Reconcile a persisted active-view id against the loaded views: a dangling id
  // (its view deleted in another tab, or a half-written storage pair) would
  // otherwise keep an inactive marker around with no matching view.
  const [activeViewId, setActiveViewId] = useState<string | null>(() => {
    const id = readLS(activeKey) || null;
    return id && views.some((v) => v.id === id) ? id : null;
  });
  const [editing, setEditing] = useState(false);

  const effectiveLayout = useMemo(() => override ?? globalLayout, [override, globalLayout]);
  const [draft, setDraft] = useState<DashboardLayout>(effectiveLayout);

  const persistGlobalLayout = useCallback(
    (next: DashboardLayout) => writeLS(globalLayoutKey, JSON.stringify(next)),
    [globalLayoutKey],
  );
  const persistOverride = useCallback(
    (next: DashboardLayout | null) => writeLS(overrideKey, next ? JSON.stringify(next) : null),
    [overrideKey],
  );
  const persistViews = useCallback(
    (next: DashboardView[]) => writeLS(viewsKey, JSON.stringify(next)),
    [viewsKey],
  );
  const persistActiveView = useCallback((id: string | null) => writeLS(activeKey, id), [activeKey]);

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

  const moveWidgetBy = useCallback((id: string, delta: number) => {
    setDraft((prev) => moveWidget(prev, id, delta));
  }, []);

  const toggleHidden = useCallback((id: string) => {
    setDraft((prev) => {
      const current = prev.find((w) => w.id === id);
      if (!current) return prev;
      return setWidgetHidden(prev, id, !current.hidden);
    });
  }, []);

  const setSpan = useCallback((id: string, span: DashboardWidgetSpan) => {
    setDraft((prev) => setWidgetSpan(prev, id, span));
  }, []);

  const saveAsView = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const snapshot = cloneLayout(editing ? draft : effectiveLayout);
      const newView: DashboardView = {
        id: generateDashboardViewId(),
        name: trimmed,
        layout: snapshot,
      };
      // Persist as a sibling statement (not inside the setState updater) so the
      // localStorage write stays out of a function React may invoke twice.
      const nextViews = [...views, newView];
      setViews(nextViews);
      persistViews(nextViews);
      setEditing(false);
      // Saving a view also pins this project to it (as an override).
      applyOverride(cloneLayout(snapshot), newView.id);
    },
    [editing, draft, effectiveLayout, views, persistViews, applyOverride],
  );

  const applyView = useCallback(
    (viewId: string) => {
      const view = views.find((v) => v.id === viewId);
      if (!view) return;
      setEditing(false);
      applyOverride(cloneLayout(view.layout), view.id);
    },
    [views, applyOverride],
  );

  const deleteView = useCallback(
    (viewId: string) => {
      const nextViews = views.filter((v) => v.id !== viewId);
      setViews(nextViews);
      persistViews(nextViews);
      // Deleting the active view detaches the marker but leaves the project's
      // override layout in place.
      if (activeViewId === viewId) {
        setActiveViewId(null);
        persistActiveView(null);
      }
    },
    [views, activeViewId, persistViews, persistActiveView],
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
    followingGlobal: override === null,
    startEditing,
    cancelEditing,
    doneEditing,
    moveWidgetBy,
    toggleHidden,
    setSpan,
    saveAsView,
    applyView,
    deleteView,
    followGlobalDefault,
    setAsGlobalDefault,
  };
};
