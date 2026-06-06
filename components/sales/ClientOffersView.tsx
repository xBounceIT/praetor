import { RotateCcw } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { normalizeClientOfferItem } from '../../services/api/normalizers';
import type {
  Client,
  ClientOffer,
  ClientOfferItem,
  DiscountType,
  OfferVersion,
  Product,
  SupplierQuote,
  SupplierUnitType,
} from '../../types';
import {
  addMonthsToDateOnly,
  formatDateOnlyForLocale,
  formatInsertDateTime,
  getLocalDateString,
  isDateOnlyBeforeToday,
  normalizeDateOnlyString,
} from '../../utils/date';
import { getLinkedFieldStatus } from '../../utils/fieldStatus';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  getItemPricingContext,
  parseNumberInputValue,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';
import { toastError } from '../../utils/toast';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import FieldTooltip from '../shared/FieldTooltip';
import HeaderAddButton from '../shared/HeaderAddButton';
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
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import SupplierQuoteCostHint from '../shared/SupplierQuoteCostHint';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import OfferVersionsPanel from './OfferVersionsPanel';
import ProductSelectOrFallback from './ProductSelectOrFallback';

export interface ClientOffersViewProps {
  offers: ClientOffer[];
  clients: Client[];
  products: Product[];
  supplierQuotes: SupplierQuote[];
  offerIdsWithOrders: ReadonlySet<string>;
  onAddOffer?: (offerData: Partial<ClientOffer>) => void | Promise<void>;
  onUpdateOffer: (id: string, updates: Partial<ClientOffer>) => void | Promise<void>;
  onRevertOfferToDraft?: (id: string, reason?: string) => void | Promise<void>;
  onDeleteOffer: (id: string) => void | Promise<void>;
  onOfferRestored?: (offer: ClientOffer) => void;
  onCreateClientsOrder?: (offer: ClientOffer) => void | Promise<void>;
  onViewQuote?: (quoteId: string) => void;
  canRevertTerminalStatus?: boolean;
  currency: string;
  quoteFilterId?: string | null;
  offerFilterId?: string | null;
}

const offerToFormData = (offer: ClientOffer): Partial<ClientOffer> => ({
  ...offer,
  expirationDate: offer.expirationDate ? normalizeDateOnlyString(offer.expirationDate) : '',
});

const getDefaultFormData = (): Partial<ClientOffer> => ({
  id: '',
  linkedQuoteId: '',
  clientId: '',
  clientName: '',
  items: [],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  expirationDate: addMonthsToDateOnly(getLocalDateString(), 1),
  notes: '',
});

const formatPercentageLabelValue = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

const getDiscountPercentageValue = (
  discount: number,
  discountType: DiscountType,
  subtotal: number,
  discountAmount: number,
): number => {
  if (discountType === 'percentage') {
    return Number.isFinite(discount) ? discount : 0;
  }

  if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(discountAmount)) {
    return 0;
  }

  return (discountAmount / subtotal) * 100;
};

const getDiscountPercentageLabelValue = (
  discount: number,
  discountType: DiscountType,
  subtotal: number,
  discountAmount: number,
): string =>
  `${formatPercentageLabelValue(
    getDiscountPercentageValue(discount, discountType, subtotal, discountAmount),
  )}%`;

const ClientOffersView: React.FC<ClientOffersViewProps> = ({
  offers,
  clients,
  products,
  supplierQuotes,
  offerIdsWithOrders,
  onAddOffer,
  onUpdateOffer,
  onRevertOfferToDraft,
  onDeleteOffer,
  onOfferRestored,
  onCreateClientsOrder,
  onViewQuote,
  canRevertTerminalStatus = false,
  currency,
  quoteFilterId,
  offerFilterId,
}) => {
  const { t, i18n } = useTranslation(['sales', 'crm', 'common', 'form']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const STATUS_OPTIONS = useMemo(
    () => [
      { id: 'draft', name: t('sales:clientOffers.statusDraft', { defaultValue: 'Draft' }) },
      { id: 'sent', name: t('sales:clientOffers.statusSent', { defaultValue: 'Sent' }) },
      {
        id: 'accepted',
        name: t('sales:clientOffers.statusAccepted', { defaultValue: 'Accepted' }),
      },
      { id: 'denied', name: t('sales:clientOffers.statusDenied', { defaultValue: 'Denied' }) },
    ],
    [t],
  );
  const activeClients = useMemo(() => clients.filter((client) => !client.isDisabled), [clients]);
  const clientOptions = useMemo(
    () => activeClients.map((client) => ({ id: client.id, name: client.name })),
    [activeClients],
  );
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );
  const productOptions = useMemo(
    () => activeProducts.map((product) => ({ id: product.id, name: product.name })),
    [activeProducts],
  );
  const today = getLocalDateString();

  const acceptedSupplierQuotes = useMemo(
    () =>
      supplierQuotes.filter(
        (q) => q.status === 'accepted' && !isDateOnlyBeforeToday(q.expirationDate, today),
      ),
    [supplierQuotes, today],
  );

  const supplierQuoteItemOptions = useMemo(() => {
    const options: Array<{ id: string; name: string }> = [];
    for (const quote of acceptedSupplierQuotes) {
      for (const item of quote.items) {
        options.push({
          id: item.id,
          name: `${quote.supplierName} · ${item.productName} (${item.unitPrice.toFixed(2)})`,
        });
      }
    }
    return options;
  }, [acceptedSupplierQuotes]);

  const supplierQuoteSelectOptions = useMemo(
    () => [
      { id: 'none' as const, name: t('sales:clientQuotes.noSupplierQuote') },
      ...supplierQuoteItemOptions.map((o) => ({ id: o.id, name: o.name })),
    ],
    [supplierQuoteItemOptions, t],
  );

  const getSupplierQuoteItemDisplayValue = (itemId?: string | null) => {
    if (!itemId) return t('sales:clientQuotes.noSupplierQuote');
    const option = supplierQuoteItemOptions.find((o) => o.id === itemId);
    return option?.name ?? t('sales:clientQuotes.noSupplierQuote');
  };

  const activeProductIds = useMemo(
    () => new Set(activeProducts.map((p) => p.id)),
    [activeProducts],
  );

  const isLinkedProductMissing = (item: ClientOfferItem) =>
    Boolean(item.supplierQuoteItemId && (!item.productId || !activeProductIds.has(item.productId)));

  const updateProductSelection = (index: number, productId: string) => {
    updateItem(index, 'productId', productId);
  };

  const handleUnitTypeChange = (index: number, newType: SupplierUnitType) => {
    if (isReadOnly) return;
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const item = items[index];
      if (!item) return prev;
      const oldType = item.unitType || 'hours';
      if (oldType === newType) return prev;
      const adjustedPrice = convertUnitPrice(item.unitPrice, oldType, newType);
      items[index] = {
        ...items[index],
        unitType: newType,
        unitPrice: adjustedPrice,
      };
      return { ...prev, items };
    });
  };

  const [editingOffer, setEditingOffer] = useState<ClientOffer | null>(null);
  const [offerToDelete, setOfferToDelete] = useState<ClientOffer | null>(null);
  const [offerToRevert, setOfferToRevert] = useState<ClientOffer | null>(null);
  const [revertReason, setRevertReason] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isRevertConfirmOpen, setIsRevertConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<ClientOffer>>(() => getDefaultFormData());
  const [previewVersion, setPreviewVersion] = useState<OfferVersion | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReverting, setIsReverting] = useState(false);

  const baseReadOnly = Boolean(editingOffer && editingOffer.status !== 'draft');
  const isReadOnly = baseReadOnly || previewVersion !== null;
  const isClientLocked = Boolean(editingOffer?.linkedQuoteId);

  const readOnlyReason = t('sales:clientOffers.readOnlyStatus', {
    defaultValue: 'Read-only due to non-draft status',
  });
  const clientLockedReason = t('sales:clientOffers.clientLockedByQuote', {
    defaultValue: 'Locked due to linked quote',
  });
  const supplierLockedReason = t('sales:fieldInfo.fieldLockedBySupplierQuote', {
    defaultValue: 'Locked due to linked supplier quote',
  });
  const statusEditable = t('sales:fieldInfo.statusEditable', { defaultValue: 'Editable' });
  const statusLabel = t('sales:fieldInfo.statusLabel', { defaultValue: 'Status:' });

  const clientStatus = isReadOnly
    ? readOnlyReason
    : isClientLocked
      ? clientLockedReason
      : statusEditable;
  const readOnlyStatus = isReadOnly ? readOnlyReason : statusEditable;

  const tableInitialFilterState = useMemo(() => {
    const filters: Record<string, string[]> = {};
    if (offerFilterId) {
      filters.id = [offerFilterId];
    }
    if (quoteFilterId) {
      filters.linkedQuoteId = [quoteFilterId];
    }
    return Object.keys(filters).length > 0 ? filters : undefined;
  }, [offerFilterId, quoteFilterId]);

  const openEditModal = useCallback((offer: ClientOffer) => {
    setEditingOffer(offer);
    setFormData(offerToFormData(offer));
    setErrors({});
    setPreviewVersion(null);
    setIsModalOpen(true);
  }, []);

  const handleVersionPreview = useCallback(
    (version: OfferVersion) => {
      setPreviewVersion(version);
      setFormData(
        offerToFormData({
          ...version.snapshot.offer,
          id: editingOffer?.id ?? version.snapshot.offer.id,
          items: version.snapshot.items.map(normalizeClientOfferItem),
        }),
      );
      setErrors({});
    },
    [editingOffer],
  );

  const handleClearPreview = useCallback(() => {
    if (editingOffer) setFormData(offerToFormData(editingOffer));
    setPreviewVersion(null);
  }, [editingOffer]);

  const handleVersionRestored = useCallback(
    (updated: ClientOffer) => {
      setEditingOffer(updated);
      setFormData(offerToFormData(updated));
      setPreviewVersion(null);
      onOfferRestored?.(updated);
    },
    [onOfferRestored],
  );

  const getStatusLabel = useCallback(
    (status: string) => {
      const option = STATUS_OPTIONS.find((o) => o.id === status);
      return option ? option.name : status;
    },
    [STATUS_OPTIONS],
  );

  const getPaymentTermsLabel = useCallback(
    (paymentTerms: string | null | undefined) => {
      const option = paymentTermsOptions.find((entry) => entry.id === paymentTerms);
      return option ? option.name : paymentTerms || '-';
    },
    [paymentTermsOptions],
  );

  const handleStatusUpdate = async (id: string, updates: Partial<ClientOffer>) => {
    try {
      await onUpdateOffer(id, updates);
    } catch (err) {
      toastError((err as Error).message || t('sales:clientOffers.failedToUpdateStatus'));
    }
  };

  const openRevertConfirm = (offer: ClientOffer) => {
    setOfferToRevert(offer);
    setRevertReason('');
    setIsRevertConfirmOpen(true);
  };

  const closeRevertConfirm = () => {
    if (isReverting) return;
    setIsRevertConfirmOpen(false);
    setOfferToRevert(null);
    setRevertReason('');
  };

  const handleRevertToDraft = async () => {
    if (!offerToRevert || !onRevertOfferToDraft || isReverting) return;
    setIsReverting(true);
    try {
      const reason = revertReason.trim();
      await onRevertOfferToDraft(offerToRevert.id, reason || undefined);
      setIsRevertConfirmOpen(false);
      setOfferToRevert(null);
      setRevertReason('');
    } catch (err) {
      toastError((err as Error).message || t('sales:clientOffers.failedToUpdateStatus'));
    } finally {
      setIsReverting(false);
    }
  };

  const columns: Column<ClientOffer>[] = [
    {
      header: t('sales:clientOffers.offerColumn', { defaultValue: 'Offer' }),
      accessorKey: 'id',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      cell: ({ row }) => <span className="font-bold text-zinc-700">{row.id}</span>,
    },
    {
      header: t('sales:clientOffers.deliveryDateColumn', { defaultValue: 'Delivery date' }),
      id: 'deliveryDate',
      accessorFn: (row) => row.deliveryDate ?? '',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      cell: ({ row }) => {
        if (!row.deliveryDate) return <span className="text-xs text-zinc-400">-</span>;
        return (
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {formatDateOnlyForLocale(row.deliveryDate, i18n.language)}
          </span>
        );
      },
      filterFormat: (value) => {
        if (typeof value !== 'string' || !value) return '-';
        return formatDateOnlyForLocale(value, i18n.language);
      },
    },
    {
      header: t('sales:clientOffers.clientColumn', { defaultValue: 'Client' }),
      accessorKey: 'clientName',
      cell: ({ row }) => {
        return <div className="font-bold text-zinc-800">{row.clientName}</div>;
      },
    },
    {
      header: t('sales:clientOffers.subtotal', { defaultValue: 'Subtotal' }),
      id: 'subtotal',
      accessorFn: (row) =>
        calculatePricingTotals(row.items, row.discount, 'hours', row.discountType).subtotal,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { subtotal } = calculatePricingTotals(
          row.items,
          row.discount,
          'hours',
          row.discountType,
        );
        return (
          <span className="text-sm font-semibold text-zinc-700 whitespace-nowrap">
            {subtotal.toFixed(2)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.discountPercentColumn', { defaultValue: 'Discount %' }),
      id: 'globalDiscount',
      accessorFn: (row) => {
        const { subtotal, discountAmount } = calculatePricingTotals(
          row.items,
          row.discount,
          'hours',
          row.discountType,
        );
        return getDiscountPercentageValue(row.discount, row.discountType, subtotal, discountAmount);
      },
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { subtotal, discountAmount } = calculatePricingTotals(
          row.items,
          row.discount,
          'hours',
          row.discountType,
        );
        return (
          <span className="text-sm font-semibold text-zinc-600 whitespace-nowrap">
            {getDiscountPercentageLabelValue(
              row.discount,
              row.discountType,
              subtotal,
              discountAmount,
            )}
          </span>
        );
      },
    },
    {
      header: t('common:labels.discount'),
      id: 'discountAmount',
      accessorFn: (row) =>
        calculatePricingTotals(row.items, row.discount, 'hours', row.discountType).discountAmount,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { discountAmount } = calculatePricingTotals(
          row.items,
          row.discount,
          'hours',
          row.discountType,
        );
        if (discountAmount <= 0) {
          return <span className="text-sm font-semibold text-zinc-400">-</span>;
        }
        return (
          <span className="text-sm font-semibold text-amber-600 whitespace-nowrap">
            -{discountAmount.toFixed(2)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.discountedTotalColumn', { defaultValue: 'Discounted total' }),
      id: 'total',
      accessorFn: (row) =>
        calculatePricingTotals(row.items, row.discount, 'hours', row.discountType).total,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { total } = calculatePricingTotals(
          row.items,
          row.discount,
          'hours',
          row.discountType,
        );
        return (
          <span className="text-sm font-bold text-zinc-700 whitespace-nowrap">
            {total.toFixed(2)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.margin', { defaultValue: 'Margin' }),
      id: 'margin',
      accessorFn: (row) =>
        calculatePricingTotals(row.items, row.discount, 'hours', row.discountType).margin,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { margin } = calculatePricingTotals(
          row.items,
          row.discount,
          'hours',
          row.discountType,
        );
        return (
          <span className="text-sm font-bold text-emerald-600 whitespace-nowrap">
            {margin.toFixed(2)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.molColumn', { defaultValue: 'MOL' }),
      id: 'mol',
      accessorFn: (row) =>
        calculatePricingTotals(row.items, row.discount, 'hours', row.discountType).marginPercentage,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[6rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { marginPercentage } = calculatePricingTotals(
          row.items,
          row.discount,
          'hours',
          row.discountType,
        );
        return (
          <span className="text-sm font-semibold text-emerald-700 whitespace-nowrap">
            {marginPercentage.toFixed(1)}%
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.paymentTermsColumn', { defaultValue: 'Payment terms' }),
      id: 'paymentTerms',
      accessorFn: (row) => getPaymentTermsLabel(row.paymentTerms),
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[11rem]',
      cell: ({ row }) => {
        return (
          <span className="text-sm font-medium text-zinc-700 whitespace-nowrap">
            {getPaymentTermsLabel(row.paymentTerms)}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.statusColumn', { defaultValue: 'Status' }),
      accessorKey: 'status',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      cell: ({ row }) => {
        return <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status)} />;
      },
      filterFormat: (value) => getStatusLabel(String(value ?? '')),
    },
    {
      header: 'linkedQuoteId',
      accessorKey: 'linkedQuoteId',
      hidden: true,
    },
    {
      header: t('sales:clientOffers.actionsColumn', { defaultValue: 'Actions' }),
      id: 'actions',
      align: 'right',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      disableSorting: true,
      disableFiltering: true,
      cell: ({ row }) => {
        const hasOrder = offerIdsWithOrders.has(row.id);
        const canRevertRowToDraft =
          canRevertTerminalStatus &&
          Boolean(onRevertOfferToDraft) &&
          !hasOrder &&
          (row.status === 'accepted' || row.status === 'denied');

        return (
          <div className="flex justify-end gap-2">
            {row.linkedQuoteId && onViewQuote && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewQuote(row.linkedQuoteId);
                      }}
                      aria-label={t('sales:clientOffers.viewQuote', { defaultValue: 'View quote' })}
                      className="p-2 rounded-lg transition-all text-zinc-400 hover:text-praetor hover:bg-zinc-100"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('sales:clientOffers.viewQuote', { defaultValue: 'View quote' })}
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
                    aria-label={t('common:buttons.edit')}
                    className="p-2 rounded-lg transition-all text-zinc-400 hover:text-praetor hover:bg-zinc-100"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
            </Tooltip>
            {row.status === 'draft' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStatusUpdate(row.id, { status: 'sent' });
                      }}
                      aria-label={t('sales:clientOffers.markSent', {
                        defaultValue: 'Mark as sent',
                      })}
                      className="p-2 rounded-lg transition-all text-blue-700 hover:text-blue-600 hover:bg-blue-50"
                    >
                      <i className="fa-solid fa-paper-plane"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('sales:clientOffers.markSent', { defaultValue: 'Mark as sent' })}
                </TooltipContent>
              </Tooltip>
            )}
            {row.status === 'sent' && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStatusUpdate(row.id, { status: 'accepted' });
                        }}
                        aria-label={t('sales:clientOffers.markAccepted', {
                          defaultValue: 'Mark as accepted',
                        })}
                        className="p-2 rounded-lg transition-all text-emerald-700 hover:text-emerald-600 hover:bg-emerald-50"
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('sales:clientOffers.markAccepted', {
                      defaultValue: 'Mark as accepted',
                    })}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStatusUpdate(row.id, { status: 'denied' });
                        }}
                        aria-label={t('sales:clientOffers.markDenied', {
                          defaultValue: 'Mark as denied',
                        })}
                        className="p-2 rounded-lg transition-all text-red-600 hover:text-red-600 hover:bg-red-50"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('sales:clientOffers.markDenied', { defaultValue: 'Mark as denied' })}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            {row.status === 'accepted' && !hasOrder && onCreateClientsOrder && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateClientsOrder(row);
                      }}
                      aria-label={t('sales:clientOffers.createOrder', {
                        defaultValue: 'Create sale order',
                      })}
                      className="p-2 rounded-lg transition-all text-zinc-400 hover:text-praetor hover:bg-zinc-100"
                    >
                      <i className="fa-solid fa-cart-plus"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('sales:clientOffers.createOrder', { defaultValue: 'Create sale order' })}
                </TooltipContent>
              </Tooltip>
            )}
            {canRevertRowToDraft && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('sales:clientOffers.revertToDraft', {
                        defaultValue: 'Revert to Draft',
                      })}
                      data-testid={`client-offer-revert-${row.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openRevertConfirm(row);
                      }}
                      className="text-amber-700 hover:text-amber-700 hover:bg-amber-50"
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      <span className="sr-only">
                        {t('sales:clientOffers.revertToDraft', {
                          defaultValue: 'Revert to Draft',
                        })}
                      </span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('sales:clientOffers.revertToDraft', {
                    defaultValue: 'Revert to Draft',
                  })}
                </TooltipContent>
              </Tooltip>
            )}
            {row.status === 'draft' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOfferToDelete(row);
                        setIsDeleteConfirmOpen(true);
                      }}
                      aria-label={t('common:buttons.delete')}
                      className="p-2 text-red-600 rounded-lg transition-all hover:text-red-600 hover:bg-red-50"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        );
      },
    },
  ];

  const openAddModal = () => {
    setEditingOffer(null);
    setFormData(getDefaultFormData());
    setErrors({});
    setPreviewVersion(null);
    setIsModalOpen(true);
  };

  const handleClientChange = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      clientName: client?.name || '',
    }));
  };

  const addItem = () => {
    if (isReadOnly) return;
    const nextItem: ClientOfferItem = {
      id: `tmp-${Date.now()}`,
      offerId: editingOffer?.id || '',
      productId: '',
      productName: '',
      quantity: 1,
      unitType: 'hours',
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      supplierQuoteId: null,
      supplierQuoteItemId: null,
      supplierQuoteSupplierName: null,
      supplierQuoteUnitPrice: null,
      note: '',
    };
    setFormData((prev) => ({
      ...prev,
      items: [...(prev.items || []), nextItem],
    }));
  };

  const removeItem = (index: number) => {
    if (isReadOnly) return;
    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const updateItem = (index: number, field: keyof ClientOfferItem, value: string | number) => {
    if (isReadOnly) return;
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const current = { ...items[index], [field]: value };

      if (field === 'productId') {
        const product = products.find((item) => item.id === value);
        if (product) {
          const mol = product.molPercentage ? Number(product.molPercentage) : 0;
          current.productName = product.name;
          current.unitPrice = calcProductSalePrice(Number(product.costo), mol);
          current.productCost = Number(product.costo);
          current.productMolPercentage = product.molPercentage;
          current.supplierQuoteId = null;
          current.supplierQuoteItemId = null;
          current.supplierQuoteSupplierName = null;
          current.supplierQuoteUnitPrice = null;
        }
      }

      if (field === 'supplierQuoteItemId') {
        if (!value) {
          current.supplierQuoteId = null;
          current.supplierQuoteItemId = null;
          current.supplierQuoteSupplierName = null;
          current.supplierQuoteUnitPrice = null;

          const product = products.find((p) => p.id === current.productId);
          if (product) {
            const mol = product.molPercentage ? Number(product.molPercentage) : 0;
            current.unitPrice = calcProductSalePrice(Number(product.costo), mol);
            current.productCost = Number(product.costo);
            current.productMolPercentage = product.molPercentage;
          }
          items[index] = current;
          return { ...prev, items };
        }

        const selectedQuote = acceptedSupplierQuotes.find((quote) =>
          quote.items.some((item) => item.id === value),
        );
        const selectedQuoteItem = selectedQuote?.items.find((item) => item.id === value);

        if (selectedQuote && selectedQuoteItem) {
          const product = selectedQuoteItem.productId
            ? products.find((p) => p.id === selectedQuoteItem.productId)
            : undefined;

          const netCost = selectedQuoteItem.unitPrice;

          current.productId = selectedQuoteItem.productId || '';
          current.productName = product?.name || selectedQuoteItem.productName;
          current.supplierQuoteId = selectedQuote.id;
          current.supplierQuoteItemId = selectedQuoteItem.id;
          current.supplierQuoteSupplierName = selectedQuote.supplierName;
          current.supplierQuoteUnitPrice = netCost;
          current.quantity = selectedQuoteItem.quantity;

          let salePrice: number;
          if (product) {
            const mol = product.molPercentage ? Number(product.molPercentage) : 0;
            salePrice = calcProductSalePrice(netCost, mol);
            current.productCost = Number(product.costo);
            current.productMolPercentage = product.molPercentage;
          } else {
            salePrice = netCost;
            current.productCost = netCost;
            current.productMolPercentage = null;
          }
          current.unitPrice = salePrice;
        }
      }

      items[index] = current;
      return { ...prev, items };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const nextErrors: Record<string, string> = {};
    if (!formData.clientId) {
      nextErrors.clientId = t('sales:clientOffers.clientRequired');
    }
    if (!formData.id?.trim()) {
      nextErrors.id = t('sales:clientOffers.offerCodeRequired', {
        defaultValue: 'Offer code is required',
      });
    }
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('sales:clientOffers.itemsRequired');
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const payload: Partial<ClientOffer> = {
      ...formData,
      discount: Number(formData.discount ?? 0),
      items: (formData.items || []).map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice ?? 0),
        productCost: Number(item.productCost ?? 0),
      })),
    };

    setIsSubmitting(true);
    try {
      if (editingOffer) {
        await onUpdateOffer(editingOffer.id, payload);
      } else if (onAddOffer) {
        await onAddOffer(payload);
      }
    } catch (err) {
      toastError((err as Error).message || t('sales:clientOffers.failedToSave'));
      return;
    } finally {
      setIsSubmitting(false);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
          <ModalContent size="full" className="max-h-[90vh]">
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <ModalHeader>
                <ModalTitle className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                    <i
                      className={`fa-solid ${editingOffer ? 'fa-pen-to-square' : 'fa-plus'}`}
                      aria-hidden="true"
                    ></i>
                  </span>
                  {isReadOnly
                    ? t('sales:clientOffers.viewOffer', { defaultValue: 'View offer' })
                    : editingOffer
                      ? t('sales:clientOffers.editOffer', { defaultValue: 'Edit offer' })
                      : t('sales:clientOffers.newOffer', { defaultValue: 'New offer' })}
                </ModalTitle>
                <ModalCloseButton onClick={() => setIsModalOpen(false)} />
              </ModalHeader>

              <ModalBody className="flex-1 space-y-5">
                {previewVersion && (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50">
                    <span className="text-amber-800 text-xs font-bold flex items-center gap-2">
                      <i className="fa-solid fa-clock-rotate-left"></i>
                      {t('sales:clientOffers.versionHistory.previewBanner', {
                        date: formatInsertDateTime(previewVersion.createdAt, i18n.language),
                        defaultValue: 'Previewing version from {{date}}',
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      onClick={handleClearPreview}
                      className="h-auto px-0 text-xs font-semibold text-amber-800"
                    >
                      {t('sales:clientOffers.versionHistory.backToCurrent', {
                        defaultValue: 'Back to current',
                      })}
                    </Button>
                  </div>
                )}
                {editingOffer?.linkedQuoteId && (
                  <LinkedRecordBanner
                    label={t('sales:clientOffers.sourceQuote', { defaultValue: 'Source quote' })}
                    value={editingOffer.linkedQuoteId}
                    action={
                      onViewQuote
                        ? {
                            label: t('sales:clientOffers.viewQuote', {
                              defaultValue: 'View quote',
                            }),
                            onClick: () => onViewQuote(editingOffer.linkedQuoteId),
                          }
                        : undefined
                    }
                  />
                )}

                {isReadOnly && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                    <span className="text-amber-700 text-xs font-bold">
                      {t('sales:clientOffers.readOnlyStatus', {
                        defaultValue: 'Read-only due to non-draft status',
                      })}
                    </span>
                  </div>
                )}

                {/* Client Information */}
                <div className="space-y-2">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('sales:clientOffers.clientInformation', {
                      defaultValue: 'Client Information',
                    })}
                    <FieldTooltip
                      description={t('sales:fieldInfo.clientInformation', {
                        defaultValue: 'Client and document details',
                      })}
                      status={clientStatus}
                      statusLabel={statusLabel}
                    />
                  </h4>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Field data-invalid={Boolean(errors.clientId)}>
                      <SelectControl
                        id="client-offer-client"
                        options={clientOptions}
                        value={formData.clientId || ''}
                        onChange={(value) => handleClientChange(value as string)}
                        placeholder={t('sales:clientOffers.selectAClient', {
                          defaultValue: 'Select a client',
                        })}
                        searchable={true}
                        disabled={isReadOnly || isClientLocked}
                        label={t('sales:clientOffers.client', { defaultValue: 'Client' })}
                        buttonClassName="h-9"
                        className={errors.clientId ? 'border-red-300' : ''}
                      />
                      <FieldError className="text-xs">{errors.clientId}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(errors.id)}>
                      <FieldLabel htmlFor="client-offer-code">
                        {t('sales:clientOffers.offerCode', { defaultValue: 'Offer code' })}
                      </FieldLabel>
                      <Input
                        id="client-offer-code"
                        type="text"
                        value={formData.id || ''}
                        disabled={isReadOnly}
                        onChange={(event) =>
                          setFormData((prev) => ({ ...prev, id: event.target.value }))
                        }
                        placeholder="O0000"
                        className={errors.id ? 'border-red-300 font-medium' : 'font-medium'}
                        aria-invalid={Boolean(errors.id)}
                      />
                      <FieldError className="text-xs">{errors.id}</FieldError>
                    </Field>
                    <Field>
                      <SelectControl
                        id="client-offer-payment-terms"
                        options={paymentTermsOptions}
                        value={formData.paymentTerms || 'immediate'}
                        onChange={(value) =>
                          setFormData((prev) => ({
                            ...prev,
                            paymentTerms: value as ClientOffer['paymentTerms'],
                          }))
                        }
                        searchable={false}
                        disabled={isReadOnly}
                        label={t('sales:clientOffers.paymentTerms', {
                          defaultValue: 'Payment terms',
                        })}
                        buttonClassName="h-9"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="client-offer-expiration-date">
                        {t('sales:clientOffers.expirationDate', {
                          defaultValue: 'Expiration date',
                        })}
                      </FieldLabel>
                      <Input
                        id="client-offer-expiration-date"
                        type="date"
                        required
                        value={formData.expirationDate || ''}
                        disabled={isReadOnly}
                        onChange={(event) =>
                          setFormData((prev) => ({ ...prev, expirationDate: event.target.value }))
                        }
                      />
                    </Field>
                  </div>
                </div>

                {/* Products */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('sales:clientOffers.items', { defaultValue: 'Items' })}
                      <FieldTooltip
                        description={t('sales:fieldInfo.items', {
                          defaultValue: 'Line items for this offer',
                        })}
                        status={readOnlyStatus}
                        statusLabel={statusLabel}
                      />
                    </h4>
                    <Button type="button" size="sm" onClick={addItem} disabled={isReadOnly}>
                      <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                      {t('sales:clientOffers.addItem', { defaultValue: 'Add item' })}
                    </Button>
                  </div>
                  {errors.items && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
                  )}

                  {formData.items && formData.items.length > 0 && (
                    <div className="hidden lg:flex gap-2 px-3 mb-1 items-center">
                      <div className="flex-1 min-w-0 grid grid-cols-13 gap-2">
                        <div className="col-span-3 text-[10px] font-black text-zinc-400 uppercase tracking-wider ml-1">
                          {t('sales:clientQuotes.supplierQuoteColumn')}
                        </div>
                        <div className="col-span-3 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                          {t('sales:clientOffers.product', { defaultValue: 'Product' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                        </div>
                        <div className="col-span-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('crm:internalListing.cost')}
                        </div>
                        <div className="col-span-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center whitespace-nowrap">
                          {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
                        </div>
                        <div className="col-span-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center whitespace-nowrap">
                          {t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' })}
                        </div>
                        <div className="col-span-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:clientQuotes.marginLabel')}
                        </div>
                        <div className="col-span-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:clientQuotes.revenue')}
                        </div>
                      </div>
                      <div className="w-10 shrink-0"></div>
                    </div>
                  )}

                  {formData.items && formData.items.length > 0 ? (
                    <div className="space-y-3">
                      {formData.items.map((item, index) => {
                        const isSupply =
                          products.find((p) => p.id === item.productId)?.type === 'supply';

                        const {
                          unitCost: cost,
                          molPercentage,
                          lineCost,
                          quantity,
                        } = getItemPricingContext(item);
                        const unitSalePrice = Number(item.unitPrice || 0);
                        const lineSalePrice = unitSalePrice * quantity;
                        const lineMargin = lineSalePrice - lineCost;

                        const isLinkedToSupplierQuote = Boolean(item.supplierQuoteItemId);
                        const linkedFieldStatus = getLinkedFieldStatus({
                          isReadOnly,
                          isLinkedToSupplierQuote,
                          readOnlyReason,
                          supplierLockedReason,
                          statusEditable,
                        });

                        const handleCostChange = (value: string) => {
                          if (isReadOnly) return;
                          setFormData(makeCostUpdater<Partial<ClientOffer>>(index, value));
                        };

                        const handleMolChange = (value: string) => {
                          if (isReadOnly) return;
                          setFormData(makeMolUpdater<Partial<ClientOffer>>(index, value));
                        };

                        return (
                          <div
                            key={item.id}
                            className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
                          >
                            <div className="lg:hidden flex items-start gap-3">
                              <div className="grid flex-1 min-w-0 grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="min-w-0">
                                  <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                    {t('sales:clientQuotes.supplierQuoteColumn')}
                                    <FieldTooltip
                                      description={t('sales:fieldInfo.supplierQuote', {
                                        defaultValue:
                                          'Link this item to a supplier quote for cost tracking',
                                      })}
                                      status={readOnlyStatus}
                                      statusLabel={statusLabel}
                                    />
                                  </div>
                                  <SelectControl
                                    options={supplierQuoteSelectOptions}
                                    value={item.supplierQuoteItemId || 'none'}
                                    onChange={(val) =>
                                      updateItem(
                                        index,
                                        'supplierQuoteItemId',
                                        val === 'none' ? '' : (val as string),
                                      )
                                    }
                                    placeholder={t('sales:clientQuotes.selectSupplierQuote')}
                                    displayValue={getSupplierQuoteItemDisplayValue(
                                      item.supplierQuoteItemId,
                                    )}
                                    displayValueIsPlaceholder={!item.supplierQuoteItemId}
                                    searchable={true}
                                    disabled={isReadOnly}
                                    className="min-w-0"
                                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                  />
                                </div>
                                <div className="min-w-0">
                                  <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                    {t('sales:clientOffers.product', { defaultValue: 'Product' })}
                                    <FieldTooltip
                                      description={t('sales:fieldInfo.product', {
                                        defaultValue:
                                          'Select a product or service for this line item',
                                      })}
                                      status={linkedFieldStatus}
                                      statusLabel={statusLabel}
                                    />
                                  </div>
                                  <ProductSelectOrFallback
                                    item={item}
                                    index={index}
                                    options={productOptions}
                                    isProductMissing={isLinkedProductMissing(item)}
                                    isReadOnly={isReadOnly}
                                    ariaLabel={t('sales:clientOffers.selectProduct', {
                                      defaultValue: 'Select product',
                                    })}
                                    placeholder={t('sales:clientOffers.selectProduct', {
                                      defaultValue: 'Select product',
                                    })}
                                    onProductChange={updateProductSelection}
                                    className="min-w-0"
                                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                  />
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => removeItem(index)}
                                disabled={isReadOnly}
                                className="mt-5 shrink-0 text-muted-foreground hover:text-destructive"
                              >
                                <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                                <span className="sr-only">{t('common:buttons.delete')}</span>
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-6 lg:hidden">
                              <div>
                                <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                  {t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                                  <FieldTooltip
                                    description={t('sales:fieldInfo.qty', {
                                      defaultValue: 'Quantity of items or hours',
                                    })}
                                    status={linkedFieldStatus}
                                    statusLabel={statusLabel}
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    step="0.01"
                                    min="0"
                                    required
                                    placeholder={t('sales:clientOffers.qty', {
                                      defaultValue: 'Qty',
                                    })}
                                    value={item.quantity}
                                    onValueChange={(value) =>
                                      updateItem(index, 'quantity', parseNumberInputValue(value))
                                    }
                                    disabled={isReadOnly || isLinkedToSupplierQuote}
                                    className="w-full text-sm px-3 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed flex-1"
                                  />
                                  <span className="text-xs font-semibold text-zinc-400 shrink-0">
                                    /
                                  </span>
                                  <UnitTypeSelector
                                    value={(item.unitType || 'hours') as SupplierUnitType}
                                    onChange={(val) => handleUnitTypeChange(index, val)}
                                    isSupply={isSupply}
                                    quantity={Number(item.quantity) || 0}
                                    disabled={isReadOnly || isLinkedToSupplierQuote}
                                  />
                                </div>
                              </div>
                              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                  {t('crm:internalListing.cost')}
                                  <FieldTooltip
                                    description={t('sales:fieldInfo.cost', {
                                      defaultValue: 'Unit cost for this item',
                                    })}
                                    status={linkedFieldStatus}
                                    statusLabel={statusLabel}
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={cost}
                                    formatDecimals={2}
                                    onValueChange={handleCostChange}
                                    disabled={isReadOnly || isLinkedToSupplierQuote}
                                    className="w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                  />
                                  <span className="text-[9px] font-semibold text-zinc-400 shrink-0">
                                    {currency}
                                  </span>
                                  {isLinkedToSupplierQuote && <SupplierQuoteCostHint />}
                                </div>
                              </div>
                              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                  {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })} (%)
                                  <FieldTooltip
                                    description={t('sales:fieldInfo.mol', {
                                      defaultValue: 'Margin overhead loading percentage',
                                    })}
                                    status={readOnlyStatus}
                                    statusLabel={statusLabel}
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={molPercentage}
                                    formatDecimals={1}
                                    onValueChange={handleMolChange}
                                    disabled={isReadOnly}
                                    className="w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                  />
                                  <span className="text-[9px] font-semibold text-zinc-400 shrink-0">
                                    %
                                  </span>
                                </div>
                              </div>
                              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                  {t('sales:clientQuotes.totalCost', {
                                    defaultValue: 'Total cost',
                                  })}
                                </div>
                                <div className="text-xs font-bold text-zinc-700 whitespace-nowrap">
                                  {lineCost.toFixed(2)} {currency}
                                </div>
                              </div>
                              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                  {t('sales:clientQuotes.marginLabel')}
                                </div>
                                <div className="text-xs font-bold text-emerald-600 whitespace-nowrap">
                                  {lineMargin.toFixed(2)} {currency}
                                </div>
                              </div>
                              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1 col-span-2 md:col-span-1">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                  {t('sales:clientQuotes.revenue')}
                                </div>
                                <div className="text-sm font-semibold whitespace-nowrap text-zinc-800">
                                  {lineSalePrice.toFixed(2)} {currency}
                                </div>
                              </div>
                            </div>
                            <div className="hidden lg:flex gap-2 items-center">
                              <div className="flex-1 min-w-0 grid grid-cols-13 gap-2 items-center">
                                <div className="col-span-3 min-w-0">
                                  <SelectControl
                                    options={supplierQuoteSelectOptions}
                                    value={item.supplierQuoteItemId || 'none'}
                                    onChange={(val) =>
                                      updateItem(
                                        index,
                                        'supplierQuoteItemId',
                                        val === 'none' ? '' : (val as string),
                                      )
                                    }
                                    placeholder={t('sales:clientQuotes.selectSupplierQuote')}
                                    displayValue={getSupplierQuoteItemDisplayValue(
                                      item.supplierQuoteItemId,
                                    )}
                                    displayValueIsPlaceholder={!item.supplierQuoteItemId}
                                    searchable={true}
                                    disabled={isReadOnly}
                                    className="min-w-0"
                                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                  />
                                </div>
                                <div className="col-span-3 min-w-0">
                                  <ProductSelectOrFallback
                                    item={item}
                                    index={index}
                                    options={productOptions}
                                    isProductMissing={isLinkedProductMissing(item)}
                                    isReadOnly={isReadOnly}
                                    ariaLabel={t('sales:clientOffers.selectProduct', {
                                      defaultValue: 'Select product',
                                    })}
                                    placeholder={t('sales:clientOffers.selectProduct', {
                                      defaultValue: 'Select product',
                                    })}
                                    onProductChange={updateProductSelection}
                                    className="min-w-0"
                                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <div className="flex items-center gap-1">
                                    <ValidatedNumberInput
                                      step="0.01"
                                      min="0"
                                      required
                                      placeholder={t('sales:clientOffers.qty', {
                                        defaultValue: 'Qty',
                                      })}
                                      value={item.quantity}
                                      onValueChange={(value) =>
                                        updateItem(index, 'quantity', parseNumberInputValue(value))
                                      }
                                      disabled={isReadOnly || isLinkedToSupplierQuote}
                                      className="w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <span className="text-xs font-semibold text-zinc-400 shrink-0">
                                      /
                                    </span>
                                    <UnitTypeSelector
                                      value={(item.unitType || 'hours') as SupplierUnitType}
                                      onChange={(val) => handleUnitTypeChange(index, val)}
                                      isSupply={isSupply}
                                      quantity={Number(item.quantity) || 0}
                                      disabled={isReadOnly || isLinkedToSupplierQuote}
                                    />
                                  </div>
                                </div>
                                <div className="col-span-1 flex flex-col items-center justify-center gap-1">
                                  <div className="flex items-center gap-1 w-full">
                                    <ValidatedNumberInput
                                      value={cost}
                                      formatDecimals={2}
                                      onValueChange={handleCostChange}
                                      disabled={isReadOnly || isLinkedToSupplierQuote}
                                      className="w-full text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <span className="text-[9px] font-semibold text-zinc-400 shrink-0">
                                      {currency}
                                    </span>
                                    {isLinkedToSupplierQuote && <SupplierQuoteCostHint />}
                                  </div>
                                </div>
                                <div className="col-span-1 flex items-center justify-center gap-1">
                                  <ValidatedNumberInput
                                    value={molPercentage}
                                    formatDecimals={1}
                                    onValueChange={handleMolChange}
                                    disabled={isReadOnly}
                                    className="w-full text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                  />
                                  <span className="text-[9px] font-semibold text-zinc-400 shrink-0">
                                    %
                                  </span>
                                </div>
                                <div className="col-span-1 flex items-center justify-center">
                                  <span className="text-xs font-bold text-zinc-700 whitespace-nowrap">
                                    {lineCost.toFixed(2)} {currency}
                                  </span>
                                </div>
                                <div className="col-span-1 flex items-center justify-center">
                                  <span className="text-xs font-bold text-emerald-600 whitespace-nowrap">
                                    {lineMargin.toFixed(2)} {currency}
                                  </span>
                                </div>
                                <div className="col-span-1 flex items-center justify-center">
                                  <span className="text-xs font-semibold whitespace-nowrap text-zinc-800">
                                    {lineSalePrice.toFixed(2)} {currency}
                                  </span>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => removeItem(index)}
                                disabled={isReadOnly}
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                              >
                                <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                                <span className="sr-only">{t('common:buttons.delete')}</span>
                              </Button>
                            </div>
                            <Input
                              type="text"
                              placeholder={t('form:placeholderNotes', {
                                defaultValue: 'Optional notes...',
                              })}
                              value={item.note || ''}
                              onChange={(event) => updateItem(index, 'note', event.target.value)}
                              disabled={isReadOnly}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                      {t('sales:clientOffers.noItemsAdded', { defaultValue: 'No items added yet' })}
                    </div>
                  )}
                </div>

                {(() => {
                  const discountValue = Number.isNaN(formData.discount ?? 0)
                    ? 0
                    : (formData.discount ?? 0);
                  const { subtotal, discountAmount, total, margin, marginPercentage } =
                    calculatePricingTotals(
                      formData.items || [],
                      discountValue,
                      'hours',
                      formData.discountType || 'percentage',
                    );
                  return (
                    <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
                      <Field className="md:w-2/3">
                        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                          <span className="size-1.5 rounded-full bg-primary"></span>
                          {t('sales:clientOffers.notes', { defaultValue: 'Notes' })}
                          <FieldTooltip
                            description={t('sales:fieldInfo.notes', {
                              defaultValue: 'Additional notes for the entire document',
                            })}
                            status={readOnlyStatus}
                            statusLabel={statusLabel}
                          />
                        </h4>
                        <FieldLabel htmlFor="client-offer-notes" className="sr-only">
                          {t('sales:clientOffers.notes', { defaultValue: 'Notes' })}
                        </FieldLabel>
                        <Textarea
                          id="client-offer-notes"
                          rows={4}
                          value={formData.notes || ''}
                          disabled={isReadOnly}
                          placeholder={t('sales:clientOffers.additionalNotesPlaceholder', {
                            defaultValue: 'Additional notes...',
                          })}
                          onChange={(event) =>
                            setFormData((prev) => ({ ...prev, notes: event.target.value }))
                          }
                          className="min-h-28 resize-none"
                        />
                      </Field>
                      <div className="space-y-2 md:w-1/3">
                        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                          <span className="size-1.5 rounded-full bg-primary"></span>
                          {t('sales:clientOffers.summary', { defaultValue: 'Summary' })}
                        </h4>
                        <CostSummaryPanel
                          currency={currency}
                          subtotal={subtotal}
                          total={total}
                          subtotalLabel={t('sales:clientOffers.subtotal', {
                            defaultValue: 'Subtotal',
                          })}
                          totalLabel={t('sales:clientOffers.total', { defaultValue: 'Total' })}
                          globalDiscount={{
                            label: t('sales:clientOffers.globalDiscount', {
                              defaultValue: 'Global Discount',
                            }),
                            value: formData.discount || 0,
                            type: formData.discountType || 'percentage',
                            onChange: (value) =>
                              setFormData((prev) => ({
                                ...prev,
                                discount: value === '' ? 0 : Number(value),
                              })),
                            onTypeChange: (type) =>
                              setFormData((prev) => ({ ...prev, discountType: type })),
                            disabled: isReadOnly,
                          }}
                          discountRow={
                            discountAmount > 0
                              ? {
                                  label: t('sales:clientOffers.discountAmount', {
                                    value: getDiscountPercentageLabelValue(
                                      discountValue,
                                      formData.discountType ?? 'percentage',
                                      subtotal,
                                      discountAmount,
                                    ),
                                  }),
                                  amount: discountAmount,
                                }
                              : undefined
                          }
                          margin={{
                            label: `${t('sales:clientOffers.margin', { defaultValue: 'Margin' })} (${(marginPercentage || 0).toFixed(1)}%)`,
                            amount: margin,
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}
              </ModalBody>

              <ModalFooter>
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  {t('common:buttons.cancel')}
                </Button>
                {!isReadOnly && (
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting
                      ? t('common:buttons.saving')
                      : editingOffer
                        ? t('common:buttons.update')
                        : t('common:buttons.save')}
                  </Button>
                )}
              </ModalFooter>
            </form>
          </ModalContent>
          {editingOffer?.id && (
            <OfferVersionsPanel
              offerId={editingOffer.id}
              selectedVersionId={previewVersion?.id ?? null}
              onPreview={handleVersionPreview}
              onClearPreview={handleClearPreview}
              onRestored={handleVersionRestored}
              disabled={baseReadOnly}
            />
          )}
        </div>
      </Modal>

      <Modal isOpen={isRevertConfirmOpen} onClose={closeRevertConfirm} ariaLabel={null}>
        {() => (
          <ModalContent size="sm">
            <ModalHeader>
              <ModalTitle>
                {t('sales:clientOffers.revertToDraftTitle', {
                  defaultValue: 'Revert offer to Draft?',
                })}
              </ModalTitle>
              <ModalCloseButton onClick={closeRevertConfirm} />
            </ModalHeader>
            <ModalBody className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('sales:clientOffers.revertToDraftDescription', {
                  defaultValue:
                    'This moves {{offerId}} from {{status}} back to Draft and records the change in the audit trail.',
                  offerId: offerToRevert?.id ?? '',
                  status: offerToRevert ? getStatusLabel(offerToRevert.status) : '',
                })}
              </p>
              <Field>
                <FieldLabel htmlFor="client-offer-revert-reason">
                  {t('sales:clientOffers.revertReasonLabel', {
                    defaultValue: 'Reason',
                  })}
                </FieldLabel>
                <Textarea
                  id="client-offer-revert-reason"
                  value={revertReason}
                  onChange={(event) => setRevertReason(event.target.value)}
                  disabled={isReverting}
                  placeholder={t('sales:clientOffers.revertReasonPlaceholder', {
                    defaultValue: 'Optional note for the audit trail',
                  })}
                  className="min-h-24 resize-none"
                />
              </Field>
            </ModalBody>
            <ModalFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeRevertConfirm}
                disabled={isReverting}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleRevertToDraft}
                disabled={isReverting}
              >
                {isReverting
                  ? t('common:buttons.saving')
                  : t('sales:clientOffers.confirmRevertToDraft', {
                      defaultValue: 'Revert to Draft',
                    })}
              </Button>
            </ModalFooter>
          </ModalContent>
        )}
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          if (isDeleting) return;
          setIsDeleteConfirmOpen(false);
        }}
        onConfirm={async () => {
          if (!offerToDelete) return;
          if (isDeleting) return;
          setIsDeleting(true);
          try {
            await onDeleteOffer(offerToDelete.id);
            setIsDeleteConfirmOpen(false);
            setOfferToDelete(null);
          } catch (err) {
            toastError((err as Error).message || t('sales:clientOffers.failedToDelete'));
          } finally {
            setIsDeleting(false);
          }
        }}
        isDeleting={isDeleting}
        title={t('sales:clientOffers.deleteTitle', { defaultValue: 'Delete offer?' })}
        description={offerToDelete?.id ?? ''}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">
              {t('sales:clientOffers.title', { defaultValue: 'Client Offers' })}
            </h2>
            <p className="text-zinc-500 text-sm">
              {t('sales:clientOffers.subtitle', {
                defaultValue: 'Offers created from customer quotes.',
              })}
            </p>
          </div>
          {onAddOffer && (
            <HeaderAddButton onClick={openAddModal}>
              {t('sales:clientOffers.addOffer', { defaultValue: 'Add offer' })}
            </HeaderAddButton>
          )}
        </div>
      </div>

      <StandardTable<ClientOffer>
        title={t('sales:clientOffers.activeOffers', { defaultValue: 'Customer offers' })}
        viewKey="sales.client_offers"
        data={offers}
        columns={columns}
        defaultRowsPerPage={5}
        onRowClick={(row) => openEditModal(row)}
        rowClassName={() => 'cursor-pointer hover:bg-zinc-50/50'}
        initialFilterState={tableInitialFilterState}
      />
    </div>
  );
};

export default ClientOffersView;
