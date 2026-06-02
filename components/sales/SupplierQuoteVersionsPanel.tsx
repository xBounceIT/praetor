import type React from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supplierQuotesApi } from '../../services/api/supplierQuotes';
import type { SupplierQuote, SupplierQuoteVersion, SupplierQuoteVersionRow } from '../../types';
import { asyncRowsReducer, createInitialAsyncRowsState } from '../shared/asyncRowsState';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';

interface SupplierQuoteVersionsPanelProps {
  quoteId: string;
  selectedVersionId: string | null;
  onPreview: (version: SupplierQuoteVersion) => void;
  onClearPreview: () => void;
  onRestored: (updatedQuote: SupplierQuote) => void;
  disabled?: boolean;
}

const SupplierQuoteVersionsPanel: React.FC<SupplierQuoteVersionsPanelProps> = ({
  quoteId,
  selectedVersionId,
  onPreview,
  onClearPreview,
  onRestored,
  disabled,
}) => {
  const { t, i18n } = useTranslation('sales');
  const tRef = useRef(t);
  tRef.current = t;
  const [historyState, dispatchHistory] = useReducer(
    asyncRowsReducer<SupplierQuoteVersionRow>,
    createInitialAsyncRowsState<SupplierQuoteVersionRow>(),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    dispatchHistory({ type: 'loading' });
    try {
      const versions = await supplierQuotesApi.listVersions(quoteId);
      dispatchHistory({ type: 'loaded', rows: versions });
    } catch {
      dispatchHistory({
        type: 'failed',
        error: tRef.current('supplierQuotes.versionHistory.loadFailed'),
      });
    }
  }, [quoteId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSelect = useCallback(
    async (row: SupplierQuoteVersionRow) => {
      if (row.id === selectedVersionId) return;
      try {
        const version = await supplierQuotesApi.getVersion(quoteId, row.id);
        dispatchHistory({ type: 'setError', error: null });
        onPreview(version);
      } catch {
        dispatchHistory({ type: 'setError', error: t('supplierQuotes.versionHistory.loadFailed') });
      }
    },
    [quoteId, onPreview, selectedVersionId, t],
  );

  const handleRestoreConfirmed = useCallback(async () => {
    if (!selectedVersionId) return;
    setRestoreInFlight(true);
    try {
      const updated = await supplierQuotesApi.restoreVersion(quoteId, selectedVersionId);
      dispatchHistory({ type: 'setError', error: null });
      onRestored(updated);
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      // Restore failures (409 linked-order, 404 missing snapshot reference, etc.) carry
      // actionable server messages - surface them instead of a generic load error.
      dispatchHistory({
        type: 'setError',
        error:
          e instanceof Error && e.message
            ? e.message
            : t('supplierQuotes.versionHistory.loadFailed'),
      });
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, quoteId, onRestored, reload, t]);

  return (
    <>
      <VersionHistoryPanel
        rows={historyState.rows}
        selectedVersionId={selectedVersionId}
        isLoading={historyState.isLoading}
        error={historyState.error}
        locale={i18n.language}
        disabled={disabled}
        restoreInFlight={restoreInFlight}
        labels={{
          title: t('supplierQuotes.versionHistory.title'),
          empty: t('supplierQuotes.versionHistory.empty'),
          reasonRestore: t('supplierQuotes.versionHistory.reasonRestore'),
          reasonUpdate: t('supplierQuotes.versionHistory.reasonUpdate'),
          backToCurrent: t('supplierQuotes.versionHistory.backToCurrent'),
          restoreButton: t('supplierQuotes.versionHistory.restoreButton'),
        }}
        onSelect={handleSelect}
        onClearPreview={onClearPreview}
        onRestore={() => setConfirmOpen(true)}
      />
      <DeleteConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleRestoreConfirmed}
        title={t('supplierQuotes.versionHistory.restoreConfirmTitle')}
        description={t('supplierQuotes.versionHistory.restoreConfirmDescription')}
      />
    </>
  );
};

export default SupplierQuoteVersionsPanel;
