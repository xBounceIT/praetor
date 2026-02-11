import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logsApi } from '../../services/api';
import type { AuditLogEntry } from '../../types';
import StandardTable, { type Column } from '../shared/StandardTable';

const LogsView: React.FC = () => {
  const { t, i18n } = useTranslation(['administration', 'common']);
  const [activeTab, setActiveTab] = useState<'audit'>('audit');
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadAuditLogs = useCallback(async () => {
    setError('');
    try {
      const data = await logsApi.listAudit();
      setRows(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('logs.errors.loadFailed');
      setError(message || t('logs.errors.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await loadAuditLogs();
      setLoading(false);
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
        header: t('logs.columns.user'),
        accessorKey: 'userName',
        disableFiltering: true,
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
        header: t('logs.columns.timestamp'),
        id: 'createdAt',
        accessorFn: (row) => new Date(row.createdAt).getTime(),
        cell: ({ row }) => dateTimeFormatter.format(new Date(row.createdAt)),
        filterFormat: (value) => dateTimeFormatter.format(new Date(Number(value))),
      },
    ],
    [dateTimeFormatter, t],
  );

  const refreshButton = (
    <button
      type="button"
      onClick={handleRefreshLogs}
      disabled={loading || isRefreshing}
      className="h-10 px-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <i className={`fa-solid ${isRefreshing ? 'fa-circle-notch fa-spin' : 'fa-rotate-right'}`} />
      {t('buttons.refresh', { ns: 'common' })}
    </button>
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
