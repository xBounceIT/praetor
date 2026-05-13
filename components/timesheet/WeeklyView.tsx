import { Eye, EyeOff } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Client, Project, ProjectTask, TimeEntry, TimeEntryLocation } from '../../types';
import { downloadCsv } from '../../utils/csv';
import { dateOnlyStringToLocalDate, getLocalDateString } from '../../utils/date';
import { isItalianHoliday } from '../../utils/holidays';
import Calendar from '../shared/Calendar';
import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import { useCatalogSelection } from './useCatalogSelection';
import WeeklyEntryForm, { type WeeklyEntryFormErrors } from './WeeklyEntryForm';

export interface WeeklyViewProps {
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  permissions: string[];
  currency: string;
  onAddCustomTask: (
    name: string,
    projectId: string,
    recurringConfig?: { isRecurring: boolean; pattern: 'daily' | 'weekly' | 'monthly' },
    description?: string,
    details?: Pick<
      ProjectTask,
      'expectedEffort' | 'monthlyEffort' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
    >,
  ) => Promise<ProjectTask>;
  onAddBulkEntries: (entries: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[]) => Promise<void>;
  onUpdateEntry: (id: string, updates: Partial<TimeEntry>) => void;
  viewingUserId: string;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  allowWeekendSelection?: boolean;
  defaultLocation?: TimeEntryLocation;
  dailyGoal: number;
}

const getWeekStart = (date: Date, startOfWeek: 'Monday' | 'Sunday'): Date => {
  const d = new Date(date);
  const day = d.getDay();
  // Sunday-first: shift back by `day` days. Monday-first: shift back by `day - 1`
  // days, except for Sunday (day === 0) which should jump back 6 days.
  const diff =
    startOfWeek === 'Sunday' ? d.getDate() - day : d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
};

type DayCell = { duration: string; note: string; entryId?: string };
type DayMap = Record<string, DayCell>;

type EntryRow = {
  key: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  taskName: string;
  location: TimeEntryLocation;
  baseDays: DayMap;
};

const FORM_ROW_KEY = '__form_row__';

const parseDuration = (raw: string): number => {
  if (!raw) return 0;
  const parsed = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const WeeklyView: React.FC<WeeklyViewProps> = ({
  entries,
  clients,
  projects,
  projectTasks,
  permissions,
  currency,
  onAddCustomTask,
  onAddBulkEntries,
  onUpdateEntry,
  viewingUserId,
  selectedDate,
  onSelectedDateChange,
  startOfWeek,
  treatSaturdayAsHoliday,
  allowWeekendSelection = false,
  defaultLocation = 'remote',
  dailyGoal,
}) => {
  const { t } = useTranslation('timesheets');

  const currentWeekStart = useMemo(
    () => getWeekStart(dateOnlyStringToLocalDate(selectedDate), startOfWeek),
    [selectedDate, startOfWeek],
  );

  const weekDays = useMemo(() => {
    return [0, 1, 2, 3, 4, 5, 6].map((offset) => {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + offset);
      const dateStr = getLocalDateString(d);
      const holidayName = isItalianHoliday(new Date(`${dateStr}T00:00:00`));
      const isSunday = d.getDay() === 0;
      const isSaturday = d.getDay() === 6;
      const isWeekendOrHoliday =
        isSunday || (treatSaturdayAsHoliday && isSaturday) || !!holidayName;
      const isForbidden = !allowWeekendSelection && isWeekendOrHoliday;
      const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];

      return {
        dateStr,
        dayKey,
        dayNum: d.getDate(),
        isToday: dateStr === getLocalDateString(new Date()),
        isForbidden,
        isWeekendOrHoliday,
        holidayName,
      };
    });
  }, [currentWeekStart, treatSaturdayAsHoliday, allowWeekendSelection]);

  const weekDates = useMemo(() => weekDays.map((d) => d.dateStr), [weekDays]);

  const userEntries = useMemo(
    () => entries.filter((e) => e.userId === viewingUserId),
    [entries, viewingUserId],
  );

  const selection = useCatalogSelection({
    clients,
    projects,
    projectTasks,
    defaultLocation,
  });

  const [errors, setErrors] = useState<WeeklyEntryFormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [weekNote, setWeekNote] = useState('');
  const [hideWeekend, setHideWeekend] = useState(false);

  // Saturday and Sunday columns are hidden when `hideWeekend` is on so the
  // weekday columns can claim the freed width. State + submit still operate
  // on all seven days — hiding is purely a display concern, so a user who
  // had weekend hours pending won't lose them by toggling visibility.
  const visibleWeekDays = useMemo(
    () =>
      hideWeekend
        ? weekDays.filter((day) => day.dayKey !== 'sat' && day.dayKey !== 'sun')
        : weekDays,
    [weekDays, hideWeekend],
  );

  const [pendingEdits, setPendingEdits] = useState<Record<string, DayMap>>({});

  // Reset pending edits whenever the visible week changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentWeekStart is the intended trigger
  useEffect(() => {
    setPendingEdits({});
  }, [currentWeekStart]);

  // Entries matching the form selection in the current week — used to pre-fill
  // the "Nuova voce" row so an existing combo isn't double-rendered.
  const formRowBaseDays = useMemo<DayMap>(() => {
    if (!selection.clientId || !selection.projectId || !selection.taskName) return {};
    const days: DayMap = {};
    for (const entry of userEntries) {
      if (entry.clientId !== selection.clientId) continue;
      if (entry.projectId !== selection.projectId) continue;
      if (entry.task !== selection.taskName) continue;
      if (!weekDates.includes(entry.date)) continue;
      days[entry.date] = {
        duration: String(entry.duration),
        note: entry.notes ?? '',
        entryId: entry.id,
      };
    }
    return days;
  }, [userEntries, weekDates, selection.clientId, selection.projectId, selection.taskName]);

  // Rows for previously-logged combos. Includes every distinct (client,
  // project, task) the viewing user has used and is still in scope. Combos
  // with entries in the current week sort first; the rest fall back to most-
  // recent `createdAt`. The combo matching the form selection is dropped so
  // the "Nuova voce" row at the top isn't duplicated.
  const entryRows: EntryRow[] = useMemo(() => {
    const groups = new Map<
      string,
      { row: EntryRow; maxCreatedAt: number; hasWeekEntry: boolean }
    >();
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const taskKey = (projectId: string, name: string) => `${projectId}|${name}`;
    const taskSet = new Set(projectTasks.map((task) => taskKey(task.projectId, task.name)));

    for (const entry of userEntries) {
      if (!clientById.has(entry.clientId)) continue;
      if (!projectById.has(entry.projectId)) continue;
      if (!taskSet.has(taskKey(entry.projectId, entry.task))) continue;

      const key = `${entry.clientId}|${entry.projectId}|${entry.task}`;
      let group = groups.get(key);
      if (!group) {
        const client = clientById.get(entry.clientId);
        const project = projectById.get(entry.projectId);
        group = {
          row: {
            key,
            clientId: entry.clientId,
            clientName: client?.name ?? '',
            projectId: entry.projectId,
            projectName: project?.name ?? '',
            taskName: entry.task,
            location: entry.location ?? defaultLocation,
            baseDays: {},
          },
          maxCreatedAt: entry.createdAt,
          hasWeekEntry: false,
        };
        groups.set(key, group);
      }
      if (entry.createdAt > group.maxCreatedAt) group.maxCreatedAt = entry.createdAt;
      if (weekDates.includes(entry.date)) {
        group.hasWeekEntry = true;
        group.row.baseDays[entry.date] = {
          duration: String(entry.duration),
          note: entry.notes ?? '',
          entryId: entry.id,
        };
        if (entry.location) group.row.location = entry.location;
      }
    }

    const formKey =
      selection.clientId && selection.projectId && selection.taskName
        ? `${selection.clientId}|${selection.projectId}|${selection.taskName}`
        : '';
    if (formKey) groups.delete(formKey);

    return Array.from(groups.values())
      .sort((a, b) => {
        if (a.hasWeekEntry !== b.hasWeekEntry) return a.hasWeekEntry ? -1 : 1;
        return b.maxCreatedAt - a.maxCreatedAt;
      })
      .slice(0, 5)
      .map((g) => g.row);
  }, [
    userEntries,
    weekDates,
    clients,
    projects,
    projectTasks,
    selection.clientId,
    selection.projectId,
    selection.taskName,
    defaultLocation,
  ]);

  // When the set of entry rows changes (e.g. user switches), drop stale edits
  // that no longer match an existing row. Use a Set of raw keys — each row
  // key already contains `|`, so split/join would lose boundaries.
  const entryRowKeySet = useMemo(() => new Set(entryRows.map((r) => r.key)), [entryRows]);
  useEffect(() => {
    setPendingEdits((prev) => {
      let changed = false;
      const next: Record<string, DayMap> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (key === FORM_ROW_KEY || entryRowKeySet.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [entryRowKeySet]);

  const getCellValue = (rowKey: string, dateStr: string, baseDays?: DayMap): DayCell => {
    const edit = pendingEdits[rowKey]?.[dateStr];
    if (edit) return edit;
    if (baseDays?.[dateStr]) return baseDays[dateStr];
    return { duration: '', note: '' };
  };

  const updateCell = (
    rowKey: string,
    dateStr: string,
    patch: Partial<Pick<DayCell, 'duration' | 'note'>>,
    baseCell?: DayCell,
  ) => {
    setPendingEdits((prev) => {
      const rowEdits = prev[rowKey] ?? {};
      const existing = rowEdits[dateStr];
      const seed: DayCell = existing ?? baseCell ?? { duration: '', note: '' };
      const nextCell: DayCell = {
        duration: patch.duration ?? seed.duration,
        note: patch.note ?? seed.note,
        entryId: seed.entryId,
      };
      return { ...prev, [rowKey]: { ...rowEdits, [dateStr]: nextCell } };
    });
  };

  const renderDayCellInputs = (
    rowKey: string,
    day: (typeof weekDays)[number],
    baseDays: DayMap,
  ) => {
    const cell = getCellValue(rowKey, day.dateStr, baseDays);
    return (
      <div className="flex flex-col gap-2">
        <ValidatedNumberInput
          placeholder="0.0"
          disabled={day.isForbidden}
          value={cell.duration}
          onValueChange={(value) =>
            updateCell(rowKey, day.dateStr, { duration: value }, baseDays[day.dateStr])
          }
          className={cn(
            'h-9 w-full text-center text-sm font-bold',
            day.isForbidden && 'opacity-50 cursor-not-allowed',
          )}
        />
        <Input
          type="text"
          placeholder={t('weekly.note')}
          disabled={day.isForbidden}
          value={cell.note}
          onChange={(e) =>
            updateCell(rowKey, day.dateStr, { note: e.target.value }, baseDays[day.dateStr])
          }
          className={cn('h-7 text-xs rounded', day.isForbidden && 'opacity-40 cursor-not-allowed')}
        />
      </div>
    );
  };

  const clearError = (field: keyof WeeklyEntryFormErrors) => {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setErrors({});

    const newErrors: WeeklyEntryFormErrors = {};
    const formEdits = pendingEdits[FORM_ROW_KEY] ?? {};
    const hasFormHours = Object.values(formEdits).some((cell) => parseDuration(cell.duration) > 0);

    if (hasFormHours) {
      if (!selection.clientId) newErrors.clientId = t('common:validation.clientRequired');
      if (!selection.projectId) newErrors.projectId = t('common:validation.projectRequired');
      if (!selection.taskName) {
        const availableTasks = projectTasks.filter(
          (task) => task.projectId === selection.projectId,
        );
        if (availableTasks.length > 0) {
          newErrors.task = t('common:validation.taskNameRequired');
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsLoading(false);
      return;
    }

    const entriesToAdd: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[] = [];

    const submitRow = (
      rowKey: string,
      meta: {
        clientId: string;
        projectId: string;
        taskName: string;
        location: TimeEntryLocation;
        baseDays: DayMap;
      },
    ) => {
      const client = clients.find((c) => c.id === meta.clientId);
      const project = projects.find((p) => p.id === meta.projectId);
      const rowEdits = pendingEdits[rowKey] ?? {};
      for (const day of weekDays) {
        const base = meta.baseDays[day.dateStr];
        const edit = rowEdits[day.dateStr];
        if (!edit) continue;
        const newDuration = parseDuration(edit.duration);
        const baseDuration = base ? parseDuration(base.duration) : 0;
        const noteChanged = (edit.note ?? '') !== (base?.note ?? '');
        if (base?.entryId) {
          if (newDuration > 0 && (newDuration !== baseDuration || noteChanged)) {
            // `edit.note` directly so a user can clear a previously-set note.
            onUpdateEntry(base.entryId, {
              duration: newDuration,
              notes: edit.note,
              task: meta.taskName,
              projectId: meta.projectId,
              clientId: meta.clientId,
              clientName: client?.name || 'Unknown',
              projectName: project?.name || 'General',
              location: meta.location,
            });
          }
          continue;
        }
        if (newDuration > 0) {
          entriesToAdd.push({
            date: day.dateStr,
            clientId: meta.clientId,
            clientName: client?.name || 'Unknown',
            projectId: meta.projectId,
            projectName: project?.name || 'General',
            task: meta.taskName,
            duration: newDuration,
            notes: edit.note || weekNote,
            hourlyCost: 0,
            location: meta.location,
          });
        }
      }
    };

    if (hasFormHours) {
      submitRow(FORM_ROW_KEY, {
        clientId: selection.clientId,
        projectId: selection.projectId,
        taskName: selection.taskName,
        location: selection.location,
        baseDays: formRowBaseDays,
      });
    }

    for (const row of entryRows) {
      submitRow(row.key, {
        clientId: row.clientId,
        projectId: row.projectId,
        taskName: row.taskName,
        location: row.location,
        baseDays: row.baseDays,
      });
    }

    try {
      if (entriesToAdd.length > 0) {
        await onAddBulkEntries(entriesToAdd);
      }
      setPendingEdits({});
      setWeekNote('');
      setShowSuccess(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(() => setShowSuccess(false), 2500);
    return () => clearTimeout(timer);
  }, [showSuccess]);

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const day of weekDays) {
      let sum = 0;
      const formEdit = pendingEdits[FORM_ROW_KEY]?.[day.dateStr];
      if (formEdit) {
        sum += parseDuration(formEdit.duration);
      } else {
        const formBase = formRowBaseDays[day.dateStr];
        if (formBase) sum += parseDuration(formBase.duration);
      }
      for (const row of entryRows) {
        const edit = pendingEdits[row.key]?.[day.dateStr];
        if (edit) {
          sum += parseDuration(edit.duration);
        } else {
          const base = row.baseDays[day.dateStr];
          if (base) sum += parseDuration(base.duration);
        }
      }
      totals[day.dateStr] = sum;
    }
    return totals;
  }, [weekDays, entryRows, pendingEdits, formRowBaseDays]);

  const weekTotal = useMemo(() => Object.values(dayTotals).reduce((a, b) => a + b, 0), [dayTotals]);

  const monthTotal = useMemo(() => {
    const monthYear = `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth() + 1).padStart(2, '0')}`;
    return userEntries
      .filter((e) => e.date.startsWith(monthYear))
      .reduce((sum, e) => sum + e.duration, 0);
  }, [userEntries, currentWeekStart]);

  const formSelectionLabels = useMemo(() => {
    const client = clients.find((c) => c.id === selection.clientId);
    const project = projects.find((p) => p.id === selection.projectId);
    return {
      clientName: client?.name ?? '',
      projectName: project?.name ?? '',
      taskName: selection.taskName,
    };
  }, [clients, projects, selection.clientId, selection.projectId, selection.taskName]);

  const renderRowLabel = (
    clientName: string,
    projectName: string,
    taskName: string,
  ): React.ReactNode => {
    const rows: Array<{ icon: string; text: string }> = [];
    if (clientName) rows.push({ icon: 'fa-building', text: clientName });
    if (projectName) rows.push({ icon: 'fa-folder-open', text: projectName });
    if (taskName) rows.push({ icon: 'fa-list-check', text: taskName });
    if (rows.length === 0) return null;
    return (
      <div className="flex flex-col gap-1">
        {rows.map(({ icon, text }) => (
          <div key={icon} className="flex items-center gap-2 text-xs text-foreground">
            <i
              className={cn('fa-solid w-3 text-[10px] text-muted-foreground', icon)}
              aria-hidden="true"
            />
            <span className="line-clamp-1">{text}</span>
          </div>
        ))}
      </div>
    );
  };

  const hasPendingEdits = Object.values(pendingEdits).some((row) => Object.keys(row).length > 0);
  const weeklyGoal = dailyGoal * 5;

  const handleExportToCsv = () => {
    const formatHours = (hours: number) => (hours > 0 ? hours.toFixed(2) : '');
    const sumDayValues = (values: string[]) =>
      values.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

    const headerRow = [
      '',
      ...visibleWeekDays.map((day) => `${t(`weekly.days.${day.dayKey}`)} ${day.dayNum}`),
      t('weekly.total'),
    ];
    const rows: string[][] = [headerRow];

    const joinLabel = (clientName: string, projectName: string, taskName: string) =>
      [clientName, projectName, taskName].filter(Boolean).join(' · ');

    const formRowValues = visibleWeekDays.map((day) => {
      const cell = getCellValue(FORM_ROW_KEY, day.dateStr, formRowBaseDays);
      return formatHours(parseDuration(cell.duration));
    });
    const formRowTotal = sumDayValues(formRowValues);
    if (formRowTotal > 0) {
      const label =
        joinLabel(
          formSelectionLabels.clientName,
          formSelectionLabels.projectName,
          formSelectionLabels.taskName,
        ) || t('weekly.newEntry');
      rows.push([label, ...formRowValues, formatHours(formRowTotal)]);
    }

    for (const row of entryRows) {
      const dayValues = visibleWeekDays.map((day) => {
        const cell = getCellValue(row.key, day.dateStr, row.baseDays);
        return formatHours(parseDuration(cell.duration));
      });
      const rowTotal = sumDayValues(dayValues);
      rows.push([
        joinLabel(row.clientName, row.projectName, row.taskName),
        ...dayValues,
        formatHours(rowTotal),
      ]);
    }

    rows.push([
      t('weekly.total'),
      ...visibleWeekDays.map((day) => formatHours(dayTotals[day.dateStr] ?? 0)),
      formatHours(weekTotal),
    ]);

    downloadCsv(rows, `weekly_timesheet_${getLocalDateString(currentWeekStart)}.csv`);
  };

  return (
    <div className="w-full xl:w-[calc(45%+300px+1.5rem)] xl:mx-auto space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start xl:items-stretch">
        <WeeklyEntryForm
          selectedDate={selectedDate}
          selection={selection}
          weekNote={weekNote}
          errors={errors}
          onWeekNoteChange={setWeekNote}
          onClearError={clearError}
          clients={clients}
          projects={projects}
          permissions={permissions}
          currency={currency}
          onAddCustomTask={onAddCustomTask}
          defaultLocation={defaultLocation}
          onSubmit={handleSubmit}
          isSubmitting={isLoading}
          showSubmitSuccess={showSuccess}
          canSubmit={hasPendingEdits}
        />

        <div className="w-full xl:max-w-[300px] xl:h-full">
          <Calendar
            selectedDate={selectedDate}
            onDateSelect={onSelectedDateChange}
            entries={userEntries}
            startOfWeek={startOfWeek}
            treatSaturdayAsHoliday={treatSaturdayAsHoliday}
            dailyGoal={dailyGoal}
            allowWeekendSelection={allowWeekendSelection}
            size="compact"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 mb-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {t('weekly.weekTotal')}
              </span>
              <span
                className={cn(
                  'text-lg font-black transition-colors',
                  weekTotal > weeklyGoal ? 'text-destructive' : 'text-praetor',
                )}
              >
                {weekTotal.toFixed(2)} h
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {t('weekly.monthTotal')}
              </span>
              <span className="text-lg font-black text-foreground">{monthTotal.toFixed(2)} h</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t('common:table.exportToCsv')}
                    onClick={handleExportToCsv}
                    className={TABLE_CONTROL_BUTTON_CLASSNAME}
                  >
                    <i className="fa-solid fa-file-export text-xs" aria-hidden="true"></i>
                    <span>{t('common:table.export')}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('common:table.exportToCsv')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant={hideWeekend ? 'secondary' : 'outline'}
                    size="sm"
                    aria-label={t('weekly.hideWeekend')}
                    aria-pressed={hideWeekend}
                    onClick={() => setHideWeekend((v) => !v)}
                    className={TABLE_CONTROL_BUTTON_CLASSNAME}
                  >
                    {hideWeekend ? (
                      <EyeOff className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="size-3.5" aria-hidden="true" />
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('weekly.hideWeekend')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="-mx-5 overflow-x-auto">
          <Table className="border-collapse">
            <TableHeader className="bg-muted/40">
              <TableRow className="border-b border-border">
                <TableHead className="px-4 py-3 min-w-56" />

                {visibleWeekDays.map((day) => (
                  <TableHead
                    key={day.dateStr}
                    className={cn(
                      'min-w-28 px-2 py-2 text-center relative align-middle',
                      day.isToday && 'bg-accent',
                      day.isWeekendOrHoliday && 'bg-destructive/5',
                    )}
                  >
                    <div
                      className={cn(
                        'flex items-center justify-center gap-1 text-[10px] font-black uppercase',
                        day.isToday
                          ? 'text-praetor'
                          : day.isWeekendOrHoliday
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {t(`weekly.days.${day.dayKey}`)}
                      {day.holidayName && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <span className="size-1.5 bg-destructive rounded-full animate-pulse block"></span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{day.holidayName}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <p
                      className={cn(
                        'text-sm font-black leading-none mt-0.5',
                        day.isToday
                          ? 'text-praetor'
                          : day.isWeekendOrHoliday
                            ? 'text-destructive'
                            : 'text-foreground',
                      )}
                    >
                      {day.dayNum}
                    </p>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-praetor/5 hover:bg-praetor/10">
                <TableCell className="px-4 py-3 align-top whitespace-normal">
                  <p className="text-[10px] font-bold text-praetor uppercase tracking-wider mb-2">
                    {t('weekly.newEntry')}
                  </p>
                  {renderRowLabel(
                    formSelectionLabels.clientName,
                    formSelectionLabels.projectName,
                    formSelectionLabels.taskName,
                  )}
                </TableCell>
                {visibleWeekDays.map((day) => (
                  <TableCell
                    key={day.dateStr}
                    className={cn(
                      'min-w-28 px-2 py-3 align-top',
                      day.isToday && 'bg-accent/60',
                      day.isWeekendOrHoliday && 'bg-destructive/5',
                    )}
                  >
                    {renderDayCellInputs(FORM_ROW_KEY, day, formRowBaseDays)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
            <TableBody className="divide-y divide-border border-t-[3px] border-t-border">
              {entryRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={1 + visibleWeekDays.length}
                    className="px-4 py-6 text-center text-xs text-muted-foreground"
                  >
                    {t('weekly.noRecentTasks')}
                  </TableCell>
                </TableRow>
              ) : (
                entryRows.map((row) => (
                  <TableRow key={row.key} className="hover:bg-muted/30">
                    <TableCell className="px-4 py-3 align-middle whitespace-normal">
                      {renderRowLabel(row.clientName, row.projectName, row.taskName)}
                    </TableCell>
                    {visibleWeekDays.map((day) => {
                      const cell = getCellValue(row.key, day.dateStr, row.baseDays);
                      return (
                        <TableCell
                          key={day.dateStr}
                          className={cn(
                            'min-w-28 px-2 py-3 align-top',
                            day.isToday && 'bg-accent/60',
                            day.isWeekendOrHoliday && 'bg-destructive/5',
                            showSuccess && parseDuration(cell.duration) > 0 && 'bg-emerald-500/10',
                          )}
                        >
                          {renderDayCellInputs(row.key, day, row.baseDays)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter className="bg-muted/30">
              <TableRow className="border-t border-border">
                <TableCell className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {t('weekly.total')}
                </TableCell>
                {visibleWeekDays.map((day) => (
                  <TableCell
                    key={day.dateStr}
                    className={cn(
                      'min-w-28 px-2 py-3 text-center',
                      day.isToday && 'bg-accent',
                      day.isWeekendOrHoliday && 'bg-destructive/5',
                    )}
                  >
                    <p
                      className={cn(
                        'text-sm font-black',
                        dayTotals[day.dateStr] > dailyGoal ? 'text-destructive' : 'text-praetor',
                      )}
                    >
                      {dayTotals[day.dateStr].toFixed(1)}
                    </p>
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default WeeklyView;
