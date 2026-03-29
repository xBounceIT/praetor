import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../../services/api';
import type {
  DashboardWidget,
  DashboardWidgetDataResult,
  ReportDashboard,
} from '../../services/api/reports';
import { buildPermission, hasPermission } from '../../utils/permissions';
import NotFound from '../NotFound';
import Modal from '../shared/Modal';
import {
  CHART_COLORS,
  DASHBOARD_GRID_GAP_PX,
  DASHBOARD_GRID_ROW_HEIGHT_PX,
  DASHBOARD_WIDGET_DEFAULT_HEIGHT,
  DASHBOARD_WIDGET_DEFAULT_WIDTH,
  DASHBOARD_WIDGET_MAX_HEIGHT,
  DASHBOARD_WIDGET_MAX_WIDTH,
  DASHBOARD_WIDGET_MIN_HEIGHT,
  DASHBOARD_WIDGET_MIN_WIDTH,
} from './dashboardConstants';
import {
  getAccessibleDashboardDatasets,
  widgetHasRestrictedDashboardDatasets,
} from './dashboardPermissions';
import { buildDashboardBarChartRows, getDashboardQueryDisplayName } from './dashboardWidgetUtils';
import WidgetEditor from './WidgetEditor';

type WidgetRoute = { mode: 'new' } | { mode: 'edit'; widgetId: string };
type DashboardMode = 'readonly' | 'edit';
type WidgetSize = { width: number; height: number };

type ResizeInteractionState = {
  widgetId: string;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  currentWidth: number;
  currentHeight: number;
  cellWidth: number;
  gridColumnCount: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

const normalizeWidgetWidth = (value?: number) =>
  clamp(
    Number.isFinite(value) ? Math.floor(value as number) : DASHBOARD_WIDGET_DEFAULT_WIDTH,
    DASHBOARD_WIDGET_MIN_WIDTH,
    DASHBOARD_WIDGET_MAX_WIDTH,
  );

const normalizeWidgetHeight = (value?: number) =>
  clamp(
    Number.isFinite(value) ? Math.floor(value as number) : DASHBOARD_WIDGET_DEFAULT_HEIGHT,
    DASHBOARD_WIDGET_MIN_HEIGHT,
    DASHBOARD_WIDGET_MAX_HEIGHT,
  );

const getGridColumnCount = (viewportWidth: number) => {
  if (viewportWidth >= 1280) return 12;
  if (viewportWidth >= 768) return 6;
  return 1;
};

const getInitialGridColumnCount = () => {
  if (typeof window === 'undefined') return 12;
  return getGridColumnCount(window.innerWidth);
};

const getColumnResizeStep = (gridColumnCount: number) => (gridColumnCount >= 12 ? 1 : 2);

const getRenderWidthSpan = (widgetWidth: number, gridColumnCount: number) => {
  if (gridColumnCount >= 12) {
    return clamp(widgetWidth, 1, 12);
  }
  if (gridColumnCount >= 6) {
    return clamp(Math.ceil(widgetWidth / 2), 1, 6);
  }
  return 1;
};

const buildEmptyWidgetDataResult = (widget: DashboardWidget): DashboardWidgetDataResult => ({
  groupBy: widget.groupBy,
  queries: widget.queries.map((query) => ({
    id: query.id,
    ref: query.ref,
    label: query.label,
    dataset: query.dataset,
    metric: query.metric,
    total: 0,
    series: [],
  })),
});

export interface DashboardDetailProps {
  permissions: string[];
  dashboardId: string;
  activeWidgetRoute: WidgetRoute | null;
  onBack: () => void;
  onWidgetRouteChange: (route: WidgetRoute | null) => void;
}

const DashboardDetail: React.FC<DashboardDetailProps> = ({
  permissions,
  dashboardId,
  activeWidgetRoute,
  onBack,
  onWidgetRouteChange,
}) => {
  const { t } = useTranslation('reports');
  const [dashboards, setDashboards] = useState<
    Awaited<ReturnType<typeof api.reports.listDashboards>>
  >([]);
  const [renameValue, setRenameValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [widgetData, setWidgetData] = useState<Record<string, DashboardWidgetDataResult>>({});
  const [recentlyAddedWidgetId, setRecentlyAddedWidgetId] = useState<string | null>(null);
  const [widgetPendingDelete, setWidgetPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>('readonly');
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [gridColumnCount, setGridColumnCount] = useState(getInitialGridColumnCount);
  const [resizingWidgetId, setResizingWidgetId] = useState<string | null>(null);
  const [draftWidgetSizes, setDraftWidgetSizes] = useState<Record<string, WidgetSize>>({});

  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<ResizeInteractionState | null>(null);
  const removeResizeListenersRef = useRef<(() => void) | null>(null);
  const widgetDataRequestRef = useRef<AbortController | null>(null);
  const widgetDataRunRef = useRef(0);

  const canUpdate = hasPermission(permissions, buildPermission('reports.dashboard', 'update'));
  const canDelete = hasPermission(permissions, buildPermission('reports.dashboard', 'delete'));
  const canManageDashboard = canUpdate || canDelete;
  const isEditMode = dashboardMode === 'edit';
  const canMutateDashboard = canManageDashboard && isEditMode;
  const canMutateWidgets = canUpdate && isEditMode;
  const accessibleDatasets = useMemo(
    () => getAccessibleDashboardDatasets(permissions),
    [permissions],
  );
  const hasAccessibleDatasets = accessibleDatasets.length > 0;
  const canAddWidgets = canMutateWidgets && hasAccessibleDatasets;

  const dashboard = useMemo(
    () => dashboards.find((d) => d.id === dashboardId) || null,
    [dashboards, dashboardId],
  );

  const clearResizeListeners = () => {
    if (removeResizeListenersRef.current) {
      removeResizeListenersRef.current();
      removeResizeListenersRef.current = null;
    }
    resizeStateRef.current = null;
  };

  const persistWidgetResize = async (widgetId: string, width: number, height: number) => {
    if (!dashboard || !canUpdate || !isEditMode) return;

    const nextWidth = normalizeWidgetWidth(width);
    const nextHeight = normalizeWidgetHeight(height);
    const currentWidget = dashboard.widgets.find((widget) => widget.id === widgetId);
    if (!currentWidget) return;

    const currentWidth = normalizeWidgetWidth(currentWidget.width);
    const currentHeight = normalizeWidgetHeight(currentWidget.height);
    if (currentWidth === nextWidth && currentHeight === nextHeight) return;

    const updatedWidgets = dashboard.widgets.map((widget) =>
      widget.id === widgetId ? { ...widget, width: nextWidth, height: nextHeight } : widget,
    );

    try {
      const updated = await api.reports.updateDashboard(dashboard.id, { widgets: updatedWidgets });
      setDashboards((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
    }
  };

  const startWidgetResize = (
    event: React.PointerEvent<HTMLButtonElement>,
    widgetId: string,
    width: number,
    height: number,
  ) => {
    if (!canMutateWidgets || gridColumnCount <= 1) return;
    if (!gridRef.current) return;

    event.preventDefault();
    event.stopPropagation();

    const gridRect = gridRef.current.getBoundingClientRect();
    const totalGap = DASHBOARD_GRID_GAP_PX * Math.max(gridColumnCount - 1, 0);
    const cellWidth = (gridRect.width - totalGap) / gridColumnCount;
    if (!Number.isFinite(cellWidth) || cellWidth <= 0) return;

    clearResizeListeners();
    setResizingWidgetId(widgetId);
    setDraftWidgetSizes((prev) => ({ ...prev, [widgetId]: { width, height } }));

    resizeStateRef.current = {
      widgetId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: width,
      startHeight: height,
      currentWidth: width,
      currentHeight: height,
      cellWidth,
      gridColumnCount,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.widgetId !== widgetId) return;

      const deltaCols = Math.round(
        (moveEvent.clientX - resizeState.startX) / (resizeState.cellWidth + DASHBOARD_GRID_GAP_PX),
      );
      const deltaRows = Math.round(
        (moveEvent.clientY - resizeState.startY) /
          (DASHBOARD_GRID_ROW_HEIGHT_PX + DASHBOARD_GRID_GAP_PX),
      );

      const widthStep = getColumnResizeStep(resizeState.gridColumnCount);
      const nextWidth = clamp(
        resizeState.startWidth + deltaCols * widthStep,
        DASHBOARD_WIDGET_MIN_WIDTH,
        DASHBOARD_WIDGET_MAX_WIDTH,
      );
      const nextHeight = clamp(
        resizeState.startHeight + deltaRows,
        DASHBOARD_WIDGET_MIN_HEIGHT,
        DASHBOARD_WIDGET_MAX_HEIGHT,
      );

      if (nextWidth === resizeState.currentWidth && nextHeight === resizeState.currentHeight) {
        return;
      }

      resizeState.currentWidth = nextWidth;
      resizeState.currentHeight = nextHeight;
      setDraftWidgetSizes((prev) => ({
        ...prev,
        [widgetId]: { width: nextWidth, height: nextHeight },
      }));
    };

    const handlePointerEnd = () => {
      const resizeState = resizeStateRef.current;
      clearResizeListeners();
      setResizingWidgetId(null);
      setDraftWidgetSizes((prev) => {
        const next = { ...prev };
        delete next[widgetId];
        return next;
      });

      if (!resizeState || resizeState.widgetId !== widgetId) return;
      void persistWidgetResize(
        widgetId,
        normalizeWidgetWidth(resizeState.currentWidth),
        normalizeWidgetHeight(resizeState.currentHeight),
      );
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    removeResizeListenersRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  };

  const getWidgetSize = (widget: DashboardWidget): WidgetSize => {
    const draftSize = draftWidgetSizes[widget.id];
    return {
      width: normalizeWidgetWidth(draftSize?.width ?? widget.width),
      height: normalizeWidgetHeight(draftSize?.height ?? widget.height),
    };
  };

  useEffect(() => {
    return () => {
      if (removeResizeListenersRef.current) {
        removeResizeListenersRef.current();
        removeResizeListenersRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const data = await api.reports.listDashboards();
        setDashboards(data);
      } catch (err) {
        setError((err as Error).message || t('dashboard.error'));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [t]);

  useEffect(() => {
    setRenameValue(dashboard?.name || '');
  }, [dashboard]);

  useEffect(() => {
    if (!recentlyAddedWidgetId) return;
    const timer = window.setTimeout(() => {
      setRecentlyAddedWidgetId(null);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [recentlyAddedWidgetId]);

  useEffect(() => {
    if (!dashboardId) return;
    setDashboardMode('readonly');
    setIsModeMenuOpen(false);
    setIsEditModalOpen(false);
    setWidgetPendingDelete(null);
    if (removeResizeListenersRef.current) {
      removeResizeListenersRef.current();
      removeResizeListenersRef.current = null;
    }
    resizeStateRef.current = null;
    setResizingWidgetId(null);
    setDraftWidgetSizes({});
  }, [dashboardId]);

  useEffect(() => {
    if (isEditMode) return;
    setIsEditModalOpen(false);
    setWidgetPendingDelete(null);
    if (removeResizeListenersRef.current) {
      removeResizeListenersRef.current();
      removeResizeListenersRef.current = null;
    }
    resizeStateRef.current = null;
    setResizingWidgetId(null);
    setDraftWidgetSizes({});
  }, [isEditMode]);

  useEffect(() => {
    if (!dashboard || !activeWidgetRoute || activeWidgetRoute.mode !== 'edit') return;
    const exists = dashboard.widgets.some((widget) => widget.id === activeWidgetRoute.widgetId);
    if (!exists) {
      onWidgetRouteChange(null);
    }
  }, [dashboard, activeWidgetRoute, onWidgetRouteChange]);

  useEffect(() => {
    if (!activeWidgetRoute) return;
    if (!canUpdate) {
      onWidgetRouteChange(null);
      return;
    }
    if (dashboardMode !== 'edit') {
      setDashboardMode('edit');
    }
  }, [activeWidgetRoute, canUpdate, dashboardMode, onWidgetRouteChange]);

  useEffect(() => {
    const runId = ++widgetDataRunRef.current;
    if (widgetDataRequestRef.current) {
      widgetDataRequestRef.current.abort();
      widgetDataRequestRef.current = null;
    }

    if (!dashboard || dashboard.widgets.length === 0) {
      setWidgetData({});
      return;
    }

    const abortController = new AbortController();
    widgetDataRequestRef.current = abortController;
    setWidgetData({});

    const loadWidgetData = async () => {
      const results = await Promise.all(
        dashboard.widgets.map(async (widget) => {
          try {
            const response = await api.reports.getDashboardWidgetData(widget, {
              signal: abortController.signal,
            });
            return [widget.id, response] as const;
          } catch {
            if (abortController.signal.aborted) {
              return null;
            }
            return [widget.id, buildEmptyWidgetDataResult(widget)] as const;
          }
        }),
      );

      if (widgetDataRunRef.current !== runId || abortController.signal.aborted) return;
      setWidgetData(
        Object.fromEntries(
          results.filter((result): result is readonly [string, DashboardWidgetDataResult] =>
            Boolean(result),
          ),
        ),
      );
    };

    void loadWidgetData();

    return () => {
      abortController.abort();
      if (widgetDataRequestRef.current === abortController) {
        widgetDataRequestRef.current = null;
      }
    };
  }, [dashboard]);

  useEffect(() => {
    const handleResize = () => {
      setGridColumnCount(getGridColumnCount(window.innerWidth));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isModeMenuOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(event.target as Node)) {
        setIsModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isModeMenuOpen]);

  const saveDashboardName = async () => {
    if (!canUpdate || !canMutateDashboard || !dashboard || !renameValue.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      const updated = await api.reports.updateDashboard(dashboard.id, {
        name: renameValue.trim(),
      });
      setDashboards((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setIsEditModalOpen(false);
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDashboard = async () => {
    if (!canDelete || !canMutateDashboard || !dashboard) return;
    setIsSaving(true);
    setError('');
    try {
      await api.reports.deleteDashboard(dashboard.id);
      onBack();
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
      setIsSaving(false);
    }
  };

  const openDeleteWidgetModal = (widgetId: string, title: string) => {
    if (!canMutateWidgets || isSaving) return;
    setWidgetPendingDelete({ id: widgetId, title });
  };

  const closeDeleteWidgetModal = () => {
    if (isSaving) return;
    setWidgetPendingDelete(null);
  };

  const removeWidget = async (widgetId: string): Promise<boolean> => {
    if (!canMutateWidgets || !dashboard) return false;
    setIsSaving(true);
    setError('');
    try {
      const updated = await api.reports.updateDashboard(dashboard.id, {
        widgets: dashboard.widgets.filter((widget) => widget.id !== widgetId),
      });
      setDashboards((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      return true;
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDeleteWidget = async () => {
    if (!widgetPendingDelete) return;
    const removed = await removeWidget(widgetPendingDelete.id);
    if (removed) {
      setWidgetPendingDelete(null);
    }
  };

  const handleWidgetSaved = (payload: {
    dashboard: ReportDashboard;
    mode: 'new' | 'edit';
    widgetId: string;
  }) => {
    setDashboards((prev) =>
      prev.map((item) => (item.id === payload.dashboard.id ? payload.dashboard : item)),
    );
    if (payload.mode === 'new') {
      setRecentlyAddedWidgetId(payload.widgetId);
    }
    onWidgetRouteChange(null);
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        <i className="fa-solid fa-circle-notch fa-spin mr-2" />
        {t('dashboard.loading')}
      </div>
    );
  }

  if (!dashboard) {
    return <NotFound onReturn={onBack} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          >
            <i className="fa-solid fa-arrow-left text-xs" />
            {t('dashboard.browser.backToDashboards')}
          </button>
          <h2 className="text-xl font-black text-slate-800">{dashboard.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          {canManageDashboard && (
            <button
              type="button"
              onClick={() => setIsEditModalOpen(true)}
              disabled={!canMutateDashboard || isSaving}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <i className="fa-solid fa-pen text-xs" />
              {t('dashboard.editDashboard')}
            </button>
          )}

          {canManageDashboard && (
            <div className="relative" ref={modeMenuRef}>
              <button
                type="button"
                onClick={() => setIsModeMenuOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                aria-haspopup="menu"
                aria-expanded={isModeMenuOpen}
              >
                <i
                  className={`fa-solid ${isEditMode ? 'fa-pen-to-square text-slate-600' : 'fa-eye text-slate-500'} text-xs`}
                />
                {isEditMode ? t('dashboard.modes.edit') : t('dashboard.modes.readOnly')}
                <i className="fa-solid fa-chevron-down text-[10px]" />
              </button>

              {isModeMenuOpen && (
                <div
                  className="absolute right-0 z-30 mt-2 w-48 rounded-2xl border border-slate-200 bg-white py-2 shadow-xl animate-in fade-in zoom-in-95 duration-150 origin-top-right"
                  role="menu"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDashboardMode('readonly');
                      onWidgetRouteChange(null);
                      setIsModeMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    role="menuitem"
                  >
                    <span className="flex items-center gap-2">
                      <i className="fa-solid fa-eye text-xs text-slate-500" />
                      {t('dashboard.modes.readOnly')}
                    </span>
                    {dashboardMode === 'readonly' && (
                      <i className="fa-solid fa-check text-xs text-praetor" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDashboardMode('edit');
                      setIsModeMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    role="menuitem"
                  >
                    <span className="flex items-center gap-2">
                      <i className="fa-solid fa-pen-to-square text-xs text-slate-500" />
                      {t('dashboard.modes.edit')}
                    </span>
                    {dashboardMode === 'edit' && (
                      <i className="fa-solid fa-check text-xs text-praetor" />
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {canUpdate && (
            <button
              type="button"
              onClick={() => onWidgetRouteChange({ mode: 'new' })}
              disabled={!canAddWidgets || isSaving}
              className="flex items-center gap-2 rounded-xl bg-praetor px-5 py-2.5 text-sm font-black text-white shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
            >
              <i className="fa-solid fa-plus" />
              {t('dashboard.addVisualization')}
            </button>
          )}
        </div>
      </div>

      {canManageDashboard && !isEditMode && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          <i className="fa-solid fa-eye mr-1.5 text-slate-500" />
          {t('dashboard.readOnlyHint')}
        </div>
      )}

      {canMutateWidgets && !hasAccessibleDatasets && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          {t('dashboard.widgetEditor.noAccessibleDatasets')}
        </div>
      )}

      {/* Widget grid */}
      <div
        ref={gridRef}
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, 1fr))`,
          gridAutoRows: `${DASHBOARD_GRID_ROW_HEIGHT_PX}px`,
          gridAutoFlow: 'row dense',
        }}
      >
        {dashboard.widgets.map((widget) => {
          const data = widgetData[widget.id];
          const widgetSize = getWidgetSize(widget);
          const renderWidth = getRenderWidthSpan(widgetSize.width, gridColumnCount);
          const pieQuery = data?.queries[0];
          const barRows = data ? buildDashboardBarChartRows(data, widget.limit ?? 8) : [];
          const hasSeriesData = Boolean(data?.queries.some((query) => query.series.length > 0));
          const isWidgetEditable = !widgetHasRestrictedDashboardDatasets(widget, permissions);

          return (
            <div
              key={widget.id}
              style={{
                gridColumn: `span ${renderWidth} / span ${renderWidth}`,
                gridRow: `span ${widgetSize.height} / span ${widgetSize.height}`,
              }}
              className={`relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${
                recentlyAddedWidgetId === widget.id
                  ? 'dashboard-widget-pop ring-2 ring-blue-200'
                  : ''
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h4 className="text-base font-bold text-slate-800">{widget.title}</h4>
                  <p className="text-xs text-slate-500">
                    {t('dashboard.editModal.groupByLabel')}:{' '}
                    {t(`dashboard.groupBy.${widget.groupBy}`)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {widget.queries.map((query) => (
                      <span
                        key={query.id}
                        className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500"
                      >
                        {getDashboardQueryDisplayName(query)} ·{' '}
                        {t(`dashboard.datasets.${query.dataset}`)} ·{' '}
                        {t(`dashboard.metrics.${query.metric}`)}
                      </span>
                    ))}
                  </div>
                  {widget.description && (
                    <p className="mt-1 text-xs text-slate-500">{widget.description}</p>
                  )}
                  {widget.tags && widget.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {widget.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {canMutateWidgets && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onWidgetRouteChange({ mode: 'edit', widgetId: widget.id })}
                      disabled={!isWidgetEditable}
                      aria-label={
                        isWidgetEditable
                          ? t('dashboard.editDashboard')
                          : t('dashboard.widgetEditor.restrictedDatasetEditBlocked')
                      }
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <i className="fa-solid fa-pen text-[10px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openDeleteWidgetModal(widget.id, widget.title)}
                      className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700"
                      aria-label={t('dashboard.deleteWidgetAction')}
                      title={t('dashboard.deleteWidgetAction')}
                    >
                      <i className="fa-solid fa-trash text-[10px]" />
                    </button>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1">
                {!data ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    <i className="fa-solid fa-circle-notch fa-spin mr-2" />
                    {t('dashboard.loadingWidget')}
                  </div>
                ) : !hasSeriesData ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    {t('dashboard.noData')}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    {widget.chartType === 'pie' && pieQuery ? (
                      <PieChart>
                        <Pie
                          data={pieQuery.series}
                          dataKey="value"
                          nameKey="label"
                          outerRadius={90}
                          label
                        >
                          {pieQuery.series.map((entry, index) => (
                            <Cell
                              key={`${entry.label}-${index}`}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip />
                        {(widget.legendMode || 'list') !== 'hidden' && (
                          <Legend
                            verticalAlign={
                              (widget.legendPlacement || 'bottom') === 'right' ? 'middle' : 'bottom'
                            }
                            align={
                              (widget.legendPlacement || 'bottom') === 'right' ? 'right' : 'center'
                            }
                            layout={
                              (widget.legendPlacement || 'bottom') === 'right'
                                ? 'vertical'
                                : 'horizontal'
                            }
                          />
                        )}
                      </PieChart>
                    ) : (
                      <BarChart data={barRows}>
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        {(widget.legendMode || 'list') !== 'hidden' && (
                          <Legend
                            verticalAlign={
                              (widget.legendPlacement || 'bottom') === 'right' ? 'middle' : 'bottom'
                            }
                            align={
                              (widget.legendPlacement || 'bottom') === 'right' ? 'right' : 'center'
                            }
                            layout={
                              (widget.legendPlacement || 'bottom') === 'right'
                                ? 'vertical'
                                : 'horizontal'
                            }
                          />
                        )}
                        {data.queries.map((query, index) => (
                          <Bar
                            key={query.id}
                            dataKey={query.id}
                            name={getDashboardQueryDisplayName(query)}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                            radius={[6, 6, 0, 0]}
                          />
                        ))}
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                )}
              </div>

              {canMutateWidgets && gridColumnCount > 1 && (
                <button
                  type="button"
                  onPointerDown={(event) =>
                    startWidgetResize(event, widget.id, widgetSize.width, widgetSize.height)
                  }
                  className={`absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-500 transition hover:bg-slate-100 ${
                    resizingWidgetId === widget.id ? 'cursor-grabbing' : 'cursor-se-resize'
                  }`}
                  aria-label={t('dashboard.resizeWidgetAction')}
                  title={t('dashboard.resizeWidgetAction')}
                >
                  <i className="fa-solid fa-up-right-and-down-left-from-center text-[10px]" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {dashboard.widgets.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          {t('dashboard.noData')}
        </div>
      )}

      {activeWidgetRoute && canMutateWidgets && (
        <WidgetEditor
          isOpen={Boolean(activeWidgetRoute)}
          permissions={permissions}
          dashboard={dashboard}
          mode={activeWidgetRoute.mode}
          widgetId={activeWidgetRoute.mode === 'edit' ? activeWidgetRoute.widgetId : undefined}
          onClose={() => onWidgetRouteChange(null)}
          onSaved={handleWidgetSaved}
        />
      )}

      <Modal isOpen={Boolean(widgetPendingDelete)} onClose={closeDeleteWidgetModal}>
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="space-y-4 p-6">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <i className="fa-solid fa-trash text-xl text-red-600" />
            </div>

            <div className="text-center">
              <h3 className="text-xl font-black text-slate-800">
                {t('dashboard.deleteWidgetTitleWithName', {
                  name: widgetPendingDelete?.title,
                })}
              </h3>
            </div>
          </div>

          <div className="flex gap-3 border-t border-slate-100 px-6 pb-6 pt-4">
            <button
              type="button"
              onClick={closeDeleteWidgetModal}
              disabled={isSaving}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {t('dashboard.createModal.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteWidget()}
              disabled={isSaving}
              className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-200 transition-all hover:bg-red-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {isSaving ? (
                <i className="fa-solid fa-circle-notch fa-spin" />
              ) : (
                t('dashboard.deleteWidgetAction')
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit modal (rename + delete) */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setError('');
          setIsEditModalOpen(false);
        }}
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <h2 className="mb-5 text-lg font-black text-slate-800">{t('dashboard.editDashboard')}</h2>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('dashboard.dashboardName')}
            </label>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              disabled={isSaving || !canMutateDashboard}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setError('');
                setIsEditModalOpen(false);
              }}
              disabled={isSaving}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
            >
              {t('dashboard.editModal.cancel')}
            </button>
            {canUpdate && (
              <button
                type="button"
                onClick={() => void saveDashboardName()}
                disabled={isSaving || !renameValue.trim() || !canMutateDashboard}
                className="rounded-xl bg-praetor px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? (
                  <i className="fa-solid fa-circle-notch fa-spin" />
                ) : (
                  t('dashboard.saveName')
                )}
              </button>
            )}
          </div>

          {canDelete && (
            <>
              <div className="my-5 border-t border-slate-200" />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-red-700">{t('dashboard.deleteDashboard')}</p>
                  <p className="text-xs text-slate-500">{t('dashboard.editModal.deleteHint')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteDashboard()}
                  disabled={isSaving || !canMutateDashboard}
                  className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('dashboard.deleteDashboard')}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default DashboardDetail;
