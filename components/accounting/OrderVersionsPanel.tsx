import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { clientsOrdersApi } from '../../services/api/clientsOrders';
import type { ClientsOrder, OrderVersion, OrderVersionRow } from '../../types';
import { formatInsertDateTime } from '../../utils/date';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';

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
      <div className="hidden max-h-[90vh] w-72 flex-shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-lg animate-in fade-in slide-in-from-right duration-200 2xl:flex">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <i className="fa-solid fa-clock-rotate-left text-primary" aria-hidden="true"></i>
            {t('clientsOrders.versionHistory.title')}
          </h4>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {rows.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            </div>
          )}
          {error && !isLoading && (
            <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <div className="p-6 text-center text-xs leading-relaxed text-muted-foreground">
              {t('clientsOrders.versionHistory.empty')}
            </div>
          )}
          {!isLoading && !error && rows.length > 0 && (
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const selected = row.id === selectedVersionId;
                return (
                  <li key={row.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleSelect(row)}
                      className={`h-auto w-full flex-col items-start justify-start rounded-none px-4 py-3 text-left ${
                        selected ? 'border-l-4 border-primary bg-primary/5 pl-3' : ''
                      }`}
                    >
                      <span className="text-xs font-semibold text-foreground">
                        {formatInsertDateTime(row.createdAt, i18n.language)}
                      </span>
                      <span
                        className={`text-[9px] font-semibold uppercase tracking-wider ${
                          row.reason === 'restore' ? 'text-amber-600' : 'text-muted-foreground'
                        }`}
                      >
                        {row.reason === 'restore'
                          ? t('clientsOrders.versionHistory.reasonRestore')
                          : t('clientsOrders.versionHistory.reasonUpdate')}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {selectedVersionId && (
          <div className="space-y-2 border-t border-border bg-muted/30 p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClearPreview}
              className="w-full"
            >
              <i className="fa-solid fa-arrow-left" aria-hidden="true"></i>
              {t('clientsOrders.versionHistory.backToCurrent')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled || restoreInFlight}
              onClick={() => setConfirmOpen(true)}
              className="w-full"
            >
              <i className="fa-solid fa-rotate-left" aria-hidden="true"></i>
              {t('clientsOrders.versionHistory.restoreButton')}
            </Button>
          </div>
        )}
      </div>
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
