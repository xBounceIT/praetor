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
import api from '../../services/api';
import type { GeneralSettings, Project, TimeEntry, User } from '../../types';
import {
  calculateRilTotals,
  generateRilRows,
  getCurrentRilMonthKey,
  getRilLocationLabels,
  getRilMonthBounds,
  type RilRow,
} from '../../utils/ril';
import { downloadRilWorkbook } from '../../utils/rilExport';
import StandardTable, { type Column } from '../shared/StandardTable';

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

type EditableRilField = 'entrance' | 'exit' | 'hours' | 'notes' | 'transfer';

const parseDraftHours = (value: string): number => {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return 0;
  if (trimmed.includes(':')) {
    const [hours, minutes = '0'] = trimmed.split(':');
    const parsedHours = Number(hours);
    const parsedMinutes = Number(minutes);
    if (Number.isFinite(parsedHours) && Number.isFinite(parsedMinutes)) {
      return Math.max(0, parsedHours + parsedMinutes / 60);
    }
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
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

  const updateRow = useCallback((day: number, field: EditableRilField, value: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.day !== day) return row;
        if (row.isHoliday) return row;
        if (field === 'hours') {
          const hoursDecimal = parseDraftHours(value);
          return {
            ...row,
            hours: value,
            hoursDecimal,
            picap: Math.round(hoursDecimal * 4) / 4,
            worked: hoursDecimal > 0,
          };
        }
        return { ...row, [field]: value };
      }),
    );
  }, []);

  const getEditableValue = useCallback((row: RilRow, field: EditableRilField): string => {
    return String(row[field] ?? '');
  }, []);

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

  const columns = useMemo<Column<RilRow>[]>(() => {
    const locationLabels = getRilLocationLabels(locale);
    const transferOptions = [locationLabels.office, locationLabels.remote];

    const editableColumn = (
      field: EditableRilField,
      label: string,
      inputClassName = 'min-w-[7rem]',
    ): Column<RilRow> => ({
      header: label,
      id: field,
      accessorKey: field,
      disableFiltering: true,
      disableSorting: true,
      cell: ({ row }) => (
        <Input
          aria-label={`${label} ${row.day}`}
          value={getEditableValue(row, field)}
          disabled={row.isHoliday}
          onChange={(event) => updateRow(row.day, field, event.target.value)}
          className={`h-8 text-xs disabled:cursor-not-allowed ${inputClassName}`}
        />
      ),
    });

    const transferLabel = t('ril.columns.transfer');

    return [
      {
        header: t('ril.columns.day'),
        id: 'day',
        accessorKey: 'day',
        disableFiltering: true,
        disableSorting: true,
        cell: ({ row }) => (
          <span className="inline-flex items-baseline gap-2 font-medium">
            <span className="tabular-nums">{row.day}</span>
            {row.weekday && (
              <span className="text-xs font-normal text-muted-foreground">{row.weekday}</span>
            )}
          </span>
        ),
      },
      editableColumn('entrance', t('ril.columns.entrance')),
      editableColumn('exit', t('ril.columns.exit')),
      editableColumn('hours', t('ril.columns.hours')),
      editableColumn('notes', t('ril.columns.notes'), 'min-w-[9rem]'),
      {
        header: transferLabel,
        id: 'transfer',
        accessorKey: 'transfer',
        disableFiltering: true,
        disableSorting: true,
        cell: ({ row }) => (
          <Select
            value={row.transfer || undefined}
            onValueChange={(value) => updateRow(row.day, 'transfer', value)}
            disabled={row.isHoliday}
          >
            <SelectTrigger
              aria-label={`${transferLabel} ${row.day}`}
              className="h-8 min-w-[10rem] text-xs disabled:cursor-not-allowed"
            >
              <SelectValue placeholder="-" />
            </SelectTrigger>
            <SelectContent>
              {transferOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
    ];
  }, [getEditableValue, locale, t, updateRow]);

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

      <StandardTable<RilRow>
        title={t('ril.tableTitle')}
        data={rows}
        columns={columns}
        defaultRowsPerPage={50}
        minBodyRows={31}
        rowClassName={getRowClassName}
        headerExtras={
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
        }
      />
    </div>
  );
};

export default RilView;
