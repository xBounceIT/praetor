import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logsApi } from '../../services/api';
import type { AuditLogEntry } from '../../types';

const LogsView: React.FC = () => {
  const { t, i18n } = useTranslation('administration');
  const [activeTab, setActiveTab] = useState<'audit'>('audit');
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await logsApi.listAudit();
        setRows(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : t('logs.errors.loadFailed');
        setError(message || t('logs.errors.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [t]);

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }),
    [i18n.language],
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">{t('logs.title')}</h2>
        <p className="text-slate-500 mt-1">{t('logs.subtitle')}</p>
      </div>

      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'audit'
              ? 'bg-praetor text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
          }`}
        >
          {t('logs.tabs.audit')}
        </button>
      </div>

      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-500">
              <i className="fa-solid fa-circle-notch fa-spin mr-2" />
              {t('logs.loading')}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-red-600">{error}</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-slate-500">{t('logs.empty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">
                      {t('logs.columns.user')}
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">
                      {t('logs.columns.username')}
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">
                      {t('logs.columns.ip')}
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">
                      {t('logs.columns.timestamp')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-slate-800">{entry.userName}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.username}</td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        {entry.ipAddress}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {dateTimeFormatter.format(new Date(entry.createdAt))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LogsView;
