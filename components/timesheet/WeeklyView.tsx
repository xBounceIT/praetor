import { Eye, EyeOff } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
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
import { formatDecimal } from '../../utils/numbers';
import { toastError } from '../../utils/toast';
import { filterTrackerEntrySelectableCatalogs } from '../../utils/trackerCatalogs';
import Calendar from '../shared/Calendar';
import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import { useCatalogSelection } from './useCatalogSelection';
import WeeklyEntryForm, { type WeeklyEntryFormErrors } from './WeeklyEntryForm';

type TimeEntryUpdate = Partial<Omit<TimeEntry, 'version'>> & Pick<TimeEntry, 'version'>;

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
      'monthlyEffort' | 'duration' | 'revenue' | 'notes' | 'billingType' | 'billingFrequency'
    >,
  ) => Promise<ProjectTask>;
  onAddBulkEntries: (entries: TimeEntryDraft[]) => Promise<void>;
  onUpdateEntry: (id: string, updates: TimeEntryUpdate) => void | Promise<void>;
  onDeleteEntry: (id: string) => void | Promise<void>;
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

type DayCell = { duration: string; note: string; entryId?: string; version?: number };
type DayMap = Record<string, DayCell>;
type TimeEntryDraft = Omit<
  TimeEntry,
  'id' | 'createdAt' | 'version' | 'userId' | 'hourlyCost' | 'cost'
>;

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
const EMPTY_DAY_MAP: DayMap = {};

type WeeklyDayForInput = {
  dateStr: string;
  isForbidden: boolean;
};

const WeeklyDayCellInputs: React.FC<{
  rowKey: string;
  day: WeeklyDayForInput;
  cell: DayCell;
  baseCell?: DayCell;
  notePlaceholder: string;
  onUpdate: (
    rowKey: string,
    dateStr: string,
    patch: Partial<Pick<DayCell, 'duration' | 'note'>>,
    baseCell?: DayCell,
  ) => void;
}> = ({ rowKey, day, cell, baseCell, notePlaceholder, onUpdate }) => (
  <div className="flex flex-col gap-2">
    <ValidatedNumberInput
      placeholder="0,0"
      disabled={day.isForbidden}
      value={cell.duration}
      onValueChange={(value) => onUpdate(rowKey, day.dateStr, { duration: value }, baseCell)}
      className={cn(
        'h-9 w-full text-center text-sm font-bold',
        day.isForbidden && 'opacity-50 cursor-not-allowed',
      )}
    />
    <Input
      type="text"
      placeholder={notePlaceholder}
      disabled={day.isForbidden}
      value={cell.note}
      onChange={(e) => onUpdate(rowKey, day.dateStr, { note: e.target.value }, baseCell)}
      className={cn('h-7 text-xs rounded', day.isForbidden && 'opacity-40 cursor-not-allowed')}
      // Kept in sync with server MAX_NOTES_LENGTH (server/services/timeEntries.ts).
      maxLength={2000}
    />
  </div>
);

const WeeklyRowLabel: React.FC<{
  clientName: string;
  projectName: string;
  taskName: string;
}> = ({ clientName, projectName, taskName }) => {
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

const parseDuration = (raw: string): number => {
  if (!raw) return 0;
  const parsed = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

type EditClassification = 'add' | 'update' | 'delete' | 'noop';

type StateUpdate<T> = T | ((prev: T) => T);

type WeeklyViewState = {
  errors: WeeklyEntryFormErrors;
  isLoading: boolean;
  showSuccess: boolean;
  weekNote: string;
  hideWeekend: boolean;
  pendingEdits: Record<string, DayMap>;
};

type WeeklyViewAction =
  | { type: 'setErrors'; update: StateUpdate<WeeklyEntryFormErrors> }
  | { type: 'setIsLoading'; value: boolean }
  | { type: 'setShowSuccess'; value: boolean }
  | { type: 'setWeekNote'; value: string }
  | { type: 'setHideWeekend'; update: StateUpdate<boolean> }
  | { type: 'setPendingEdits'; update: StateUpdate<Record<string, DayMap>> };

const resolveStateUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const weeklyViewReducer = (state: WeeklyViewState, action: WeeklyViewAction): WeeklyViewState => {
  switch (action.type) {
    case 'setErrors':
      return { ...state, errors: resolveStateUpdate(state.errors, action.update) };
    case 'setIsLoading':
      return { ...state, isLoading: action.value };
    case 'setShowSuccess':
      return { ...state, showSuccess: action.value };
    case 'setWeekNote':
      return { ...state, weekNote: action.value };
    case 'setHideWeekend':
      return { ...state, hideWeekend: resolveStateUpdate(state.hideWeekend, action.update) };
    case 'setPendingEdits':
      return { ...state, pendingEdits: resolveStateUpdate(state.pendingEdits, action.update) };
  }
};

const classifyEdit = (base: DayCell | undefined, edit: DayCell): EditClassification => {
  const newDuration = parseDuration(edit.duration);
  const baseDuration = base ? parseDuration(base.duration) : 0;
  const noteChanged = (edit.note ?? '') !== (base?.note ?? '');
  if (base?.entryId) {
    if (newDuration === 0) return 'delete';
    if (newDuration !== baseDuration || noteChanged) return 'update';
    return 'noop';
  }
  return newDuration > 0 ? 'add' : 'noop';
};

const useWeeklyController = ({
  entries,
  clients,
  projects,
  projectTasks,
  permissions,
  currency,
  onAddCustomTask,
  onAddBulkEntries,
  onUpdateEntry,
  onDeleteEntry,
  viewingUserId,
  selectedDate,
  onSelectedDateChange,
  startOfWeek,
  treatSaturdayAsHoliday,
  allowWeekendSelection = false,
  defaultLocation = 'remote',
  dailyGoal,
}: WeeklyViewProps) => {
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

  const selectableCatalogs = useMemo(
    () => filterTrackerEntrySelectableCatalogs({ clients, projects, projectTasks, permissions }),
    [clients, projects, projectTasks, permissions],
  );

  const selection = useCatalogSelection({
    clients: selectableCatalogs.clients,
    projects: selectableCatalogs.projects,
    projectTasks: selectableCatalogs.projectTasks,
    defaultLocation,
  });

  const [weeklyState, dispatchWeeklyState] = useReducer(weeklyViewReducer, {
    errors: {},
    isLoading: false,
    showSuccess: false,
    weekNote: '',
    hideWeekend: false,
    pendingEdits: {},
  });
  const { errors, isLoading, showSuccess, weekNote, hideWeekend, pendingEdits } = weeklyState;
  const setErrors = useCallback((update: StateUpdate<WeeklyEntryFormErrors>) => {
    dispatchWeeklyState({ type: 'setErrors', update });
  }, []);
  const setIsLoading = useCallback((value: boolean) => {
    dispatchWeeklyState({ type: 'setIsLoading', value });
  }, []);
  const setShowSuccess = useCallback((value: boolean) => {
    dispatchWeeklyState({ type: 'setShowSuccess', value });
  }, []);
  const setWeekNote = useCallback((value: string) => {
    dispatchWeeklyState({ type: 'setWeekNote', value });
  }, []);
  const setHideWeekend = useCallback((update: StateUpdate<boolean>) => {
    dispatchWeeklyState({ type: 'setHideWeekend', update });
  }, []);
  const setPendingEdits = useCallback((update: StateUpdate<Record<string, DayMap>>) => {
    dispatchWeeklyState({ type: 'setPendingEdits', update });
  }, []);
  const currentWeekStartKey = getLocalDateString(currentWeekStart);

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

  const [pendingEditsWeekKey, setPendingEditsWeekKey] = useState(currentWeekStartKey);

  if (pendingEditsWeekKey !== currentWeekStartKey) {
    setPendingEditsWeekKey(currentWeekStartKey);
    setPendingEdits({});
  }

  // One row per TimeEntry in the current week (keyed by entry.id) so duplicates
  // sharing (client, project, task, date) stay visible and independently
  // editable. Combos with no in-week entries get an empty quick-log row keyed
  // by `combo:…`, capped at 5; the active form-selection combo is filtered out
  // so the "Nuova voce" row at the top isn't shadowed by an empty duplicate.
  const entryRows: EntryRow[] = useMemo(() => {
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const taskKey = (projectId: string, name: string) => `${projectId}|${name}`;
    const taskSet = new Set(projectTasks.map((task) => taskKey(task.projectId, task.name)));
    const weekDateSet = new Set(weekDates);
    const comboKey = (cid: string, pid: string, task: string) => `${cid}|${pid}|${task}`;

    const scopedEntries = userEntries.filter(
      (entry) =>
        clientById.has(entry.clientId) &&
        projectById.has(entry.projectId) &&
        taskSet.has(taskKey(entry.projectId, entry.task)),
    );

    const scopedInWeek = scopedEntries
      .filter((entry) => weekDateSet.has(entry.date))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id < b.id ? -1 : 1;
      });

    const phase1: EntryRow[] = scopedInWeek.map((entry) => ({
      key: entry.id,
      clientId: entry.clientId,
      clientName: clientById.get(entry.clientId)?.name ?? '',
      projectId: entry.projectId,
      projectName: projectById.get(entry.projectId)?.name ?? '',
      taskName: entry.task,
      location: entry.location ?? defaultLocation,
      baseDays: {
        [entry.date]: {
          duration: String(entry.duration),
          note: entry.notes ?? '',
          entryId: entry.id,
          version: entry.version,
        },
      },
    }));

    const inWeekCombos = new Set(
      scopedInWeek.map((e) => comboKey(e.clientId, e.projectId, e.task)),
    );

    const comboGroups = new Map<string, { row: EntryRow; maxCreatedAt: number }>();
    for (const entry of scopedEntries) {
      const key = comboKey(entry.clientId, entry.projectId, entry.task);
      if (inWeekCombos.has(key)) continue;
      const group = comboGroups.get(key);
      if (!group) {
        comboGroups.set(key, {
          row: {
            key: `combo:${key}`,
            clientId: entry.clientId,
            clientName: clientById.get(entry.clientId)?.name ?? '',
            projectId: entry.projectId,
            projectName: projectById.get(entry.projectId)?.name ?? '',
            taskName: entry.task,
            location: entry.location ?? defaultLocation,
            baseDays: {},
          },
          maxCreatedAt: entry.createdAt,
        });
      } else if (entry.createdAt > group.maxCreatedAt) {
        group.maxCreatedAt = entry.createdAt;
        group.row.location = entry.location ?? group.row.location;
      }
    }

    if (selection.clientId && selection.projectId && selection.taskName) {
      comboGroups.delete(comboKey(selection.clientId, selection.projectId, selection.taskName));
    }

    const phase2 = Array.from(comboGroups.values())
      .sort((a, b) => b.maxCreatedAt - a.maxCreatedAt)
      .slice(0, 5)
      .map((g) => g.row);

    return [...phase1, ...phase2];
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
  }, [entryRowKeySet, setPendingEdits]);

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
        version: seed.version,
      };
      return { ...prev, [rowKey]: { ...rowEdits, [dateStr]: nextCell } };
    });
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

    const entriesToAdd: TimeEntryDraft[] = [];
    const entriesToUpdate: Array<{ id: string; updates: TimeEntryUpdate }> = [];
    const entriesToDelete: string[] = [];

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
        const action = classifyEdit(base, edit);
        if (action === 'noop') continue;
        if (action === 'delete' && base?.entryId) {
          entriesToDelete.push(base.entryId);
          continue;
        }
        if (action === 'update' && base?.entryId) {
          entriesToUpdate.push({
            id: base.entryId,
            updates: {
              version: base.version ?? 1,
              duration: parseDuration(edit.duration),
              notes: edit.note,
              task: meta.taskName,
              projectId: meta.projectId,
              clientId: meta.clientId,
              clientName: client?.name || 'Unknown',
              projectName: project?.name || 'General',
              location: meta.location,
            },
          });
          continue;
        }
        entriesToAdd.push({
          date: day.dateStr,
          clientId: meta.clientId,
          clientName: client?.name || 'Unknown',
          projectId: meta.projectId,
          projectName: project?.name || 'General',
          task: meta.taskName,
          duration: parseDuration(edit.duration),
          notes: edit.note || weekNote,
          location: meta.location,
        });
      }
    };

    if (hasFormHours) {
      submitRow(FORM_ROW_KEY, {
        clientId: selection.clientId,
        projectId: selection.projectId,
        taskName: selection.taskName,
        location: selection.location,
        baseDays: EMPTY_DAY_MAP,
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
      const pending: Promise<void>[] = [];
      if (entriesToAdd.length > 0) pending.push(onAddBulkEntries(entriesToAdd));
      for (const { id, updates } of entriesToUpdate) {
        pending.push(Promise.resolve(onUpdateEntry(id, updates)));
      }
      for (const id of entriesToDelete) {
        pending.push(Promise.resolve(onDeleteEntry(id)));
      }
      // allSettled (not all): a single failure shouldn't abort the rest. Successful
      // writes already update local entry state via their handlers; we only gate the
      // "clear pendingEdits / show success" path on every write succeeding.
      const results = await Promise.allSettled(pending);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejected.length === 0) {
        setPendingEdits({});
        setWeekNote('');
        setShowSuccess(true);
      } else {
        const firstReason = rejected[0].reason;
        toastError(
          firstReason instanceof Error ? firstReason.message : t('entry.entryUpdateFailed'),
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(
      () => dispatchWeeklyState({ type: 'setShowSuccess', value: false }),
      2500,
    );
    return () => clearTimeout(timer);
  }, [showSuccess]);

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const day of weekDays) {
      let sum = 0;
      const formEdit = pendingEdits[FORM_ROW_KEY]?.[day.dateStr];
      if (formEdit) sum += parseDuration(formEdit.duration);
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
  }, [weekDays, entryRows, pendingEdits]);

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

  const hasPendingEdits = useMemo(() => {
    const rowHasChange = (rowKey: string, baseDays: DayMap) => {
      const edits = pendingEdits[rowKey];
      if (!edits) return false;
      return Object.entries(edits).some(
        ([dateStr, edit]) => classifyEdit(baseDays[dateStr], edit) !== 'noop',
      );
    };
    if (rowHasChange(FORM_ROW_KEY, EMPTY_DAY_MAP)) return true;
    return entryRows.some((row) => rowHasChange(row.key, row.baseDays));
  }, [pendingEdits, entryRows]);
  const weeklyGoal = dailyGoal * 5;

  const handleExportToCsv = () => {
    const formatHours = (hours: number) => (hours > 0 ? formatDecimal(hours) : '');
    const sumDayValues = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

    const headerRow = [
      '',
      ...visibleWeekDays.map((day) => `${t(`weekly.days.${day.dayKey}`)} ${day.dayNum}`),
      t('weekly.total'),
    ];
    const rows: string[][] = [headerRow];

    const joinLabel = (clientName: string, projectName: string, taskName: string) =>
      [clientName, projectName, taskName].filter(Boolean).join(' · ');

    const formRowHours = visibleWeekDays.map((day) => {
      const cell = getCellValue(FORM_ROW_KEY, day.dateStr);
      return parseDuration(cell.duration);
    });
    const formRowTotal = sumDayValues(formRowHours);
    if (formRowTotal > 0) {
      const label =
        joinLabel(
          formSelectionLabels.clientName,
          formSelectionLabels.projectName,
          formSelectionLabels.taskName,
        ) || t('weekly.newEntry');
      rows.push([label, ...formRowHours.map(formatHours), formatHours(formRowTotal)]);
    }

    for (const row of entryRows) {
      const dayHours = visibleWeekDays.map((day) => {
        const cell = getCellValue(row.key, day.dateStr, row.baseDays);
        return parseDuration(cell.duration);
      });
      const rowTotal = sumDayValues(dayHours);
      rows.push([
        joinLabel(row.clientName, row.projectName, row.taskName),
        ...dayHours.map(formatHours),
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

  return {
    allowWeekendSelection,
    clearError,
    currency,
    dailyGoal,
    dayTotals,
    defaultLocation,
    entryRows,
    errors,
    formSelectionLabels,
    getCellValue,
    handleExportToCsv,
    handleSubmit,
    hasPendingEdits,
    hideWeekend,
    isLoading,
    monthTotal,
    onAddCustomTask,
    onSelectedDateChange,
    permissions,
    selectableCatalogs,
    selectedDate,
    selection,
    setHideWeekend,
    setWeekNote,
    showSuccess,
    startOfWeek,
    t,
    treatSaturdayAsHoliday,
    updateCell,
    userEntries,
    visibleWeekDays,
    weekNote,
    weeklyGoal,
    weekTotal,
  };
};

type WeeklyController = ReturnType<typeof useWeeklyController>;

const WeeklyView: React.FC<WeeklyViewProps> = (props) => {
  // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Custom-hook invocation is misclassified as a state updater.
  const controller = useWeeklyController(props);
  return <WeeklyViewLayout controller={controller} />;
};

const WeeklyViewLayout: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <div className="w-full space-y-6 xl:mx-auto xl:w-[calc(45%+300px+1.5rem)]">
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-stretch">
      <WeeklyEntryFormPane controller={controller} />
      <WeeklyCalendarPane controller={controller} />
    </div>
    <WeeklyGridPanel controller={controller} />
  </div>
);

const WeeklyEntryFormPane: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <WeeklyEntryForm
    selectedDate={controller.selectedDate}
    selection={controller.selection}
    weekNote={controller.weekNote}
    errors={controller.errors}
    onWeekNoteChange={controller.setWeekNote}
    onClearError={controller.clearError}
    clients={controller.selectableCatalogs.clients}
    projects={controller.selectableCatalogs.projects}
    permissions={controller.permissions}
    currency={controller.currency}
    onAddCustomTask={controller.onAddCustomTask}
    defaultLocation={controller.defaultLocation}
    onSubmit={controller.handleSubmit}
    isSubmitting={controller.isLoading}
    showSubmitSuccess={controller.showSuccess}
    canSubmit={controller.hasPendingEdits}
  />
);

const WeeklyCalendarPane: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <div className="w-full xl:h-full xl:max-w-[300px]">
    <Calendar
      selectedDate={controller.selectedDate}
      onDateSelect={controller.onSelectedDateChange}
      entries={controller.userEntries}
      startOfWeek={controller.startOfWeek}
      treatSaturdayAsHoliday={controller.treatSaturdayAsHoliday}
      dailyGoal={controller.dailyGoal}
      allowWeekendSelection={controller.allowWeekendSelection}
      size="compact"
    />
  </div>
);

const WeeklyGridPanel: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <div className="rounded-lg border border-border bg-background p-5 shadow-sm">
    <WeeklyGridToolbar controller={controller} />
    <WeeklyGridTable controller={controller} />
  </div>
);

const WeeklyGridToolbar: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <WeeklyTotalMetric
        label={controller.t('weekly.weekTotal')}
        value={`${formatDecimal(controller.weekTotal)} h`}
        isOverGoal={controller.weekTotal > controller.weeklyGoal}
      />
      <WeeklyTotalMetric
        label={controller.t('weekly.monthTotal')}
        value={`${formatDecimal(controller.monthTotal)} h`}
      />
    </div>
    <WeeklyGridActions controller={controller} />
  </div>
);

const WeeklyTotalMetric: React.FC<{ label: string; value: string; isOverGoal?: boolean }> = ({
  label,
  value,
  isOverGoal,
}) => (
  <div className="flex items-baseline gap-2">
    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
      {label}
    </span>
    <span
      className={cn(
        'text-lg font-black transition-colors',
        isOverGoal === undefined
          ? 'text-foreground'
          : isOverGoal
            ? 'text-destructive'
            : 'text-praetor',
      )}
    >
      {value}
    </span>
  </div>
);

const WeeklyGridActions: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <div className="flex items-center gap-2">
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={controller.t('common:table.exportToCsv')}
            onClick={controller.handleExportToCsv}
            className={TABLE_CONTROL_BUTTON_CLASSNAME}
          >
            <i className="fa-solid fa-file-export text-xs" aria-hidden="true"></i>
            <span>{controller.t('common:table.export')}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{controller.t('common:table.exportToCsv')}</TooltipContent>
    </Tooltip>

    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant={controller.hideWeekend ? 'secondary' : 'outline'}
            size="sm"
            aria-label={controller.t('weekly.hideWeekend')}
            aria-pressed={controller.hideWeekend}
            onClick={() => controller.setHideWeekend((value) => !value)}
            className={TABLE_CONTROL_BUTTON_CLASSNAME}
          >
            {controller.hideWeekend ? (
              <EyeOff className="size-3.5" aria-hidden="true" />
            ) : (
              <Eye className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{controller.t('weekly.hideWeekend')}</TooltipContent>
    </Tooltip>
  </div>
);

const WeeklyGridTable: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <div className="-mx-5 -mb-5 overflow-x-auto">
    <Table className="border-collapse">
      <WeeklyGridHeader controller={controller} />
      <WeeklyNewEntryBody controller={controller} />
      <WeeklyExistingEntriesBody controller={controller} />
      <WeeklyTotalsFooter controller={controller} />
    </Table>
  </div>
);

const WeeklyGridHeader: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <TableHeader className="bg-muted/40">
    <TableRow className="border-b border-border">
      <TableHead className="min-w-56 px-4 py-3" />
      {controller.visibleWeekDays.map((day) => (
        <WeeklyDayHeader key={day.dateStr} controller={controller} day={day} />
      ))}
    </TableRow>
  </TableHeader>
);

const WeeklyDayHeader: React.FC<{
  controller: WeeklyController;
  day: WeeklyController['visibleWeekDays'][number];
}> = ({ controller, day }) => (
  <TableHead
    className={cn(
      'relative min-w-28 px-2 py-2 text-center align-middle',
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
      {controller.t(`weekly.days.${day.dayKey}`)}
      {day.holidayName && <WeeklyHolidayMarker holidayName={day.holidayName} />}
    </div>
    <p
      className={cn(
        'mt-0.5 text-sm font-black leading-none',
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
);

const WeeklyHolidayMarker: React.FC<{ holidayName: string }> = ({ holidayName }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex">
        <span className="block size-1.5 animate-pulse rounded-full bg-destructive"></span>
      </span>
    </TooltipTrigger>
    <TooltipContent>{holidayName}</TooltipContent>
  </Tooltip>
);

const WeeklyNewEntryBody: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <TableBody>
    <TableRow className="bg-praetor/5 hover:bg-praetor/10">
      <TableCell className="whitespace-normal px-4 py-3 align-top">
        <p className="mb-2 text-[10px] font-bold text-praetor uppercase tracking-wider">
          {controller.t('weekly.newEntry')}
        </p>
        <WeeklyRowLabel
          clientName={controller.formSelectionLabels.clientName}
          projectName={controller.formSelectionLabels.projectName}
          taskName={controller.formSelectionLabels.taskName}
        />
      </TableCell>
      {controller.visibleWeekDays.map((day) => (
        <WeeklyEditableCell
          key={day.dateStr}
          controller={controller}
          rowKey={FORM_ROW_KEY}
          day={day}
          cell={controller.getCellValue(FORM_ROW_KEY, day.dateStr, EMPTY_DAY_MAP)}
        />
      ))}
    </TableRow>
    <TableRow className="border-b-0 hover:bg-transparent">
      <TableCell colSpan={1 + controller.visibleWeekDays.length} className="h-6 p-0" />
    </TableRow>
  </TableBody>
);

const WeeklyExistingEntriesBody: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <TableBody className="divide-y divide-border border-t-[3px] border-t-border">
    {controller.entryRows.length === 0 ? (
      <TableRow>
        <TableCell
          colSpan={1 + controller.visibleWeekDays.length}
          className="px-4 py-6 text-center text-xs text-muted-foreground"
        >
          {controller.t('weekly.noRecentTasks')}
        </TableCell>
      </TableRow>
    ) : (
      controller.entryRows.map((row) => (
        <WeeklyExistingEntryRow key={row.key} controller={controller} row={row} />
      ))
    )}
  </TableBody>
);

const WeeklyExistingEntryRow: React.FC<{ controller: WeeklyController; row: EntryRow }> = ({
  controller,
  row,
}) => (
  <TableRow className="hover:bg-muted/30">
    <TableCell className="whitespace-normal px-4 py-3 align-middle">
      <WeeklyRowLabel
        clientName={row.clientName}
        projectName={row.projectName}
        taskName={row.taskName}
      />
    </TableCell>
    {controller.visibleWeekDays.map((day) => {
      const cell = controller.getCellValue(row.key, day.dateStr, row.baseDays);
      return (
        <WeeklyEditableCell
          key={day.dateStr}
          controller={controller}
          rowKey={row.key}
          day={day}
          cell={cell}
          baseCell={row.baseDays[day.dateStr]}
          highlightSuccess={controller.showSuccess && parseDuration(cell.duration) > 0}
        />
      );
    })}
  </TableRow>
);

const WeeklyEditableCell: React.FC<{
  controller: WeeklyController;
  rowKey: string;
  day: WeeklyController['visibleWeekDays'][number];
  cell: DayCell;
  baseCell?: DayCell;
  highlightSuccess?: boolean;
}> = ({ controller, rowKey, day, cell, baseCell, highlightSuccess }) => (
  <TableCell
    className={cn(
      'min-w-28 px-2 py-3 align-top',
      day.isToday && 'bg-accent/60',
      day.isWeekendOrHoliday && 'bg-destructive/5',
      highlightSuccess && 'bg-emerald-500/10',
    )}
  >
    <WeeklyDayCellInputs
      rowKey={rowKey}
      day={day}
      cell={cell}
      baseCell={baseCell}
      notePlaceholder={controller.t('weekly.note')}
      onUpdate={controller.updateCell}
    />
  </TableCell>
);

const WeeklyTotalsFooter: React.FC<{ controller: WeeklyController }> = ({ controller }) => (
  <TableFooter className="bg-muted/30">
    <TableRow className="border-t border-border">
      <TableCell className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        {controller.t('weekly.total')}
      </TableCell>
      {controller.visibleWeekDays.map((day) => (
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
              controller.dayTotals[day.dateStr] > controller.dailyGoal
                ? 'text-destructive'
                : 'text-praetor',
            )}
          >
            {formatDecimal(controller.dayTotals[day.dateStr], 1)}
          </p>
        </TableCell>
      ))}
    </TableRow>
  </TableFooter>
);

export default WeeklyView;
