import type React from 'react';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clientOffersApi } from '../../services/api/clientOffers';
import type { ClientOffer, OfferVersion, OfferVersionRow } from '../../types';
import { asyncRowsReducer, createInitialAsyncRowsState } from '../shared/asyncRowsState';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';

type OfferVersionApi = Pick<
  typeof clientOffersApi,
  'listVersions' | 'getVersion' | 'restoreVersion'
>;

interface OfferVersionsPanelProps {
  offerId: string;
  selectedVersionId: string | null;
  onPreview: (version: OfferVersion) => void;
  onClearPreview: () => void;
  onRestored: (updatedOffer: ClientOffer) => void;
  disabled?: boolean;
  embedded?: boolean;
  versionApi?: OfferVersionApi;
}

const OfferVersionsPanel: React.FC<OfferVersionsPanelProps> = ({
  offerId,
  selectedVersionId,
  onPreview,
  onClearPreview,
  onRestored,
  disabled,
  embedded,
  versionApi = clientOffersApi,
}) => {
  const { t, i18n } = useTranslation('sales');
  const [historyState, dispatchHistory] = useReducer(
    asyncRowsReducer<OfferVersionRow>,
    createInitialAsyncRowsState<OfferVersionRow>(),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    dispatchHistory({ type: 'loading' });
    try {
      const versions = await versionApi.listVersions(offerId);
      dispatchHistory({ type: 'loaded', rows: versions });
    } catch {
      dispatchHistory({ type: 'failed', error: t('clientOffers.versionHistory.loadFailed') });
    }
  }, [offerId, t, versionApi]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSelect = useCallback(
    async (row: OfferVersionRow) => {
      if (row.id === selectedVersionId) return;
      try {
        const version = await versionApi.getVersion(offerId, row.id);
        dispatchHistory({ type: 'setError', error: null });
        onPreview(version);
      } catch {
        dispatchHistory({ type: 'setError', error: t('clientOffers.versionHistory.loadFailed') });
      }
    },
    [offerId, onPreview, selectedVersionId, t, versionApi],
  );

  const handleRestoreConfirmed = useCallback(async () => {
    if (!selectedVersionId) return;
    setRestoreInFlight(true);
    try {
      const updated = await versionApi.restoreVersion(offerId, selectedVersionId);
      dispatchHistory({ type: 'setError', error: null });
      onRestored(updated);
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      // Restore failures (409 non-draft / 409 linked sale / 404) carry actionable server
      // messages - surface them instead of a generic load error.
      dispatchHistory({
        type: 'setError',
        error:
          e instanceof Error && e.message ? e.message : t('clientOffers.versionHistory.loadFailed'),
      });
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, offerId, onRestored, reload, t, versionApi]);

  return (
    <>
      <VersionHistoryPanel
        embedded={embedded}
        rows={historyState.rows}
        selectedVersionId={selectedVersionId}
        isLoading={historyState.isLoading}
        error={historyState.error}
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
