import type React from 'react';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clientsOrdersApi } from '../../services/api/clientsOrders';
import type { ClientsOrder, OrderVersion, OrderVersionRow } from '../../types';
import { asyncRowsReducer, createInitialAsyncRowsState } from '../shared/asyncRowsState';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';

interface OrderVersionsPanelProps {
  orderId: string;
  selectedVersionId: string | null;
  onPreview: (version: OrderVersion) => void;
  onClearPreview: () => void;
  onRestored: (updatedOrder: ClientsOrder) => void;
  disabled?: boolean;
  layout?: 'inline' | 'dialog';
  className?: string;
}

const OrderVersionsPanel: React.FC<OrderVersionsPanelProps> = ({
  orderId,
  selectedVersionId,
  onPreview,
  onClearPreview,
  onRestored,
  disabled,
  layout = 'inline',
  className,
}) => {
  const { t, i18n } = useTranslation('accounting');
  const [historyState, dispatchHistory] = useReducer(
    asyncRowsReducer<OrderVersionRow>,
    createInitialAsyncRowsState<OrderVersionRow>(),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    dispatchHistory({ type: 'loading' });
    try {
      const versions = await clientsOrdersApi.listVersions(orderId);
      dispatchHistory({ type: 'loaded', rows: versions });
    } catch {
      dispatchHistory({ type: 'failed', error: t('clientsOrders.versionHistory.loadFailed') });
    }
  }, [orderId, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSelect = useCallback(
    async (row: OrderVersionRow) => {
      if (row.id === selectedVersionId) return;
      try {
        const version = await clientsOrdersApi.getVersion(orderId, row.id);
        dispatchHistory({ type: 'setError', error: null });
        onPreview(version);
      } catch {
        dispatchHistory({ type: 'setError', error: t('clientsOrders.versionHistory.loadFailed') });
      }
    },
    [orderId, onPreview, selectedVersionId, t],
  );

  const handleRestoreConfirmed = useCallback(async () => {
    if (!selectedVersionId) return;
    setRestoreInFlight(true);
    try {
      const updated = await clientsOrdersApi.restoreVersion(orderId, selectedVersionId);
      dispatchHistory({ type: 'setError', error: null });
      onRestored(updated);
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      dispatchHistory({
        type: 'setError',
        error:
          e instanceof Error && e.message
            ? e.message
            : t('clientsOrders.versionHistory.loadFailed'),
      });
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, orderId, onRestored, reload, t]);

  return (
    <>
      <VersionHistoryPanel
        layout={layout}
        className={className}
        rows={historyState.rows}
        selectedVersionId={selectedVersionId}
        isLoading={historyState.isLoading}
        error={historyState.error}
        locale={i18n.language}
        disabled={disabled}
        restoreInFlight={restoreInFlight}
        labels={{
          title: t('clientsOrders.versionHistory.title'),
          empty: t('clientsOrders.versionHistory.empty'),
          reasonRestore: t('clientsOrders.versionHistory.reasonRestore'),
          reasonUpdate: t('clientsOrders.versionHistory.reasonUpdate'),
          backToCurrent: t('clientsOrders.versionHistory.backToCurrent'),
          restoreButton: t('clientsOrders.versionHistory.restoreButton'),
          searchPlaceholder: t('clientsOrders.versionHistory.searchPlaceholder'),
          searchAriaLabel: t('clientsOrders.versionHistory.searchAriaLabel'),
          noResults: t('clientsOrders.versionHistory.noResults'),
          currentBadge: t('clientsOrders.versionHistory.currentBadge'),
          infoTooltip: t('clientsOrders.versionHistory.infoTooltip'),
        }}
        onSelect={handleSelect}
        onClearPreview={onClearPreview}
        onRestore={() => setConfirmOpen(true)}
      />
      <DeleteConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleRestoreConfirmed}
        zIndex={70}
        title={t('clientsOrders.versionHistory.restoreConfirmTitle')}
        description={t('clientsOrders.versionHistory.restoreConfirmDescription')}
      />
    </>
  );
};

export default OrderVersionsPanel;
