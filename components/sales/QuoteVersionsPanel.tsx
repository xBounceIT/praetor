import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clientQuotesApi } from '../../services/api/clientQuotes';
import type { Quote, QuoteVersion, QuoteVersionRow } from '../../types';
import { formatInsertDateTime } from '../../utils/date';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';

interface QuoteVersionsPanelProps {
  quoteId: string;
  selectedVersionId: string | null;
  onPreview: (version: QuoteVersion) => void;
  onClearPreview: () => void;
  onRestored: (updatedQuote: Quote) => void;
  disabled?: boolean;
}

const QuoteVersionsPanel: React.FC<QuoteVersionsPanelProps> = ({
  quoteId,
  selectedVersionId,
  onPreview,
  onClearPreview,
  onRestored,
  disabled,
}) => {
  const { t, i18n } = useTranslation('sales');
  const [rows, setRows] = useState<QuoteVersionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const versions = await clientQuotesApi.listVersions(quoteId);
      setRows(versions);
    } catch {
      setError(t('clientQuotes.versionHistory.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [quoteId, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSelect = useCallback(
    async (row: QuoteVersionRow) => {
      if (row.id === selectedVersionId) return;
      try {
        const version = await clientQuotesApi.getVersion(quoteId, row.id);
        setError(null);
        onPreview(version);
      } catch {
        setError(t('clientQuotes.versionHistory.loadFailed'));
      }
    },
    [quoteId, onPreview, selectedVersionId, t],
  );

  const handleRestoreConfirmed = useCallback(async () => {
    if (!selectedVersionId) return;
    setRestoreInFlight(true);
    try {
      const updated = await clientQuotesApi.restoreVersion(quoteId, selectedVersionId);
      setError(null);
      onRestored(updated);
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      // Restore failures (409 linked-offer / 409 confirmed / 409 non-draft sale / 404)
      // carry actionable server messages — surface them instead of a generic load error.
      setError(
        e instanceof Error && e.message ? e.message : t('clientQuotes.versionHistory.loadFailed'),
      );
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, quoteId, onRestored, reload, t]);

  return (
    <>
      <div className="hidden 2xl:flex w-72 max-h-[90vh] flex-col flex-shrink-0 rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in slide-in-from-right duration-200">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
            <i className="fa-solid fa-clock-rotate-left text-praetor"></i>
            {t('clientQuotes.versionHistory.title')}
          </h4>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {rows.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-6 text-xs text-slate-400 text-center">
              <i className="fa-solid fa-spinner fa-spin"></i>
            </div>
          )}
          {error && !isLoading && (
            <div className="m-3 p-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg">
              {error}
            </div>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <div className="p-6 text-xs text-slate-400 text-center leading-relaxed">
              {t('clientQuotes.versionHistory.empty')}
            </div>
          )}
          {!isLoading && !error && rows.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => {
                const selected = row.id === selectedVersionId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(row)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex flex-col gap-1 ${
                        selected ? 'bg-praetor/5 border-l-4 border-praetor pl-3' : ''
                      }`}
                    >
                      <span className="text-xs font-bold text-slate-700">
                        {formatInsertDateTime(row.createdAt, i18n.language)}
                      </span>
                      <span
                        className={`text-[9px] font-black uppercase tracking-wider ${
                          row.reason === 'restore' ? 'text-amber-600' : 'text-slate-400'
                        }`}
                      >
                        {row.reason === 'restore'
                          ? t('clientQuotes.versionHistory.reasonRestore')
                          : t('clientQuotes.versionHistory.reasonUpdate')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {selectedVersionId && (
          <div className="border-t border-slate-100 p-3 space-y-2 bg-slate-50/50">
            <button
              type="button"
              onClick={onClearPreview}
              className="w-full py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <i className="fa-solid fa-arrow-left mr-1.5"></i>
              {t('clientQuotes.versionHistory.backToCurrent')}
            </button>
            <button
              type="button"
              disabled={Boolean(disabled) || restoreInFlight}
              onClick={() => setConfirmOpen(true)}
              className="w-full py-2 bg-praetor text-white text-xs font-bold rounded-lg shadow-md shadow-slate-200 hover:bg-slate-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <i className="fa-solid fa-rotate-left mr-1.5"></i>
              {t('clientQuotes.versionHistory.restoreButton')}
            </button>
          </div>
        )}
      </div>
      <DeleteConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleRestoreConfirmed}
        title={t('clientQuotes.versionHistory.restoreConfirmTitle')}
        description={t('clientQuotes.versionHistory.restoreConfirmDescription')}
      />
    </>
  );
};

export default QuoteVersionsPanel;
