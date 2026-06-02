import type { TFunction } from 'i18next';
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logsApi } from '../../services/api/logs';
import type { AuditLogEntry } from '../../types';
import DatePickerButton from '../shared/DatePickerButton';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import { TABLE_CONTROL_BUTTON_CLASSNAME } from '../shared/tableControlStyles';
import { Button } from '../ui/button';

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
      const diff = endOfLastWeek.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek);
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

  const [entityKey, verbKey, suffixKey] = row.action.split('.');
  if (!entityKey || !verbKey) {
    return humanizeToken(row.action);
  }

  const verbLabel = t(`logs.operations.verbs.${verbKey}`, {
    defaultValue: humanizeToken(verbKey),
  });

  // For 3-part actions (e.g. `client_offer.update.conflict`) append a suffix like
  // "(denied)" or "(conflict)" so the failed-operation rows are distinguishable in the table.
  const suffixSuffix = suffixKey
    ? t(`logs.operations.suffixes.${suffixKey}`, { defaultValue: '' })
    : '';

  const entityLabel = t(`logs.operations.entities.${entityKey}`, {
    defaultValue: humanizeToken(entityKey),
  });

  const targetLabel = row.details?.targetLabel;
  const base = targetLabel
    ? `${verbLabel.toLowerCase()} ${entityLabel}: ${targetLabel}`
    : `${verbLabel.toLowerCase()} ${entityLabel}`;

  return suffixSuffix ? `${base} ${suffixSuffix}` : base;
};

interface LogsViewProps {
  startOfWeek?: 'Monday' | 'Sunday';
  treatSaturdayAsHoliday?: boolean;
}

type LogsViewState = {
  rows: AuditLogEntry[];
  loading: boolean;
  error: string;
  isRefreshing: boolean;
  selectedPreset: TimeRange | null;
  startDate: Date;
  endDate: Date;
};

type LogsViewAction =
  | { type: 'loadStart'; initial: boolean }
  | { type: 'loadSuccess'; rows: AuditLogEntry[] }
  | { type: 'loadError'; error: string }
  | { type: 'selectPreset'; range: TimeRange }
  | { type: 'setStartDate'; date: Date }
  | { type: 'setEndDate'; date: Date };

const createLogsViewState = (): LogsViewState => {
  const range = getPresetRange('last7Days');
  return {
    rows: [],
    loading: true,
    error: '',
    isRefreshing: false,
    selectedPreset: 'last7Days',
    startDate: range.start,
    endDate: range.end,
  };
};

const logsViewReducer = (state: LogsViewState, action: LogsViewAction): LogsViewState => {
  switch (action.type) {
    case 'loadStart':
      return {
        ...state,
        error: '',
        loading: action.initial,
        isRefreshing: !action.initial,
      };
    case 'loadSuccess':
      return {
        ...state,
        rows: action.rows,
        loading: false,
        isRefreshing: false,
      };
    case 'loadError':
      return {
        ...state,
        error: action.error,
        loading: false,
        isRefreshing: false,
      };
    case 'selectPreset': {
      const { start, end } = getPresetRange(action.range);
      return { ...state, selectedPreset: action.range, startDate: start, endDate: end };
    }
    case 'setStartDate':
      return { ...state, startDate: action.date, selectedPreset: null };
    case 'setEndDate':
      return { ...state, endDate: action.date, selectedPreset: null };
  }
};

const LogsView: React.FC<LogsViewProps> = ({
  startOfWeek = 'Monday',
  treatSaturdayAsHoliday = false,
}) => {
  const { t, i18n } = useTranslation(['administration', 'common']);
  const [activeTab, setActiveTab] = useState<'audit'>('audit');
  const [state, dispatch] = useReducer(logsViewReducer, undefined, createLogsViewState);
  const initialLoadRef = useRef(true);
  const latestAuditRequestIdRef = useRef(0);
  const { rows, loading, error, isRefreshing, selectedPreset, startDate, endDate } = state;

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
    dispatch({ type: 'selectPreset', range });
  }, []);

  const handleStartDateChange = useCallback((date: Date) => {
    dispatch({ type: 'setStartDate', date });
  }, []);

  const handleEndDateChange = useCallback((date: Date) => {
    dispatch({ type: 'setEndDate', date });
  }, []);

  const handleStartDateClear = useCallback(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    date.setHours(0, 0, 0, 0);
    dispatch({ type: 'setStartDate', date });
  }, []);

  const handleEndDateClear = useCallback(() => {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    dispatch({ type: 'setEndDate', date });
  }, []);

  const loadAuditLogs = useCallback(
    async (requestId: number) => {
      try {
        const data = await logsApi.listAudit({ startDate, endDate });
        const isLatest = latestAuditRequestIdRef.current === requestId;
        if (isLatest) {
          dispatch({ type: 'loadSuccess', rows: data });
        }
        return isLatest;
      } catch (err) {
        const isLatest = latestAuditRequestIdRef.current === requestId;
        if (isLatest) {
          const message = err instanceof Error ? err.message : t('logs.errors.loadFailed');
          dispatch({ type: 'loadError', error: message || t('logs.errors.loadFailed') });
        }
        return isLatest;
      }
    },
    [t, startDate, endDate],
  );

  useEffect(() => {
    const requestId = latestAuditRequestIdRef.current + 1;
    latestAuditRequestIdRef.current = requestId;
    const isInitialLoad = initialLoadRef.current;

    const load = async () => {
      dispatch({ type: 'loadStart', initial: isInitialLoad });
      const isCurrent = await loadAuditLogs(requestId);
      if (isCurrent && isInitialLoad) {
        initialLoadRef.current = false;
      }
    };

    void load();
    return () => {
      latestAuditRequestIdRef.current += 1;
    };
  }, [loadAuditLogs]);

  const handleRefreshLogs = async () => {
    const requestId = latestAuditRequestIdRef.current + 1;
    latestAuditRequestIdRef.current = requestId;
    dispatch({ type: 'loadStart', initial: false });
    await loadAuditLogs(requestId);
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
        header: t('logs.columns.timestamp'),
        id: 'createdAt',
        accessorFn: (row) => new Date(row.createdAt).getTime(),
        cell: ({ row }) => dateTimeFormatter.format(new Date(row.createdAt)),
        filterFormat: (value) => dateTimeFormatter.format(new Date(Number(value))),
      },
      {
        header: t('logs.columns.username'),
        accessorKey: 'username',
      },
      {
        header: t('logs.columns.ip'),
        accessorKey: 'ipAddress',
        className: 'font-mono text-xs',
      },
      {
        header: t('logs.columns.operation'),
        id: 'operation',
        accessorFn: (row) => formatOperationPrimary(row, t),
        className: 'min-w-[18rem]',
        align: 'left',
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
        buttonClassName={TABLE_CONTROL_BUTTON_CLASSNAME}
        startOfWeek={startOfWeek}
        treatSaturdayAsHoliday={treatSaturdayAsHoliday}
      />
      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <DatePickerButton
        label={t('logs.filters.endDate')}
        value={endDate}
        onChange={handleEndDateChange}
        onClear={handleEndDateClear}
        buttonClassName={TABLE_CONTROL_BUTTON_CLASSNAME}
        startOfWeek={startOfWeek}
        treatSaturdayAsHoliday={treatSaturdayAsHoliday}
      />
      <SelectControl
        options={timeRangeOptions}
        value={dropdownValue}
        onChange={handleTimeRangeChange}
        displayValue={dropdownValue ? undefined : t('logs.timeRanges.custom')}
        buttonClassName={TABLE_CONTROL_BUTTON_CLASSNAME}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRefreshLogs}
        disabled={loading || isRefreshing}
        className={TABLE_CONTROL_BUTTON_CLASSNAME}
      >
        {isRefreshing ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="size-3.5" aria-hidden="true" />
        )}
        {t('common:buttons.refresh')}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-800">{t('logs.title')}</h2>
        <p className="text-zinc-500 mt-1">{t('logs.subtitle')}</p>
      </div>

      <div className="flex border-b border-zinc-200 gap-8">
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`pb-4 text-sm font-bold transition-all relative ${activeTab === 'audit' ? 'text-praetor' : 'text-zinc-400 hover:text-zinc-600'}`}
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
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-8 text-center text-zinc-500">
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
                <div className="p-8 text-center text-zinc-500 text-sm font-medium">
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
