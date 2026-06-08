import { RotateCcw } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useReducer, useState } from 'react';
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
  DurationUnit,
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
  durationValueToMonths,
  getDurationDisplayValue,
  getItemPricingContext,
  isUnitLine,
  normalizeDurationUnit,
  parseDurationValueToMonths,
  parseNumberInputValue,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';
import {
  buildProductQuickViewHref,
  buildQuoteIdBySupplierQuoteItemId,
  buildSupplierQuoteQuickViewHref,
  resolveLinkedSupplierQuoteId,
} from '../../utils/quickViewLinks';
import { toastError } from '../../utils/toast';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DateField from '../shared/DateField';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import DurationUnitSelector from '../shared/DurationUnitSelector';
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
import QuickViewLinkButton from '../shared/QuickViewLinkButton';
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
  canViewSupplierQuotes?: boolean;
  canViewInternalListing?: boolean;
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

interface ClientOffersViewState {
  editingOffer: ClientOffer | null;
  offerToDelete: ClientOffer | null;
  offerToRevert: ClientOffer | null;
  revertReason: string;
  isModalOpen: boolean;
  isDeleteConfirmOpen: boolean;
  isRevertConfirmOpen: boolean;
  isSubmitting: boolean;
  isDeleting: boolean;
  isReverting: boolean;
}

const INITIAL_CLIENT_OFFERS_VIEW_STATE: ClientOffersViewState = {
  editingOffer: null,
  offerToDelete: null,
  offerToRevert: null,
  revertReason: '',
  isModalOpen: false,
  isDeleteConfirmOpen: false,
  isRevertConfirmOpen: false,
  isSubmitting: false,
  isDeleting: false,
  isReverting: false,
};

type ClientOffersViewAction =
  | { type: 'openEditModal'; offer: ClientOffer }
  | { type: 'openAddModal' }
  | { type: 'setEditingOffer'; offer: ClientOffer | null }
  | { type: 'closeModal' }
  | { type: 'openRevertConfirm'; offer: ClientOffer }
  | { type: 'closeRevertConfirm' }
  | { type: 'revertSuccess' }
  | { type: 'setRevertReason'; value: string }
  | { type: 'setIsReverting'; value: boolean }
  | { type: 'promptDelete'; offer: ClientOffer }
  | { type: 'closeDeleteConfirm' }
  | { type: 'deleteSuccess' }
  | { type: 'setIsDeleting'; value: boolean }
  | { type: 'setIsSubmitting'; value: boolean };

const clientOffersViewReducer = (
  state: ClientOffersViewState,
  action: ClientOffersViewAction,
): ClientOffersViewState => {
  switch (action.type) {
    case 'openEditModal':
      return { ...state, editingOffer: action.offer, isModalOpen: true };
    case 'openAddModal':
      return { ...state, editingOffer: null, isModalOpen: true };
    case 'setEditingOffer':
      return { ...state, editingOffer: action.offer };
    case 'closeModal':
      return { ...state, isModalOpen: false };
    case 'openRevertConfirm':
      return {
        ...state,
        offerToRevert: action.offer,
        revertReason: '',
        isRevertConfirmOpen: true,
      };
    case 'closeRevertConfirm':
      return {
        ...state,
        isRevertConfirmOpen: false,
        offerToRevert: null,
        revertReason: '',
      };
    case 'revertSuccess':
      return {
        ...state,
        isRevertConfirmOpen: false,
        offerToRevert: null,
        revertReason: '',
      };
    case 'setRevertReason':
      return { ...state, revertReason: action.value };
    case 'setIsReverting':
      return { ...state, isReverting: action.value };
    case 'promptDelete':
      return { ...state, offerToDelete: action.offer, isDeleteConfirmOpen: true };
    case 'closeDeleteConfirm':
      return { ...state, isDeleteConfirmOpen: false };
    case 'deleteSuccess':
      return { ...state, isDeleteConfirmOpen: false, offerToDelete: null };
    case 'setIsDeleting':
      return { ...state, isDeleting: action.value };
    case 'setIsSubmitting':
      return { ...state, isSubmitting: action.value };
    default:
      return state;
  }
};

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
  canViewSupplierQuotes = true,
  canViewInternalListing = true,
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

  // Deep-link target id sets, built from ALL records (not just the active/accepted
  // options) so a quick-view shortcut on a line that references a now-archived
  // supplier quote / product still lands on the referenced record instead of the
  // full listing.
  const allProductIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const allSupplierQuoteIds = useMemo(
    () => new Set(supplierQuotes.map((q) => q.id)),
    [supplierQuotes],
  );
  const quoteIdBySupplierQuoteItemId = useMemo(
    () => buildQuoteIdBySupplierQuoteItemId(supplierQuotes),
    [supplierQuotes],
  );

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

  const [state, dispatch] = useReducer(clientOffersViewReducer, INITIAL_CLIENT_OFFERS_VIEW_STATE);
  const {
    editingOffer,
    offerToDelete,
    offerToRevert,
    revertReason,
    isModalOpen,
    isDeleteConfirmOpen,
    isRevertConfirmOpen,
    isSubmitting,
    isDeleting,
    isReverting,
  } = state;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<ClientOffer>>(() => getDefaultFormData());
  const [previewVersion, setPreviewVersion] = useState<OfferVersion | null>(null);

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
    dispatch({ type: 'openEditModal', offer });
    setFormData(offerToFormData(offer));
    setErrors({});
    setPreviewVersion(null);
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
      dispatch({ type: 'setEditingOffer', offer: updated });
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
    dispatch({ type: 'openRevertConfirm', offer });
  };

  const closeRevertConfirm = () => {
    if (isReverting) return;
    dispatch({ type: 'closeRevertConfirm' });
  };

  const handleRevertToDraft = async () => {
    if (!offerToRevert || !onRevertOfferToDraft || isReverting) return;
    dispatch({ type: 'setIsReverting', value: true });
    try {
      const reason = revertReason.trim();
      await onRevertOfferToDraft(offerToRevert.id, reason || undefined);
      dispatch({ type: 'revertSuccess' });
    } catch (err) {
      toastError((err as Error).message || t('sales:clientOffers.failedToUpdateStatus'));
    } finally {
      dispatch({ type: 'setIsReverting', value: false });
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
            {marginPercentage.toFixed(2)}%
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
                        dispatch({ type: 'promptDelete', offer: row });
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
    dispatch({ type: 'openAddModal' });
    setFormData(getDefaultFormData());
    setErrors({});
    setPreviewVersion(null);
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
      durationMonths: 1,
      durationUnit: 'months',
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

  // Duration value entered in the item's chosen unit (issue #757). Stored canonically as whole
  // months; 'years' multiplies by 12. Empty/invalid input falls back to 1 of the chosen unit.
  const handleDurationValueChange = (index: number, value: string) => {
    if (isReadOnly) return;
    const unit = normalizeDurationUnit(formData.items?.[index]?.durationUnit);
    updateItem(index, 'durationMonths', parseDurationValueToMonths(value, unit));
  };

  // Switching months↔years keeps the displayed number and reinterprets it under the new unit
  // (e.g. "2" months → "2" years = 24 months), mirroring how the quantity unit selector behaves.
  const handleDurationUnitChange = (index: number, newUnit: DurationUnit) => {
    if (isReadOnly) return;
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const item = items[index];
      if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return prev;
      const displayValue = getDurationDisplayValue(item);
      items[index] = {
        ...items[index],
        durationUnit: newUnit,
        durationMonths: durationValueToMonths(displayValue, newUnit),
      };
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
        // Unit-measured lines cannot carry a duration — coerce to a single month.
        durationMonths: isUnitLine(item) ? 1 : Number(item.durationMonths ?? 1) || 1,
        durationUnit: normalizeDurationUnit(isUnitLine(item) ? 'months' : item.durationUnit),
      })),
    };

    dispatch({ type: 'setIsSubmitting', value: true });
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
      dispatch({ type: 'setIsSubmitting', value: false });
    }
    dispatch({ type: 'closeModal' });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => dispatch({ type: 'closeModal' })}>
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
                <ModalCloseButton onClick={() => dispatch({ type: 'closeModal' })} />
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
                        required
                        buttonClassName="h-9"
                        className={errors.clientId ? 'border-red-300' : ''}
                      />
                      <FieldError className="text-xs">{errors.clientId}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(errors.id)}>
                      <FieldLabel htmlFor="client-offer-code" required>
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
                      <FieldLabel htmlFor="client-offer-expiration-date" required>
                        {t('sales:clientOffers.expirationDate', {
                          defaultValue: 'Expiration date',
                        })}
                      </FieldLabel>
                      <DateField
                        id="client-offer-expiration-date"
                        required
                        value={formData.expirationDate || ''}
                        disabled={isReadOnly}
                        onChange={(value) =>
                          setFormData((prev) => ({ ...prev, expirationDate: value }))
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
                      <div className="flex-1 min-w-0 grid grid-cols-16 gap-2">
                        <div className="col-span-3 text-[10px] font-black text-zinc-400 uppercase tracking-wider ml-1">
                          {t('sales:clientQuotes.supplierQuoteColumn')}
                        </div>
                        <div className="col-span-3 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                          {t('sales:clientOffers.product', { defaultValue: 'Product' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center whitespace-nowrap">
                          {t('sales:clientOffers.durationColumn', { defaultValue: 'Duration' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
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
                          durationMonths,
                        } = getItemPricingContext(item);
                        // Duration is stored as canonical months; show it in the item's unit.
                        const durationUnit = normalizeDurationUnit(item.durationUnit);
                        const durationValue = getDurationDisplayValue(item);
                        // "Unit"-measured lines can't carry a duration → Durata shows N/A.
                        const isUnitDurationLine = isUnitLine(item);
                        const unitSalePrice = Number(item.unitPrice || 0);
                        const lineSalePrice = unitSalePrice * quantity * durationMonths;
                        const lineMargin = lineSalePrice - lineCost;

                        const isLinkedToSupplierQuote = Boolean(item.supplierQuoteItemId);
                        const supplierQuoteHref = buildSupplierQuoteQuickViewHref(
                          resolveLinkedSupplierQuoteId(item, quoteIdBySupplierQuoteItemId),
                          allSupplierQuoteIds,
                        );
                        const productHref = buildProductQuickViewHref(
                          item.productId,
                          allProductIds,
                        );
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
                                  <div className="flex items-center gap-1">
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
                                      className="min-w-0 flex-1"
                                      buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                    />
                                    {canViewSupplierQuotes && (
                                      <QuickViewLinkButton
                                        href={supplierQuoteHref}
                                        label={t('sales:clientQuotes.openSupplierQuoteInNewTab')}
                                        disabledLabel={t(
                                          'sales:clientQuotes.supplierQuoteShortcutUnavailable',
                                        )}
                                      />
                                    )}
                                  </div>
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
                                  <div className="flex items-center gap-1">
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
                                      className="min-w-0 flex-1"
                                      buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                    />
                                    {canViewInternalListing && (
                                      <QuickViewLinkButton
                                        href={productHref}
                                        label={t('sales:clientQuotes.openProductInNewTab')}
                                        disabledLabel={t(
                                          'sales:clientQuotes.productShortcutUnavailable',
                                        )}
                                      />
                                    )}
                                  </div>
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
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-7 lg:hidden">
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
                              <div>
                                <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                  {t('sales:clientOffers.durationColumn', {
                                    defaultValue: 'Duration',
                                  })}
                                  <FieldTooltip
                                    description={t('sales:fieldInfo.duration', {
                                      defaultValue: 'Number of months the service runs',
                                    })}
                                    status={readOnlyStatus}
                                    statusLabel={statusLabel}
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  {isUnitDurationLine ? (
                                    <span className="text-sm font-medium text-zinc-400">
                                      {t('common:labels.notApplicable')}
                                    </span>
                                  ) : (
                                    <>
                                      <ValidatedNumberInput
                                        step="1"
                                        min="1"
                                        placeholder={t('sales:clientOffers.durationColumn', {
                                          defaultValue: 'Duration',
                                        })}
                                        value={durationValue}
                                        onValueChange={(value) =>
                                          handleDurationValueChange(index, value)
                                        }
                                        disabled={isReadOnly}
                                        className="w-full text-sm px-3 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed flex-1"
                                      />
                                      <span className="text-xs font-semibold text-zinc-400 shrink-0">
                                        /
                                      </span>
                                      <DurationUnitSelector
                                        value={durationUnit}
                                        onChange={(val) => handleDurationUnitChange(index, val)}
                                        count={durationValue}
                                        disabled={isReadOnly}
                                      />
                                    </>
                                  )}
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
                              <div className="flex-1 min-w-0 grid grid-cols-16 gap-2 items-center pt-5">
                                <div className="relative col-span-3 min-w-0">
                                  {canViewSupplierQuotes && (
                                    <QuickViewLinkButton
                                      href={supplierQuoteHref}
                                      label={t('sales:clientQuotes.openSupplierQuoteInNewTab')}
                                      disabledLabel={t(
                                        'sales:clientQuotes.supplierQuoteShortcutUnavailable',
                                      )}
                                      floating
                                    />
                                  )}
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
                                    className="w-full min-w-0"
                                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                  />
                                </div>
                                <div className="relative col-span-3 min-w-0">
                                  {canViewInternalListing && (
                                    <QuickViewLinkButton
                                      href={productHref}
                                      label={t('sales:clientQuotes.openProductInNewTab')}
                                      disabledLabel={t(
                                        'sales:clientQuotes.productShortcutUnavailable',
                                      )}
                                      floating
                                    />
                                  )}
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
                                    className="w-full min-w-0"
                                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <div className="flex items-center justify-center gap-1">
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
                                      className="w-full max-w-[5rem] text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
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
                                <div className="col-span-2 flex items-center justify-center gap-1">
                                  {isUnitDurationLine ? (
                                    <span className="text-sm font-medium text-zinc-400">
                                      {t('common:labels.notApplicable')}
                                    </span>
                                  ) : (
                                    <>
                                      <ValidatedNumberInput
                                        step="1"
                                        min="1"
                                        placeholder={t('sales:clientOffers.durationColumn', {
                                          defaultValue: 'Duration',
                                        })}
                                        value={durationValue}
                                        onValueChange={(value) =>
                                          handleDurationValueChange(index, value)
                                        }
                                        disabled={isReadOnly}
                                        className="w-full max-w-[5rem] text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                      />
                                      <span className="text-[9px] font-semibold text-zinc-400 shrink-0">
                                        /
                                      </span>
                                      <DurationUnitSelector
                                        value={durationUnit}
                                        onChange={(val) => handleDurationUnitChange(index, val)}
                                        count={durationValue}
                                        disabled={isReadOnly}
                                      />
                                    </>
                                  )}
                                </div>
                                <div className="relative col-span-2 flex flex-col items-center justify-center gap-1">
                                  {isLinkedToSupplierQuote && (
                                    <div className="absolute right-0.5 -top-1 z-10 -translate-y-full">
                                      <SupplierQuoteCostHint />
                                    </div>
                                  )}
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
                            label: `${t('sales:clientOffers.margin', { defaultValue: 'Margin' })} (${(marginPercentage || 0).toFixed(2)}%)`,
                            amount: margin,
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}
              </ModalBody>

              <ModalFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => dispatch({ type: 'closeModal' })}
                >
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
                  onChange={(event) =>
                    dispatch({ type: 'setRevertReason', value: event.target.value })
                  }
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
          dispatch({ type: 'closeDeleteConfirm' });
        }}
        onConfirm={async () => {
          if (!offerToDelete) return;
          if (isDeleting) return;
          dispatch({ type: 'setIsDeleting', value: true });
          try {
            await onDeleteOffer(offerToDelete.id);
            dispatch({ type: 'deleteSuccess' });
          } catch (err) {
            toastError((err as Error).message || t('sales:clientOffers.failedToDelete'));
          } finally {
            dispatch({ type: 'setIsDeleting', value: false });
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
