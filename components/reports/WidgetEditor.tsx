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
  DashboardDataset,
  DashboardLegendMode,
  DashboardLegendPlacement,
  DashboardWidget,
  DashboardWidgetDataResult,
  DashboardWidgetQuery,
  DashboardWidgetTransformation,
  ReportDashboard,
} from '../../services/api/reports';
import { buildPermission, hasPermission } from '../../utils/permissions';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import {
  CHART_COLORS,
  DASHBOARD_WIDGET_DEFAULT_HEIGHT,
  DASHBOARD_WIDGET_DEFAULT_WIDTH,
  LEGEND_MODE_OPTIONS,
  LEGEND_PLACEMENT_OPTIONS,
  METRIC_OPTIONS,
} from './dashboardConstants';
import {
  getAccessibleDashboardDatasets,
  widgetHasRestrictedDashboardDatasets,
} from './dashboardPermissions';
import {
  buildDashboardWidgetVisualizationModel,
  normalizeDashboardWidgetTransformations,
} from './dashboardWidgetTransformations';
import {
  createDashboardWidgetQuery,
  getDefaultGroupByForDatasets,
  getDefaultMetricForDataset,
  getNextDashboardQueryRef,
  getSharedGroupByOptions,
} from './dashboardWidgetUtils';
import WidgetTransformationEditor from './WidgetTransformationEditor';

export interface WidgetEditorProps {
  isOpen: boolean;
  permissions: string[];
  dashboard: ReportDashboard | null;
  mode: 'new' | 'edit';
  widgetId?: string;
  onClose: () => void;
  onSaved: (payload: {
    dashboard: ReportDashboard;
    mode: 'new' | 'edit';
    widgetId: string;
  }) => void;
}

const createDefaultQueries = (defaultDataset: DashboardDataset | null) =>
  defaultDataset ? [createDashboardWidgetQuery('A', defaultDataset)] : [];

const normalizeEditorQueries = (
  queries: DashboardWidgetQuery[] | undefined,
  defaultDataset: DashboardDataset | null,
) => {
  if (Array.isArray(queries) && queries.length > 0) {
    return queries.map((query) => ({
      ...query,
      label: query.label || '',
    }));
  }
  return createDefaultQueries(defaultDataset);
};

const WidgetEditor: React.FC<WidgetEditorProps> = ({
  isOpen,
  permissions,
  dashboard,
  mode,
  widgetId,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation('reports');
  const accessibleDatasets = useMemo(
    () => getAccessibleDashboardDatasets(permissions),
    [permissions],
  );
  const firstAccessibleDataset = accessibleDatasets[0] || null;
  const hasAccessibleDatasets = accessibleDatasets.length > 0;
  const accessibleDatasetOptions = useMemo(
    () =>
      accessibleDatasets.map((item) => ({
        id: item,
        name: t(`dashboard.datasets.${item}`),
      })),
    [accessibleDatasets, t],
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [queryHint, setQueryHint] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [chartType, setChartType] = useState<DashboardWidget['chartType']>('pie');
  const [activeConfigTab, setActiveConfigTab] = useState<'data' | 'transformation'>('data');
  const [queries, setQueries] = useState<DashboardWidgetQuery[]>(() =>
    createDefaultQueries(firstAccessibleDataset),
  );
  const [transformations, setTransformations] = useState<DashboardWidgetTransformation[]>([]);
  const [groupBy, setGroupBy] = useState(
    getDefaultGroupByForDatasets(firstAccessibleDataset ? [firstAccessibleDataset] : []),
  );
  const [limit, setLimit] = useState(8);
  const [legendMode, setLegendMode] = useState<DashboardLegendMode>('list');
  const [legendPlacement, setLegendPlacement] = useState<DashboardLegendPlacement>('bottom');

  // Preview state
  const [previewData, setPreviewData] = useState<DashboardWidgetDataResult | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const previewRunRef = useRef(0);

  const canUpdate = hasPermission(permissions, buildPermission('reports.dashboard', 'update'));

  const existingWidget = useMemo(() => {
    if (mode !== 'edit' || !widgetId || !dashboard) return null;
    return dashboard.widgets.find((widget) => widget.id === widgetId) || null;
  }, [mode, widgetId, dashboard]);

  const isInvalidEditTarget = Boolean(isOpen && mode === 'edit' && widgetId && !existingWidget);
  const isRestrictedEdit = Boolean(
    existingWidget && widgetHasRestrictedDashboardDatasets(existingWidget, permissions),
  );
  const editorBlockedMessage = isRestrictedEdit
    ? t('dashboard.widgetEditor.restrictedDatasetEditBlocked')
    : !hasAccessibleDatasets
      ? t('dashboard.widgetEditor.noAccessibleDatasets')
      : '';
  const dashboardId = dashboard?.id || '';

  const sharedGroupByOptions = useMemo(
    () => getSharedGroupByOptions(queries.map((query) => query.dataset)),
    [queries],
  );
  const hasSharedGroupBy = sharedGroupByOptions.length > 0;
  const canSave = Boolean(
    canUpdate &&
      dashboard &&
      title.trim() &&
      queries.length > 0 &&
      groupBy &&
      hasSharedGroupBy &&
      !isInvalidEditTarget &&
      hasAccessibleDatasets &&
      !isRestrictedEdit,
  );
  const normalizedTransformations = useMemo(
    () => normalizeDashboardWidgetTransformations(transformations, queries),
    [transformations, queries],
  );
  const previewModel = useMemo(
    () =>
      previewData
        ? buildDashboardWidgetVisualizationModel(
            {
              limit,
              transformations: normalizedTransformations,
            },
            previewData,
            {
              mergedSeries: t('dashboard.widgetEditor.transformations.defaultMergedLabel'),
              reducedValue: t('dashboard.widgetEditor.transformations.defaultReducedLabel'),
            },
          )
        : null,
    [limit, normalizedTransformations, previewData, t],
  );
  const hasPreviewData = previewModel?.hasSeriesData || false;
  const nextQueryRef = getNextDashboardQueryRef(queries);
  const chartTypeOptions =
    queries.length > 1
      ? [{ id: 'bar', name: t('dashboard.chartTypes.bar') }]
      : [
          { id: 'pie', name: t('dashboard.chartTypes.pie') },
          { id: 'bar', name: t('dashboard.chartTypes.bar') },
        ];

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setQueryHint('');
    setPreviewData(null);
    setTagInput('');
    setActiveConfigTab('data');

    if (mode === 'edit' && existingWidget) {
      const editorQueries = normalizeEditorQueries(existingWidget.queries, firstAccessibleDataset);
      setTitle(existingWidget.title);
      setDescription(existingWidget.description || '');
      setTags(existingWidget.tags || []);
      setChartType(existingWidget.chartType);
      setQueries(editorQueries);
      setTransformations(
        normalizeDashboardWidgetTransformations(existingWidget.transformations, editorQueries),
      );
      setGroupBy(existingWidget.groupBy);
      setLimit(existingWidget.limit ?? 8);
      setLegendMode(existingWidget.legendMode || 'list');
      setLegendPlacement(existingWidget.legendPlacement || 'bottom');
      return;
    }

    setTitle('');
    setDescription('');
    setTags([]);
    setChartType('pie');
    const defaultQueries = createDefaultQueries(firstAccessibleDataset);
    setQueries(defaultQueries);
    setTransformations([]);
    setGroupBy(
      getDefaultGroupByForDatasets(firstAccessibleDataset ? [firstAccessibleDataset] : []),
    );
    setLimit(8);
    setLegendMode('list');
    setLegendPlacement('bottom');
  }, [isOpen, mode, existingWidget, firstAccessibleDataset]);

  useEffect(() => {
    const firstGroupBy = sharedGroupByOptions[0] || '';
    setGroupBy((prev) => (sharedGroupByOptions.includes(prev) ? prev : firstGroupBy));
  }, [sharedGroupByOptions]);

  useEffect(() => {
    if (chartType === 'bar' || queries.length <= 1) {
      setQueryHint('');
    }
  }, [chartType, queries.length]);

  useEffect(() => {
    setTransformations((prev) => normalizeDashboardWidgetTransformations(prev, queries));
  }, [queries]);

  useEffect(() => {
    if (
      !isOpen ||
      !dashboardId ||
      isInvalidEditTarget ||
      isRestrictedEdit ||
      !hasAccessibleDatasets ||
      !groupBy ||
      !hasSharedGroupBy
    ) {
      setPreviewData(null);
      return;
    }

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
          groupBy,
          queries,
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
  }, [
    isOpen,
    dashboardId,
    isInvalidEditTarget,
    isRestrictedEdit,
    hasAccessibleDatasets,
    chartType,
    groupBy,
    hasSharedGroupBy,
    queries,
    limit,
  ]);

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
      return;
    }

    if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const handleTagBlur = () => {
    if (!tagInput.trim()) return;
    addTag(tagInput);
    setTagInput('');
  };

  const handleClose = () => {
    if (isSaving) return;
    setError('');
    setQueryHint('');
    onClose();
  };

  const updateQuery = (
    queryId: string,
    updater: (query: DashboardWidgetQuery) => DashboardWidgetQuery,
  ) => {
    setQueries((prev) => prev.map((query) => (query.id === queryId ? updater(query) : query)));
  };

  const handleAddQuery = () => {
    if (!nextQueryRef || isSaving || !firstAccessibleDataset || isRestrictedEdit) return;
    if (chartType === 'pie') {
      setQueryHint(t('dashboard.widgetEditor.multiQueryBarHint'));
      return;
    }

    setQueryHint('');
    setQueries((prev) => [
      ...prev,
      createDashboardWidgetQuery(nextQueryRef, firstAccessibleDataset),
    ]);
  };

  const handleRemoveQuery = (queryId: string) => {
    if (queries.length <= 1 || isSaving) return;
    setQueries((prev) => prev.filter((query) => query.id !== queryId));
  };

  const handleSave = async () => {
    if (!canSave) return;

    const currentDashboard = dashboard;
    if (!currentDashboard) return;

    setIsSaving(true);
    setError('');

    const resolvedWidgetId = mode === 'edit' && widgetId ? widgetId : `wdg-${Date.now()}`;
    const normalizedQueries: DashboardWidgetQuery[] = queries.map((query) => {
      const label = query.label?.trim();
      return {
        id: query.id,
        ref: query.ref,
        dataset: query.dataset,
        metric: query.metric,
        ...(label ? { label } : {}),
      };
    });

    const widget: DashboardWidget = {
      id: resolvedWidgetId,
      title: title.trim(),
      description: description.trim(),
      tags,
      chartType,
      groupBy,
      queries: normalizedQueries,
      transformations: normalizedTransformations,
      limit,
      width: existingWidget?.width ?? DASHBOARD_WIDGET_DEFAULT_WIDTH,
      height: existingWidget?.height ?? DASHBOARD_WIDGET_DEFAULT_HEIGHT,
      legendMode,
      legendPlacement,
    };

    const updatedWidgets =
      mode === 'edit' && widgetId
        ? currentDashboard.widgets.map((current) => (current.id === widgetId ? widget : current))
        : [...currentDashboard.widgets, widget];

    try {
      const updatedDashboard = await api.reports.updateDashboard(currentDashboard.id, {
        widgets: updatedWidgets,
      });
      onSaved({
        dashboard: updatedDashboard,
        mode,
        widgetId: resolvedWidgetId,
      });
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      closeOnBackdrop={!isSaving}
      closeOnEsc={!isSaving}
      zIndex={70}
    >
      <div className="w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex max-h-[calc(100vh-4rem)] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
            <h2 className="text-xl font-black text-slate-800">
              {mode === 'new'
                ? t('dashboard.widgetEditor.newTitle')
                : t('dashboard.widgetEditor.editTitle')}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSaving}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
              >
                {t('dashboard.widgetEditor.discard')}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving || !canSave}
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

          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {isInvalidEditTarget ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
                {t('dashboard.error')}
              </div>
            ) : editorBlockedMessage ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-700">
                {editorBlockedMessage}
              </div>
            ) : (
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1 space-y-4">
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
                      ) : !groupBy || !hasSharedGroupBy ? (
                        <div className="flex h-full items-center justify-center text-sm text-amber-600">
                          {t('dashboard.widgetEditor.noSharedGroupBy')}
                        </div>
                      ) : !previewModel || !hasPreviewData ? (
                        <div className="flex h-full items-center justify-center text-sm text-slate-400">
                          {t('dashboard.widgetEditor.noPreviewData')}
                        </div>
                      ) : chartType === 'pie' && previewModel.pieSeries.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={previewModel.pieSeries}
                              dataKey="value"
                              nameKey="label"
                              outerRadius={100}
                              label
                            >
                              {previewModel.pieSeries.map((entry, index) => (
                                <Cell
                                  key={`${entry.label}-${index}`}
                                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                                />
                              ))}
                            </Pie>
                            <Tooltip />
                            {legendMode !== 'hidden' && (
                              <Legend
                                verticalAlign={legendPlacement === 'right' ? 'middle' : 'bottom'}
                                align={legendPlacement === 'right' ? 'right' : 'center'}
                                layout={legendPlacement === 'right' ? 'vertical' : 'horizontal'}
                              />
                            )}
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={previewModel.barRows}>
                            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            {legendMode !== 'hidden' && (
                              <Legend
                                verticalAlign={legendPlacement === 'right' ? 'middle' : 'bottom'}
                                align={legendPlacement === 'right' ? 'right' : 'center'}
                                layout={legendPlacement === 'right' ? 'vertical' : 'horizontal'}
                              />
                            )}
                            {previewModel.series.map((seriesItem, index) => (
                              <Bar
                                key={seriesItem.id}
                                dataKey={seriesItem.id}
                                name={seriesItem.label}
                                fill={CHART_COLORS[index % CHART_COLORS.length]}
                                radius={[6, 6, 0, 0]}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        {t('dashboard.widgetEditor.configTitle')}
                      </p>
                      {activeConfigTab === 'data' && (
                        <button
                          type="button"
                          onClick={handleAddQuery}
                          disabled={isSaving || !nextQueryRef}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <i className="fa-solid fa-plus text-[10px]" />
                          {t('dashboard.widgetEditor.addQuery')}
                        </button>
                      )}
                    </div>
                    <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setActiveConfigTab('data')}
                        className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
                          activeConfigTab === 'data'
                            ? 'bg-white text-slate-800 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {t('dashboard.widgetEditor.tabs.data')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveConfigTab('transformation')}
                        className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
                          activeConfigTab === 'transformation'
                            ? 'bg-white text-slate-800 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {t('dashboard.widgetEditor.tabs.transformation')}
                      </button>
                    </div>

                    {activeConfigTab === 'data' ? (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <CustomSelect
                            label={t('dashboard.editModal.groupByLabel')}
                            options={sharedGroupByOptions.map((item) => ({
                              id: item,
                              name: t(`dashboard.groupBy.${item}`),
                            }))}
                            value={groupBy}
                            onChange={(value) => setGroupBy(value as string)}
                            disabled={isSaving || !hasSharedGroupBy}
                            placeholder={t('dashboard.widgetEditor.noSharedGroupBy')}
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
                                const parsed = Number.parseInt(e.target.value, 10);
                                if (!Number.isFinite(parsed)) return;
                                setLimit(Math.max(3, Math.min(parsed, 20)));
                              }}
                              disabled={isSaving}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
                            />
                          </div>
                        </div>

                        {queryHint && (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                            {queryHint}
                          </div>
                        )}

                        {!hasSharedGroupBy && (
                          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {t('dashboard.widgetEditor.noSharedGroupBy')}
                          </div>
                        )}

                        <div className="mt-4 space-y-3">
                          {queries.map((query) => (
                            <div
                              key={query.id}
                              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                            >
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-800 px-2 text-xs font-black text-white">
                                    {query.ref}
                                  </span>
                                  <p className="text-sm font-bold text-slate-700">
                                    {t('dashboard.widgetEditor.queryTitle', { ref: query.ref })}
                                  </p>
                                </div>
                                {queries.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveQuery(query.id)}
                                    disabled={isSaving}
                                    className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-700 disabled:opacity-60"
                                  >
                                    {t('dashboard.widgetEditor.removeQuery')}
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <CustomSelect
                                  label={t('dashboard.editModal.dataset')}
                                  options={accessibleDatasetOptions}
                                  value={query.dataset}
                                  onChange={(value) => {
                                    const dataset = value as DashboardDataset;
                                    updateQuery(query.id, (current) => ({
                                      ...current,
                                      dataset,
                                      metric: METRIC_OPTIONS[dataset].includes(current.metric)
                                        ? current.metric
                                        : getDefaultMetricForDataset(dataset),
                                    }));
                                  }}
                                  disabled={isSaving}
                                />
                                <CustomSelect
                                  label={t('dashboard.editModal.metric')}
                                  options={METRIC_OPTIONS[query.dataset].map((item) => ({
                                    id: item,
                                    name: t(`dashboard.metrics.${item}`),
                                  }))}
                                  value={query.metric}
                                  onChange={(value) =>
                                    updateQuery(query.id, (current) => ({
                                      ...current,
                                      metric: value as string,
                                    }))
                                  }
                                  disabled={isSaving}
                                />
                                <div>
                                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                                    {t('dashboard.widgetEditor.queryAliasLabel')}
                                  </label>
                                  <input
                                    value={query.label || ''}
                                    onChange={(e) =>
                                      updateQuery(query.id, (current) => ({
                                        ...current,
                                        label: e.target.value,
                                      }))
                                    }
                                    placeholder={t('dashboard.widgetEditor.queryAliasPlaceholder')}
                                    maxLength={120}
                                    disabled={isSaving}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <WidgetTransformationEditor
                        chartType={chartType}
                        queries={queries}
                        transformations={normalizedTransformations}
                        onChange={setTransformations}
                        disabled={isSaving}
                      />
                    )}
                  </div>
                </div>

                <div className="w-full shrink-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:w-80">
                  <div className="mb-5">
                    <CustomSelect
                      label={t('dashboard.widgetEditor.chartTypeLabel')}
                      options={chartTypeOptions}
                      value={chartType}
                      onChange={(value) => setChartType(value as DashboardWidget['chartType'])}
                      disabled={isSaving}
                    />
                  </div>

                  <div className="mb-5">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                      {t('dashboard.widgetEditor.legendTitle')}
                    </p>
                    <div className="space-y-3">
                      <CustomSelect
                        label={t('dashboard.widgetEditor.legendModeLabel')}
                        options={LEGEND_MODE_OPTIONS.map((item) => ({
                          id: item,
                          name: t(`dashboard.legendModes.${item}`),
                        }))}
                        value={legendMode}
                        onChange={(value) => setLegendMode(value as DashboardLegendMode)}
                        disabled={isSaving}
                      />
                      {legendMode === 'list' && (
                        <CustomSelect
                          label={t('dashboard.widgetEditor.legendPlacementLabel')}
                          options={LEGEND_PLACEMENT_OPTIONS.map((item) => ({
                            id: item,
                            name: t(`dashboard.legendPlacements.${item}`),
                          }))}
                          value={legendPlacement}
                          onChange={(value) =>
                            setLegendPlacement(value as DashboardLegendPlacement)
                          }
                          disabled={isSaving}
                        />
                      )}
                    </div>
                  </div>

                  <div className="mb-5">
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
                      {t('dashboard.widgetEditor.nameLabel')}
                    </label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t('dashboard.widgetEditor.namePlaceholder')}
                      disabled={isSaving}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
                    />
                  </div>

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
                      disabled={isSaving}
                      className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20 disabled:opacity-60"
                    />
                  </div>

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
                            onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}
                            className="ml-0.5 text-slate-400 hover:text-slate-700"
                            aria-label={`Remove tag ${tag}`}
                            disabled={isSaving}
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
                          placeholder={
                            tags.length === 0 ? t('dashboard.widgetEditor.tagsPlaceholder') : ''
                          }
                          disabled={isSaving}
                          className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 disabled:opacity-60"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default WidgetEditor;
