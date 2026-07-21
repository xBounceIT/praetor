import type React from 'react';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supplierOrdersApi } from '../../services/api/supplierOrders';
import type { SupplierOrderVersion, SupplierOrderVersionRow, SupplierSaleOrder } from '../../types';
import { asyncRowsReducer, createInitialAsyncRowsState } from '../shared/asyncRowsState';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';

interface SupplierOrderVersionsPanelProps {
  orderId: string;
  selectedVersionId: string | null;
  onPreview: (version: SupplierOrderVersion) => void;
  onClearPreview: () => void;
  onRestored: (updatedOrder: SupplierSaleOrder) => void;
  disabled?: boolean;
}

const SupplierOrderVersionsPanel: React.FC<SupplierOrderVersionsPanelProps> = ({
  orderId,
  selectedVersionId,
  onPreview,
  onClearPreview,
  onRestored,
  disabled,
}) => {
  const { t, i18n } = useTranslation('accounting');
  const [historyState, dispatchHistory] = useReducer(
    asyncRowsReducer<SupplierOrderVersionRow>,
    createInitialAsyncRowsState<SupplierOrderVersionRow>(),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    dispatchHistory({ type: 'loading' });
    try {
      const versions = await supplierOrdersApi.listVersions(orderId);
      dispatchHistory({ type: 'loaded', rows: versions });
    } catch {
      dispatchHistory({ type: 'failed', error: t('supplierOrders.versionHistory.loadFailed') });
    }
  }, [orderId, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSelect = useCallback(
    async (row: SupplierOrderVersionRow) => {
      if (row.id === selectedVersionId) return;
      try {
        const version = await supplierOrdersApi.getVersion(orderId, row.id);
        dispatchHistory({ type: 'setError', error: null });
        onPreview(version);
      } catch {
        dispatchHistory({ type: 'setError', error: t('supplierOrders.versionHistory.loadFailed') });
      }
    },
    [orderId, onPreview, selectedVersionId, t],
  );

  const handleRestoreConfirmed = useCallback(async () => {
    if (!selectedVersionId) return;
    setRestoreInFlight(true);
    try {
      const updated = await supplierOrdersApi.restoreVersion(orderId, selectedVersionId);
      dispatchHistory({ type: 'setError', error: null });
      onRestored(updated);
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      // Restore failures (409 linked-invoice / 409 non-draft / 409 missing snapshot ref / 404)
      // carry actionable server messages - surface them instead of a generic load error.
      dispatchHistory({
        type: 'setError',
        error:
          e instanceof Error && e.message
            ? e.message
            : t('supplierOrders.versionHistory.loadFailed'),
      });
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, orderId, onRestored, reload, t]);

  return (
    <>
      <VersionHistoryPanel
        persistenceKey="supplierOrders.versions"
        rows={historyState.rows}
        selectedVersionId={selectedVersionId}
        isLoading={historyState.isLoading}
        error={historyState.error}
        locale={i18n.language}
        disabled={disabled}
        restoreInFlight={restoreInFlight}
        labels={{
          title: t('supplierOrders.versionHistory.title'),
          empty: t('supplierOrders.versionHistory.empty'),
          reasonRestore: t('supplierOrders.versionHistory.reasonRestore'),
          reasonUpdate: t('supplierOrders.versionHistory.reasonUpdate'),
          backToCurrent: t('supplierOrders.versionHistory.backToCurrent'),
          restoreButton: t('supplierOrders.versionHistory.restoreButton'),
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
        title={t('supplierOrders.versionHistory.restoreConfirmTitle')}
        description={t('supplierOrders.versionHistory.restoreConfirmDescription')}
      />
    </>
  );
};

export default SupplierOrderVersionsPanel;
