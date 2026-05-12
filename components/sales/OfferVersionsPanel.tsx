import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clientOffersApi } from '../../services/api/clientOffers';
import type { ClientOffer, OfferVersion, OfferVersionRow } from '../../types';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';

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
      // messages - surface them instead of a generic load error.
      setError(
        e instanceof Error && e.message ? e.message : t('clientOffers.versionHistory.loadFailed'),
      );
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, offerId, onRestored, reload, t]);

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
          title: t('clientOffers.versionHistory.title'),
          empty: t('clientOffers.versionHistory.empty'),
          reasonRestore: t('clientOffers.versionHistory.reasonRestore'),
          reasonUpdate: t('clientOffers.versionHistory.reasonUpdate'),
          backToCurrent: t('clientOffers.versionHistory.backToCurrent'),
          restoreButton: t('clientOffers.versionHistory.restoreButton'),
        }}
        onSelect={handleSelect}
        onClearPreview={onClearPreview}
        onRestore={() => setConfirmOpen(true)}
      />
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
