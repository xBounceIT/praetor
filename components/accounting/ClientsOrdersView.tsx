import type { TFunction } from 'i18next';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  Client,
  ClientsOrder,
  ClientsOrderItem,
  OrderVersion,
  Product,
  SupplierUnitType,
} from '../../types';
import {
  addDaysToDateOnly,
  formatDateOnlyForLocale,
  formatInsertDate,
  formatInsertDateTime,
  getLocalDateString,
} from '../../utils/date';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  formatDiscountValue,
  getItemPricingContext,
  type PricingTotals,
  parseNumberInputValue,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';
import { toastError } from '../../utils/toast';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import OrderVersionsPanel from './OrderVersionsPanel';

export interface ClientsOrdersViewProps {
  orders: ClientsOrder[];
  clients: Client[];
  products: Product[];
  onUpdateClientsOrder: (id: string, updates: Partial<ClientsOrder>) => Promise<void>;
  onDeleteClientsOrder: (id: string) => Promise<void>;
  onOrderRestored?: (order: ClientsOrder) => void;
  onViewOffer?: (offerId: string) => void;
  currency: string;
  offerFilterId?: string | null;
  orderFilterId?: string | null;
}

const DEFAULT_UNIT_TYPE: SupplierUnitType = 'hours';

const compactInputClass = 'h-9 text-center font-medium';

const pillBadgeClass =
  'px-2 py-0.5 rounded-full text-white text-[8px] font-black uppercase tracking-wider';

const convertHourlyToUnit = (hourlyPrice: number, unitType: SupplierUnitType | undefined) =>
  convertUnitPrice(hourlyPrice, 'hours', unitType || DEFAULT_UNIT_TYPE);

const getOrderStatusLabel = (status: ClientsOrder['status'], t: (key: string) => string) => {
  if (status === 'confirmed') return t('accounting:clientsOrders.statusConfirmed');
  if (status === 'denied') return t('accounting:clientsOrders.statusDenied');
  return t('accounting:clientsOrders.statusDraft');
};

const isHistoryRow = (status: ClientsOrder['status']) =>
  status === 'confirmed' || status === 'denied';

interface PricingCellProps {
  value: number;
  isHistory: boolean;
  colorClass: string;
  bold?: boolean;
  prefix?: string;
  dashOnZero?: boolean;
  currency: string;
}

const PricingCell: React.FC<PricingCellProps> = ({
  value,
  isHistory,
  colorClass,
  bold = false,
  prefix = '',
  dashOnZero = false,
  currency,
}) => {
  if (dashOnZero && value <= 0) {
    return (
      <span className={`text-sm font-semibold ${isHistory ? 'text-zinc-300' : 'text-zinc-400'}`}>
        -
      </span>
    );
  }
  return (
    <span
      className={`text-sm ${bold ? 'font-bold' : 'font-semibold'} whitespace-nowrap ${isHistory ? 'text-zinc-400' : colorClass}`}
    >
      {prefix}
      {value.toFixed(2)} {currency}
    </span>
  );
};

const computeDueDate = (
  createdAt: number | undefined,
  paymentTerms: string | undefined | null,
  t: TFunction,
): string => {
  if (!createdAt) return '-';
  if (paymentTerms === 'immediate') return t('crm:paymentTerms.immediate');
  const baseDate = getLocalDateString(new Date(createdAt));
  const days = Number.parseInt(paymentTerms ?? '', 10);
  if (!Number.isFinite(days) || days <= 0) return formatDateOnlyForLocale(baseDate);
  return formatDateOnlyForLocale(addDaysToDateOnly(baseDate, days));
};

const ClientsOrdersView: React.FC<ClientsOrdersViewProps> = ({
  orders,
  clients,
  products,
  onUpdateClientsOrder,
  onDeleteClientsOrder,
  onOrderRestored,
  onViewOffer,
  currency,
  offerFilterId,
  orderFilterId,
}) => {
  const { t, i18n } = useTranslation(['accounting', 'crm', 'common', 'sales']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ClientsOrder | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<ClientsOrder | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewVersion, setPreviewVersion] = useState<OrderVersion | null>(null);

  // Form State
  const [formData, setFormData] = useState<Partial<ClientsOrder>>({
    clientId: '',
    clientName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    discountType: 'percentage',
    status: 'draft',
    notes: '',
  });

  const orderToFormData = useCallback(
    (order: ClientsOrder): Partial<ClientsOrder> => ({
      linkedQuoteId: order.linkedQuoteId,
      linkedOfferId: order.linkedOfferId,
      clientId: order.clientId,
      clientName: order.clientName,
      items: order.items,
      paymentTerms: order.paymentTerms,
      discount: order.discount,
      discountType: order.discountType || 'percentage',
      status: order.status,
      notes: order.notes || '',
    }),
    [],
  );

  const openEditModal = useCallback(
    (order: ClientsOrder) => {
      setEditingOrder(order);
      setFormData(orderToFormData(order));
      setErrors({});
      setPreviewVersion(null);
      setIsModalOpen(true);
    },
    [orderToFormData],
  );

  const closeEditModal = useCallback(() => {
    setIsModalOpen(false);
    setPreviewVersion(null);
  }, []);

  const handleVersionPreview = useCallback(
    (version: OrderVersion) => {
      setPreviewVersion(version);
      setFormData({
        linkedQuoteId: editingOrder?.linkedQuoteId,
        linkedOfferId: editingOrder?.linkedOfferId,
        clientId: version.snapshot.order.clientId,
        clientName: version.snapshot.order.clientName,
        items: version.snapshot.items,
        paymentTerms: version.snapshot.order.paymentTerms,
        discount: version.snapshot.order.discount,
        discountType: version.snapshot.order.discountType || 'percentage',
        status: version.snapshot.order.status,
        notes: version.snapshot.order.notes ?? '',
      });
      setErrors({});
    },
    [editingOrder],
  );

  const handleClearPreview = useCallback(() => {
    if (editingOrder) setFormData(orderToFormData(editingOrder));
    setPreviewVersion(null);
  }, [editingOrder, orderToFormData]);

  const handleVersionRestored = useCallback(
    (updated: ClientsOrder) => {
      setEditingOrder(updated);
      setFormData(orderToFormData(updated));
      setPreviewVersion(null);
      onOrderRestored?.(updated);
    },
    [onOrderRestored, orderToFormData],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;

    const newErrors: Record<string, string> = {};

    if (!formData.clientId) {
      newErrors.clientId = t('sales:clientQuotes.errors.clientRequired');
    }

    if (!formData.items || formData.items.length === 0) {
      newErrors.items = t('sales:clientQuotes.errors.itemsRequired');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const itemsWithSnapshots = (formData.items || []).map((item) => {
      return {
        ...item,
        unitPrice: item.unitPrice,
        discount: item.discount ? item.discount : 0,
        productCost: Number(item.productCost ?? 0),
        productMolPercentage:
          item.productMolPercentage === undefined || item.productMolPercentage === null
            ? null
            : Number(item.productMolPercentage),
      };
    });

    const payload = {
      ...formData,
      discount: formData.discount ? formData.discount : 0,
      items: itemsWithSnapshots,
    };

    try {
      await onUpdateClientsOrder(editingOrder.id, payload);
      closeEditModal();
    } catch (err) {
      toastError((err as Error).message || t('accounting:clientsOrders.failedToSave'));
    }
  };

  const confirmDelete = useCallback((order: ClientsOrder) => {
    setOrderToDelete(order);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = async () => {
    if (!orderToDelete) return;
    try {
      await onDeleteClientsOrder(orderToDelete.id);
      setIsDeleteConfirmOpen(false);
      setOrderToDelete(null);
    } catch (err) {
      toastError((err as Error).message || t('accounting:clientsOrders.failedToDelete'));
    }
  };

  const handleStatusUpdate = useCallback(
    async (id: string, updates: Partial<ClientsOrder>) => {
      try {
        await onUpdateClientsOrder(id, updates);
      } catch (err) {
        toastError((err as Error).message || t('accounting:clientsOrders.failedToUpdateStatus'));
      }
    },
    [onUpdateClientsOrder, t],
  );

  const handleClientChange = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      clientName: client?.name || '',
    }));
    if (errors.clientId) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.clientId;
        return newErrors;
      });
    }
  };

  const addProductRow = () => {
    const newItem: Partial<ClientsOrderItem> = {
      id: 'temp-' + Date.now(),
      productId: '',
      productName: '',
      quantity: 1,
      unitType: DEFAULT_UNIT_TYPE,
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      discount: 0,
    };
    setFormData((prev) => ({
      ...prev,
      items: [...(formData.items || []), newItem as ClientsOrderItem],
    }));
    if (errors.items) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.items;
        return newErrors;
      });
    }
  };

  const removeProductRow = (index: number) => {
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  const updateProductRow = (
    index: number,
    field: keyof ClientsOrderItem,
    value: string | number,
  ) => {
    const newItems = [...(formData.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'productId') {
      const product = activeProducts.find((p) => p.id === value);
      if (product) {
        newItems[index].productName = product.name;
        const mol = product.molPercentage ? Number(product.molPercentage) : 0;
        const hourlySalePrice = calcProductSalePrice(Number(product.costo), mol);
        newItems[index].unitPrice = convertHourlyToUnit(hourlySalePrice, newItems[index].unitType);
        newItems[index].productCost = Number(product.costo);
        newItems[index].productMolPercentage = product.molPercentage;
      }
    }

    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  const handleUnitTypeChange = (index: number, newType: SupplierUnitType) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item) return;
    const oldType = item.unitType || DEFAULT_UNIT_TYPE;
    if (oldType === newType) return;
    const adjustedPrice = convertUnitPrice(item.unitPrice, oldType, newType);
    const newItems = [...(formData.items || [])];
    newItems[index] = {
      ...newItems[index],
      unitType: newType,
      unitPrice: adjustedPrice,
    };
    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  const activeClients = useMemo(() => clients.filter((c) => !c.isDisabled), [clients]);
  const activeProducts = useMemo(() => products.filter((p) => !p.isDisabled), [products]);

  const isLinkedOffer = Boolean(formData.linkedOfferId);
  const baseReadOnly = Boolean(isLinkedOffer || (editingOrder && editingOrder.status !== 'draft'));
  const isReadOnly = baseReadOnly || previewVersion !== null;

  const tableInitialFilterState = useMemo(() => {
    if (orderFilterId) {
      return { id: [orderFilterId] };
    }
    return undefined;
  }, [orderFilterId]);

  // Filter orders by offerFilterId if provided
  const filteredOrders = useMemo(() => {
    if (offerFilterId) {
      return orders.filter((o) => o.linkedOfferId === offerFilterId);
    }
    return orders;
  }, [orders, offerFilterId]);

  const orderPricingMap = useMemo(() => {
    const map = new Map<string, PricingTotals>();
    for (const order of filteredOrders) {
      map.set(
        order.id,
        calculatePricingTotals(order.items, order.discount, DEFAULT_UNIT_TYPE, order.discountType),
      );
    }
    return map;
  }, [filteredOrders]);

  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);

  // Table columns definition with TableFilter support
  const columns = useMemo(
    () => [
      {
        header: t('accounting:clientsOrders.orderNumber', { defaultValue: 'Order Number' }),
        id: 'id',
        accessorFn: (row: ClientsOrder) => row.id,
        cell: ({ row }: { row: ClientsOrder }) => (
          <span className="font-bold text-zinc-700">{row.id}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (row: ClientsOrder) => row.createdAt ?? 0,
        className: 'whitespace-nowrap',
        cell: ({ row }: { row: ClientsOrder }) => {
          if (!row.createdAt) return <span className="text-xs text-zinc-400">-</span>;
          return (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatInsertDate(row.createdAt, i18n.language)}
            </span>
          );
        },
        filterFormat: (value: unknown) => {
          const timestamp = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
          return formatInsertDate(timestamp, i18n.language);
        },
      },
      {
        header: t('accounting:clientsOrders.clientColumn'),
        accessorFn: (row: ClientsOrder) => row.clientName,
        cell: ({ row }: { row: ClientsOrder }) => (
          <div>
            <div
              className={`font-bold ${isHistoryRow(row.status) ? 'text-zinc-400' : 'text-zinc-800'}`}
            >
              {row.clientName}
            </div>
          </div>
        ),
      },
      {
        header: t('sales:clientQuotes.globalDiscount'),
        id: 'globalDiscount',
        accessorFn: (row: ClientsOrder) =>
          formatDiscountValue(row.discount, row.discountType, currency),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        cell: ({ row }: { row: ClientsOrder }) => {
          const history = isHistoryRow(row.status);
          return (
            <span
              className={`text-sm font-semibold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-zinc-600'}`}
            >
              {formatDiscountValue(row.discount, row.discountType, currency)}
            </span>
          );
        },
      },
      {
        header: t('accounting:clientsOrders.subtotal', { defaultValue: 'Subtotal' }),
        id: 'subtotal',
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.subtotal ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-zinc-700"
            currency={currency}
          />
        ),
      },
      {
        header: t('common:labels.discount'),
        id: 'discountAmount',
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.discountAmount ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-amber-600"
            prefix="-"
            dashOnZero
            currency={currency}
          />
        ),
      },
      {
        header: t('accounting:clientsOrders.margin'),
        id: 'margin',
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.margin ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-emerald-600"
            bold
            currency={currency}
          />
        ),
      },
      {
        header: t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' }),
        id: 'totalCost',
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.totalCost ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-zinc-700"
            currency={currency}
          />
        ),
      },
      {
        header: t('accounting:clientsOrders.totalColumn'),
        accessorFn: (row: ClientsOrder) => orderPricingMap.get(row.id)?.total ?? 0,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row, value }: { row: ClientsOrder; value: unknown }) => (
          <PricingCell
            value={Number(value)}
            isHistory={isHistoryRow(row.status)}
            colorClass="text-zinc-700"
            bold
            currency={currency}
          />
        ),
        filterFormat: (val: unknown) => (val as number).toFixed(2),
      },
      {
        header: t('accounting:clientsOrders.paymentTermsColumn'),
        accessorFn: (row: ClientsOrder) =>
          row.paymentTerms === 'immediate' ? t('crm:paymentTerms.immediate') : row.paymentTerms,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[10rem]',
        cell: ({ row }: { row: ClientsOrder }) => (
          <span
            className={`text-sm font-semibold ${isHistoryRow(row.status) ? 'text-zinc-400' : 'text-zinc-600'}`}
          >
            {row.paymentTerms === 'immediate' ? t('crm:paymentTerms.immediate') : row.paymentTerms}
          </span>
        ),
      },
      {
        header: t('accounting:clientsOrders.statusColumn'),
        accessorFn: (row: ClientsOrder) => getOrderStatusLabel(row.status, t),
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }: { row: ClientsOrder }) => (
          <div className={isHistoryRow(row.status) ? 'opacity-60' : ''}>
            <StatusBadge
              type={row.status as StatusType}
              label={getOrderStatusLabel(row.status, t)}
            />
          </div>
        ),
      },
      {
        header: t('accounting:clientsOrders.actionsColumn'),
        id: 'actions',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        disableFiltering: true,
        align: 'right' as const,
        cell: ({ row }: { row: ClientsOrder }) => (
          <div className="flex justify-end gap-2">
            {onViewOffer && row.linkedOfferId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewOffer(row.linkedOfferId as string);
                      }}
                      aria-label={t('sales:clientOffers.viewOffer', { defaultValue: 'View offer' })}
                      className="p-2 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('sales:clientOffers.viewOffer', { defaultValue: 'View offer' })}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(row);
                    }}
                    aria-label={
                      row.status === 'draft'
                        ? t('accounting:clientsOrders.editOrder')
                        : t('accounting:clientsOrders.viewOrder')
                    }
                    className="p-2 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-all"
                  >
                    <i
                      className={`fa-solid ${row.status === 'draft' ? 'fa-pen-to-square' : 'fa-eye'}`}
                    ></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {row.status === 'draft'
                  ? t('accounting:clientsOrders.editOrder')
                  : t('accounting:clientsOrders.viewOrder')}
              </TooltipContent>
            </Tooltip>
            {row.status === 'draft' && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleStatusUpdate(row.id, { status: 'confirmed' });
                        }}
                        aria-label={t('accounting:clientsOrders.markAsConfirmed')}
                        className="p-2 text-emerald-700 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:clientsOrders.markAsConfirmed')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleStatusUpdate(row.id, { status: 'denied' });
                        }}
                        aria-label={t('accounting:clientsOrders.markAsDenied')}
                        className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:clientsOrders.markAsDenied')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmDelete(row);
                        }}
                        aria-label={t('accounting:clientsOrders.deleteOrder')}
                        className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounting:clientsOrders.deleteOrder')}</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        ),
      },
    ],
    [
      currency,
      handleStatusUpdate,
      onViewOffer,
      t,
      confirmDelete,
      openEditModal,
      orderPricingMap,
      i18n.language,
    ],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeEditModal}>
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
          <ModalContent size="full" className="max-h-[90vh]">
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <ModalHeader>
                <ModalTitle className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                    <i
                      className={`fa-solid ${isReadOnly ? 'fa-eye' : 'fa-pen-to-square'}`}
                      aria-hidden="true"
                    ></i>
                  </span>
                  {isReadOnly ? t('common:buttons.view') : t('accounting:clientsOrders.editOrder')}
                </ModalTitle>
                <ModalCloseButton onClick={closeEditModal} />
              </ModalHeader>

              <ModalBody className="flex-1 space-y-5">
                {previewVersion && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <span className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                      <i className="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                      {t('accounting:clientsOrders.versionHistory.previewBanner', {
                        date: formatInsertDateTime(previewVersion.createdAt, i18n.language),
                        defaultValue: 'Previewing version from {{date}}',
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={handleClearPreview}
                      className="h-auto px-0 text-amber-700 dark:text-amber-300"
                    >
                      {t('accounting:clientsOrders.versionHistory.backToCurrent', {
                        defaultValue: 'Back to current',
                      })}
                    </Button>
                  </div>
                )}
                {editingOrder && editingOrder.status !== 'draft' && (
                  <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      {t('accounting:clientsOrders.readOnlyStatus', {
                        status: getOrderStatusLabel(editingOrder.status, t),
                      })}
                    </span>
                  </div>
                )}
                {/* Linked Offer Info */}
                {formData.linkedOfferId && (
                  <LinkedRecordBanner
                    label={t('accounting:clientsOrders.linkedOffer', {
                      defaultValue: 'Linked Offer',
                    })}
                    value={t('accounting:clientsOrders.linkedOfferInfo', {
                      number: formData.linkedOfferId,
                      defaultValue: 'Offer #{{number}}',
                    })}
                    note={t('accounting:clientsOrders.offerDetailsReadOnly', {
                      defaultValue: '(Order details are read-only)',
                    })}
                    action={
                      onViewOffer && formData.linkedOfferId
                        ? {
                            label: t('sales:clientOffers.viewOffer', {
                              defaultValue: 'View offer',
                            }),
                            onClick: () => onViewOffer(formData.linkedOfferId as string),
                          }
                        : undefined
                    }
                  />
                )}

                {/* Order Details */}
                <div className="space-y-2">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('accounting:clientsOrders.orderDetails')}
                  </h4>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Field data-invalid={Boolean(errors.clientId)}>
                      <SelectControl
                        id="client-order-client"
                        options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                        value={formData.clientId || ''}
                        onChange={(val) => handleClientChange(val as string)}
                        label={t('accounting:clientsOrders.client')}
                        placeholder={t('sales:clientQuotes.selectAClient')}
                        searchable={true}
                        disabled={isReadOnly}
                        buttonClassName={errors.clientId ? 'h-9 border-destructive' : 'h-9'}
                      />
                      <FieldError className="text-xs">{errors.clientId}</FieldError>
                    </Field>
                    <Field>
                      <FieldLabel>
                        {t('accounting:clientsOrders.orderNumber', {
                          defaultValue: 'Order Number',
                        })}
                      </FieldLabel>
                      <div className="flex h-9 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-medium text-foreground">
                        {editingOrder?.id || '-'}
                      </div>
                    </Field>
                    <Field>
                      <SelectControl
                        id="client-order-payment-terms"
                        options={paymentTermsOptions}
                        value={formData.paymentTerms || 'immediate'}
                        onChange={(val) =>
                          setFormData((prev) => ({
                            ...prev,
                            paymentTerms: val as ClientsOrder['paymentTerms'],
                          }))
                        }
                        label={t('accounting:clientsOrders.paymentTerms')}
                        searchable={false}
                        disabled={isReadOnly}
                        buttonClassName="h-9"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>
                        {t('accounting:clientsOrders.paymentDueDate', {
                          defaultValue: 'Payment due date',
                        })}
                      </FieldLabel>
                      <div className="flex h-9 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-medium text-foreground">
                        {computeDueDate(editingOrder?.createdAt, formData.paymentTerms, t)}
                      </div>
                    </Field>
                  </div>
                </div>

                {/* Products */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('sales:clientQuotes.productsServices')}
                    </h4>
                    <Button type="button" size="sm" onClick={addProductRow} disabled={isReadOnly}>
                      <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                      {t('sales:clientQuotes.addProduct')}
                    </Button>
                  </div>
                  <FieldError className="-mt-2 text-xs">{errors.items}</FieldError>

                  {formData.items && formData.items.length > 0 && (
                    <div className="hidden lg:flex gap-2 px-3 mb-1 items-center">
                      <div className="grid flex-1 grid-cols-12 gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        <div className="col-span-2">
                          {t('accounting:clientsOrders.supplierOrderColumn', {
                            defaultValue: 'Supplier Order',
                          })}
                        </div>
                        <div className="col-span-2">{t('sales:clientQuotes.productsServices')}</div>
                        <div className="col-span-2 text-center">{t('sales:clientQuotes.qty')}</div>
                        <div className="col-span-1 text-center">
                          {t('crm:internalListing.cost')}
                        </div>
                        <div className="col-span-1 text-center">
                          {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
                        </div>
                        <div className="col-span-1 text-center whitespace-nowrap">
                          {t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' })}
                        </div>
                        <div className="col-span-1 text-center">
                          {t('sales:clientQuotes.marginLabel')}
                        </div>
                        <div className="col-span-2 pr-2 text-right">
                          {t('crm:internalListing.salePrice')}
                        </div>
                      </div>
                      <div className="w-8 shrink-0"></div>
                    </div>
                  )}

                  {formData.items && formData.items.length > 0 ? (
                    <div className="space-y-3">
                      {formData.items.map((item, index) => {
                        const product = products.find((p) => p.id === item.productId);
                        const { unitCost, molPercentage, lineCost, quantity } =
                          getItemPricingContext(item, DEFAULT_UNIT_TYPE);
                        const salePrice = Number(item.unitPrice || 0);
                        const lineSalePrice = salePrice * quantity;
                        const margin = lineSalePrice - lineCost;
                        const isSupply = product?.type === 'supply';

                        const handleCostChange = (value: string) => {
                          if (isReadOnly) return;
                          setFormData(
                            makeCostUpdater<Partial<ClientsOrder>>(index, value, DEFAULT_UNIT_TYPE),
                          );
                        };

                        const handleMolChange = (value: string) => {
                          if (isReadOnly) return;
                          setFormData(
                            makeMolUpdater<Partial<ClientsOrder>>(index, value, DEFAULT_UNIT_TYPE),
                          );
                        };

                        return (
                          <div
                            key={item.id}
                            className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
                          >
                            <div className="flex items-start gap-2 lg:items-center">
                              <div className="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-12 lg:items-center">
                                <div className="min-w-0 space-y-1 lg:col-span-2 lg:space-y-0">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                    {t('accounting:clientsOrders.supplierOrderColumn', {
                                      defaultValue: 'Supplier Order',
                                    })}
                                  </FieldLabel>
                                  <div className="flex h-9 items-center rounded-md border border-border bg-background px-3">
                                    {item.supplierSaleId ? (
                                      <span className="truncate text-xs font-medium text-foreground">
                                        {item.supplierSaleSupplierName ?? '-'} ·{' '}
                                        {item.supplierSaleId}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">
                                        {t('accounting:clientsOrders.noSupplierOrder', {
                                          defaultValue: 'No supplier order',
                                        })}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="min-w-0 space-y-1 lg:col-span-2 lg:space-y-0">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                    {t('sales:clientQuotes.productsServices')}
                                  </FieldLabel>
                                  <SelectControl
                                    options={activeProducts.map((p) => ({
                                      id: p.id,
                                      name: p.name,
                                    }))}
                                    value={item.productId}
                                    onChange={(val) =>
                                      updateProductRow(index, 'productId', val as string)
                                    }
                                    placeholder={t('sales:clientQuotes.selectProduct')}
                                    searchable={true}
                                    disabled={isReadOnly}
                                    buttonClassName="h-9"
                                  />
                                </div>
                                <div className="space-y-1 lg:col-span-2 lg:space-y-0">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                    {t('sales:clientQuotes.qty')}
                                  </FieldLabel>
                                  <div className="flex h-9 items-center gap-1">
                                    <ValidatedNumberInput
                                      step="0.01"
                                      min="0"
                                      required
                                      placeholder="Qty"
                                      value={item.quantity}
                                      onValueChange={(value) => {
                                        const parsed = parseFloat(value);
                                        updateProductRow(
                                          index,
                                          'quantity',
                                          value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                        );
                                      }}
                                      disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                      className="flex-1 text-center"
                                    />
                                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                      /
                                    </span>
                                    <UnitTypeSelector
                                      value={
                                        (item.unitType || DEFAULT_UNIT_TYPE) as SupplierUnitType
                                      }
                                      onChange={(val) => handleUnitTypeChange(index, val)}
                                      isSupply={isSupply}
                                      quantity={Number(item.quantity) || 0}
                                      disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                      i18nPrefix="sales:clientQuotes"
                                    />
                                  </div>
                                </div>
                                <div className="space-y-1 lg:col-span-1 lg:space-y-0">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                    {t('crm:internalListing.cost')}
                                  </FieldLabel>
                                  <div className="flex min-h-9 flex-col items-center justify-center gap-1">
                                    {item.supplierQuoteItemId && (
                                      <span className={`${pillBadgeClass} bg-emerald-600`}>
                                        {t('sales:clientQuotes.supplierQuoteBadge')}
                                      </span>
                                    )}
                                    {item.supplierSaleId && (
                                      <span className={`${pillBadgeClass} bg-blue-600`}>
                                        {t('accounting:clientsOrders.supplierOrderBadge', {
                                          defaultValue: 'Supplier order',
                                        })}
                                      </span>
                                    )}
                                    <div className="flex items-center gap-1">
                                      <ValidatedNumberInput
                                        value={unitCost}
                                        formatDecimals={2}
                                        onValueChange={handleCostChange}
                                        disabled={isReadOnly}
                                        className={compactInputClass}
                                      />
                                      <span className="shrink-0 text-[9px] font-medium text-muted-foreground">
                                        {currency}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="space-y-1 lg:col-span-1 lg:space-y-0">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                    {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
                                  </FieldLabel>
                                  <div className="flex h-9 items-center justify-center gap-1">
                                    <ValidatedNumberInput
                                      value={molPercentage}
                                      formatDecimals={1}
                                      onValueChange={handleMolChange}
                                      disabled={isReadOnly}
                                      className={compactInputClass}
                                    />
                                    <span className="shrink-0 text-[9px] font-medium text-muted-foreground">
                                      %
                                    </span>
                                  </div>
                                </div>
                                <div className="space-y-1 lg:col-span-1 lg:space-y-0">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                    {t('sales:clientQuotes.totalCost', {
                                      defaultValue: 'Total cost',
                                    })}
                                  </FieldLabel>
                                  <div className="flex h-9 items-center justify-center">
                                    <span className="whitespace-nowrap text-xs font-semibold text-foreground">
                                      {lineCost.toFixed(2)} {currency}
                                    </span>
                                  </div>
                                </div>
                                <div className="space-y-1 lg:col-span-1 lg:space-y-0">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                    {t('sales:clientQuotes.marginLabel')}
                                  </FieldLabel>
                                  <div className="flex h-9 items-center justify-center">
                                    <span className="text-xs font-bold text-emerald-600">
                                      {margin.toFixed(2)} {currency}
                                    </span>
                                  </div>
                                </div>
                                <div className="space-y-1 lg:col-span-2 lg:space-y-0">
                                  <FieldLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:hidden">
                                    {t('crm:internalListing.salePrice')}
                                  </FieldLabel>
                                  <div className="flex h-9 items-center justify-end whitespace-nowrap px-3 text-sm font-bold text-foreground">
                                    <span className="text-sm font-semibold text-foreground">
                                      {lineSalePrice.toFixed(2)} {currency}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => removeProductRow(index)}
                                disabled={isReadOnly}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                                <span className="sr-only">{t('common:buttons.delete')}</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                      {t('sales:clientQuotes.noProductsAdded')}
                    </div>
                  )}
                </div>

                {/* Notes & Cost Summary */}
                <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
                  <Field className="md:w-2/3">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('accounting:clientsOrders.notes')}
                    </h4>
                    <FieldLabel htmlFor="client-order-notes" className="sr-only">
                      {t('accounting:clientsOrders.notes')}
                    </FieldLabel>
                    <Textarea
                      id="client-order-notes"
                      rows={4}
                      value={formData.notes}
                      onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder={t('sales:clientQuotes.additionalNotesPlaceholder')}
                      disabled={isReadOnly}
                      className="min-h-28 resize-none"
                    />
                  </Field>

                  <div className="space-y-2 md:w-1/3">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('accounting:clientsOrders.summary', { defaultValue: 'Summary' })}
                    </h4>
                    {(() => {
                      const { subtotal, discountAmount, total, margin, marginPercentage } =
                        calculatePricingTotals(
                          formData.items || [],
                          formData.discount || 0,
                          DEFAULT_UNIT_TYPE,
                          formData.discountType || 'percentage',
                        );
                      return (
                        <CostSummaryPanel
                          currency={currency}
                          subtotal={subtotal}
                          total={total}
                          subtotalLabel={t('sales:clientQuotes.subtotal', {
                            defaultValue: 'Subtotal',
                          })}
                          totalLabel={t('sales:clientQuotes.totalLabel')}
                          globalDiscount={{
                            label: t('sales:clientQuotes.globalDiscount', {
                              defaultValue: 'Global Discount',
                            }),
                            value: formData.discount || 0,
                            type: formData.discountType || 'percentage',
                            onChange: (value) => {
                              const parsed = parseNumberInputValue(value);
                              setFormData((prev) => ({ ...prev, discount: parsed }));
                            },
                            onTypeChange: (type) =>
                              setFormData((prev) => ({ ...prev, discountType: type })),
                            disabled: isReadOnly,
                          }}
                          discountRow={
                            discountAmount > 0
                              ? {
                                  label: t('sales:clientOffers.discountAmount', {
                                    value: formatDiscountValue(
                                      formData.discount ?? 0,
                                      formData.discountType ?? 'percentage',
                                      currency,
                                    ),
                                  }),
                                  amount: discountAmount,
                                }
                              : undefined
                          }
                          margin={{
                            label: `${t('sales:clientQuotes.marginLabel')} (${marginPercentage.toFixed(1)}%)`,
                            amount: margin,
                          }}
                        />
                      );
                    })()}
                  </div>
                </div>
              </ModalBody>

              <ModalFooter>
                <Button type="button" variant="outline" onClick={closeEditModal}>
                  {t('common:buttons.cancel')}
                </Button>
                {!previewVersion && (
                  <Button type="submit" disabled={isReadOnly}>
                    {t('accounting:clientsOrders.updateOrder')}
                  </Button>
                )}
              </ModalFooter>
            </form>
          </ModalContent>
          {editingOrder?.id && (
            <OrderVersionsPanel
              orderId={editingOrder.id}
              selectedVersionId={previewVersion?.id ?? null}
              onPreview={handleVersionPreview}
              onClearPreview={handleClearPreview}
              onRestored={handleVersionRestored}
              disabled={baseReadOnly}
            />
          )}
        </div>
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title={t('accounting:clientsOrders.deleteOrderTitle')}
        description={t('accounting:clientsOrders.deleteOrderConfirm', {
          clientName: orderToDelete?.clientName,
        })}
      />

      <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">
              {t('accounting:clientsOrders.title')}
            </h2>
            <p className="text-sm text-zinc-500">{t('accounting:clientsOrders.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Main Table with all orders and TableFilter */}
      <StandardTable<ClientsOrder>
        title={t('accounting:clientsOrders.title')}
        data={filteredOrders}
        columns={columns}
        defaultRowsPerPage={10}
        initialFilterState={tableInitialFilterState}
        containerClassName="overflow-visible"
        rowClassName={(row: ClientsOrder) =>
          isHistoryRow(row.status) ? 'bg-zinc-50 text-zinc-400' : 'hover:bg-zinc-50/50'
        }
        onRowClick={(row: ClientsOrder) => openEditModal(row)}
      />
    </div>
  );
};

export default ClientsOrdersView;
