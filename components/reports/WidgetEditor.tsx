import type React from 'react';
import { useEffect, useRef, useState } from 'react';
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
import CustomSelect from '../shared/CustomSelect';
import {
  CHART_COLORS,
  DATASET_OPTIONS,
  GROUP_BY_OPTIONS,
  METRIC_OPTIONS,
} from './dashboardConstants';

export interface WidgetEditorProps {
  permissions: string[];
  dashboardId: string;
  mode: 'new' | 'edit';
  widgetId?: string;
  onBack: () => void;
}

const WidgetEditor: React.FC<WidgetEditorProps> = ({
  permissions,
  dashboardId,
  mode,
  widgetId,
  onBack,
}) => {
  const { t } = useTranslation('reports');

  const [dashboard, setDashboard] = useState<ReportDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [chartType, setChartType] = useState<DashboardWidget['chartType']>('pie');
  const [dataset, setDataset] = useState<DashboardWidget['dataset']>('timesheets');
  const [groupBy, setGroupBy] = useState('user');
  const [metric, setMetric] = useState('hours');
  const [limit, setLimit] = useState(8);

  // Preview state
  const [previewData, setPreviewData] = useState<DashboardWidgetDataResult | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const previewRunRef = useRef(0);

  const canUpdate = hasPermission(permissions, buildPermission('reports.dashboard', 'update'));

  // Load dashboard on mount
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const data = await api.reports.listDashboards();
        const found = data.find((d) => d.id === dashboardId) || null;
        setDashboard(found);
        if (found && mode === 'edit' && widgetId) {
          const existing = found.widgets.find((w) => w.id === widgetId);
          if (existing) {
            setTitle(existing.title);
            setDescription(existing.description || '');
            setTags(existing.tags || []);
            setChartType(existing.chartType);
            setDataset(existing.dataset);
            setGroupBy(existing.groupBy);
            setMetric(existing.metric);
            setLimit(existing.limit ?? 8);
          }
        }
      } catch (err) {
        setError((err as Error).message || t('dashboard.error'));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [dashboardId, mode, widgetId, t]);

  // Reset groupBy/metric when dataset changes
  useEffect(() => {
    const firstGroupBy = GROUP_BY_OPTIONS[dataset][0] || '';
    const firstMetric = METRIC_OPTIONS[dataset][0] || '';
    setGroupBy((prev) => (GROUP_BY_OPTIONS[dataset].includes(prev) ? prev : firstGroupBy));
    setMetric((prev) => (METRIC_OPTIONS[dataset].includes(prev) ? prev : firstMetric));
  }, [dataset]);

  // Live preview with 500ms debounce
  useEffect(() => {
    if (isLoading || !dashboard) return;

    const runId = ++previewRunRef.current;

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    if (previewRequestRef.current) {
      previewRequestRef.current.abort();
      previewRequestRef.current = null;
    }

    previewTimerRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      previewRequestRef.current = abortController;

      setIsLoadingPreview(true);
      try {
        const previewWidget: DashboardWidget = {
          id: 'preview',
          title: 'Preview',
          chartType,
          dataset,
          groupBy,
          metric,
          limit,
        };

        const data = await api.reports.getDashboardWidgetData(previewWidget, {
          signal: abortController.signal,
        });

        if (previewRunRef.current !== runId || abortController.signal.aborted) return;
        setPreviewData(data);
      } catch {
        if (abortController.signal.aborted) return;
        if (previewRunRef.current !== runId) return;
        setPreviewData(null);
      } finally {
        if (previewRequestRef.current === abortController) {
          previewRequestRef.current = null;
        }
        if (previewRunRef.current === runId && !abortController.signal.aborted) {
          setIsLoadingPreview(false);
        }
      }
    }, 500);

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (previewRequestRef.current) {
        previewRequestRef.current.abort();
        previewRequestRef.current = null;
      }
    };
  }, [isLoading, dashboard, chartType, dataset, groupBy, metric, limit]);

  const addTag = (raw: string) => {
    const trimmed = raw.trim().replace(/,$/, '').trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= 10) return;
    setTags((prev) => [...prev, trimmed]);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
      setTagInput('');
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const handleTagBlur = () => {
    if (tagInput.trim()) {
      addTag(tagInput);
      setTagInput('');
    }
  };

  const handleSave = async () => {
    if (!canUpdate || !dashboard || !title.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      const widget: DashboardWidget = {
        id: mode === 'edit' && widgetId ? widgetId : `wdg-${Date.now()}`,
        title: title.trim(),
        description: description.trim(),
        tags,
        chartType,
        dataset,
        groupBy,
        metric,
        limit,
      };
      const updatedWidgets =
        mode === 'edit' && widgetId
          ? dashboard.widgets.map((w) => (w.id === widgetId ? widget : w))
          : [...dashboard.widgets, widget];
      await api.reports.updateDashboard(dashboard.id, { widgets: updatedWidgets });
      onBack();
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
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

  if (
    !dashboard ||
    (mode === 'edit' && widgetId && !dashboard.widgets.find((w) => w.id === widgetId))
  ) {
    return <NotFound onReturn={onBack} />;
  }

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          >
            <i className="fa-solid fa-arrow-left text-xs" />
            {t('dashboard.widgetEditor.backToDashboard')}
          </button>
          <h2 className="text-xl font-black text-slate-800">
            {mode === 'new'
              ? t('dashboard.widgetEditor.newTitle')
              : t('dashboard.widgetEditor.editTitle')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={isSaving}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
          >
            {t('dashboard.widgetEditor.discard')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !title.trim()}
            className="flex items-center gap-2 rounded-xl bg-praetor px-5 py-2.5 text-sm font-black text-white shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? (
              <i className="fa-solid fa-circle-notch fa-spin" />
            ) : (
              t('dashboard.widgetEditor.save')
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Two-column editor layout */}
      <div className="flex gap-6 lg:items-start">
        {/* Left: preview + data config */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Live chart preview */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('dashboard.widgetEditor.previewTitle')}
            </p>
            <div className="h-72">
              {isLoadingPreview ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  <i className="fa-solid fa-circle-notch fa-spin mr-2" />
                  {t('dashboard.widgetEditor.loadingPreview')}
                </div>
              ) : !previewData || previewData.series.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  {t('dashboard.widgetEditor.noPreviewData')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'pie' ? (
                    <PieChart>
                      <Pie
                        data={previewData.series}
                        dataKey="value"
                        nameKey="label"
                        outerRadius={100}
                        label
                      >
                        {previewData.series.map((entry, index) => (
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
                    <BarChart data={previewData.series}>
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {previewData.series.map((entry, index) => (
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

          {/* Data configuration */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('dashboard.widgetEditor.configTitle')}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CustomSelect
                label={t('dashboard.editModal.chartType')}
                options={[
                  { id: 'pie', name: t('dashboard.chartTypes.pie') },
                  { id: 'bar', name: t('dashboard.chartTypes.bar') },
                ]}
                value={chartType}
                onChange={(value) => setChartType(value as DashboardWidget['chartType'])}
              />
              <CustomSelect
                label={t('dashboard.editModal.dataset')}
                options={DATASET_OPTIONS.map((ds) => ({
                  id: ds,
                  name: t(`dashboard.datasets.${ds}`),
                }))}
                value={dataset}
                onChange={(value) => setDataset(value as DashboardWidget['dataset'])}
              />
              <CustomSelect
                label={t('dashboard.editModal.groupByLabel')}
                options={GROUP_BY_OPTIONS[dataset].map((g) => ({
                  id: g,
                  name: t(`dashboard.groupBy.${g}`),
                }))}
                value={groupBy}
                onChange={(value) => setGroupBy(value as string)}
              />
              <CustomSelect
                label={t('dashboard.editModal.metric')}
                options={METRIC_OPTIONS[dataset].map((m) => ({
                  id: m,
                  name: t(`dashboard.metrics.${m}`),
                }))}
                value={metric}
                onChange={(value) => setMetric(value as string)}
              />
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t('dashboard.widgetEditor.limitLabel')}
                </label>
                <input
                  type="number"
                  min={3}
                  max={20}
                  value={limit}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v)) setLimit(Math.max(3, Math.min(v, 20)));
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: metadata panel */}
        <div className="w-80 shrink-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-4">
          {/* Name */}
          <div className="mb-5">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('dashboard.widgetEditor.nameLabel')}
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('dashboard.widgetEditor.namePlaceholder')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20"
            />
          </div>

          {/* Description */}
          <div className="mb-5">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('dashboard.widgetEditor.descriptionLabel')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('dashboard.widgetEditor.descriptionPlaceholder')}
              rows={4}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('dashboard.widgetEditor.tagsLabel')}
            </label>
            <div className="flex min-h-[42px] flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition focus-within:border-praetor focus-within:ring-2 focus-within:ring-praetor/20">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-lg bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    className="ml-0.5 text-slate-400 hover:text-slate-700"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <i className="fa-solid fa-xmark text-[10px]" />
                  </button>
                </span>
              ))}
              {tags.length < 10 && (
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={handleTagBlur}
                  placeholder={tags.length === 0 ? t('dashboard.widgetEditor.tagsPlaceholder') : ''}
                  className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WidgetEditor;
