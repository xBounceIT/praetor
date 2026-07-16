import {
  Bookmark,
  Columns3,
  Layers3,
  ListFilter,
  Loader2,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { timeReportsApi } from '../../services/api/timeReports';
import { usersApi } from '../../services/api/users';
import { type SavedViewDto, viewsApi } from '../../services/api/views';
import type {
  ProjectTask,
  TimeEntry,
  TimeReportDefinition,
  TimeReportField,
  TimeReportGroup,
  TimeReportOptions,
  TimeReportPeriodPreset,
  TimeReportResult,
  TimeReportRow,
} from '../../types';
import { getLocalDateString } from '../../utils/date';
import { downloadBlob } from '../../utils/download';
import { hasPermission } from '../../utils/permissions';
import {
  finalizeTimeReportFavorite,
  sanitizeTimeReportFavorite,
} from '../../utils/timeReportFavorites';
import type { TrackerCatalogs } from '../../utils/trackerCatalogs';
import type { RecurringConfig, TaskFormDetails } from '../projects/TaskFormModal';
import DateField from '../shared/DateField';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import EntryEditDialog from '../timesheet/EntryEditDialog';

const REPORT_SCOPE_KEY = 'reports.time_report';
const DEFAULT_FIELDS: TimeReportField[] = ['client', 'project', 'task', 'duration', 'note'];
const FIELD_ORDER: TimeReportField[] = [
  'user',
  'client',
  'project',
  'task',
  'duration',
  'note',
  'cost',
];
const GROUP_ORDER: TimeReportGroup[] = ['date', 'user', 'client', 'project', 'task'];
const PERIOD_ORDER: TimeReportPeriodPreset[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
  'last_year',
  'custom',
];

const shiftDate = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const periodRange = (
  preset: TimeReportPeriodPreset,
  startOfWeek: 'Monday' | 'Sunday',
  now = new Date(),
): { fromDate: string; toDate: string } => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'today' || preset === 'custom') {
    const value = getLocalDateString(today);
    return { fromDate: value, toDate: value };
  }
  if (preset === 'yesterday') {
    const value = getLocalDateString(shiftDate(today, -1));
    return { fromDate: value, toDate: value };
  }
  if (preset === 'this_week' || preset === 'last_week') {
    const day = today.getDay();
    const offset = startOfWeek === 'Sunday' ? -day : day === 0 ? -6 : 1 - day;
    const currentStart = shiftDate(today, offset);
    const start = preset === 'last_week' ? shiftDate(currentStart, -7) : currentStart;
    return {
      fromDate: getLocalDateString(start),
      toDate: getLocalDateString(shiftDate(start, 6)),
    };
  }
  if (preset === 'this_month' || preset === 'last_month') {
    const monthOffset = preset === 'last_month' ? -1 : 0;
    const start = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return { fromDate: getLocalDateString(start), toDate: getLocalDateString(end) };
  }
  const year = today.getFullYear() + (preset === 'last_year' ? -1 : 0);
  return {
    fromDate: getLocalDateString(new Date(year, 0, 1)),
    toDate: getLocalDateString(new Date(year, 11, 31)),
  };
};

const createDefaultDefinition = (
  currentUserId: string,
  startOfWeek: 'Monday' | 'Sunday',
  now = new Date(),
): TimeReportDefinition => ({
  periodPreset: 'this_month',
  ...periodRange('this_month', startOfWeek, now),
  userIds: [currentUserId],
  clientId: null,
  projectIds: [],
  task: null,
  noteContains: '',
  fields: DEFAULT_FIELDS,
  groupBy: [],
  totalsOnly: false,
});

const formatDuration = (hours: number) => {
  const totalMinutes = Math.round(hours * 60);
  return `${Math.floor(totalMinutes / 60)}:${String(Math.abs(totalMinutes % 60)).padStart(2, '0')}`;
};

const formatCost = (value: number, currency: string, language: string) =>
  `${new Intl.NumberFormat(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${currency}`;

export interface TimeReportViewProps {
  permissions: string[];
  currency: string;
  startOfWeek: 'Monday' | 'Sunday';
  onUpdateEntry: (
    id: string,
    updates: Partial<Omit<TimeEntry, 'version'>> & Pick<TimeEntry, 'version'>,
  ) => Promise<void> | void;
  onAddCustomTask: (
    name: string,
    projectId: string,
    recurringConfig?: RecurringConfig,
    description?: string,
    details?: TaskFormDetails,
  ) => Promise<ProjectTask>;
  reportApi?: Pick<typeof timeReportsApi, 'options' | 'generate' | 'exportCsv'>;
  userCatalogsApi?: Pick<typeof usersApi, 'getTrackerCatalogs'>;
  savedViewsApi?: Pick<typeof viewsApi, 'list' | 'create' | 'remove'>;
  currentUserId: string;
}

const TimeReportView = ({
  permissions,
  currency,
  startOfWeek,
  onUpdateEntry,
  onAddCustomTask,
  reportApi = timeReportsApi,
  userCatalogsApi = usersApi,
  savedViewsApi = viewsApi,
  currentUserId,
}: TimeReportViewProps) => {
  const { t, i18n } = useTranslation(['reports', 'common']);
  const canSelectUsers = hasPermission(permissions, 'reports.time_report_all.view');
  const canViewCost = hasPermission(permissions, 'reports.cost.view');

  const [definition, setDefinition] = useState<TimeReportDefinition>(() =>
    createDefaultDefinition(currentUserId, startOfWeek),
  );
  const [generatedDefinition, setGeneratedDefinition] = useState<TimeReportDefinition | null>(null);
  const [options, setOptions] = useState<TimeReportOptions | null>(null);
  const [result, setResult] = useState<TimeReportResult | null>(null);
  const [favorites, setFavorites] = useState<SavedViewDto[]>([]);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState('');
  const [favoriteName, setFavoriteName] = useState('');
  const [favoriteToDelete, setFavoriteToDelete] = useState<SavedViewDto | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editingCatalogs, setEditingCatalogs] = useState<TrackerCatalogs | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);
  const [isDeletingFavorite, setIsDeletingFavorite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const loadFavorites = useCallback(async () => {
    const rows = await savedViewsApi.list('report', REPORT_SCOPE_KEY);
    setFavorites(rows);
  }, [savedViewsApi]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingOptions(true);
    Promise.all([
      reportApi.options(controller.signal),
      savedViewsApi.list('report', REPORT_SCOPE_KEY),
    ])
      .then(([loadedOptions, loadedFavorites]) => {
        setOptions(loadedOptions);
        setFavorites(loadedFavorites);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t('timeReport.errors.load'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingOptions(false);
      });
    return () => controller.abort();
  }, [reportApi, savedViewsApi, t]);

  useEffect(() => {
    if (!currentUserId) return;
    setDefinition((current) =>
      current.userIds.some(Boolean) ? current : { ...current, userIds: [currentUserId] },
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!result || !generatedDefinition) return;
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [generatedDefinition, result]);

  const updateDefinition = (patch: Partial<TimeReportDefinition>) => {
    setDefinition((current) => ({ ...current, ...patch }));
  };

  const handlePresetChange = (value: string | string[]) => {
    if (Array.isArray(value)) return;
    const preset = value as TimeReportPeriodPreset;
    if (preset === 'custom') {
      updateDefinition({ periodPreset: preset });
      return;
    }
    updateDefinition({ periodPreset: preset, ...periodRange(preset, startOfWeek) });
  };

  const visibleProjects = useMemo(
    () =>
      options?.projects.filter(
        (project) => definition.clientId === null || project.clientId === definition.clientId,
      ) ?? [],
    [definition.clientId, options],
  );

  const visibleTasks = useMemo(() => {
    const visibleProjectIds =
      definition.projectIds.length > 0
        ? new Set(definition.projectIds)
        : new Set(visibleProjects.map((project) => project.id));
    return options?.tasks.filter((task) => visibleProjectIds.has(task.projectId)) ?? [];
  }, [definition.projectIds, options, visibleProjects]);

  const handleClientChange = (value: string | string[]) => {
    if (Array.isArray(value)) return;
    const clientId = value || null;
    const allowedProjects = new Set(
      options?.projects
        .filter((project) => clientId === null || project.clientId === clientId)
        .map((project) => project.id) ?? [],
    );
    const projectIds = definition.projectIds.filter((id) => allowedProjects.has(id));
    updateDefinition({
      clientId,
      projectIds,
      task:
        definition.task && allowedProjects.has(definition.task.projectId) ? definition.task : null,
    });
  };

  const handleProjectChange = (value: string | string[]) => {
    if (!Array.isArray(value)) return;
    updateDefinition({
      projectIds: value,
      task:
        definition.task && (value.length === 0 || value.includes(definition.task.projectId))
          ? definition.task
          : null,
    });
  };

  const handleTaskChange = (value: string | string[]) => {
    if (Array.isArray(value)) return;
    const selected = visibleTasks.find((task) => task.key === value) ?? null;
    updateDefinition({
      task: selected
        ? { projectId: selected.projectId, taskId: selected.taskId, name: selected.name }
        : null,
    });
  };

  const toggleField = (field: TimeReportField, checked: boolean) => {
    updateDefinition({
      fields: checked
        ? FIELD_ORDER.filter(
            (candidate) => candidate === field || definition.fields.includes(candidate),
          )
        : definition.fields.filter((candidate) => candidate !== field),
    });
  };

  const updateGroup = (index: number, value: string | string[]) => {
    if (Array.isArray(value)) return;
    const next = [...definition.groupBy];
    if (!value) {
      next.splice(index);
    } else {
      next[index] = value as TimeReportGroup;
    }
    updateDefinition({
      groupBy: next,
      totalsOnly: next.length > 0 ? definition.totalsOnly : false,
    });
  };

  const generate = useCallback(
    async (target: TimeReportDefinition) => {
      setIsGenerating(true);
      setError(null);
      try {
        const generated = await reportApi.generate(target);
        setResult(generated);
        setGeneratedDefinition(target);
      } catch (generateError) {
        const message =
          generateError instanceof Error ? generateError.message : t('timeReport.errors.generate');
        setError(message);
        toast.error(message);
      } finally {
        setIsGenerating(false);
      }
    },
    [reportApi, t],
  );

  const applyFavorite = (favoriteId: string) => {
    setSelectedFavoriteId(favoriteId);
    const favorite = favorites.find((item) => item.id === favoriteId);
    if (!favorite || !options) return;
    const saved = favorite.config as unknown as TimeReportDefinition;
    const sanitized = sanitizeTimeReportFavorite(saved, options, {
      canSelectUsers,
      canViewCost,
      currentUserId,
    });
    const { definition: finalized, wasSanitized } = finalizeTimeReportFavorite(
      saved,
      sanitized,
      saved.periodPreset === 'custom' ? null : periodRange(saved.periodPreset, startOfWeek),
    );
    setDefinition(finalized);
    if (wasSanitized) toast.warning(t('timeReport.favorites.sanitized'));
  };

  const saveFavorite = async () => {
    const name = favoriteName.trim();
    if (!name) return;
    setIsSavingFavorite(true);
    try {
      await savedViewsApi.create({
        kind: 'report',
        scopeKey: REPORT_SCOPE_KEY,
        name,
        config: definition as unknown as Record<string, unknown>,
      });
      setFavoriteName('');
      await loadFavorites();
      toast.success(t('timeReport.favorites.saved'));
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : t('timeReport.errors.favorite'));
    } finally {
      setIsSavingFavorite(false);
    }
  };

  const deleteFavorite = async () => {
    if (!favoriteToDelete) return;
    setIsDeletingFavorite(true);
    try {
      await savedViewsApi.remove(favoriteToDelete.id);
      if (selectedFavoriteId === favoriteToDelete.id) setSelectedFavoriteId('');
      setFavoriteToDelete(null);
      await loadFavorites();
      toast.success(t('timeReport.favorites.deleted'));
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error ? deleteError.message : t('timeReport.errors.favorite'),
      );
    } finally {
      setIsDeletingFavorite(false);
    }
  };

  const exportCsv = async () => {
    if (!generatedDefinition || !result) return;
    setIsExporting(true);
    try {
      const blob = await reportApi.exportCsv(
        generatedDefinition,
        i18n.language.toLowerCase().startsWith('en') ? 'en' : 'it',
      );
      downloadBlob(
        `time-report-${generatedDefinition.fromDate}-${generatedDefinition.toDate}.csv`,
        blob,
      );
    } catch (exportError) {
      toast.error(
        exportError instanceof Error ? exportError.message : t('timeReport.errors.export'),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const closeEntryEditor = useCallback(() => {
    setEditingEntry(null);
    setEditingCatalogs(null);
  }, []);

  const openEntryEditor = useCallback(
    async (entry: TimeEntry) => {
      setEditingCatalogs(null);
      try {
        const catalogs = await userCatalogsApi.getTrackerCatalogs(entry.userId);
        setEditingCatalogs(catalogs);
        setEditingEntry(entry);
      } catch (catalogError) {
        toast.error(
          catalogError instanceof Error
            ? catalogError.message
            : t('timeReport.errors.editCatalogs'),
        );
      }
    },
    [t, userCatalogsApi],
  );

  const tableColumns = useMemo<Column<TimeReportRow>[]>(() => {
    if (!generatedDefinition) return [];
    const editableUserIds = new Set(options?.editableUserIds ?? []);
    const grouped = generatedDefinition.groupBy.length > 0;
    const common = {
      disableSorting: grouped,
      disableFiltering: grouped,
    };
    const columns: Column<TimeReportRow>[] = [
      {
        id: 'date',
        header: t('timeReport.columns.date'),
        accessorFn: (row) => row.date ?? row.label ?? '',
        cell: ({ row }) => (
          <span className={row.kind === 'subtotal' ? 'font-semibold' : undefined}>
            {row.date ?? row.label ?? ''}
          </span>
        ),
        ...common,
      },
    ];
    const fieldColumns: Record<TimeReportField, Column<TimeReportRow>> = {
      user: {
        id: 'user',
        header: t('timeReport.columns.user'),
        accessorFn: (row) => row.userName ?? '',
        ...common,
      },
      client: {
        id: 'client',
        header: t('timeReport.columns.client'),
        accessorFn: (row) => row.clientName ?? '',
        ...common,
      },
      project: {
        id: 'project',
        header: t('timeReport.columns.project'),
        accessorFn: (row) => row.projectName ?? '',
        ...common,
      },
      task: {
        id: 'task',
        header: t('timeReport.columns.task'),
        accessorFn: (row) => row.taskName ?? '',
        ...common,
      },
      duration: {
        id: 'duration',
        header: t('timeReport.columns.duration'),
        accessorFn: (row) => row.duration,
        cell: ({ row }) => (
          <span className={row.kind === 'subtotal' ? 'font-semibold tabular-nums' : 'tabular-nums'}>
            {formatDuration(row.duration)}
          </span>
        ),
        align: 'right',
        ...common,
      },
      note: {
        id: 'note',
        header: t('timeReport.columns.note'),
        accessorFn: (row) => row.notes ?? '',
        ...common,
      },
      cost: {
        id: 'cost',
        header: t('timeReport.columns.cost'),
        accessorFn: (row) => row.cost ?? '',
        cell: ({ row }) =>
          row.cost === null ? (
            ''
          ) : (
            <span
              className={row.kind === 'subtotal' ? 'font-semibold tabular-nums' : 'tabular-nums'}
            >
              {formatCost(row.cost, currency, i18n.language)}
            </span>
          ),
        align: 'right',
        ...common,
      },
    };
    for (const field of generatedDefinition.fields) columns.push(fieldColumns[field]);
    if (editableUserIds.size > 0) {
      columns.push({
        id: 'actions',
        header: t('common:labels.actions'),
        cell: ({ row }) => {
          const entry = row.entry;
          if (row.kind !== 'detail' || !entry || !row.userId || !editableUserIds.has(row.userId)) {
            return null;
          }
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('timeReport.actions.edit')}
              onClick={(event) => {
                event.stopPropagation();
                void openEntryEditor(entry);
              }}
            >
              <Pencil className="size-4" />
            </Button>
          );
        },
        disableSorting: true,
        disableFiltering: true,
        align: 'center',
        sticky: 'right',
      });
    }
    return columns;
  }, [currency, generatedDefinition, i18n.language, openEntryEditor, options?.editableUserIds, t]);

  const saveEditedEntry = async (
    id: string,
    updates: Partial<Omit<TimeEntry, 'version'>> & Pick<TimeEntry, 'version'>,
  ) => {
    await onUpdateEntry(id, updates);
    closeEntryEditor();
    if (generatedDefinition) await generate(generatedDefinition);
  };

  if (isLoadingOptions) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        {t('common:states.loading')}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8" data-testid="time-report-layout">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('timeReport.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('timeReport.description')}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('timeReport.errors.title')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card
        className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0"
        data-testid="time-report-favorites-section"
      >
        <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <Bookmark aria-hidden="true" className="size-4 text-praetor" />
            {t('timeReport.favorites.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <SelectControl
            options={favorites.map((favorite) => ({ id: favorite.id, name: favorite.name }))}
            value={selectedFavoriteId}
            onChange={(value) => !Array.isArray(value) && applyFavorite(value)}
            label={t('timeReport.favorites.select')}
            placeholder={t('timeReport.favorites.none')}
          />
          <Field>
            <FieldLabel htmlFor="time-report-favorite-name">
              {t('timeReport.favorites.name')}
            </FieldLabel>
            <Input
              id="time-report-favorite-name"
              value={favoriteName}
              onChange={(event) => setFavoriteName(event.target.value)}
              maxLength={255}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button
              type="button"
              onClick={saveFavorite}
              disabled={!favoriteName.trim() || isSavingFavorite}
            >
              <Save className="size-4" />
              {t('timeReport.favorites.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('timeReport.favorites.delete')}
              disabled={!selectedFavoriteId}
              onClick={() =>
                setFavoriteToDelete(
                  favorites.find((favorite) => favorite.id === selectedFavoriteId) ?? null,
                )
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card
        className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0"
        data-testid="time-report-filters-section"
      >
        <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <ListFilter aria-hidden="true" className="size-4 text-praetor" />
            {t('timeReport.filters.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectControl
              options={PERIOD_ORDER.map((preset) => ({
                id: preset,
                name: t(`timeReport.periods.${preset}`),
              }))}
              value={definition.periodPreset}
              onChange={handlePresetChange}
              label={t('timeReport.filters.period')}
            />
            <Field>
              <FieldLabel htmlFor="time-report-from">{t('timeReport.filters.from')}</FieldLabel>
              <DateField
                id="time-report-from"
                value={definition.fromDate}
                onChange={(fromDate) => updateDefinition({ fromDate })}
                disabled={definition.periodPreset !== 'custom'}
                required
                startOfWeek={startOfWeek}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="time-report-to">{t('timeReport.filters.to')}</FieldLabel>
              <DateField
                id="time-report-to"
                value={definition.toDate}
                onChange={(toDate) => updateDefinition({ toDate })}
                disabled={definition.periodPreset !== 'custom'}
                required
                startOfWeek={startOfWeek}
              />
            </Field>
            {canSelectUsers && (
              <SelectControl
                options={options?.users ?? []}
                value={definition.userIds}
                onChange={(value) => Array.isArray(value) && updateDefinition({ userIds: value })}
                label={t('timeReport.filters.users')}
                placeholder={t('timeReport.filters.usersPlaceholder')}
                searchable
                isMulti
              />
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectControl
              options={[
                { id: '', name: t('timeReport.filters.allClients') },
                ...(options?.clients ?? []),
              ]}
              value={definition.clientId ?? ''}
              onChange={handleClientChange}
              label={t('timeReport.filters.client')}
            />
            <SelectControl
              options={visibleProjects}
              value={definition.projectIds}
              onChange={handleProjectChange}
              label={t('timeReport.filters.projects')}
              placeholder={t('timeReport.filters.allProjects')}
              searchable
              isMulti
            />
            <SelectControl
              options={[
                { id: '', name: t('timeReport.filters.allTasks') },
                ...visibleTasks.map((task) => ({ id: task.key, name: task.name })),
              ]}
              value={
                definition.task?.taskId ??
                (definition.task
                  ? `legacy:${definition.task.projectId}:${definition.task.name.toLowerCase()}`
                  : '')
              }
              onChange={handleTaskChange}
              label={t('timeReport.filters.task')}
              searchable
            />
            <Field>
              <FieldLabel htmlFor="time-report-note">{t('timeReport.filters.note')}</FieldLabel>
              <Input
                id="time-report-note"
                value={definition.noteContains}
                onChange={(event) => updateDefinition({ noteContains: event.target.value })}
                placeholder={t('timeReport.filters.notePlaceholder')}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card
        className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0"
        data-testid="time-report-fields-section"
      >
        <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <Columns3 aria-hidden="true" className="size-4 text-praetor" />
            {t('timeReport.fields.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Field>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked disabled />
                {t('timeReport.columns.date')}
              </label>
              {FIELD_ORDER.filter((field) => field !== 'cost' || canViewCost).map((field) => (
                <label key={field} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={definition.fields.includes(field)}
                    onCheckedChange={(checked) => toggleField(field, checked === true)}
                  />
                  {t(`timeReport.columns.${field}`)}
                </label>
              ))}
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card
        className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0"
        data-testid="time-report-groups-section"
      >
        <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <Layers3 aria-hidden="true" className="size-4 text-praetor" />
            {t('timeReport.groups.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <SelectControl
                key={index}
                options={[
                  { id: '', name: t('timeReport.groups.none') },
                  ...GROUP_ORDER.map((group) => ({
                    id: group,
                    name: t(`timeReport.columns.${group}`),
                    disabled:
                      definition.groupBy.includes(group) && definition.groupBy[index] !== group,
                  })),
                ]}
                value={definition.groupBy[index] ?? ''}
                onChange={(value) => updateGroup(index, value)}
                disabled={index > definition.groupBy.length}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={definition.totalsOnly}
              disabled={definition.groupBy.length === 0}
              onCheckedChange={(checked) => updateDefinition({ totalsOnly: checked === true })}
            />
            {t('timeReport.groups.totalsOnly')}
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="button"
          size="lg"
          onClick={() => generate(definition)}
          disabled={isGenerating || definition.fromDate > definition.toDate}
        >
          {isGenerating && <Loader2 className="size-4 animate-spin" />}
          {t('timeReport.actions.generate')}
        </Button>
      </div>

      {result && generatedDefinition && (
        <div ref={resultsRef} className="scroll-mt-6" data-testid="time-report-results">
          {result.truncated && (
            <Alert className="mb-4">
              <AlertTitle>{t('timeReport.results.truncatedTitle')}</AlertTitle>
              <AlertDescription>
                {t('timeReport.results.truncated', { count: result.matchedEntryCount })}
              </AlertDescription>
            </Alert>
          )}
          <StandardTable
            title={t('timeReport.results.title')}
            persistenceKey="reports.timeReport.results"
            data={result.rows}
            columns={tableColumns}
            totalCount={result.matchedEntryCount}
            totalLabel={t('timeReport.results.entries')}
            showConfigurationControls={false}
            suppressSavedView
            allowColumnHiding={false}
            onExportCsv={exportCsv}
            isExporting={isExporting}
            shouldBypassFilters={(row) => row.kind === 'subtotal'}
            rowClassName={(row) =>
              row.kind === 'subtotal' ? 'bg-muted/60 font-medium border-t border-border' : ''
            }
            emptyState={
              <div className="py-10 text-center text-sm text-muted-foreground">
                {t('timeReport.results.empty')}
              </div>
            }
            footer={
              <div className="flex flex-wrap justify-end gap-6 text-sm font-semibold">
                <span>
                  {t('timeReport.results.totalDuration')}: {formatDuration(result.totals.duration)}
                </span>
                {result.totals.cost !== null && (
                  <span>
                    {t('timeReport.results.totalCost')}:{' '}
                    {formatCost(result.totals.cost, currency, i18n.language)}
                  </span>
                )}
              </div>
            }
          />
        </div>
      )}

      <EntryEditDialog
        entry={editingEntry}
        onClose={closeEntryEditor}
        onSave={saveEditedEntry}
        clients={editingCatalogs?.clients ?? []}
        projects={editingCatalogs?.projects ?? []}
        projectTasks={editingCatalogs?.projectTasks ?? []}
        permissions={permissions}
        currency={currency}
        onAddCustomTask={onAddCustomTask}
      />

      <DeleteConfirmModal
        isOpen={favoriteToDelete !== null}
        onClose={() => setFavoriteToDelete(null)}
        onConfirm={deleteFavorite}
        isDeleting={isDeletingFavorite}
        title={t('timeReport.favorites.deleteTitle')}
        description={t('timeReport.favorites.deleteDescription', {
          name: favoriteToDelete?.name ?? '',
        })}
      />
    </div>
  );
};

export default TimeReportView;
