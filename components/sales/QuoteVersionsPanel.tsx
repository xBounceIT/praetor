import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clientQuotesApi } from '../../services/api/clientQuotes';
import type { Quote, QuoteVersion, QuoteVersionRow } from '../../types';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';

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
      // carry actionable server messages - surface them instead of a generic load error.
      setError(
        e instanceof Error && e.message ? e.message : t('clientQuotes.versionHistory.loadFailed'),
      );
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, quoteId, onRestored, reload, t]);

  return (
    <>
      <VersionHistoryPanel
        rows={rows}
        selectedVersionId={selectedVersionId}
        isLoading={isLoading}
        error={error}
        locale={i18n.language}
        disabled={disabled}
        restoreInFlight={restoreInFlight}
        labels={{
          title: t('clientQuotes.versionHistory.title'),
          empty: t('clientQuotes.versionHistory.empty'),
          reasonRestore: t('clientQuotes.versionHistory.reasonRestore'),
          reasonUpdate: t('clientQuotes.versionHistory.reasonUpdate'),
          backToCurrent: t('clientQuotes.versionHistory.backToCurrent'),
          restoreButton: t('clientQuotes.versionHistory.restoreButton'),
        }}
        onSelect={handleSelect}
        onClearPreview={onClearPreview}
        onRestore={() => setConfirmOpen(true)}
      />
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
