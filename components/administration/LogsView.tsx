import type { TFunction } from 'i18next';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logsApi } from '../../services/api';
import type { AuditLogEntry } from '../../types';
import CustomSelect from '../shared/CustomSelect';
import DatePickerButton from '../shared/DatePickerButton';
import StandardTable, { type Column } from '../shared/StandardTable';

const humanizeToken = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

type TimeRange =
  | 'today'
  | 'yesterday'
  | 'last7Days'
  | 'last30Days'
  | 'last90Days'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear';

const getPresetRange = (range: TimeRange): { start: Date; end: Date } => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (range) {
    case 'today':
      return { start: new Date(today.getTime()), end };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        start: new Date(yesterday.getTime()),
        end: new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          23,
          59,
          59,
          999,
        ),
      };
    }
    case 'last7Days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { start, end };
    }
    case 'last30Days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { start, end };
    }
    case 'last90Days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 89);
      return { start, end };
    }
    case 'thisWeek': {
      const start = new Date(today);
      const dayOfWeek = start.getDay();
      const diff = start.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      start.setDate(diff);
      return { start, end };
    }
    case 'lastWeek': {
      const endOfLastWeek = new Date(today);
      const dayOfWeek = endOfLastWeek.getDay();
      const diff = endOfLastWeek.getDate() - dayOfWeek;
      endOfLastWeek.setDate(diff);
      const startOfLastWeek = new Date(endOfLastWeek);
      startOfLastWeek.setDate(startOfLastWeek.getDate() - 6);
      return {
        start: startOfLastWeek,
        end: new Date(
          endOfLastWeek.getFullYear(),
          endOfLastWeek.getMonth(),
          endOfLastWeek.getDate(),
          23,
          59,
          59,
          999,
        ),
      };
    }
    case 'thisMonth': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start, end };
    }
    case 'lastMonth': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        start,
        end: new Date(
          lastDay.getFullYear(),
          lastDay.getMonth(),
          lastDay.getDate(),
          23,
          59,
          59,
          999,
        ),
      };
    }
    case 'thisYear': {
      const start = new Date(today.getFullYear(), 0, 1);
      return { start, end };
    }
  }
};

const detectTimeRange = (startDate: Date, endDate: Date): TimeRange | null => {
  // Check each preset
  const presets: TimeRange[] = [
    'today',
    'yesterday',
    'last7Days',
    'last30Days',
    'last90Days',
    'thisWeek',
    'lastWeek',
    'thisMonth',
    'lastMonth',
    'thisYear',
  ];

  for (const preset of presets) {
    const { start, end } = getPresetRange(preset);
    if (start.getTime() === startDate.getTime() && end.getTime() === endDate.getTime()) {
      return preset;
    }
  }

  return null;
};

const formatOperationPrimary = (row: AuditLogEntry, t: TFunction) => {
  const customKey = `logs.operations.custom.${row.action}`;
  const customLabel = t(customKey);
  if (customLabel !== customKey) {
    return customLabel.toLowerCase();
  }

  const [entityKey, verbKey] = row.action.split('.');
  if (!entityKey || !verbKey) {
    return humanizeToken(row.action);
  }

  const verbLabel = t(`logs.operations.verbs.${verbKey}`, {
    defaultValue: humanizeToken(verbKey),
  });

  const targetLabel = row.details?.targetLabel;
  if (targetLabel) {
    const entityLabel = t(`logs.operations.entities.${entityKey}`, {
      defaultValue: humanizeToken(entityKey),
    });
    return `${verbLabel.toLowerCase()} ${entityLabel}: ${targetLabel}`;
  }

  const entityLabel = t(`logs.operations.entities.${entityKey}`, {
    defaultValue: humanizeToken(entityKey),
  });
  return `${verbLabel.toLowerCase()} ${entityLabel}`;
};

const LogsView: React.FC = () => {
  const { t, i18n } = useTranslation(['administration', 'common']);
  const [activeTab, setActiveTab] = useState<'audit'>('audit');
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const initialLoadRef = useRef(true);
  const [selectedPreset, setSelectedPreset] = useState<TimeRange | null>('last7Days');
  const [startDate, setStartDate] = useState<Date>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    date.setHours(0, 0, 0, 0);
    return date;
  });
  const [endDate, setEndDate] = useState<Date>(() => {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    return date;
  });

  const timeRangeOptions = useMemo(
    () => [
      { id: 'today', name: t('logs.timeRanges.today') },
      { id: 'yesterday', name: t('logs.timeRanges.yesterday') },
      { id: 'last7Days', name: t('logs.timeRanges.last7Days') },
      { id: 'last30Days', name: t('logs.timeRanges.last30Days') },
      { id: 'last90Days', name: t('logs.timeRanges.last90Days') },
      { id: 'thisWeek', name: t('logs.timeRanges.thisWeek') },
      { id: 'lastWeek', name: t('logs.timeRanges.lastWeek') },
      { id: 'thisMonth', name: t('logs.timeRanges.thisMonth') },
      { id: 'lastMonth', name: t('logs.timeRanges.lastMonth') },
      { id: 'thisYear', name: t('logs.timeRanges.thisYear') },
    ],
    [t],
  );

  const handleTimeRangeChange = useCallback((value: string | string[]) => {
    const range = (Array.isArray(value) ? value[0] : value) as TimeRange;
    setSelectedPreset(range);
    const { start, end } = getPresetRange(range);
    setStartDate(start);
    setEndDate(end);
  }, []);

  const handleStartDateChange = useCallback((date: Date) => {
    setStartDate(date);
    setSelectedPreset(null);
  }, []);

  const handleEndDateChange = useCallback((date: Date) => {
    setEndDate(date);
    setSelectedPreset(null);
  }, []);

  const handleStartDateClear = useCallback(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    date.setHours(0, 0, 0, 0);
    setStartDate(date);
    setSelectedPreset(null);
  }, []);

  const handleEndDateClear = useCallback(() => {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    setEndDate(date);
    setSelectedPreset(null);
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setError('');
    try {
      const data = await logsApi.listAudit({ startDate, endDate });
      setRows(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('logs.errors.loadFailed');
      setError(message || t('logs.errors.loadFailed'));
    }
  }, [t, startDate, endDate]);

  useEffect(() => {
    const load = async () => {
      if (initialLoadRef.current) {
        setLoading(true);
        await loadAuditLogs();
        setLoading(false);
        initialLoadRef.current = false;
      } else {
        setIsRefreshing(true);
        await loadAuditLogs();
        setIsRefreshing(false);
      }
    };

    void load();
  }, [loadAuditLogs]);

  const handleRefreshLogs = async () => {
    setIsRefreshing(true);
    await loadAuditLogs();
    setIsRefreshing(false);
  };

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }),
    [i18n.language],
  );

  const columns = useMemo<Column<AuditLogEntry>[]>(
    () => [
      {
        header: t('logs.columns.username'),
        accessorKey: 'username',
      },
      {
        header: t('logs.columns.operation'),
        id: 'operation',
        accessorFn: (row) => formatOperationPrimary(row, t),
        className: 'min-w-[18rem]',
      },
      {
        header: t('logs.columns.ip'),
        accessorKey: 'ipAddress',
        className: 'font-mono text-xs',
      },
      {
        header: t('logs.columns.timestamp'),
        id: 'createdAt',
        accessorFn: (row) => new Date(row.createdAt).getTime(),
        cell: ({ row }) => dateTimeFormatter.format(new Date(row.createdAt)),
        filterFormat: (value) => dateTimeFormatter.format(new Date(Number(value))),
      },
    ],
    [dateTimeFormatter, t],
  );

  const detectedRange = useMemo(() => detectTimeRange(startDate, endDate), [startDate, endDate]);

  const dropdownValue = selectedPreset ?? detectedRange ?? '';

  const refreshButton = (
    <div className="flex items-center gap-3">
      <DatePickerButton
        label={t('logs.filters.startDate')}
        value={startDate}
        onChange={handleStartDateChange}
        onClear={handleStartDateClear}
      />
      <i className="fa-solid fa-arrow-right text-slate-300 text-sm" />
      <DatePickerButton
        label={t('logs.filters.endDate')}
        value={endDate}
        onChange={handleEndDateChange}
        onClear={handleEndDateClear}
      />
      <CustomSelect
        options={timeRangeOptions}
        value={dropdownValue}
        onChange={handleTimeRangeChange}
        displayValue={dropdownValue ? undefined : t('logs.timeRanges.custom')}
        buttonClassName="h-10 px-3 text-sm font-semibold !bg-white"
      />
      <button
        type="button"
        onClick={handleRefreshLogs}
        disabled={loading || isRefreshing}
        className="h-10 px-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <i className={`fa-solid ${isRefreshing ? 'fa-circle-notch fa-spin' : 'fa-rotate-right'}`} />
        {t('common:buttons.refresh')}
      </button>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">{t('logs.title')}</h2>
        <p className="text-slate-500 mt-1">{t('logs.subtitle')}</p>
      </div>

      <div className="flex border-b border-slate-200 gap-8">
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'audit' ? 'text-praetor' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fa-solid fa-shield-halved mr-2"></i>
          {t('logs.tabs.audit')}
          {activeTab === 'audit' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
          )}
        </button>
      </div>

      {activeTab === 'audit' && (
        <>
          {error && <div className="text-sm font-medium text-red-600">{error}</div>}

          {loading ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-slate-500">
              <i className="fa-solid fa-circle-notch fa-spin mr-2" />
              {t('logs.loading')}
            </div>
          ) : (
            <StandardTable<AuditLogEntry>
              title={t('logs.tabs.audit')}
              data={rows}
              columns={columns}
              headerAction={refreshButton}
              emptyState={
                <div className="p-8 text-center text-slate-500 text-sm font-medium">
                  {t('logs.empty')}
                </div>
              }
            />
          )}
        </>
      )}
    </div>
  );
};

export default LogsView;
