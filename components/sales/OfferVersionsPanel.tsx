import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clientOffersApi } from '../../services/api/clientOffers';
import type { ClientOffer, OfferVersion, OfferVersionRow } from '../../types';
import { formatInsertDateTime } from '../../utils/date';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';

interface OfferVersionsPanelProps {
  offerId: string;
  selectedVersionId: string | null;
  onPreview: (version: OfferVersion) => void;
  onClearPreview: () => void;
  onRestored: (updatedOffer: ClientOffer) => void;
  disabled?: boolean;
}

const OfferVersionsPanel: React.FC<OfferVersionsPanelProps> = ({
  offerId,
  selectedVersionId,
  onPreview,
  onClearPreview,
  onRestored,
  disabled,
}) => {
  const { t, i18n } = useTranslation('sales');
  const [rows, setRows] = useState<OfferVersionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const versions = await clientOffersApi.listVersions(offerId);
      setRows(versions);
    } catch {
      setError(t('clientOffers.versionHistory.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [offerId, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSelect = useCallback(
    async (row: OfferVersionRow) => {
      if (row.id === selectedVersionId) return;
      try {
        const version = await clientOffersApi.getVersion(offerId, row.id);
        setError(null);
        onPreview(version);
      } catch {
        setError(t('clientOffers.versionHistory.loadFailed'));
      }
    },
    [offerId, onPreview, selectedVersionId, t],
  );

  const handleRestoreConfirmed = useCallback(async () => {
    if (!selectedVersionId) return;
    setRestoreInFlight(true);
    try {
      const updated = await clientOffersApi.restoreVersion(offerId, selectedVersionId);
      setError(null);
      onRestored(updated);
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      // Restore failures (409 non-draft / 409 linked sale / 404) carry actionable server
      // messages — surface them instead of a generic load error.
      setError(
        e instanceof Error && e.message ? e.message : t('clientOffers.versionHistory.loadFailed'),
      );
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, offerId, onRestored, reload, t]);

  return (
    <>
      <div className="hidden 2xl:flex w-72 max-h-[90vh] flex-col flex-shrink-0 rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in slide-in-from-right duration-200">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
            <i className="fa-solid fa-clock-rotate-left text-praetor"></i>
            {t('clientOffers.versionHistory.title')}
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
              {t('clientOffers.versionHistory.empty')}
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
                          ? t('clientOffers.versionHistory.reasonRestore')
                          : t('clientOffers.versionHistory.reasonUpdate')}
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
              {t('clientOffers.versionHistory.backToCurrent')}
            </button>
            <button
              type="button"
              disabled={Boolean(disabled) || restoreInFlight}
              onClick={() => setConfirmOpen(true)}
              className="w-full py-2 bg-praetor text-white text-xs font-bold rounded-lg shadow-md shadow-slate-200 hover:bg-slate-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <i className="fa-solid fa-rotate-left mr-1.5"></i>
              {t('clientOffers.versionHistory.restoreButton')}
            </button>
          </div>
        )}
      </div>
      <DeleteConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleRestoreConfirmed}
        title={t('clientOffers.versionHistory.restoreConfirmTitle')}
        description={t('clientOffers.versionHistory.restoreConfirmDescription')}
      />
    </>
  );
};

export default OfferVersionsPanel;
