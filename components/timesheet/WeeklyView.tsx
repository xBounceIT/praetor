import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Client, Project, ProjectTask, TimeEntry, TimeEntryLocation, User } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { isItalianHoliday } from '../../utils/holidays';
import SelectControl from '../shared/SelectControl';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import EntryCatalogSelector from './EntryCatalogSelector';
import { useCatalogSelection } from './useCatalogSelection';

export interface WeeklyViewProps {
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  projectTasks: ProjectTask[];
  onAddBulkEntries: (entries: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[]) => Promise<void>;
  onDeleteEntry: (id: string) => void;
  onUpdateEntry: (id: string, updates: Partial<TimeEntry>) => void;
  viewingUserId: string;
  currentUserId?: string;
  availableUsers: User[];
  onViewUserChange: (id: string) => void;
  startOfWeek: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday: boolean;
  allowWeekendSelection?: boolean;
  defaultLocation?: TimeEntryLocation;
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

type RecentRow = {
  key: string;
  clientId: string;
  projectId: string;
  taskName: string;
  location: TimeEntryLocation;
  label: string;
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
  onAddBulkEntries,
  onUpdateEntry,
  viewingUserId,
  currentUserId,
  availableUsers,
  onViewUserChange,
  startOfWeek,
  treatSaturdayAsHoliday,
  allowWeekendSelection = false,
  defaultLocation = 'remote',
}) => {
  const { t, i18n } = useTranslation('timesheets');

  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    getWeekStart(new Date(), startOfWeek),
  );

  // Re-align the current week when the startOfWeek setting changes — generalSettings
  // loads async, so the prop can flip after mount and the displayed week must follow.
  useEffect(() => {
    setCurrentWeekStart((prev) => {
      const realigned = getWeekStart(prev, startOfWeek);
      return realigned.getTime() === prev.getTime() ? prev : realigned;
    });
  }, [startOfWeek]);

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

  const [errors, setErrors] = useState<{ clientId?: string; projectId?: string; task?: string }>(
    {},
  );

  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [weekNote, setWeekNote] = useState('');

  // Per-row, per-day edits the user has made since the last sync from props.
  const [pendingEdits, setPendingEdits] = useState<Record<string, DayMap>>({});

  // Reset pending edits whenever the visible week changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentWeekStart is the intended trigger
  useEffect(() => {
    setPendingEdits({});
  }, [currentWeekStart]);

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

  const recentRows: RecentRow[] = useMemo(() => {
    const groups = new Map<
      string,
      {
        row: RecentRow;
        maxCreatedAt: number;
        hasWeekEntry: boolean;
      }
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
            projectId: entry.projectId,
            taskName: entry.task,
            location: entry.location ?? defaultLocation,
            label: [client?.name, project?.name, entry.task].filter(Boolean).join(' · '),
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
        if (entry.location) {
          group.row.location = entry.location;
        }
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

  // When the set of recent rows changes (e.g. user switches), drop stale edits
  // that no longer match an existing row. Each row's key is itself a
  // `|`-joined composite, so a join+split would lose key boundaries — use the
  // raw Set directly.
  const recentRowKeySet = useMemo(() => new Set(recentRows.map((r) => r.key)), [recentRows]);
  useEffect(() => {
    setPendingEdits((prev) => {
      let changed = false;
      const next: Record<string, DayMap> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (key === FORM_ROW_KEY || recentRowKeySet.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [recentRowKeySet]);

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
      return {
        ...prev,
        [rowKey]: { ...rowEdits, [dateStr]: nextCell },
      };
    });
  };

  const handleWeekChange = (offset: number) => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() + offset * 7);
    setCurrentWeekStart(newStart);
    setErrors({});
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setErrors({});

    const newErrors: typeof errors = {};
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
            onUpdateEntry(base.entryId, {
              duration: newDuration,
              notes: edit.note || weekNote || base.note,
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

    for (const row of recentRows) {
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
      // Only clear edits + flash success when the bulk-add resolves cleanly
      // — on failure the user's in-flight values must survive so they can
      // retry. The parent surfaces the error via App.tsx's global handler.
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
      for (const row of recentRows) {
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
  }, [weekDays, recentRows, pendingEdits, formRowBaseDays]);

  const weekTotal = useMemo(() => Object.values(dayTotals).reduce((a, b) => a + b, 0), [dayTotals]);

  const monthTotal = useMemo(() => {
    const monthYear = `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth() + 1).padStart(2, '0')}`;
    return userEntries
      .filter((e) => e.date.startsWith(monthYear))
      .reduce((sum, e) => sum + e.duration, 0);
  }, [userEntries, currentWeekStart]);

  const weekEnd = useMemo(() => {
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 6);
    return end;
  }, [currentWeekStart]);

  const weekRangeLabel = `${currentWeekStart.toLocaleDateString(i18n.language, {
    month: 'short',
    day: 'numeric',
  })} – ${weekEnd.toLocaleDateString(i18n.language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  const formLabel = useMemo(() => {
    const client = clients.find((c) => c.id === selection.clientId);
    const project = projects.find((p) => p.id === selection.projectId);
    const parts = [client?.name, project?.name, selection.taskName].filter((p) => Boolean(p));
    return parts.length > 0 ? parts.join(' · ') : t('weekly.newEntry');
  }, [clients, projects, selection.clientId, selection.projectId, selection.taskName, t]);

  const hasPendingEdits = Object.values(pendingEdits).some((row) => Object.keys(row).length > 0);

  return (
    <div className="w-full xl:w-[calc(45%+300px+1.5rem)] xl:mx-auto space-y-6">
      <Card className="px-6 py-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleWeekChange(-1)}
              aria-label={t('weekly.weekView')}
            >
              <i className="fa-solid fa-chevron-left"></i>
            </Button>
            <div className="text-center min-w-50">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                {weekRangeLabel}
              </h3>
              <p className="text-[10px] font-bold text-praetor uppercase">{t('weekly.weekView')}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleWeekChange(1)}
              aria-label={t('weekly.weekView')}
            >
              <i className="fa-solid fa-chevron-right"></i>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setCurrentWeekStart(getWeekStart(new Date(), startOfWeek))}
              className="rounded-full text-[10px] font-bold uppercase tracking-widest"
            >
              {t('weekly.goToToday')}
            </Button>
          </div>

          {availableUsers.length > 1 && (
            <div className="w-64 space-y-1.5">
              <div className="flex min-h-6 items-center justify-between gap-2">
                <FieldLabel>{t('weekly.viewingUser')}</FieldLabel>
                {currentUserId && viewingUserId !== currentUserId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => onViewUserChange(currentUserId)}
                    className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    <i className="fa-solid fa-arrow-left" aria-hidden="true"></i>
                    {t('tracker.backToMe')}
                  </Button>
                )}
              </div>
              <SelectControl
                options={availableUsers.map((u) => ({
                  id: u.id,
                  name: u.name,
                  badge: u.id === currentUserId ? t('tracker.you') : undefined,
                }))}
                value={viewingUserId}
                onChange={(val) => onViewUserChange(val as string)}
                searchable={true}
              />
            </div>
          )}
        </div>
      </Card>

      <Card className="px-6 py-5 gap-4">
        <EntryCatalogSelector
          clients={clients}
          filteredProjects={selection.filteredProjects}
          filteredTasks={selection.filteredTasks}
          selectedClientId={selection.clientId}
          selectedProjectId={selection.projectId}
          selectedTaskId={selection.taskId}
          location={selection.location}
          onClientChange={(id) => {
            selection.setClient(id);
            if (errors.clientId) setErrors((prev) => ({ ...prev, clientId: '' }));
          }}
          onProjectChange={(id) => {
            selection.setProject(id);
            if (errors.projectId) setErrors((prev) => ({ ...prev, projectId: '' }));
          }}
          onTaskChange={(taskId) => {
            selection.setTask(taskId);
            if (errors.task) setErrors((prev) => ({ ...prev, task: '' }));
          }}
          onLocationChange={selection.setLocation}
          errors={errors}
        />

        <Field>
          <FieldLabel htmlFor="weekly-week-note">{t('weekly.weekNote')}</FieldLabel>
          <Input
            id="weekly-week-note"
            type="text"
            value={weekNote}
            onChange={(e) => setWeekNote(e.target.value)}
            placeholder={t('weekly.weekNote')}
            className="rounded-lg"
          />
        </Field>
      </Card>

      <Card className="px-0 py-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left border-collapse">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-tighter min-w-56">
                  {t('weekly.task')}
                </th>
                {weekDays.map((day) => (
                  <th
                    key={day.dateStr}
                    className={cn(
                      'w-28 p-2 text-center relative',
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
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="bg-praetor/5">
                <td className="px-4 py-3 align-top">
                  <p className="text-[10px] font-bold text-praetor uppercase tracking-wider mb-1">
                    {t('weekly.newEntry')}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{formLabel}</p>
                </td>
                {weekDays.map((day) => {
                  const cell = getCellValue(FORM_ROW_KEY, day.dateStr, formRowBaseDays);
                  return (
                    <td
                      key={day.dateStr}
                      className={cn(
                        'w-28 px-2 py-3 transition-colors',
                        day.isToday && 'bg-accent/60',
                        day.isWeekendOrHoliday && 'bg-destructive/5',
                      )}
                    >
                      <div className="flex flex-col gap-2">
                        <ValidatedNumberInput
                          placeholder="0.0"
                          disabled={day.isForbidden}
                          value={cell.duration}
                          onValueChange={(value) =>
                            updateCell(
                              FORM_ROW_KEY,
                              day.dateStr,
                              { duration: value },
                              formRowBaseDays[day.dateStr],
                            )
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
                            updateCell(
                              FORM_ROW_KEY,
                              day.dateStr,
                              { note: e.target.value },
                              formRowBaseDays[day.dateStr],
                            )
                          }
                          className={cn(
                            'h-7 text-xs rounded',
                            day.isForbidden && 'opacity-40 cursor-not-allowed',
                          )}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
              {recentRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={1 + weekDays.length}
                    className="px-4 py-6 text-center text-xs text-muted-foreground"
                  >
                    {t('weekly.noRecentTasks')}
                  </td>
                </tr>
              ) : (
                recentRows.map((row) => (
                  <tr key={row.key} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 align-top">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                        {t('weekly.recentTask')}
                      </p>
                      <p
                        className="text-xs font-semibold text-foreground line-clamp-2"
                        title={row.label}
                      >
                        {row.label}
                      </p>
                    </td>
                    {weekDays.map((day) => {
                      const cell = getCellValue(row.key, day.dateStr, row.baseDays);
                      return (
                        <td
                          key={day.dateStr}
                          className={cn(
                            'w-28 px-2 py-3 transition-colors',
                            day.isToday && 'bg-accent/60',
                            day.isWeekendOrHoliday && 'bg-destructive/5',
                            showSuccess && parseDuration(cell.duration) > 0 && 'bg-emerald-500/10',
                          )}
                        >
                          <div className="flex flex-col gap-2">
                            <ValidatedNumberInput
                              placeholder="0.0"
                              disabled={day.isForbidden}
                              value={cell.duration}
                              onValueChange={(value) =>
                                updateCell(
                                  row.key,
                                  day.dateStr,
                                  { duration: value },
                                  row.baseDays[day.dateStr],
                                )
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
                                updateCell(
                                  row.key,
                                  day.dateStr,
                                  { note: e.target.value },
                                  row.baseDays[day.dateStr],
                                )
                              }
                              className={cn(
                                'h-7 text-xs rounded',
                                day.isForbidden && 'opacity-40 cursor-not-allowed',
                              )}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-muted/30 border-t border-border">
              <tr>
                <td className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {t('weekly.total')}
                </td>
                {weekDays.map((day) => (
                  <td
                    key={day.dateStr}
                    className={cn(
                      'w-28 px-2 py-3 text-center',
                      day.isToday && 'bg-accent',
                      day.isWeekendOrHoliday && 'bg-destructive/5',
                    )}
                  >
                    <p
                      className={cn(
                        'text-sm font-black',
                        dayTotals[day.dateStr] > 8 ? 'text-destructive' : 'text-praetor',
                      )}
                    >
                      {dayTotals[day.dateStr].toFixed(1)}
                    </p>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <Card className="px-6 py-4 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-8">
            <div className="text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('weekly.weekTotal')}
              </p>
              <p className="text-2xl font-black text-praetor">{weekTotal.toFixed(1)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('weekly.monthTotal')}
              </p>
              <p className="text-2xl font-black text-foreground">{monthTotal.toFixed(1)}</p>
            </div>
          </div>
        </Card>

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading || !hasPendingEdits}
          size="lg"
          className={cn(
            'h-12 px-10 rounded-xl font-bold text-sm uppercase tracking-widest',
            showSuccess && 'bg-emerald-600 hover:bg-emerald-600',
          )}
        >
          {showSuccess ? t('weekly.success') : t('weekly.submitTime')}
        </Button>
      </div>
    </div>
  );
};

export default WeeklyView;
