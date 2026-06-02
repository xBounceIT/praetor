import { Download, Loader2, RotateCcw } from 'lucide-react';
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
import type { GeneralSettings, Project, TimeEntry, User } from '../../types';
import {
  calculateRilTotals,
  calculateRilWorkedHoursFromTimes,
  DEFAULT_RIL_EXIT_TIME,
  DEFAULT_RIL_START_TIME,
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
import { downloadRilWorkbook } from '../../utils/rilExport';

const EMPTY_SELECT_VALUE = '__empty__';
const RIL_CODE_OPTIONS = [
  { value: 'TR', label: 'Trasferta' },
  { value: 'SD', label: 'Sede Disagiata' },
] as const;
const RIL_MONTH_OPTION_DATE_YEAR = 2020;

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
  projects: Project[];
  settings: Pick<
    GeneralSettings,
    | 'rilCompanyName'
    | 'rilDefaultStartTime'
    | 'rilDefaultExitTime'
    | 'rilLunchBreakMinutes'
    | 'rilNoteOptions'
    | 'rilTransferOptions'
  >;
}

type EditableRilField = 'entrance' | 'exit' | 'notes' | 'transfer' | 'code';

const canEditRilRow = (row: RilRow) => Boolean(row.date && !row.isHoliday);

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
  isExporting: boolean;
  error: string | null;
};

type RilViewAction =
  | { type: 'setMonthKey'; monthKey: string }
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; rows: RilRow[] }
  | { type: 'loadError'; error: string; rows: RilRow[] }
  | { type: 'setRows'; rows: RilRow[] }
  | { type: 'updateRows'; updater: (rows: RilRow[]) => RilRow[] }
  | { type: 'setError'; error: string }
  | { type: 'exportStart' }
  | { type: 'exportDone'; error?: string };

const rilViewReducer = (state: RilViewState, action: RilViewAction): RilViewState => {
  switch (action.type) {
    case 'setMonthKey':
      return { ...state, monthKey: action.monthKey };
    case 'loadStart':
      return { ...state, isLoading: true, error: null };
    case 'loadSuccess':
      return { ...state, rows: action.rows, isLoading: false };
    case 'loadError':
      return { ...state, rows: action.rows, isLoading: false, error: action.error };
    case 'setRows':
      return { ...state, rows: action.rows };
    case 'updateRows':
      return { ...state, rows: action.updater(state.rows) };
    case 'setError':
      return { ...state, error: action.error };
    case 'exportStart':
      return { ...state, isExporting: true, error: null };
    case 'exportDone':
      return { ...state, isExporting: false, error: action.error ?? state.error };
  }
};

const RilView: React.FC<RilViewProps> = ({
  currentUser,
  availableUsers,
  viewingUserId,
  onViewUserChange,
  projects,
  settings,
}) => {
  const { t, i18n } = useTranslation('timesheets');
  const [state, dispatch] = useReducer(rilViewReducer, undefined, () => ({
    monthKey: getCurrentRilMonthKey(),
    rows: [],
    isLoading: false,
    isExporting: false,
    error: null,
  }));
  const { monthKey, rows, isLoading, isExporting, error } = state;
  const sourceEntriesRef = useRef<TimeEntry[]>([]);
  const projectCatalogRef = useRef<Project[]>([]);
  const loadTokenRef = useRef(0);

  const effectiveUserId = viewingUserId || currentUser.id;
  const selectedUser = availableUsers.find((user) => user.id === effectiveUserId) ?? currentUser;
  const monthBounds = useMemo(() => getRilMonthBounds(normalizeMonthKey(monthKey)), [monthKey]);
  const locale = getLocale(i18n.language);
  const defaultStartTime = settings.rilDefaultStartTime || DEFAULT_RIL_START_TIME;
  const defaultExitTime = settings.rilDefaultExitTime || DEFAULT_RIL_EXIT_TIME;
  const lunchBreakMinutes = settings.rilLunchBreakMinutes ?? 60;
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
    (entries: TimeEntry[], catalogProjects: Project[]) =>
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
    ],
  );

  const loadMonthEntries = useCallback(async () => {
    const token = ++loadTokenRef.current;
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
      const [nextEntries, nextProjects] = await Promise.all([
        entriesPromise,
        api.projects.list({ userId: effectiveUserId }),
      ]);
      if (loadTokenRef.current === token && nextEntries) {
        sourceEntriesRef.current = nextEntries;
        projectCatalogRef.current = nextProjects;
        dispatch({ type: 'loadSuccess', rows: generateRows(nextEntries, nextProjects) });
      }
    } catch (err) {
      if (loadTokenRef.current === token) {
        sourceEntriesRef.current = [];
        projectCatalogRef.current = projects;
        dispatch({
          type: 'loadError',
          error: err instanceof Error ? err.message : 'Failed to load RIL data',
          rows: generateRows([], []),
        });
      }
    }
  }, [effectiveUserId, generateRows, monthBounds.fromDate, monthBounds.toDate, projects]);

  useEffect(() => {
    void loadMonthEntries();
  }, [loadMonthEntries]);

  const totals = useMemo(() => calculateRilTotals(rows), [rows]);

  const handleReset = () => {
    dispatch({
      type: 'setRows',
      rows: generateRows(sourceEntriesRef.current, projectCatalogRef.current),
    });
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
    },
    [lunchBreakMinutes],
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

  const numberLocale = locale === 'it' ? 'it-IT' : 'en-US';
  const formatOneDecimal = useMemo(
    () =>
      new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [numberLocale],
  );
  const formatTwoDecimals = useMemo(
    () =>
      new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [numberLocale],
  );
  const extraHours = Math.max(0, totals.totalHours - totals.workedDays * 8);
  const summaryRows = [
    { label: t('ril.summary.workedDays'), value: String(totals.workedDays) },
    { label: t('ril.summary.lunchWindow'), value: formatRilLunchWindow(lunchBreakMinutes) },
    { label: t('ril.summary.extraHours'), value: formatOneDecimal.format(extraHours) },
    { label: t('ril.summary.totalHours'), value: formatOneDecimal.format(totals.totalHours) },
    { label: t('ril.summary.totalPicap'), value: formatTwoDecimals.format(totals.totalPicap) },
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">{t('ril.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('ril.subtitle')}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="min-w-48">
            <FieldLabel htmlFor="ril-user">{t('ril.user')}</FieldLabel>
            <Select value={effectiveUserId} onValueChange={onViewUserChange}>
              <SelectTrigger id="ril-user" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                    {user.id === currentUser.id ? ` (${t('tracker.you')})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-40">
            <FieldLabel htmlFor="ril-month-select">{t('ril.month')}</FieldLabel>
            <Select value={selectedMonthValue} onValueChange={updateSelectedMonth}>
              <SelectTrigger id="ril-month-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {monthOptions.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-28">
            <FieldLabel htmlFor="ril-year-select">{t('ril.year')}</FieldLabel>
            <Select value={selectedYearValue} onValueChange={updateSelectedYear}>
              <SelectTrigger id="ril-year-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Button type="button" variant="outline" onClick={handleReset} disabled={isLoading}>
            <RotateCcw aria-hidden="true" />
            {t('ril.reset')}
          </Button>
          <Button type="button" onClick={handleExport} disabled={isLoading || isExporting}>
            {isExporting ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Download />}
            {t('ril.exportExcel')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="overflow-x-auto rounded-md border border-border">
          <Table className="min-w-[49rem] table-fixed text-xs">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead colSpan={2} className="h-8 w-16 min-w-16 px-2 text-center">
                  {t('ril.columns.day')}
                </TableHead>
                {tableHeaders.map((header) => (
                  <TableHead key={header.key} className={`h-8 px-2 ${header.className}`}>
                    {header.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.day} className={getRowClassName(row)}>
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
                      label={t('ril.columns.entrance')}
                      onUpdate={updateRow}
                    />
                  </TableCell>
                  <TableCell className="w-24 min-w-24 px-2 py-1">
                    <RilEditableInput
                      row={row}
                      field="exit"
                      label={t('ril.columns.exit')}
                      onUpdate={updateRow}
                    />
                  </TableCell>
                  <TableCell className="w-20 min-w-20 px-2 py-1">
                    <RilComputedValue row={row} label={t('ril.columns.hours')} value={row.hours} />
                  </TableCell>
                  <TableCell className="w-20 min-w-20 px-2 py-1">
                    <RilComputedValue
                      row={row}
                      label={t('ril.columns.picap')}
                      value={row.worked || row.picap > 0 ? row.picap : ''}
                    />
                  </TableCell>
                  <TableCell className="w-32 min-w-32 px-2 py-1">
                    <RilSelectControl
                      row={row}
                      field="notes"
                      label={t('ril.columns.notes')}
                      options={noteOptions}
                      onUpdate={updateRow}
                    />
                  </TableCell>
                  <TableCell className="w-40 min-w-40 px-2 py-1">
                    <RilSelectControl
                      row={row}
                      field="transfer"
                      label={t('ril.columns.transfer')}
                      options={transferOptions}
                      onUpdate={updateRow}
                    />
                  </TableCell>
                  <TableCell className="w-32 min-w-32 px-2 py-1">
                    <RilSelectControl
                      row={row}
                      field="code"
                      label={t('ril.columns.code')}
                      options={RIL_CODE_OPTIONS}
                      onUpdate={updateRow}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <aside
          aria-label={t('ril.summary.title')}
          className="rounded-lg border border-border bg-card/95 p-3 shadow-sm xl:sticky xl:top-24"
        >
          <dl className="space-y-2">
            {summaryRows.map((row) => (
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
      </section>
    </div>
  );
};

export default RilView;
