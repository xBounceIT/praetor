import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clientsOrdersApi } from '../../services/api/clientsOrders';
import type { ClientsOrder, OrderVersion, OrderVersionRow } from '../../types';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import { VersionHistoryPanel } from '../shared/VersionHistoryPanel';

interface OrderVersionsPanelProps {
  orderId: string;
  selectedVersionId: string | null;
  onPreview: (version: OrderVersion) => void;
  onClearPreview: () => void;
  onRestored: (updatedOrder: ClientsOrder) => void;
  disabled?: boolean;
}

const OrderVersionsPanel: React.FC<OrderVersionsPanelProps> = ({
  orderId,
  selectedVersionId,
  onPreview,
  onClearPreview,
  onRestored,
  disabled,
}) => {
  const { t, i18n } = useTranslation('accounting');
  const [rows, setRows] = useState<OrderVersionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const versions = await clientsOrdersApi.listVersions(orderId);
      setRows(versions);
    } catch {
      setError(t('clientsOrders.versionHistory.loadFailed'));
    } finally {
      setIsLoading(false);
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
        setError(null);
        onPreview(version);
      } catch {
        setError(t('clientsOrders.versionHistory.loadFailed'));
      }
    },
    [orderId, onPreview, selectedVersionId, t],
  );

  const handleRestoreConfirmed = useCallback(async () => {
    if (!selectedVersionId) return;
    setRestoreInFlight(true);
    try {
      const updated = await clientsOrdersApi.restoreVersion(orderId, selectedVersionId);
      setError(null);
      onRestored(updated);
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : t('clientsOrders.versionHistory.loadFailed'),
      );
    } finally {
      setRestoreInFlight(false);
    }
  }, [selectedVersionId, orderId, onRestored, reload, t]);

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
          title: t('clientsOrders.versionHistory.title'),
          empty: t('clientsOrders.versionHistory.empty'),
          reasonRestore: t('clientsOrders.versionHistory.reasonRestore'),
          reasonUpdate: t('clientsOrders.versionHistory.reasonUpdate'),
          backToCurrent: t('clientsOrders.versionHistory.backToCurrent'),
          restoreButton: t('clientsOrders.versionHistory.restoreButton'),
        }}
        onSelect={handleSelect}
        onClearPreview={onClearPreview}
        onRestore={() => setConfirmOpen(true)}
      />
      <DeleteConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleRestoreConfirmed}
        title={t('clientsOrders.versionHistory.restoreConfirmTitle')}
        description={t('clientsOrders.versionHistory.restoreConfirmDescription')}
      />
    </>
  );
};

export default OrderVersionsPanel;
