import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supplierOrdersApi } from '../../services/api/supplierOrders';
import type { SupplierOrderVersion, SupplierOrderVersionRow, SupplierSaleOrder } from '../../types';
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
  const [rows, setRows] = useState<SupplierOrderVersionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const versions = await supplierOrdersApi.listVersions(orderId);
      setRows(versions);
    } catch {
      setError(t('supplierOrders.versionHistory.loadFailed'));
    } finally {
      setIsLoading(false);
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
        setError(null);
        onPreview(version);
      } catch {
        setError(t('supplierOrders.versionHistory.loadFailed'));
      }
    },
    [orderId, onPreview, selectedVersionId, t],
  );

  const handleRestoreConfirmed = useCallback(async () => {
    if (!selectedVersionId) return;
    setRestoreInFlight(true);
    try {
      const updated = await supplierOrdersApi.restoreVersion(orderId, selectedVersionId);
      setError(null);
      onRestored(updated);
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      // Restore failures (409 linked-invoice / 409 non-draft / 409 missing snapshot ref / 404)
      // carry actionable server messages - surface them instead of a generic load error.
      setError(
        e instanceof Error && e.message ? e.message : t('supplierOrders.versionHistory.loadFailed'),
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
        title={t('supplierOrders.versionHistory.restoreConfirmTitle')}
        description={t('supplierOrders.versionHistory.restoreConfirmDescription')}
      />
    </>
  );
};

export default SupplierOrderVersionsPanel;
