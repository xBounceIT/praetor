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
  generateRilRows,
  getCurrentRilMonthKey,
  getRilMonthBounds,
  type RilRow,
} from '../../utils/ril';
import { downloadRilWorkbook } from '../../utils/rilExport';

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

type EditableRilField =
  | 'entrance'
  | 'exit'
  | 'hours'
  | 'picap'
  | 'phoneAvailability'
  | 'notes'
  | 'transfer'
  | 'code'
  | 'order';

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

  const updateRow = (day: number, field: EditableRilField, value: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.day !== day) return row;
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
        if (field === 'picap') {
          const picap = Number(value.replace(',', '.'));
          return { ...row, picap: Number.isFinite(picap) ? picap : 0 };
        }
        return { ...row, [field]: value };
      }),
    );
  };

  const getEditableValue = (row: RilRow, field: EditableRilField): string => {
    if (field === 'picap' && row.picap === 0 && !row.worked) return '';
    return String(row[field] ?? '');
  };

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

  const editableColumns: Array<{ field: EditableRilField; label: string; className?: string }> = [
    { field: 'entrance', label: t('ril.columns.entrance'), className: 'min-w-24' },
    { field: 'exit', label: t('ril.columns.exit'), className: 'min-w-24' },
    { field: 'hours', label: t('ril.columns.hours'), className: 'min-w-24' },
    { field: 'picap', label: t('ril.columns.picap'), className: 'min-w-24' },
    {
      field: 'phoneAvailability',
      label: t('ril.columns.phoneAvailability'),
      className: 'min-w-32',
    },
    { field: 'notes', label: t('ril.columns.notes'), className: 'min-w-32' },
    { field: 'transfer', label: t('ril.columns.transfer'), className: 'min-w-40' },
    { field: 'code', label: t('ril.columns.code'), className: 'min-w-28' },
    { field: 'order', label: t('ril.columns.order'), className: 'min-w-56' },
  ];

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

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{t('ril.entriesLoaded', { count: sourceEntries.length })}</Badge>
        <Badge variant="secondary">
          {t('ril.totalHours', { count: totals.totalHours.toFixed(2) })}
        </Badge>
        <Badge variant="secondary">{t('ril.workedDays', { count: totals.workedDays })}</Badge>
        {lastExportFilename && <Badge variant="outline">{lastExportFilename}</Badge>}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-24">{t('ril.columns.day')}</TableHead>
              {editableColumns.map((column) => (
                <TableHead key={column.field} className={column.className}>
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.day} className={row.isHoliday ? 'bg-muted/50' : undefined}>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span>{row.day}</span>
                    {row.weekday && (
                      <span className="text-xs text-muted-foreground">{row.weekday}</span>
                    )}
                  </div>
                </TableCell>
                {editableColumns.map((column) => (
                  <TableCell key={column.field}>
                    <Input
                      aria-label={`${column.label} ${row.day}`}
                      value={getEditableValue(row, column.field)}
                      onChange={(event) => updateRow(row.day, column.field, event.target.value)}
                      className="h-8 min-w-0"
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default RilView;
