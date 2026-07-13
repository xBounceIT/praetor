import { Check, CircleAlert, Download, Loader2, RotateCcw } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import api from '../../services/api';
import type { GeneralSettings, RilProjectReference, TimeEntry, User } from '../../types';
import { formatDecimal } from '../../utils/numbers';
import {
  applyRilDraftToRows,
  calculateRilTotals,
  calculateRilWorkedHoursFromTimes,
  DEFAULT_RIL_EXIT_TIME,
  DEFAULT_RIL_START_TIME,
  extractRilDraftRows,
  formatRilHoursAsDuration,
  formatRilLunchWindow,
  generateRilRows,
  getCurrentRilMonthKey,
  getRilMonthBounds,
  isRequiredRilWorkday,
  isRilAbsenceRow,
  normalizeRilNoteOptions,
  normalizeRilTransferOptions,
  type RilRow,
  roundRilPicapHours,
} from '../../utils/ril';

const EMPTY_SELECT_VALUE = '__empty__';
const RIL_CODE_OPTIONS = [
  { value: 'TR', label: 'Trasferta' },
  { value: 'SD', label: 'Sede Disagiata' },
] as const;
const RIL_MONTH_OPTION_DATE_YEAR = 2020;
// Debounce window for persisting draft edits to the backend after the user stops typing.
const DRAFT_SAVE_DEBOUNCE_MS = 800;

type RilDraftStatus = 'idle' | 'saving' | 'saved' | 'error';

type RilSelectOption = {
  value: string;
  label: string;
  display?: string;
};

interface RilViewProps {
  currentUser: User;
  availableUsers: User[];
  viewingUserId: string;
  onViewUserChange: (userId: string) => void;
  settings: Pick<
    GeneralSettings,
    | 'rilCompanyName'
    | 'rilDefaultStartTime'
    | 'rilDefaultExitTime'
    | 'rilLunchBreakMinutes'
    | 'rilNoteOptions'
    | 'rilTransferOptions'
  >;
  // Current user's per-weekday default "Trasferta" preference (keys 'monday'..'friday'). Applied
  // only when the user views their own RIL.
  weekdayTransferDefaults?: Record<string, string>;
}

type EditableRilField = 'entrance' | 'exit' | 'notes' | 'transfer' | 'code';

const canEditRilRow = (row: RilRow) => Boolean(row.date);

const RilEditableInput: React.FC<{
  row: RilRow;
  field: EditableRilField;
  label: string;
  onUpdate: (day: number, field: EditableRilField, value: string) => void;
}> = ({ row, field, label, onUpdate }) => (
  <Input
    aria-label={`${label} ${row.day}`}
    type="time"
    value={String(row[field] ?? '')}
    disabled={!canEditRilRow(row)}
    onChange={(event) => onUpdate(row.day, field, event.target.value)}
    className="h-7 w-full min-w-0 px-2 text-xs tabular-nums disabled:cursor-not-allowed"
  />
);

const RilComputedValue: React.FC<{
  row: RilRow;
  label: string;
  value: string | number;
}> = ({ row, label, value }) => (
  <output
    aria-label={`${label} ${row.day}`}
    className="block min-h-7 px-1 py-1.5 text-right text-xs tabular-nums"
  >
    {value || '-'}
  </output>
);

const RilSelectControl: React.FC<{
  row: RilRow;
  field: EditableRilField;
  label: string;
  options: ReadonlyArray<RilSelectOption>;
  onUpdate: (day: number, field: EditableRilField, value: string) => void;
}> = ({ row, field, label, options, onUpdate }) => {
  const currentValue = String(row[field] ?? '').trim();
  const selectOptions =
    currentValue && !options.some((option) => option.value === currentValue)
      ? [{ value: currentValue, label: currentValue, display: currentValue }, ...options]
      : options;

  return (
    <Select
      value={currentValue || EMPTY_SELECT_VALUE}
      onValueChange={(value) => onUpdate(row.day, field, value === EMPTY_SELECT_VALUE ? '' : value)}
      disabled={!canEditRilRow(row)}
    >
      <SelectTrigger
        aria-label={`${label} ${row.day}`}
        className="h-7 w-full min-w-0 px-2 text-xs disabled:cursor-not-allowed [&>svg]:size-3"
      >
        <SelectValue placeholder="-" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY_SELECT_VALUE}>-</SelectItem>
        {selectOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.display ?? `${option.value} - ${option.label}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const normalizeMonthKey = (value: string): string => {
  try {
    return getRilMonthBounds(value).monthKey;
  } catch {
    return getCurrentRilMonthKey();
  }
};

const getLocale = (language: string | undefined) => (language?.startsWith('it') ? 'it' : 'en');

// Key an in-flight draft save by the sheet it targets so a reload can find and await it.
const draftSaveKey = (userId: string, monthKey: string) => `${userId}::${monthKey}`;

const collectRilMissingDays = (rows: RilRow[], isMissing: (row: RilRow) => boolean): string[] => {
  const days: string[] = [];
  for (const row of rows) {
    if (isMissing(row)) days.push(String(row.day));
  }
  return days;
};

type RilViewState = {
  monthKey: string;
  rows: RilRow[];
  isLoading: boolean;
  loadedContext: string | null;
  isExporting: boolean;
  draftStatus: RilDraftStatus;
  error: string | null;
};

type RilViewAction =
  | { type: 'setMonthKey'; monthKey: string }
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; context: string; rows: RilRow[] }
  | { type: 'loadError'; context: string; error: string; rows: RilRow[] }
  | { type: 'setRows'; rows: RilRow[] }
  | { type: 'updateRows'; updater: (rows: RilRow[]) => RilRow[] }
  | { type: 'setError'; error: string }
  | { type: 'setDraftStatus'; draftStatus: RilDraftStatus }
  | { type: 'exportStart' }
  | { type: 'exportDone'; error?: string };

const rilViewReducer = (state: RilViewState, action: RilViewAction): RilViewState => {
  switch (action.type) {
    case 'setMonthKey':
      return { ...state, monthKey: action.monthKey, isLoading: true, error: null };
    case 'loadStart':
      return { ...state, isLoading: true, error: null };
    case 'loadSuccess':
      return { ...state, rows: action.rows, isLoading: false, loadedContext: action.context };
    case 'loadError':
      return {
        ...state,
        rows: action.rows,
        isLoading: false,
        loadedContext: action.context,
        error: action.error,
      };
    case 'setRows':
      return { ...state, rows: action.rows };
    case 'updateRows':
      return { ...state, rows: action.updater(state.rows) };
    case 'setError':
      return { ...state, error: action.error };
    case 'setDraftStatus':
      return { ...state, draftStatus: action.draftStatus };
    case 'exportStart':
      return { ...state, isExporting: true, error: null };
    case 'exportDone':
      return { ...state, isExporting: false, error: action.error ?? state.error };
  }
};

const useRilController = ({
  currentUser,
  availableUsers,
  viewingUserId,
  onViewUserChange,
  settings,
  weekdayTransferDefaults,
}: RilViewProps) => {
  const { t, i18n } = useTranslation('timesheets');
  const [state, dispatch] = useReducer(rilViewReducer, undefined, () => ({
    monthKey: getCurrentRilMonthKey(),
    rows: [],
    isLoading: true,
    loadedContext: null,
    isExporting: false,
    draftStatus: 'idle' as RilDraftStatus,
    error: null,
  }));
  const {
    monthKey,
    rows,
    isLoading: isLoadInFlight,
    loadedContext,
    isExporting,
    draftStatus,
    error,
  } = state;
  const sourceEntriesRef = useRef<TimeEntry[]>([]);
  const projectCatalogRef = useRef<RilProjectReference[]>([]);
  const projectCatalogUserIdRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  // Mirror of the latest rows so the debounced save reads current state without re-arming on
  // every keystroke.
  const rowsRef = useRef<RilRow[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The (user, month) the currently displayed rows belong to. Lets the switch flush target the
  // sheet being left without making the flush depend on reactive values.
  const draftContextRef = useRef<{ userId: string; monthKey: string } | null>(null);
  // In-flight draft saves keyed by `${userId}::${monthKey}`, covering both the debounced autosave
  // and the flush fired when leaving a sheet. A reload awaits the matching context's save before its
  // draft GET so it can't hydrate stale rows behind an uncommitted PUT; handleReset chains its DELETE
  // after the current context's save so a late PUT can't resurrect a just-discarded draft. Lazily
  // created (initializer stays null) so it isn't reallocated on every render.
  const pendingSavesRef = useRef<Map<string, Promise<unknown>> | null>(null);
  const changedDaysRef = useRef<Map<number, number> | null>(null);
  const changedDayRevisionRef = useRef(0);
  const getChangedDays = useCallback(() => {
    if (changedDaysRef.current === null) {
      changedDaysRef.current = new Map();
    }
    return changedDaysRef.current;
  }, []);
  // Gates autosave: stays false until a draft GET succeeds for the active (user, month) so a
  // failed load can't overwrite a draft we never saw, and hydration itself can't trigger a save.
  const draftSyncReadyRef = useRef(false);

  const effectiveUserId = viewingUserId || currentUser.id;
  const selectedUser = availableUsers.find((user) => user.id === effectiveUserId) ?? currentUser;
  const monthBounds = useMemo(() => getRilMonthBounds(normalizeMonthKey(monthKey)), [monthKey]);
  const draftMonthKey = monthBounds.monthKey;
  const loadContext = `${effectiveUserId}::${draftMonthKey}`;
  // A selected user or month can change before the loading effect starts. Treat rows as pending
  // until the reducer confirms they belong to the exact context currently shown in the controls.
  const isLoading = isLoadInFlight || loadedContext !== loadContext;
  const locale = getLocale(i18n.language);
  const defaultStartTime = settings.rilDefaultStartTime || DEFAULT_RIL_START_TIME;
  const defaultExitTime = settings.rilDefaultExitTime || DEFAULT_RIL_EXIT_TIME;
  const lunchBreakMinutes = settings.rilLunchBreakMinutes ?? 60;
  // The per-weekday default transfer is a personal preference, so it only applies to the user's
  // own RIL — not when a manager views someone else's sheet.
  const ownWeekdayTransferDefaults =
    effectiveUserId === currentUser.id ? weekdayTransferDefaults : undefined;
  const selectedMonthValue = String(monthBounds.month).padStart(2, '0');
  const selectedYearValue = String(monthBounds.year);
  const noteOptions = useMemo<RilSelectOption[]>(
    () =>
      normalizeRilNoteOptions(settings.rilNoteOptions).map((option) => ({
        ...option,
        display: `${option.value} - ${option.label}`,
      })),
    [settings.rilNoteOptions],
  );
  const transferOptionValues = useMemo(
    () => normalizeRilTransferOptions(settings.rilTransferOptions),
    [settings.rilTransferOptions],
  );
  const transferOptions = useMemo<RilSelectOption[]>(
    () =>
      transferOptionValues.map((value) => ({
        value,
        label: value,
        display: value,
      })),
    [transferOptionValues],
  );

  const monthOptions = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-US', {
      month: 'long',
    });
    return Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1).padStart(2, '0'),
      label: formatter.format(new Date(RIL_MONTH_OPTION_DATE_YEAR, index, 1)),
    }));
  }, [locale]);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>();
    for (let year = currentYear - 5; year <= currentYear + 1; year += 1) {
      years.add(year);
    }
    years.add(monthBounds.year);
    return Array.from(years).sort((a, b) => a - b);
  }, [monthBounds.year]);

  const updateSelectedMonth = (nextMonth: string) => {
    dispatch({ type: 'setMonthKey', monthKey: `${monthBounds.year}-${nextMonth}` });
  };

  const updateSelectedYear = (nextYear: string) => {
    dispatch({ type: 'setMonthKey', monthKey: `${nextYear}-${selectedMonthValue}` });
  };

  const generateRows = useCallback(
    (entries: TimeEntry[], catalogProjects: RilProjectReference[]) =>
      generateRilRows({
        year: monthBounds.year,
        month: monthBounds.month,
        entries,
        projects: catalogProjects,
        defaultStartTime,
        defaultExitTime,
        lunchBreakMinutes,
        locale,
        noteOptions: normalizeRilNoteOptions(settings.rilNoteOptions),
        transferOptions: transferOptionValues,
        weekdayTransferDefaults: ownWeekdayTransferDefaults,
      }),
    [
      locale,
      defaultStartTime,
      defaultExitTime,
      lunchBreakMinutes,
      monthBounds.month,
      monthBounds.year,
      settings.rilNoteOptions,
      transferOptionValues,
      ownWeekdayTransferDefaults,
    ],
  );

  // Record a save promise under its (user, month) key and auto-evict it once settled, so a later
  // reload of the same sheet can await an in-flight PUT before reading the draft back.
  const trackDraftSave = useCallback(
    (userId: string, monthKey: string, promise: Promise<unknown>) => {
      const key = draftSaveKey(userId, monthKey);
      // Allocate the map on first use only (the initializer stays null to avoid per-render churn).
      const saves = pendingSavesRef.current ?? new Map<string, Promise<unknown>>();
      pendingSavesRef.current = saves;
      saves.set(key, promise);
      void promise.finally(() => {
        if (saves.get(key) === promise) saves.delete(key);
      });
    },
    [],
  );

  // Serialize draft saves per (user, month): chain each PUT after any in-flight save to the same
  // sheet so two never overlap and an older write can't land last and clobber newer rows on the
  // server. Resolves to {ok} (never rejects) so fire-and-forget callers can't leak a rejection.
  const enqueueDraftSave = useCallback(
    (
      userId: string,
      monthKey: string,
      rows: ReturnType<typeof extractRilDraftRows>,
      changedDays: number[],
    ): Promise<{ ok: boolean }> => {
      const prior = pendingSavesRef.current?.get(draftSaveKey(userId, monthKey));
      const run = (async (): Promise<{ ok: boolean }> => {
        if (prior) {
          try {
            await prior;
          } catch {
            // A failed prior save shouldn't block this one — the latest rows still need persisting.
          }
        }
        try {
          await api.rilDrafts.save(monthKey, rows, userId, changedDays);
          return { ok: true };
        } catch {
          return { ok: false };
        }
      })();
      trackDraftSave(userId, monthKey, run);
      return run;
    },
    [trackDraftSave],
  );

  const loadMonthEntries = useCallback(async () => {
    // Switching sheets: flush a pending debounced save for the month we're leaving before its rows
    // get replaced. draftContextRef holds the outgoing (user, month); rowsRef still holds its rows
    // (the new load dispatches asynchronously below). This is not an effect cleanup, so it runs
    // synchronously on the switch path.
    const leaving = draftContextRef.current;
    if (leaving && saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (rowsRef.current.length) {
        // Snapshot the leaving sheet's rows now (rowsRef changes when the new sheet loads) and
        // enqueue a serialized save so a quick return awaits it and it can't overlap another save.
        void enqueueDraftSave(
          leaving.userId,
          leaving.monthKey,
          extractRilDraftRows(rowsRef.current),
          Array.from(getChangedDays().keys()),
        );
      }
    }
    draftContextRef.current = { userId: effectiveUserId, monthKey: draftMonthKey };
    changedDaysRef.current = new Map();
    const token = ++loadTokenRef.current;
    // Block autosave until this load's draft GET resolves (hydration must not trigger a save, and a
    // failed GET must not let us clobber a draft we never read).
    draftSyncReadyRef.current = false;
    dispatch({ type: 'loadStart' });
    try {
      const entriesPromise = (async () => {
        const nextEntries: TimeEntry[] = [];
        let cursor: string | null = null;
        let isStale = false;
        do {
          const page = await api.entries.listPage({
            userId: effectiveUserId,
            fromDate: monthBounds.fromDate,
            toDate: monthBounds.toDate,
            cursor,
            limit: 500,
            purpose: 'ril',
          });
          isStale = loadTokenRef.current !== token;
          if (isStale) {
            cursor = null;
          } else {
            nextEntries.push(...page.entries);
            cursor = page.nextCursor;
          }
        } while (cursor);
        return isStale ? null : nextEntries;
      })();
      // A failed draft GET must not abort the load (rows still render from timesheets) but it does
      // disable autosave so we never clobber a draft we couldn't read. First await any save still in
      // flight for this exact (user, month) — e.g. the flush fired when we last left this sheet — so
      // the GET reads committed rows instead of stale ones behind an uncommitted PUT.
      const pendingSave = pendingSavesRef.current?.get(
        draftSaveKey(effectiveUserId, draftMonthKey),
      );
      const draftPromise = (async () => {
        if (pendingSave) {
          try {
            await pendingSave;
          } catch {
            // A failed save shouldn't block the read; fall through and GET whatever is stored.
          }
        }
        return api.rilDrafts.get(draftMonthKey, effectiveUserId);
      })()
        .then((draft) => ({ ok: true as const, draft }))
        .catch(() => ({ ok: false as const, draft: null }));
      const projectCatalogPromise =
        projectCatalogUserIdRef.current === effectiveUserId
          ? Promise.resolve(projectCatalogRef.current)
          : api.projects.listRilCatalog(effectiveUserId);
      const [nextEntries, nextProjects, draftResult] = await Promise.all([
        entriesPromise,
        projectCatalogPromise,
        draftPromise,
      ]);
      if (loadTokenRef.current === token && nextEntries) {
        sourceEntriesRef.current = nextEntries;
        projectCatalogRef.current = nextProjects;
        projectCatalogUserIdRef.current = effectiveUserId;
        const baseRows = generateRows(nextEntries, nextProjects);
        if (draftResult.ok) {
          const merged = applyRilDraftToRows(baseRows, draftResult.draft?.rows, lunchBreakMinutes);
          dispatch({ type: 'loadSuccess', context: loadContext, rows: merged });
          dispatch({
            type: 'setDraftStatus',
            draftStatus: draftResult.draft?.updatedAt ? 'saved' : 'idle',
          });
          draftSyncReadyRef.current = true;
        } else {
          dispatch({ type: 'loadSuccess', context: loadContext, rows: baseRows });
          dispatch({ type: 'setDraftStatus', draftStatus: 'error' });
        }
      }
    } catch (err) {
      if (loadTokenRef.current === token) {
        sourceEntriesRef.current = [];
        projectCatalogRef.current = [];
        projectCatalogUserIdRef.current = null;
        dispatch({
          type: 'loadError',
          context: loadContext,
          error: err instanceof Error ? err.message : 'Failed to load RIL data',
          rows: generateRows([], []),
        });
        dispatch({ type: 'setDraftStatus', draftStatus: 'idle' });
      }
    }
  }, [
    effectiveUserId,
    generateRows,
    monthBounds.fromDate,
    monthBounds.toDate,
    draftMonthKey,
    lunchBreakMinutes,
    enqueueDraftSave,
    getChangedDays,
    loadContext,
  ]);

  useEffect(() => {
    void loadMonthEntries();
  }, [loadMonthEntries]);

  // Keep the rows mirror current for the debounced save and the flush-on-switch cleanup.
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const totals = useMemo(() => calculateRilTotals(rows), [rows]);

  // Persist the current month's draft to the backend. Captures (user, month) from the closure so
  // a late-firing save still targets the right sheet.
  const flushDraftSave = useCallback(async () => {
    saveTimerRef.current = null;
    const rowsToSave = rowsRef.current;
    if (!rowsToSave.length) return;
    const changedDayEntries = Array.from(getChangedDays().entries());
    const changedDays = changedDayEntries.map(([day]) => day);
    // Enqueue a serialized save (chained after any in-flight PUT for this sheet) so overlapping
    // saves can't land out of order; the later edit always wins on the server.
    const { ok } = await enqueueDraftSave(
      effectiveUserId,
      draftMonthKey,
      extractRilDraftRows(rowsToSave),
      changedDays,
    );
    if (!ok) {
      dispatch({ type: 'setDraftStatus', draftStatus: 'error' });
      return;
    }
    if (
      draftContextRef.current?.userId === effectiveUserId &&
      draftContextRef.current.monthKey === draftMonthKey
    ) {
      for (const [day, revision] of changedDayEntries) {
        const changedDays = getChangedDays();
        if (changedDays.get(day) === revision) changedDays.delete(day);
      }
    }
    // A newer edit re-armed the timer while we were saving — let that save own the final status.
    if (saveTimerRef.current === null) dispatch({ type: 'setDraftStatus', draftStatus: 'saved' });
  }, [draftMonthKey, effectiveUserId, enqueueDraftSave, getChangedDays]);

  const scheduleDraftSave = useCallback(() => {
    if (!draftSyncReadyRef.current) return;
    dispatch({ type: 'setDraftStatus', draftStatus: 'saving' });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushDraftSave();
    }, DRAFT_SAVE_DEBOUNCE_MS);
  }, [flushDraftSave]);

  const handleReset = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    changedDaysRef.current = new Map();
    dispatch({
      type: 'setRows',
      rows: generateRows(sourceEntriesRef.current, projectCatalogRef.current),
    });
    dispatch({ type: 'setDraftStatus', draftStatus: 'idle' });
    if (draftSyncReadyRef.current) {
      const userId = effectiveUserId;
      const monthKey = draftMonthKey;
      const removeDraft = () => api.rilDrafts.remove(monthKey, userId).catch(() => {});
      // If a save for this sheet is already on the wire, sequence the delete after it so the late
      // PUT can't recreate the draft we're discarding; otherwise delete immediately. Either way,
      // register the delete as a pending op so a quick reload of this sheet awaits it before its
      // GET and can't re-read (and rehydrate) the draft we just discarded.
      const pending = pendingSavesRef.current?.get(draftSaveKey(userId, monthKey));
      const removal = pending ? pending.finally(removeDraft) : removeDraft();
      trackDraftSave(userId, monthKey, removal);
    }
  };

  const updateRow = useCallback(
    (day: number, field: EditableRilField, value: string) => {
      dispatch({
        type: 'updateRows',
        updater: (currentRows) =>
          currentRows.map((row) => {
            if (row.day !== day || !canEditRilRow(row)) return row;

            const nextRow = { ...row, [field]: value };
            if (field === 'notes' && isRilAbsenceRow(nextRow)) {
              return {
                ...nextRow,
                entrance: '',
                exit: '',
                hours: '',
                hoursDecimal: 0,
                picap: 0,
                transfer: '',
                worked: false,
              };
            }
            if (field !== 'entrance' && field !== 'exit') return nextRow;

            const hoursDecimal = calculateRilWorkedHoursFromTimes(
              nextRow.entrance,
              nextRow.exit,
              lunchBreakMinutes,
            );
            return {
              ...nextRow,
              hours: formatRilHoursAsDuration(hoursDecimal),
              hoursDecimal,
              picap: hoursDecimal > 0 ? roundRilPicapHours(hoursDecimal) : 0,
              worked: hoursDecimal > 0,
            };
          }),
      });
      if (field === 'entrance' || field === 'exit') {
        getChangedDays().set(day, ++changedDayRevisionRef.current);
      }
      scheduleDraftSave();
    },
    [getChangedDays, lunchBreakMinutes, scheduleDraftSave],
  );

  const handleExport = async () => {
    const validRows = rows.filter(isRequiredRilWorkday);
    const attendanceRows = validRows.filter((row) => !isRilAbsenceRow(row));
    const missingTimeDays = collectRilMissingDays(
      attendanceRows,
      (row) => !row.entrance.trim() || !row.exit.trim(),
    );
    if (missingTimeDays.length > 0) {
      dispatch({
        type: 'setError',
        error: t('ril.missingTimes', { days: missingTimeDays.join(', ') }),
      });
      return;
    }

    const missingTransferDays = collectRilMissingDays(
      attendanceRows,
      (row) => !row.transfer.trim(),
    );
    if (missingTransferDays.length > 0) {
      dispatch({
        type: 'setError',
        error: t('ril.missingTransfer', { days: missingTransferDays.join(', ') }),
      });
      return;
    }

    dispatch({ type: 'exportStart' });
    try {
      const { downloadRilWorkbook } = await import('../../utils/rilExport');
      await downloadRilWorkbook({
        rows,
        employeeName: selectedUser.name,
        companyName: settings.rilCompanyName || '',
        year: monthBounds.year,
        month: monthBounds.month,
        lunchBreakMinutes,
      });
    } catch (err) {
      dispatch({
        type: 'exportDone',
        error: err instanceof Error ? err.message : t('ril.exportFailed'),
      });
      return;
    } finally {
      dispatch({ type: 'exportDone' });
    }
  };

  const tableHeaders = [
    { key: 'entrance', label: t('ril.columns.entrance'), className: 'w-24 min-w-24' },
    { key: 'exit', label: t('ril.columns.exit'), className: 'w-24 min-w-24' },
    { key: 'hours', label: t('ril.columns.hours'), className: 'w-20 min-w-20 text-right' },
    { key: 'picap', label: t('ril.columns.picap'), className: 'w-20 min-w-20 text-right' },
    { key: 'notes', label: t('ril.columns.notes'), className: 'w-32 min-w-32' },
    { key: 'transfer', label: t('ril.columns.transfer'), className: 'w-40 min-w-40' },
    { key: 'code', label: t('ril.columns.code'), className: 'w-32 min-w-32' },
  ];

  const extraHours = Math.max(0, totals.totalHours - totals.workedDays * 8);
  const summaryRows = [
    { label: t('ril.summary.workedDays'), value: String(totals.workedDays) },
    { label: t('ril.summary.lunchWindow'), value: formatRilLunchWindow(lunchBreakMinutes) },
    { label: t('ril.summary.extraHours'), value: formatDecimal(extraHours, 1) },
    { label: t('ril.summary.totalHours'), value: formatDecimal(totals.totalHours, 1) },
    { label: t('ril.summary.totalPicap'), value: formatDecimal(totals.totalPicap) },
  ];

  const getRowClassName = useCallback(
    (row: RilRow) =>
      !row.date
        ? 'bg-muted/30 text-muted-foreground hover:bg-muted/30'
        : row.isHoliday
          ? 'bg-amber-50/80 text-amber-950 hover:bg-amber-50 dark:bg-amber-950/30 dark:text-amber-100'
          : row.date && !row.isWorkday
            ? 'bg-zinc-900/85 text-zinc-100 hover:bg-zinc-900 dark:bg-zinc-900/80 dark:text-zinc-100'
            : 'hover:bg-muted/50',
    [],
  );

  return {
    availableUsers,
    currentUser,
    draftStatus,
    effectiveUserId,
    error,
    getRowClassName,
    handleExport,
    handleReset,
    isExporting,
    isLoading,
    monthOptions,
    noteOptions,
    onViewUserChange,
    rows,
    selectedMonthValue,
    selectedYearValue,
    summaryRows,
    t,
    tableHeaders,
    transferOptions,
    updateRow,
    updateSelectedMonth,
    updateSelectedYear,
    yearOptions,
  };
};

type RilController = ReturnType<typeof useRilController>;

const RilView: React.FC<RilViewProps> = (props) => {
  const controller = useRilController(props);
  return <RilViewLayout controller={controller} />;
};

const RilViewLayout: React.FC<{ controller: RilController }> = ({ controller }) => (
  <div className="space-y-6">
    <RilHeader controller={controller} />
    {controller.error && <RilErrorMessage message={controller.error} />}
    {controller.isLoading ? (
      <RilLoadingState controller={controller} />
    ) : (
      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <RilDataTable controller={controller} />
        <RilSummary controller={controller} />
      </section>
    )}
  </div>
);

const RilLoadingState: React.FC<{ controller: RilController }> = ({ controller }) => (
  <div
    role="status"
    aria-label={controller.t('ril.loading')}
    className="flex min-h-64 items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground"
  >
    <span className="inline-flex items-center gap-2">
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      {controller.t('ril.loading')}
    </span>
  </div>
);

const RilHeader: React.FC<{ controller: RilController }> = ({ controller }) => (
  <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
    <div>
      <h2 className="text-2xl font-semibold text-foreground">{controller.t('ril.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{controller.t('ril.subtitle')}</p>
      <output aria-live="polite" className="mt-2 block min-h-4 text-xs">
        <RilDraftStatusIndicator controller={controller} />
      </output>
    </div>
    <RilHeaderControls controller={controller} />
  </div>
);

const RilDraftStatusIndicator: React.FC<{ controller: RilController }> = ({ controller }) => {
  if (controller.draftStatus === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        {controller.t('ril.draft.saving')}
      </span>
    );
  }
  if (controller.draftStatus === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Check aria-hidden="true" className="size-3 text-emerald-600 dark:text-emerald-400" />
        {controller.t('ril.draft.saved')}
      </span>
    );
  }
  if (controller.draftStatus === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <CircleAlert aria-hidden="true" className="size-3" />
        {controller.t('ril.draft.saveError')}
      </span>
    );
  }
  return null;
};

const RilHeaderControls: React.FC<{ controller: RilController }> = ({ controller }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
    <Field className="min-w-48">
      <FieldLabel htmlFor="ril-user">{controller.t('ril.user')}</FieldLabel>
      <Select value={controller.effectiveUserId} onValueChange={controller.onViewUserChange}>
        <SelectTrigger id="ril-user" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {controller.availableUsers.map((user) => (
            <SelectItem key={user.id} value={user.id}>
              {user.name}
              {user.id === controller.currentUser.id ? ` (${controller.t('tracker.you')})` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
    <Field className="min-w-40">
      <FieldLabel htmlFor="ril-month-select">{controller.t('ril.month')}</FieldLabel>
      <Select value={controller.selectedMonthValue} onValueChange={controller.updateSelectedMonth}>
        <SelectTrigger id="ril-month-select" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {controller.monthOptions.map((month) => (
              <SelectItem key={month.value} value={month.value}>
                {month.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    <Field className="min-w-28">
      <FieldLabel htmlFor="ril-year-select">{controller.t('ril.year')}</FieldLabel>
      <Select value={controller.selectedYearValue} onValueChange={controller.updateSelectedYear}>
        <SelectTrigger id="ril-year-select" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {controller.yearOptions.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
    <Button
      type="button"
      variant="outline"
      onClick={controller.handleReset}
      disabled={controller.isLoading}
    >
      <RotateCcw aria-hidden="true" />
      {controller.t('ril.reset')}
    </Button>
    <Button
      type="button"
      onClick={controller.handleExport}
      disabled={controller.isLoading || controller.isExporting}
    >
      {controller.isExporting ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <Download />
      )}
      {controller.t('ril.exportExcel')}
    </Button>
  </div>
);

const RilErrorMessage: React.FC<{ message: string }> = ({ message }) => (
  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
    {message}
  </div>
);

const RilDataTable: React.FC<{ controller: RilController }> = ({ controller }) => (
  <div className="overflow-x-auto rounded-md border border-border">
    <Table className="min-w-[49rem] table-fixed text-xs">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead colSpan={2} className="h-8 w-16 min-w-16 px-2 text-center">
            {controller.t('ril.columns.day')}
          </TableHead>
          {controller.tableHeaders.map((header) => (
            <TableHead key={header.key} className={`h-8 px-2 ${header.className}`}>
              {header.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {controller.rows.map((row) => (
          <RilDataRow key={row.day} controller={controller} row={row} />
        ))}
      </TableBody>
    </Table>
  </div>
);

const RilDataRow: React.FC<{ controller: RilController; row: RilRow }> = ({ controller, row }) => (
  <TableRow className={controller.getRowClassName(row)}>
    <TableCell className="w-8 min-w-8 py-1 pr-1 pl-2 text-xs font-normal text-muted-foreground">
      {row.weekday || '-'}
    </TableCell>
    <TableCell className="w-8 min-w-8 py-1 pr-2 pl-1 text-right font-medium tabular-nums">
      {row.day}
    </TableCell>
    <TableCell className="w-24 min-w-24 px-2 py-1">
      <RilEditableInput
        row={row}
        field="entrance"
        label={controller.t('ril.columns.entrance')}
        onUpdate={controller.updateRow}
      />
    </TableCell>
    <TableCell className="w-24 min-w-24 px-2 py-1">
      <RilEditableInput
        row={row}
        field="exit"
        label={controller.t('ril.columns.exit')}
        onUpdate={controller.updateRow}
      />
    </TableCell>
    <TableCell className="w-20 min-w-20 px-2 py-1">
      <RilComputedValue row={row} label={controller.t('ril.columns.hours')} value={row.hours} />
    </TableCell>
    <TableCell className="w-20 min-w-20 px-2 py-1">
      <RilComputedValue
        row={row}
        label={controller.t('ril.columns.picap')}
        value={row.worked || row.picap > 0 ? row.picap : ''}
      />
    </TableCell>
    <TableCell className="w-32 min-w-32 px-2 py-1">
      <RilSelectControl
        row={row}
        field="notes"
        label={controller.t('ril.columns.notes')}
        options={controller.noteOptions}
        onUpdate={controller.updateRow}
      />
    </TableCell>
    <TableCell className="w-40 min-w-40 px-2 py-1">
      <RilSelectControl
        row={row}
        field="transfer"
        label={controller.t('ril.columns.transfer')}
        options={controller.transferOptions}
        onUpdate={controller.updateRow}
      />
    </TableCell>
    <TableCell className="w-32 min-w-32 px-2 py-1">
      <RilSelectControl
        row={row}
        field="code"
        label={controller.t('ril.columns.code')}
        options={RIL_CODE_OPTIONS}
        onUpdate={controller.updateRow}
      />
    </TableCell>
  </TableRow>
);

const RilSummary: React.FC<{ controller: RilController }> = ({ controller }) => (
  <aside
    aria-label={controller.t('ril.summary.title')}
    className="rounded-lg border border-border bg-card/95 p-3 shadow-sm xl:sticky xl:top-24"
  >
    <dl className="space-y-2">
      {controller.summaryRows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border bg-muted/35 px-3 py-2 text-xs leading-tight"
        >
          <dt className="whitespace-nowrap text-muted-foreground">{row.label}</dt>
          <dd className="whitespace-nowrap text-right font-semibold text-foreground tabular-nums">
            <output aria-label={row.label}>{row.value}</output>
          </dd>
        </div>
      ))}
    </dl>
  </aside>
);

export default RilView;
