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
import type { DashboardWidget, DashboardWidgetDataResult } from '../../services/api/reports';
import { buildPermission, hasPermission } from '../../utils/permissions';
import CustomSelect from '../shared/CustomSelect';

export interface DashboardDetailProps {
  permissions: string[];
  dashboardId: string;
  onBack: () => void;
}

const CHART_COLORS = ['#1d4ed8', '#0d9488', '#d97706', '#be123c', '#7c3aed', '#0f766e', '#334155'];

const DATASET_OPTIONS: DashboardWidget['dataset'][] = [
  'timesheets',
  'quotes',
  'orders',
  'invoices',
  'supplierQuotes',
  'catalog',
];

const GROUP_BY_OPTIONS: Record<DashboardWidget['dataset'], string[]> = {
  timesheets: ['user', 'client', 'project', 'task', 'location', 'month'],
  quotes: ['status', 'client', 'month'],
  orders: ['status', 'client', 'month'],
  invoices: ['status', 'client', 'month'],
  supplierQuotes: ['status', 'supplier', 'month'],
  catalog: ['type', 'category', 'subcategory', 'supplier'],
};

const METRIC_OPTIONS: Record<DashboardWidget['dataset'], string[]> = {
  timesheets: ['hours', 'entries', 'cost'],
  quotes: ['count', 'net'],
  orders: ['count', 'net'],
  invoices: ['count', 'total', 'outstanding'],
  supplierQuotes: ['count', 'net'],
  catalog: ['count', 'cost'],
};

const DashboardDetail: React.FC<DashboardDetailProps> = ({ permissions, dashboardId, onBack }) => {
  const { t } = useTranslation('reports');
  const [dashboards, setDashboards] = useState<
    Awaited<ReturnType<typeof api.reports.listDashboards>>
  >([]);
  const [renameValue, setRenameValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [widgetData, setWidgetData] = useState<Record<string, DashboardWidgetDataResult>>({});

  const [widgetTitle, setWidgetTitle] = useState('');
  const [widgetChartType, setWidgetChartType] = useState<DashboardWidget['chartType']>('pie');
  const [widgetDataset, setWidgetDataset] = useState<DashboardWidget['dataset']>('timesheets');
  const [widgetGroupBy, setWidgetGroupBy] = useState('user');
  const [widgetMetric, setWidgetMetric] = useState('hours');

  const canUpdate = hasPermission(permissions, buildPermission('reports.dashboard', 'update'));
  const canDelete = hasPermission(permissions, buildPermission('reports.dashboard', 'delete'));

  const dashboard = useMemo(
    () => dashboards.find((d) => d.id === dashboardId) || null,
    [dashboards, dashboardId],
  );

  useEffect(() => {
    const firstGroupBy = GROUP_BY_OPTIONS[widgetDataset][0] || '';
    const firstMetric = METRIC_OPTIONS[widgetDataset][0] || '';
    setWidgetGroupBy((prev) =>
      GROUP_BY_OPTIONS[widgetDataset].includes(prev) ? prev : firstGroupBy,
    );
    setWidgetMetric((prev) => (METRIC_OPTIONS[widgetDataset].includes(prev) ? prev : firstMetric));
  }, [widgetDataset]);

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

  const addWidget = async () => {
    if (!canUpdate || !dashboard || !widgetTitle.trim()) return;
    const nextWidget: DashboardWidget = {
      id: `wdg-${Date.now()}`,
      title: widgetTitle.trim(),
      chartType: widgetChartType,
      dataset: widgetDataset,
      groupBy: widgetGroupBy,
      metric: widgetMetric,
      limit: 8,
    };
    setIsSaving(true);
    setError('');
    try {
      const updated = await api.reports.updateDashboard(dashboard.id, {
        widgets: [...dashboard.widgets, nextWidget],
      });
      setDashboards((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setWidgetTitle('');
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
    } finally {
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

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        <i className="fa-solid fa-circle-notch fa-spin mr-2" />
        {t('dashboard.loading')}
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        {t('dashboard.error')}
      </div>
    );
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
      </div>

      {/* Rename / Delete controls */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="w-full lg:max-w-md">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('dashboard.dashboardName')}
            </label>
            <input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20"
            />
          </div>
          {canUpdate && (
            <button
              type="button"
              onClick={() => void saveDashboardName()}
              disabled={isSaving || !renameValue.trim()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('dashboard.saveName')}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => void deleteDashboard()}
              disabled={isSaving}
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('dashboard.deleteDashboard')}
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Widget builder */}
      {canUpdate && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-black uppercase tracking-wider text-slate-500">
            {t('dashboard.addWidget')}
          </h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-6">
            <input
              value={widgetTitle}
              onChange={(event) => setWidgetTitle(event.target.value)}
              placeholder={t('dashboard.widgetTitle')}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 lg:col-span-2"
            />
            <CustomSelect
              options={[
                { id: 'pie', name: t('dashboard.chartTypes.pie') },
                { id: 'bar', name: t('dashboard.chartTypes.bar') },
              ]}
              value={widgetChartType}
              onChange={(value) => setWidgetChartType(value as DashboardWidget['chartType'])}
            />
            <CustomSelect
              options={DATASET_OPTIONS.map((dataset) => ({
                id: dataset,
                name: t(`dashboard.datasets.${dataset}`),
              }))}
              value={widgetDataset}
              onChange={(value) => setWidgetDataset(value as DashboardWidget['dataset'])}
            />
            <CustomSelect
              options={GROUP_BY_OPTIONS[widgetDataset].map((groupBy) => ({
                id: groupBy,
                name: t(`dashboard.groupBy.${groupBy}`),
              }))}
              value={widgetGroupBy}
              onChange={(value) => setWidgetGroupBy(value as string)}
            />
            <CustomSelect
              options={METRIC_OPTIONS[widgetDataset].map((metric) => ({
                id: metric,
                name: t(`dashboard.metrics.${metric}`),
              }))}
              value={widgetMetric}
              onChange={(value) => setWidgetMetric(value as string)}
            />
          </div>
          <div className="mt-4 text-right">
            <button
              type="button"
              onClick={() => void addWidget()}
              disabled={isSaving || !widgetTitle.trim()}
              className="rounded-xl bg-praetor px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('dashboard.addWidgetAction')}
            </button>
          </div>
        </div>
      )}

      {/* Widget grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {dashboard.widgets.map((widget) => {
          const data = widgetData[widget.id];
          return (
            <div
              key={widget.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-base font-bold text-slate-800">{widget.title}</h4>
                  <p className="text-xs text-slate-500">
                    {t(`dashboard.datasets.${widget.dataset}`)} -{' '}
                    {t(`dashboard.groupBy.${widget.groupBy}`)} -{' '}
                    {t(`dashboard.metrics.${widget.metric}`)}
                  </p>
                </div>
                {canUpdate && (
                  <button
                    type="button"
                    onClick={() => void removeWidget(widget.id)}
                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700"
                  >
                    {t('dashboard.removeWidget')}
                  </button>
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
    </div>
  );
};

export default DashboardDetail;
