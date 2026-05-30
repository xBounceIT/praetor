import { Download, Loader2, RefreshCcw, RotateCcw } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
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
  formatRilHoursAsDuration,
  generateRilRows,
  getCurrentRilMonthKey,
  getRilLocationLabels,
  getRilMonthBounds,
  isValidRilStartTime,
  parseRilTimeToMinutes,
  type RilRow,
  roundRilPicapHours,
} from '../../utils/ril';
import { downloadRilWorkbook } from '../../utils/rilExport';

const EMPTY_SELECT_VALUE = '__empty__';
const RIL_NOTES_OPTIONS = [
  { value: 'P', label: 'Ferie' },
  { value: 'P2', label: 'Permesso' },
  { value: 'M', label: 'Malattia' },
  { value: 'F', label: 'Festivita' },
] as const;
const RIL_CODE_OPTIONS = [
  { value: 'TR', label: 'Trasferta' },
  { value: 'SD', label: 'Sede Disagiata' },
] as const;

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
    'rilCompanyName' | 'rilDefaultStartTime' | 'rilLunchBreakMinutes'
  >;
}

type EditableRilField = 'entrance' | 'exit' | 'notes' | 'transfer' | 'code';

const LUNCH_BREAK_THRESHOLD_MINUTES = 6 * 60;

const normalizeLunchBreakMinutes = (value: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 60;
  return Math.min(240, Math.max(0, Math.round(parsed)));
};

const calculateDraftHoursFromTimes = (
  entrance: string,
  exit: string,
  lunchBreakMinutes: number,
): number => {
  if (!isValidRilStartTime(entrance) || !isValidRilStartTime(exit)) return 0;

  const startMinutes = parseRilTimeToMinutes(entrance);
  const exitMinutes = parseRilTimeToMinutes(exit);
  if (exitMinutes <= startMinutes) return 0;

  const elapsedMinutes = exitMinutes - startMinutes;
  const lunchMinutes =
    elapsedMinutes > LUNCH_BREAK_THRESHOLD_MINUTES
      ? normalizeLunchBreakMinutes(lunchBreakMinutes)
      : 0;
  return Math.max(0, (elapsedMinutes - lunchMinutes) / 60);
};

const normalizeMonthKey = (value: string): string => {
  try {
    return getRilMonthBounds(value).monthKey;
  } catch {
    return getCurrentRilMonthKey();
  }
};

const getLocale = (language: string | undefined) => (language?.startsWith('it') ? 'it' : 'en');

const RilView: React.FC<RilViewProps> = ({
  currentUser,
  availableUsers,
  viewingUserId,
  onViewUserChange,
  projects,
  settings,
}) => {
  const { t, i18n } = useTranslation('timesheets');
  const [monthKey, setMonthKey] = useState(() => getCurrentRilMonthKey());
  const [sourceEntries, setSourceEntries] = useState<TimeEntry[]>([]);
  const [rows, setRows] = useState<RilRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExportFilename, setLastExportFilename] = useState<string | null>(null);
  const loadTokenRef = useRef(0);

  const effectiveUserId = viewingUserId || currentUser.id;
  const selectedUser = availableUsers.find((user) => user.id === effectiveUserId) ?? currentUser;
  const monthBounds = useMemo(() => getRilMonthBounds(normalizeMonthKey(monthKey)), [monthKey]);
  const locale = getLocale(i18n.language);
  const defaultStartTime = settings.rilDefaultStartTime || '09:00';
  const lunchBreakMinutes = settings.rilLunchBreakMinutes ?? 60;

  const generateRows = useCallback(
    (entries: TimeEntry[]) =>
      generateRilRows({
        year: monthBounds.year,
        month: monthBounds.month,
        entries,
        projects,
        defaultStartTime,
        lunchBreakMinutes,
        locale,
      }),
    [defaultStartTime, locale, lunchBreakMinutes, monthBounds.month, monthBounds.year, projects],
  );

  const loadMonthEntries = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setIsLoading(true);
    setError(null);
    setLastExportFilename(null);
    try {
      const nextEntries: TimeEntry[] = [];
      let cursor: string | null = null;
      do {
        const page = await api.entries.listPage({
          userId: effectiveUserId,
          fromDate: monthBounds.fromDate,
          toDate: monthBounds.toDate,
          cursor,
          limit: 500,
        });
        if (loadTokenRef.current !== token) return;
        nextEntries.push(...page.entries);
        cursor = page.nextCursor;
      } while (cursor);
      setSourceEntries(nextEntries);
      setRows(generateRows(nextEntries));
    } catch (err) {
      if (loadTokenRef.current !== token) return;
      setError(err instanceof Error ? err.message : 'Failed to load RIL data');
      setSourceEntries([]);
      setRows(generateRows([]));
    } finally {
      if (loadTokenRef.current === token) setIsLoading(false);
    }
  }, [effectiveUserId, generateRows, monthBounds.fromDate, monthBounds.toDate]);

  useEffect(() => {
    void loadMonthEntries();
  }, [loadMonthEntries]);

  const totals = useMemo(() => calculateRilTotals(rows), [rows]);

  const handleReset = () => {
    setRows(generateRows(sourceEntries));
    setLastExportFilename(null);
  };

  const updateRow = useCallback(
    (day: number, field: EditableRilField, value: string) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.day !== day || row.isHoliday) return row;

          const nextRow = { ...row, [field]: value };
          if (field !== 'entrance' && field !== 'exit') return nextRow;

          const hoursDecimal = calculateDraftHoursFromTimes(
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
      );
    },
    [lunchBreakMinutes],
  );

  const getEditableValue = useCallback(
    (row: RilRow, field: EditableRilField): string => String(row[field] ?? ''),
    [],
  );

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const filename = await downloadRilWorkbook({
        rows,
        employeeName: selectedUser.name,
        companyName: settings.rilCompanyName || '',
        year: monthBounds.year,
        month: monthBounds.month,
        defaultStartTime,
        lunchBreakMinutes,
      });
      setLastExportFilename(filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ril.exportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const transferOptions = useMemo<RilSelectOption[]>(() => {
    const locationLabels = getRilLocationLabels(locale);
    return [
      {
        value: locationLabels.office,
        label: locationLabels.office,
        display: locationLabels.office,
      },
      {
        value: locationLabels.remote,
        label: locationLabels.remote,
        display: locationLabels.remote,
      },
    ];
  }, [locale]);

  const renderEditableInput = (row: RilRow, field: EditableRilField, label: string) => (
    <Input
      aria-label={`${label} ${row.day}`}
      type="time"
      value={getEditableValue(row, field)}
      disabled={row.isHoliday}
      onChange={(event) => updateRow(row.day, field, event.target.value)}
      className="h-7 w-full min-w-0 px-2 text-xs tabular-nums disabled:cursor-not-allowed"
    />
  );

  const renderComputedValue = (row: RilRow, label: string, value: string | number) => (
    <output
      aria-label={`${label} ${row.day}`}
      className="block min-h-7 px-1 py-1.5 text-right text-xs tabular-nums"
    >
      {value || '-'}
    </output>
  );

  const renderSelectControl = (
    row: RilRow,
    field: EditableRilField,
    label: string,
    options: ReadonlyArray<RilSelectOption>,
  ) => (
    <Select
      value={getEditableValue(row, field) || EMPTY_SELECT_VALUE}
      onValueChange={(value) =>
        updateRow(row.day, field, value === EMPTY_SELECT_VALUE ? '' : value)
      }
      disabled={row.isHoliday}
    >
      <SelectTrigger
        aria-label={`${label} ${row.day}`}
        className="h-7 w-full min-w-0 px-2 text-xs disabled:cursor-not-allowed [&>svg]:size-3"
      >
        <SelectValue placeholder="-" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY_SELECT_VALUE}>-</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.display ?? `${option.value} - ${option.label}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const tableHeaders = [
    { key: 'day', label: t('ril.columns.day'), className: 'w-[4.25rem] min-w-[4.25rem]' },
    { key: 'entrance', label: t('ril.columns.entrance'), className: 'w-24 min-w-24' },
    { key: 'exit', label: t('ril.columns.exit'), className: 'w-24 min-w-24' },
    { key: 'hours', label: t('ril.columns.hours'), className: 'w-20 min-w-20 text-right' },
    { key: 'picap', label: t('ril.columns.picap'), className: 'w-20 min-w-20 text-right' },
    { key: 'notes', label: t('ril.columns.notes'), className: 'w-32 min-w-32' },
    { key: 'transfer', label: t('ril.columns.transfer'), className: 'w-40 min-w-40' },
    { key: 'code', label: t('ril.columns.code'), className: 'w-32 min-w-32' },
  ];

  const getRowClassName = useCallback(
    (row: RilRow) =>
      row.isHoliday
        ? 'bg-amber-50/80 text-amber-950 hover:bg-amber-50 dark:bg-amber-950/30 dark:text-amber-100'
        : row.date && !row.isWorkday
          ? 'bg-sky-50/70 text-sky-950 hover:bg-sky-50 dark:bg-sky-950/25 dark:text-sky-100'
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
          <Field className="min-w-44">
            <FieldLabel htmlFor="ril-month">{t('ril.month')}</FieldLabel>
            <Input
              id="ril-month"
              type="month"
              value={monthKey}
              onChange={(event) => setMonthKey(normalizeMonthKey(event.target.value))}
            />
          </Field>
          <Button type="button" variant="outline" onClick={loadMonthEntries} disabled={isLoading}>
            {isLoading ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RefreshCcw />}
            {t('ril.refresh')}
          </Button>
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

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold text-foreground">{t('ril.tableTitle')}</h3>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {t('ril.entriesLoaded', { count: sourceEntries.length })}
            </Badge>
            <Badge variant="secondary">
              {t('ril.totalHours', { count: totals.totalHours.toFixed(2) })}
            </Badge>
            <Badge variant="secondary">{t('ril.workedDays', { count: totals.workedDays })}</Badge>
            {lastExportFilename && <Badge variant="outline">{lastExportFilename}</Badge>}
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table className="min-w-[49rem] table-fixed text-xs">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
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
                  <TableCell className="w-[4.25rem] min-w-[4.25rem] px-2 py-1 font-medium">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-normal text-muted-foreground">
                        {row.weekday || '-'}
                      </span>
                      <span className="tabular-nums">{row.day}</span>
                    </span>
                  </TableCell>
                  <TableCell className="w-24 min-w-24 px-2 py-1">
                    {renderEditableInput(row, 'entrance', t('ril.columns.entrance'))}
                  </TableCell>
                  <TableCell className="w-24 min-w-24 px-2 py-1">
                    {renderEditableInput(row, 'exit', t('ril.columns.exit'))}
                  </TableCell>
                  <TableCell className="w-20 min-w-20 px-2 py-1">
                    {renderComputedValue(row, t('ril.columns.hours'), row.hours)}
                  </TableCell>
                  <TableCell className="w-20 min-w-20 px-2 py-1">
                    {renderComputedValue(
                      row,
                      t('ril.columns.picap'),
                      row.worked || row.picap > 0 ? row.picap : '',
                    )}
                  </TableCell>
                  <TableCell className="w-32 min-w-32 px-2 py-1">
                    {renderSelectControl(row, 'notes', t('ril.columns.notes'), RIL_NOTES_OPTIONS)}
                  </TableCell>
                  <TableCell className="w-40 min-w-40 px-2 py-1">
                    {renderSelectControl(
                      row,
                      'transfer',
                      t('ril.columns.transfer'),
                      transferOptions,
                    )}
                  </TableCell>
                  <TableCell className="w-32 min-w-32 px-2 py-1">
                    {renderSelectControl(row, 'code', t('ril.columns.code'), RIL_CODE_OPTIONS)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
};

export default RilView;
