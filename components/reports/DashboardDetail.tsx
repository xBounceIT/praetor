import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
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
import type { DashboardWidgetDataResult, ReportDashboard } from '../../services/api/reports';
import { buildPermission, hasPermission } from '../../utils/permissions';
import NotFound from '../NotFound';
import Modal from '../shared/Modal';
import { CHART_COLORS } from './dashboardConstants';
import WidgetEditor from './WidgetEditor';

type WidgetRoute = { mode: 'new' } | { mode: 'edit'; widgetId: string };

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

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const canUpdate = hasPermission(permissions, buildPermission('reports.dashboard', 'update'));
  const canDelete = hasPermission(permissions, buildPermission('reports.dashboard', 'delete'));

  const dashboard = useMemo(
    () => dashboards.find((d) => d.id === dashboardId) || null,
    [dashboards, dashboardId],
  );

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
    if (!dashboard || !activeWidgetRoute || activeWidgetRoute.mode !== 'edit') return;
    const exists = dashboard.widgets.some((widget) => widget.id === activeWidgetRoute.widgetId);
    if (!exists) {
      onWidgetRouteChange(null);
    }
  }, [dashboard, activeWidgetRoute, onWidgetRouteChange]);

  useEffect(() => {
    if (activeWidgetRoute && !canUpdate) {
      onWidgetRouteChange(null);
    }
  }, [activeWidgetRoute, canUpdate, onWidgetRouteChange]);

  useEffect(() => {
    if (!dashboard || dashboard.widgets.length === 0) {
      setWidgetData({});
      return;
    }
    const loadWidgetData = async () => {
      const results = await Promise.all(
        dashboard.widgets.map(async (widget) => {
          try {
            const response = await api.reports.getDashboardWidgetData(widget);
            return [widget.id, response] as const;
          } catch {
            return [
              widget.id,
              { metric: widget.metric, groupBy: widget.groupBy, total: 0, series: [] },
            ] as const;
          }
        }),
      );
      setWidgetData(Object.fromEntries(results));
    };
    void loadWidgetData();
  }, [dashboard]);

  const saveDashboardName = async () => {
    if (!canUpdate || !dashboard || !renameValue.trim()) return;
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
    if (!canDelete || !dashboard) return;
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

  const removeWidget = async (widgetId: string) => {
    if (!canUpdate || !dashboard) return;
    setIsSaving(true);
    setError('');
    try {
      const updated = await api.reports.updateDashboard(dashboard.id, {
        widgets: dashboard.widgets.filter((widget) => widget.id !== widgetId),
      });
      setDashboards((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
    } finally {
      setIsSaving(false);
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
          {(canUpdate || canDelete) && (
            <button
              type="button"
              onClick={() => setIsEditModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
            >
              <i className="fa-solid fa-pen text-xs" />
              {t('dashboard.editDashboard')}
            </button>
          )}
          {canUpdate && (
            <button
              type="button"
              onClick={() => onWidgetRouteChange({ mode: 'new' })}
              className="flex items-center gap-2 rounded-xl bg-praetor px-5 py-2.5 text-sm font-black text-white shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95"
            >
              <i className="fa-solid fa-plus" />
              {t('dashboard.addVisualization')}
            </button>
          )}
        </div>
      </div>

      {/* Widget grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {dashboard.widgets.map((widget) => {
          const data = widgetData[widget.id];
          return (
            <div
              key={widget.id}
              className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${
                recentlyAddedWidgetId === widget.id
                  ? 'dashboard-widget-pop ring-2 ring-blue-200'
                  : ''
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h4 className="text-base font-bold text-slate-800">{widget.title}</h4>
                  <p className="text-xs text-slate-500">
                    {t(`dashboard.datasets.${widget.dataset}`)} -{' '}
                    {t(`dashboard.groupBy.${widget.groupBy}`)} -{' '}
                    {t(`dashboard.metrics.${widget.metric}`)}
                  </p>
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
                {canUpdate && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onWidgetRouteChange({ mode: 'edit', widgetId: widget.id })}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
                    >
                      <i className="fa-solid fa-pen text-[10px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeWidget(widget.id)}
                      className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700"
                    >
                      {t('dashboard.removeWidget')}
                    </button>
                  </div>
                )}
              </div>

              <div className="h-64">
                {!data ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    <i className="fa-solid fa-circle-notch fa-spin mr-2" />
                    {t('dashboard.loadingWidget')}
                  </div>
                ) : data.series.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    {t('dashboard.noData')}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    {widget.chartType === 'pie' ? (
                      <PieChart>
                        <Pie
                          data={data.series}
                          dataKey="value"
                          nameKey="label"
                          outerRadius={90}
                          label
                        >
                          {data.series.map((entry, index) => (
                            <Cell
                              key={`${entry.label}-${index}`}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    ) : (
                      <BarChart data={data.series}>
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                          {data.series.map((entry, index) => (
                            <Cell
                              key={`${entry.label}-${index}`}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dashboard.widgets.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          {t('dashboard.noData')}
        </div>
      )}

      {activeWidgetRoute && canUpdate && (
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
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20"
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
                disabled={isSaving || !renameValue.trim()}
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
                  disabled={isSaving}
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
