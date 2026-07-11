import { RotateCcw } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDocumentCodePreview } from '../../hooks/useDocumentCodePreview';
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
import { createLineItemIndexResolver } from '../../utils/lineItemIndex';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  durationValueToMonths,
  formatDecimal,
  formatMolPercentage,
  formatNumber,
  getDurationDisplayValue,
  getItemPricingContext,
  MOL_PERCENTAGE_DECIMALS,
  normalizeDurationUnit,
  type PricingTotals,
  parseDurationValueToMonths,
  parseNumberInputValue,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';
import {
  buildProductQuickViewHref,
  buildSupplierQuoteQuickViewHref,
  resolveLinkedSupplierQuoteId,
} from '../../utils/quickViewLinks';
import { effectiveQuoteStatus } from '../../utils/quoteStatus';
import {
  buildSupplierQuoteItemIndex,
  isSupplierLineLocked,
  isSupplierLineStale,
  pickedSupplierLineFields,
  refreshedSupplierLineFields,
} from '../../utils/supplierLineSync';
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
import StaleSupplierDataButton from '../shared/StaleSupplierDataButton';
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
  return formatNumber(rounded, { maximumFractionDigits: 2 });
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

// Fallback for a row whose pricing isn't in the memoized map (never happens at runtime since
// the map is built from the same list the table renders, but keeps the lookups type-safe).
const EMPTY_PRICING_TOTALS: PricingTotals = {
  subtotal: 0,
  discountAmount: 0,
  total: 0,
  totalCost: 0,
  margin: 0,
  marginPercentage: 0,
};

// One label shape for a supplier-quote line item, shared by the picker options and the
// display-value lookup so the two can never drift.
const supplierQuoteItemLabel = (quote: SupplierQuote, item: SupplierQuote['items'][number]) =>
  `${quote.supplierName} · ${item.productName} (${formatDecimal(item.unitPrice)})`;

const useClientOffersController = ({
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
}: ClientOffersViewProps) => {
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

  // Lines source from DRAFT supplier quotes (#779 derived model): a supplier quote starts as
  // draft and progresses only with the client document that uses it. Order-locked quotes are
  // final procurement — sourcing them would mint a line whose sync the server refuses. The date
  // check is a stale-cache belt — expired never reads as draft.
  const sourceableSupplierQuotes = useMemo(
    () =>
      supplierQuotes.filter(
        (q) =>
          q.status === 'draft' &&
          !q.linkedOrderId &&
          !isDateOnlyBeforeToday(q.expirationDate, today),
      ),
    [supplierQuotes, today],
  );

  const supplierQuoteItemOptions = useMemo(() => {
    const options: Array<{ id: string; name: string }> = [];
    for (const quote of sourceableSupplierQuotes) {
      for (const item of quote.items) {
        options.push({ id: item.id, name: supplierQuoteItemLabel(quote, item) });
      }
    }
    return options;
  }, [sourceableSupplierQuotes]);

  const supplierQuoteSelectOptions = useMemo(
    () => [
      { id: 'none' as const, name: t('sales:clientQuotes.noSupplierQuote') },
      ...supplierQuoteItemOptions.map((o) => ({ id: o.id, name: o.name })),
    ],
    [supplierQuoteItemOptions, t],
  );

  // item-id → its CURRENT supplier quote + item, across ALL supplier quotes (not just the
  // selectable ones), for the bidirectional-sync affordances (#779): lock detection
  // (order-locked/frozen sourced fields) and stale-data detection (the per-line
  // "data drifted — sync?" refresh button). Quick-view ids and display labels derive from it,
  // so an existing line referencing a no-longer-selectable but extant quote still resolves.
  const supplierQuoteItemIndex = useMemo(
    () => buildSupplierQuoteItemIndex(supplierQuotes),
    [supplierQuotes],
  );

  const getSupplierQuoteItemDisplayValue = (itemId?: string | null) => {
    const ref = itemId ? supplierQuoteItemIndex.get(itemId) : undefined;
    return ref
      ? supplierQuoteItemLabel(ref.quote, ref.item)
      : t('sales:clientQuotes.noSupplierQuote');
  };

  // Pulls the linked supplier item's current quantity/cost back into the line, mirroring the
  // linking math: the sale price is recomputed from the refreshed cost and the line's MOL (#779).
  const refreshLineFromSupplier = (index: number, source: SupplierQuote['items'][number]) => {
    if (isReadOnly) return;
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const cur = items[index];
      if (!cur) return prev;
      items[index] = { ...cur, ...refreshedSupplierLineFields(cur, source) };
      return { ...prev, items };
    });
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
  // O(1) item-id → parent-quote-id projection for the shared quick-view helpers.
  const quoteIdBySupplierQuoteItemId = useMemo(
    () => new Map(Array.from(supplierQuoteItemIndex, ([id, ref]) => [id, ref.quote.id] as const)),
    [supplierQuoteItemIndex],
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
  const isSourcedCreate = !editingOffer && Boolean(formData.linkedQuoteId);
  const { preview: clientOfferCodePreview } = useDocumentCodePreview('client_offer', {
    enabled: isModalOpen && !editingOffer && !isSourcedCreate,
  });
  const [previewVersion, setPreviewVersion] = useState<OfferVersion | null>(null);
  const [productRowToDelete, setProductRowToDelete] = useState<number | null>(null);

  const closeModal = useCallback(() => {
    dispatch({ type: 'closeModal' });
    setProductRowToDelete(null);
  }, []);

  // Derived #779 status: the server-computed effectiveStatus is OR-combined with the local date
  // derivation, so a row that crosses its expiration while the list sits unrefreshed (midnight
  // rollover) still locks, and a server-flagged row stays locked under clock skew. Terminal
  // accepted/denied never expire — the shared model returns them unchanged for any date.
  const isOfferExpired = useCallback(
    (offer: ClientOffer) =>
      offer.effectiveStatus === 'expired' ||
      effectiveQuoteStatus(offer.status, isDateOnlyBeforeToday(offer.expirationDate, today)) ===
        'expired',
    [today],
  );

  // Single derived-status policy for the Status column: the badge, the filter options, and
  // sorting all use this value, so an expired offer surfaces as a filterable "Expired" entry
  // instead of hiding under its stored Draft/Sent (#779).
  const effectiveRowStatus = useCallback(
    (offer: ClientOffer) => (isOfferExpired(offer) ? 'expired' : offer.status),
    [isOfferExpired],
  );

  const isEditingExpired = Boolean(editingOffer && isOfferExpired(editingOffer));
  // Expired offers are read-only EXCEPT their expiration date — extending it is the only exit
  // from `expired` (issue #779) — so an expired DRAFT offer locks too.
  const baseReadOnly = Boolean(
    editingOffer && (editingOffer.status !== 'draft' || isEditingExpired),
  );
  const isReadOnly = baseReadOnly || previewVersion !== null;
  const isClientLocked = Boolean(editingOffer?.linkedQuoteId);
  // Expired offers only (quote-style): the expiration DateField stays enabled while the rest of
  // the form is read-only, because extending the date is the one exit from `expired` (#779).
  // Valid sent offers stay fully read-only in the form — exposing the date there invited no-op
  // submits that wrote needless version snapshots and audit rows.
  const expirationEditableWhileReadOnly = isEditingExpired && previewVersion === null;

  const readOnlyReason = isEditingExpired
    ? t('sales:clientOffers.readOnlyExpired', {
        defaultValue:
          'Read-only: the offer has expired — extend the expiration date to revalidate it',
      })
    : t('sales:clientOffers.readOnlyStatus', {
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
      if (status === 'expired') {
        return t('sales:clientOffers.statusExpired', { defaultValue: 'Expired' });
      }
      const option = STATUS_OPTIONS.find((o) => o.id === status);
      return option ? option.name : status;
    },
    [STATUS_OPTIONS, t],
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

  // Compute each row's pricing once per offers change, so the column accessors and cells below
  // read from this map instead of recomputing calculatePricingTotals (an O(line-items) pass)
  // twice per column for every visible row.
  const offerPricingMap = useMemo(() => {
    const map = new Map<string, PricingTotals>();
    for (const offer of offers) {
      map.set(
        offer.id,
        calculatePricingTotals(offer.items, offer.discount, 'hours', offer.discountType),
      );
    }
    return map;
  }, [offers]);

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
      accessorFn: (row) => offerPricingMap.get(row.id)?.subtotal ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { subtotal } = offerPricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        return (
          <span className="text-sm font-semibold text-zinc-700 whitespace-nowrap">
            {formatDecimal(subtotal)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.discountPercentColumn', { defaultValue: 'Discount %' }),
      id: 'globalDiscount',
      accessorFn: (row) => {
        const { subtotal, discountAmount } = offerPricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        return getDiscountPercentageValue(row.discount, row.discountType, subtotal, discountAmount);
      },
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { subtotal, discountAmount } = offerPricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
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
      accessorFn: (row) => offerPricingMap.get(row.id)?.discountAmount ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { discountAmount } = offerPricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        if (discountAmount <= 0) {
          return <span className="text-sm font-semibold text-zinc-400">-</span>;
        }
        return (
          <span className="text-sm font-semibold text-amber-600 whitespace-nowrap">
            -{formatDecimal(discountAmount)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.discountedTotalColumn', { defaultValue: 'Discounted total' }),
      id: 'total',
      accessorFn: (row) => offerPricingMap.get(row.id)?.total ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { total } = offerPricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        return (
          <span className="text-sm font-bold text-zinc-700 whitespace-nowrap">
            {formatDecimal(total)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.margin', { defaultValue: 'Margin' }),
      id: 'margin',
      accessorFn: (row) => offerPricingMap.get(row.id)?.margin ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { margin } = offerPricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        return (
          <span className="text-sm font-bold text-emerald-600 whitespace-nowrap">
            {formatDecimal(margin)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientOffers.molColumn', { defaultValue: 'MOL' }),
      id: 'mol',
      accessorFn: (row) => offerPricingMap.get(row.id)?.marginPercentage ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[6rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { marginPercentage } = offerPricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        return (
          <span className="text-sm font-semibold text-emerald-700 whitespace-nowrap">
            {formatMolPercentage(marginPercentage)}
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
      // Filter/sort on the DERIVED status (#779): expired offers get their own filter option.
      accessorFn: effectiveRowStatus,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      cell: ({ row }) => {
        const badgeStatus = effectiveRowStatus(row) as StatusType;
        return <StatusBadge type={badgeStatus} label={getStatusLabel(badgeStatus)} />;
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
        // Scaduto freezes status transitions — the only exit is extending the expiration date
        // from the edit modal (issue #779); the server enforces the same rule with a 409.
        const expired = isOfferExpired(row);
        const expiredTitle = t('sales:clientOffers.expiredActionsDisabled', {
          defaultValue: 'Expired offers cannot change status; extend the expiration date.',
        });
        const deleteTitle = expired
          ? t('sales:clientOffers.expiredCannotDelete', {
              defaultValue: 'Expired offers cannot be deleted',
            })
          : t('common:buttons.delete');
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
                        if (expired) return;
                        handleStatusUpdate(row.id, { status: 'sent' });
                      }}
                      disabled={expired}
                      aria-label={t('sales:clientOffers.markSent', {
                        defaultValue: 'Mark as sent',
                      })}
                      className={`p-2 rounded-lg transition-all text-blue-700 ${expired ? 'cursor-not-allowed opacity-50' : 'hover:text-blue-600 hover:bg-blue-50'}`}
                    >
                      <i className="fa-solid fa-paper-plane"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {expired
                    ? expiredTitle
                    : t('sales:clientOffers.markSent', { defaultValue: 'Mark as sent' })}
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
                          if (expired) return;
                          handleStatusUpdate(row.id, { status: 'accepted' });
                        }}
                        disabled={expired}
                        aria-label={t('sales:clientOffers.markAccepted', {
                          defaultValue: 'Mark as accepted',
                        })}
                        className={`p-2 rounded-lg transition-all text-emerald-700 ${expired ? 'cursor-not-allowed opacity-50' : 'hover:text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {expired
                      ? expiredTitle
                      : t('sales:clientOffers.markAccepted', {
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
                          if (expired) return;
                          handleStatusUpdate(row.id, { status: 'denied' });
                        }}
                        disabled={expired}
                        aria-label={t('sales:clientOffers.markDenied', {
                          defaultValue: 'Mark as denied',
                        })}
                        className={`p-2 rounded-lg transition-all text-red-600 ${expired ? 'cursor-not-allowed opacity-50' : 'hover:text-red-600 hover:bg-red-50'}`}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {expired
                      ? expiredTitle
                      : t('sales:clientOffers.markDenied', { defaultValue: 'Mark as denied' })}
                  </TooltipContent>
                </Tooltip>
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
                        onClick={(e) => {
                          e.stopPropagation();
                          if (expired) return;
                          handleStatusUpdate(row.id, { status: 'draft' });
                        }}
                        disabled={expired}
                        className={`text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50 ${expired ? 'cursor-not-allowed opacity-50' : ''}`}
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
                    {expired
                      ? expiredTitle
                      : t('sales:clientOffers.revertToDraft', {
                          defaultValue: 'Revert to Draft',
                        })}
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
                        if (expired) return;
                        dispatch({ type: 'promptDelete', offer: row });
                      }}
                      disabled={expired}
                      aria-label={deleteTitle}
                      className={`p-2 text-red-600 rounded-lg transition-all ${expired ? 'cursor-not-allowed opacity-50' : 'hover:text-red-600 hover:bg-red-50'}`}
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{deleteTitle}</TooltipContent>
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
      discount: 0,
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
          current.supplierQuoteBaseQuantity = null;
          current.supplierQuoteBaseUnitPrice = null;
        }
      }

      if (field === 'supplierQuoteItemId') {
        if (!value) {
          current.supplierQuoteId = null;
          current.supplierQuoteItemId = null;
          current.supplierQuoteSupplierName = null;
          current.supplierQuoteUnitPrice = null;
          current.supplierQuoteBaseQuantity = null;
          current.supplierQuoteBaseUnitPrice = null;

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

        const selectedQuote = sourceableSupplierQuotes.find((quote) =>
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
          current.unitType = selectedQuoteItem.unitType || 'hours';
          if (product) {
            current.productCost = Number(product.costo);
            current.productMolPercentage = product.molPercentage;
          } else {
            current.productCost = netCost;
            current.productMolPercentage = null;
          }
          // Pull quantity, cost, sale price, and duration from the supplier item. The helper also
          // stamps the pick-time quantity/cost baseline used by the server's genuine-edit check.
          Object.assign(current, pickedSupplierLineFields(current, selectedQuoteItem));
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
      // 'N/A' marks the line as duration-less: reset to the neutral 1 month so it never multiplies
      // (issue #775). Months/years instead keeps the displayed number under the new unit.
      const durationMonths =
        newUnit === 'na' ? 1 : durationValueToMonths(getDurationDisplayValue(item), newUnit);
      items[index] = {
        ...items[index],
        durationUnit: newUnit,
        durationMonths,
      };
      return { ...prev, items };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    // Read-only-except-date mode (sent/expired, issue #779): submitting extends ONLY the
    // expiration date. Revalidation needs a date from today onward — a cleared or still-past
    // date would leave the offer expired, so reject it loudly instead of silently "saving".
    if (expirationEditableWhileReadOnly && editingOffer) {
      if (!formData.expirationDate || isDateOnlyBeforeToday(formData.expirationDate, today)) {
        toastError(
          t('sales:clientOffers.expirationExtendInvalid', {
            defaultValue: 'Set an expiration date of today or later to revalidate the offer',
          }),
        );
        return;
      }
      dispatch({ type: 'setIsSubmitting', value: true });
      try {
        await onUpdateOffer(editingOffer.id, { expirationDate: formData.expirationDate });
      } catch (err) {
        toastError((err as Error).message || t('sales:clientOffers.failedToSave'));
        return;
      } finally {
        dispatch({ type: 'setIsSubmitting', value: false });
      }
      closeModal();
      return;
    }
    if (isReadOnly) return;

    const nextErrors: Record<string, string> = {};
    if (!formData.clientId) {
      nextErrors.clientId = t('sales:clientOffers.clientRequired');
    }
    if (editingOffer && !formData.id?.trim()) {
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
      id: formData.id?.trim() || undefined,
      discount: Number(formData.discount ?? 0),
      items: (formData.items || []).map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice ?? 0),
        productCost: Number(item.productCost ?? 0),
        discount: item.discount ?? 0,
        durationMonths: Number(item.durationMonths ?? 1) || 1,
        durationUnit: normalizeDurationUnit(item.durationUnit),
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
    closeModal();
  };

  const formTotals = useMemo(() => {
    const discountValue = Number.isNaN(formData.discount ?? 0) ? 0 : (formData.discount ?? 0);
    return {
      discountValue,
      ...calculatePricingTotals(
        formData.items || [],
        discountValue,
        'hours',
        formData.discountType || 'percentage',
      ),
    };
  }, [formData.discount, formData.discountType, formData.items]);

  const handleDelete = async () => {
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
  };

  return {
    t,
    i18n,
    offers,
    products,
    onAddOffer,
    onViewQuote,
    currency,
    canViewSupplierQuotes,
    canViewInternalListing,
    paymentTermsOptions,
    clientOptions,
    productOptions,
    supplierQuoteSelectOptions,
    supplierQuoteItemIndex,
    getSupplierQuoteItemDisplayValue,
    refreshLineFromSupplier,
    isLinkedProductMissing,
    allProductIds,
    allSupplierQuoteIds,
    quoteIdBySupplierQuoteItemId,
    updateProductSelection,
    handleUnitTypeChange,
    dispatch,
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
    clientOfferCodePreview,
    isSourcedCreate,
    errors,
    formData,
    setFormData,
    previewVersion,
    productRowToDelete,
    setProductRowToDelete,
    closeModal,
    isOfferExpired,
    baseReadOnly,
    isReadOnly,
    isClientLocked,
    expirationEditableWhileReadOnly,
    readOnlyReason,
    supplierLockedReason,
    statusEditable,
    clientStatus,
    readOnlyStatus,
    statusLabel,
    tableInitialFilterState,
    openEditModal,
    handleVersionPreview,
    handleClearPreview,
    handleVersionRestored,
    getStatusLabel,
    closeRevertConfirm,
    handleRevertToDraft,
    handleDelete,
    columns,
    openAddModal,
    handleClientChange,
    addItem,
    removeItem,
    updateItem,
    handleDurationValueChange,
    handleDurationUnitChange,
    handleSubmit,
    formTotals,
  };
};

type ClientOffersController = ReturnType<typeof useClientOffersController>;

const ClientOffersView: React.FC<ClientOffersViewProps> = (props) => {
  const controller = useClientOffersController(props);
  return <ClientOffersLayout controller={controller} />;
};

const ClientOffersLayout: React.FC<{ controller: ClientOffersController }> = ({ controller }) => (
  <div className="space-y-6">
    <ClientOfferFormModal controller={controller} />
    <ClientOfferRevertModal controller={controller} />
    <ClientOfferDeleteDialogs controller={controller} />
    <ClientOffersHeader controller={controller} />
    <ClientOffersTable controller={controller} />
  </div>
);

const ClientOfferFormModal: React.FC<{ controller: ClientOffersController }> = ({ controller }) => {
  const {
    isModalOpen,
    closeModal,
    handleSubmit,
    editingOffer,
    previewVersion,
    handleVersionPreview,
    handleClearPreview,
    handleVersionRestored,
    baseReadOnly,
  } = controller;

  return (
    <Modal isOpen={isModalOpen} onClose={closeModal}>
      <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
        <ModalContent size="full" className="max-h-[90vh]">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <ClientOfferModalHeader controller={controller} />
            <ModalBody className="flex-1 space-y-5">
              <ClientOfferModalAlerts controller={controller} />
              <ClientOfferClientSection controller={controller} />
              <ClientOfferItemsSection controller={controller} />
              <ClientOfferNotesSummarySection controller={controller} />
            </ModalBody>
            <ClientOfferModalFooter controller={controller} />
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
  );
};

const ClientOfferModalHeader: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, closeModal, editingOffer, isReadOnly } = controller;

  return (
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
      <ModalCloseButton onClick={closeModal} />
    </ModalHeader>
  );
};

const ClientOfferModalAlerts: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, i18n, previewVersion, handleClearPreview, editingOffer, onViewQuote, isReadOnly } =
    controller;

  return (
    <>
      {previewVersion && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <span className="text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-2">
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
            className="h-auto px-0 text-xs font-semibold text-amber-800 dark:text-amber-300"
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
                  label: t('sales:clientOffers.viewQuote', { defaultValue: 'View quote' }),
                  onClick: () => onViewQuote(editingOffer.linkedQuoteId),
                }
              : undefined
          }
        />
      )}
      {isReadOnly && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <span className="text-amber-700 dark:text-amber-300 text-xs font-bold">
            {controller.readOnlyReason}
          </span>
        </div>
      )}
    </>
  );
};

const ClientOfferSectionHeading: React.FC<{
  label: React.ReactNode;
  description: string;
  status: string;
  statusLabel: string;
}> = ({ label, description, status, statusLabel }) => (
  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
    <span className="size-1.5 rounded-full bg-primary"></span>
    {label}
    <FieldTooltip description={description} status={status} statusLabel={statusLabel} />
  </h4>
);

const ClientOfferClientSection: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, clientStatus, statusLabel } = controller;

  return (
    <div className="space-y-2">
      <ClientOfferSectionHeading
        label={t('sales:clientOffers.clientInformation', { defaultValue: 'Client Information' })}
        description={t('sales:fieldInfo.clientInformation', {
          defaultValue: 'Client and document details',
        })}
        status={clientStatus}
        statusLabel={statusLabel}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ClientOfferClientField controller={controller} />
        <ClientOfferCodeField controller={controller} />
        <ClientOfferPaymentTermsField controller={controller} />
        <ClientOfferExpirationField controller={controller} />
      </div>
    </div>
  );
};

const ClientOfferClientField: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, errors, clientOptions, formData, handleClientChange, isReadOnly, isClientLocked } =
    controller;

  return (
    <Field data-invalid={Boolean(errors.clientId)}>
      <SelectControl
        id="client-offer-client"
        options={clientOptions}
        value={formData.clientId || ''}
        onChange={(value) => handleClientChange(value as string)}
        placeholder={t('sales:clientOffers.selectAClient', { defaultValue: 'Select a client' })}
        searchable={true}
        disabled={isReadOnly || isClientLocked}
        label={t('sales:clientOffers.client', { defaultValue: 'Client' })}
        required
        buttonClassName="h-9"
        className={errors.clientId ? 'border-red-300' : ''}
      />
      <FieldError className="text-xs">{errors.clientId}</FieldError>
    </Field>
  );
};

const ClientOfferCodeField: React.FC<{ controller: ClientOffersController }> = ({ controller }) => {
  const {
    t,
    errors,
    formData,
    setFormData,
    editingOffer,
    isReadOnly,
    clientOfferCodePreview,
    isSourcedCreate,
  } = controller;

  return (
    <Field data-invalid={Boolean(errors.id)}>
      <FieldLabel htmlFor="client-offer-code" required={Boolean(editingOffer)}>
        {t('sales:clientOffers.offerCode', { defaultValue: 'Offer code' })}
      </FieldLabel>
      <Input
        id="client-offer-code"
        type="text"
        value={formData.id || ''}
        disabled={isReadOnly}
        onChange={(event) => setFormData((prev) => ({ ...prev, id: event.target.value }))}
        placeholder={
          isSourcedCreate
            ? t('sales:clientOffers.inheritedCodePlaceholder', {
                defaultValue: 'Inherited from source quote',
              })
            : (clientOfferCodePreview ??
              t('sales:clientOffers.autoCodePlaceholder', { defaultValue: 'Auto-generated' }))
        }
        className={errors.id ? 'border-red-300 font-medium' : 'font-medium'}
        aria-invalid={Boolean(errors.id)}
      />
      <FieldError className="text-xs">{errors.id}</FieldError>
      {!editingOffer && (
        <FieldDescription className="text-xs">
          {isSourcedCreate
            ? t('sales:clientOffers.inheritedCodeDescription', {
                defaultValue: 'Leave blank to inherit the source quote code counter.',
              })
            : clientOfferCodePreview
              ? t('sales:clientOffers.autoCodePreviewDescription', {
                  preview: clientOfferCodePreview,
                  defaultValue:
                    'Leave blank to generate {{preview}} from the document code template.',
                })
              : t('sales:clientOffers.autoCodeDescription', {
                  defaultValue: 'Leave blank to generate the next code automatically.',
                })}
        </FieldDescription>
      )}
    </Field>
  );
};

const ClientOfferPaymentTermsField: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, formData, setFormData, paymentTermsOptions, isReadOnly } = controller;

  return (
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
        label={t('sales:clientOffers.paymentTerms', { defaultValue: 'Payment terms' })}
        buttonClassName="h-9"
      />
    </Field>
  );
};

const ClientOfferExpirationField: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, formData, setFormData, isReadOnly, expirationEditableWhileReadOnly } = controller;

  return (
    <Field>
      <FieldLabel htmlFor="client-offer-expiration-date" required>
        {t('sales:clientOffers.expirationDate', { defaultValue: 'Expiration date' })}
      </FieldLabel>
      <DateField
        id="client-offer-expiration-date"
        required
        value={formData.expirationDate || ''}
        disabled={isReadOnly && !expirationEditableWhileReadOnly}
        onChange={(value) => setFormData((prev) => ({ ...prev, expirationDate: value }))}
      />
    </Field>
  );
};

const getClientOfferItemRevenue = (item: ClientOfferItem) => getItemPricingContext(item).netRevenue;

const getClientOfferItemMargin = (item: ClientOfferItem) => getItemPricingContext(item).lineMargin;
const ClientOfferItemsSection: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, errors, formData, addItem, isReadOnly, currency } = controller;
  const items = formData.items;
  const getIndex = useMemo(() => createLineItemIndexResolver(items), [items]);
  const getLine = (item: ClientOfferItem) =>
    getClientOfferLineContext(controller, item, getIndex(item));

  const columns: Column<ClientOfferItem>[] = [
    {
      id: 'supplierQuote',
      header: t('sales:clientQuotes.supplierQuoteColumn'),
      accessorFn: (item) =>
        controller.getSupplierQuoteItemDisplayValue(item.supplierQuoteItemId) || '',
      cell: ({ row }) => {
        const index = getIndex(row);
        const line = getLine(row);
        return (
          <div className="relative flex min-w-[240px] items-center gap-1">
            {line.supplierDataStale && line.linkedSupplierRef && (
              <StaleSupplierDataButton
                onClick={() =>
                  line.linkedSupplierRef &&
                  controller.refreshLineFromSupplier(index, line.linkedSupplierRef.item)
                }
              />
            )}
            <ClientOfferSupplierPicker
              controller={controller}
              item={row}
              index={index}
              className="min-w-0 flex-1"
              buttonClassName="h-9 w-full"
            />
          </div>
        );
      },
    },
    {
      id: 'product',
      header: t('sales:clientOffers.product', { defaultValue: 'Product' }),
      accessorFn: (item) =>
        controller.products.find((product) => product.id === item.productId)?.name ||
        item.productName ||
        '',
      cell: ({ row }) => {
        const index = getIndex(row);
        return (
          <div className="relative flex min-w-[220px] items-center gap-1">
            <ClientOfferProductPicker
              controller={controller}
              item={row}
              index={index}
              className="min-w-0 flex-1"
              buttonClassName="h-9 w-full"
            />
          </div>
        );
      },
    },
    {
      id: 'quantity',
      header: t('sales:clientOffers.qty', { defaultValue: 'Qty' }),
      accessorKey: 'quantity',
      align: 'center',
      cell: ({ row }) => {
        const index = getIndex(row);
        return (
          <div className="min-w-[150px]">
            <ClientOfferQuantityEditor
              controller={controller}
              item={row}
              index={index}
              line={getLine(row)}
              compact
            />
          </div>
        );
      },
    },
    {
      id: 'duration',
      header: t('sales:clientOffers.durationColumn', { defaultValue: 'Duration' }),
      accessorFn: (item) => getItemPricingContext(item).durationMonths,
      align: 'center',
      cell: ({ row }) => {
        const index = getIndex(row);
        return (
          <div className="min-w-[150px]">
            <ClientOfferDurationEditor
              controller={controller}
              index={index}
              line={getLine(row)}
              compact
            />
          </div>
        );
      },
    },
    {
      id: 'cost',
      header: t('crm:internalListing.cost'),
      accessorFn: (item) => getItemPricingContext(item).unitCost,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[130px]">
          <ClientOfferCostEditor controller={controller} line={getLine(row)} compact />
        </div>
      ),
    },
    {
      id: 'mol',
      header: t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' }),
      accessorFn: (item) => getItemPricingContext(item).molPercentage,
      align: 'center',
      cell: ({ row }) => (
        <div className="flex min-w-[100px] items-center justify-center gap-1">
          <ClientOfferMolEditor controller={controller} line={getLine(row)} compact />
        </div>
      ),
    },
    {
      id: 'totalCost',
      header: t('sales:clientQuotes.totalCost', { defaultValue: 'Total cost' }),
      accessorFn: (item) => getItemPricingContext(item).lineCost,
      align: 'right',
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums">
          {getItemPricingContext(row).lineCost.toFixed(2)} {currency}
        </span>
      ),
    },
    {
      id: 'discount',
      header: t('common:labels.discount'),
      accessorFn: (item) => item.discount ?? 0,
      align: 'center',
      cell: ({ row }) => (
        <div className="min-w-[110px]">
          <ClientOfferDiscountEditor
            controller={controller}
            item={row}
            index={getIndex(row)}
            compact
          />
        </div>
      ),
    },
    {
      id: 'margin',
      header: t('sales:clientQuotes.marginLabel'),
      accessorFn: getClientOfferItemMargin,
      align: 'right',
      cell: ({ row }) => (
        <span className="font-semibold text-emerald-600 tabular-nums">
          {getClientOfferItemMargin(row).toFixed(2)} {currency}
        </span>
      ),
    },
    {
      id: 'revenue',
      header: t('sales:clientQuotes.revenue'),
      accessorFn: getClientOfferItemRevenue,
      align: 'right',
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums">
          {getClientOfferItemRevenue(row).toFixed(2)} {currency}
        </span>
      ),
    },
    {
      id: 'note',
      header: t('common:labels.notes'),
      accessorFn: (item) => item.note || '',
      cell: ({ row }) => (
        <div className="min-w-[220px]">
          <ClientOfferItemNote controller={controller} item={row} index={getIndex(row)} />
        </div>
      ),
    },
    {
      id: 'actions',
      header: t('common:labels.actions'),
      align: 'right',
      cell: ({ row }) => {
        const line = getLine(row);
        return (
          <>
            {controller.canViewSupplierQuotes && (
              <QuickViewLinkButton
                href={line.supplierQuoteHref}
                label={t('sales:clientQuotes.openSupplierQuoteInNewTab')}
                disabledLabel={t('sales:clientQuotes.supplierQuoteShortcutUnavailable')}
              />
            )}
            {controller.canViewInternalListing && (
              <QuickViewLinkButton
                href={line.productHref}
                label={t('sales:clientQuotes.openProductInNewTab')}
                disabledLabel={t('sales:clientQuotes.productShortcutUnavailable')}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => controller.setProductRowToDelete(getIndex(row))}
              disabled={controller.isReadOnly}
              className="text-muted-foreground hover:text-destructive"
            >
              <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
              <span className="sr-only">{t('common:buttons.delete')}</span>
            </Button>
          </>
        );
      },
    },
  ];

  return (
    <div className="space-y-2">
      {errors.items && <p className="ml-1 text-[10px] font-bold text-red-500">{errors.items}</p>}
      <StandardTable<ClientOfferItem>
        title={t('sales:clientOffers.items', { defaultValue: 'Items' })}
        persistenceKey="sales.clientOffers.items"
        data={items ?? []}
        columns={columns}
        defaultRowsPerPage={5}
        minBodyRows={0}
        tableContainerClassName="overflow-x-auto"
        emptyState={
          <div className="py-8 text-sm text-muted-foreground">
            {t('sales:clientOffers.noItemsAdded', { defaultValue: 'No items added yet' })}
          </div>
        }
        headerAction={
          <Button type="button" size="sm" onClick={addItem} disabled={isReadOnly}>
            <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
            {t('sales:clientOffers.addItem', { defaultValue: 'Add item' })}
          </Button>
        }
      />
    </div>
  );
};
const getClientOfferLineContext = (
  controller: ClientOffersController,
  item: ClientOfferItem,
  index: number,
) => {
  const {
    products,
    isReadOnly,
    readOnlyReason,
    supplierLockedReason,
    statusEditable,
    allSupplierQuoteIds,
    allProductIds,
    supplierQuoteItemIndex,
    quoteIdBySupplierQuoteItemId,
    setFormData,
  } = controller;
  const {
    unitCost: cost,
    molPercentage,
    lineCost,
    netRevenue: lineSalePrice,
    lineMargin,
  } = getItemPricingContext(item);
  const durationUnit = normalizeDurationUnit(item.durationUnit);
  const durationValue = getDurationDisplayValue(item);
  const product = products.find((p) => p.id === item.productId);
  const isSupply = product?.type === 'supply';
  const isLinkedToSupplierQuote = Boolean(item.supplierQuoteItemId);
  const linkedSupplierRef = item.supplierQuoteItemId
    ? supplierQuoteItemIndex.get(item.supplierQuoteItemId)
    : undefined;
  const supplierLineLocked = isSupplierLineLocked(item, linkedSupplierRef);
  const supplierDataStale =
    !isReadOnly && !supplierLineLocked && isSupplierLineStale(item, linkedSupplierRef?.item);
  const supplierQuoteHref = buildSupplierQuoteQuickViewHref(
    resolveLinkedSupplierQuoteId(item, quoteIdBySupplierQuoteItemId),
    allSupplierQuoteIds,
  );
  const productHref = buildProductQuickViewHref(item.productId, allProductIds);
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

  return {
    cost,
    molPercentage,
    lineCost,
    durationUnit,
    durationValue,
    isSupply,
    lineSalePrice,
    lineMargin,
    isLinkedToSupplierQuote,
    linkedSupplierRef,
    supplierLineLocked,
    supplierDataStale,
    supplierQuoteHref,
    productHref,
    linkedFieldStatus,
    handleCostChange,
    handleMolChange,
  };
};

type ClientOfferLineContext = ReturnType<typeof getClientOfferLineContext>;

const ClientOfferSupplierPicker: React.FC<{
  controller: ClientOffersController;
  item: ClientOfferItem;
  index: number;
  className: string;
  buttonClassName: string;
}> = ({ controller, item, index, className, buttonClassName }) => {
  const {
    t,
    supplierQuoteSelectOptions,
    isReadOnly,
    updateItem,
    getSupplierQuoteItemDisplayValue,
  } = controller;

  return (
    <SelectControl
      options={supplierQuoteSelectOptions}
      value={item.supplierQuoteItemId || 'none'}
      onChange={(val) =>
        updateItem(index, 'supplierQuoteItemId', val === 'none' ? '' : (val as string))
      }
      placeholder={t('sales:clientQuotes.selectSupplierQuote')}
      displayValue={getSupplierQuoteItemDisplayValue(item.supplierQuoteItemId)}
      displayValueIsPlaceholder={!item.supplierQuoteItemId}
      valueClassName="font-medium"
      searchable={true}
      disabled={isReadOnly}
      className={className}
      buttonClassName={buttonClassName}
    />
  );
};

const ClientOfferProductPicker: React.FC<{
  controller: ClientOffersController;
  item: ClientOfferItem;
  index: number;
  className: string;
  buttonClassName: string;
}> = ({ controller, item, index, className, buttonClassName }) => {
  const { t, productOptions, isReadOnly, isLinkedProductMissing, updateProductSelection } =
    controller;

  return (
    <ProductSelectOrFallback
      item={item}
      index={index}
      options={productOptions}
      isProductMissing={isLinkedProductMissing(item)}
      isReadOnly={isReadOnly}
      ariaLabel={t('sales:clientOffers.selectProduct', { defaultValue: 'Select product' })}
      placeholder={t('sales:clientOffers.selectProduct', { defaultValue: 'Select product' })}
      onProductChange={updateProductSelection}
      className={className}
      buttonClassName={buttonClassName}
    />
  );
};

const ClientOfferQuantityEditor: React.FC<{
  controller: ClientOffersController;
  item: ClientOfferItem;
  index: number;
  line: ClientOfferLineContext;
  compact?: boolean;
}> = ({ controller, item, index, line, compact }) => {
  const { t, isReadOnly, updateItem, handleUnitTypeChange } = controller;

  return (
    <div className="flex items-center justify-center gap-1">
      <ValidatedNumberInput
        step="0.01"
        min="0"
        required
        placeholder={t('sales:clientOffers.qty', { defaultValue: 'Qty' })}
        value={item.quantity}
        onValueChange={(value) => updateItem(index, 'quantity', parseNumberInputValue(value))}
        disabled={isReadOnly || line.supplierLineLocked}
        className={
          compact
            ? 'w-full max-w-[5rem] text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed'
            : 'w-full text-sm px-3 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed flex-1'
        }
      />
      <span className="text-xs font-semibold text-zinc-400 shrink-0">/</span>
      <UnitTypeSelector
        value={(item.unitType || 'hours') as SupplierUnitType}
        onChange={(val) => handleUnitTypeChange(index, val)}
        isSupply={line.isSupply}
        quantity={Number(item.quantity) || 0}
        disabled={isReadOnly || line.isLinkedToSupplierQuote}
      />
    </div>
  );
};

const ClientOfferDurationEditor: React.FC<{
  controller: ClientOffersController;
  index: number;
  line: ClientOfferLineContext;
  compact?: boolean;
}> = ({ controller, index, line, compact }) => {
  const { t, isReadOnly, handleDurationValueChange, handleDurationUnitChange } = controller;

  return (
    <div className="flex items-center gap-1">
      <ValidatedNumberInput
        step="1"
        min="1"
        placeholder={t('sales:clientOffers.durationColumn', { defaultValue: 'Duration' })}
        value={line.durationValue}
        onValueChange={(value) => handleDurationValueChange(index, value)}
        disabled={isReadOnly || line.durationUnit === 'na'}
        className={
          compact
            ? 'w-full max-w-[5rem] text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed'
            : 'w-full text-sm px-3 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed flex-1'
        }
      />
      <span
        className={
          compact
            ? 'text-[9px] font-semibold text-zinc-400 shrink-0'
            : 'text-xs font-semibold text-zinc-400 shrink-0'
        }
      >
        /
      </span>
      <DurationUnitSelector
        value={line.durationUnit}
        onChange={(val) => handleDurationUnitChange(index, val)}
        count={line.durationValue}
        disabled={isReadOnly}
      />
    </div>
  );
};

const ClientOfferCostEditor: React.FC<{
  controller: ClientOffersController;
  line: ClientOfferLineContext;
  compact?: boolean;
}> = ({ controller, line, compact }) => {
  const { currency, isReadOnly } = controller;
  const isLinkedToSupplierQuote = line.isLinkedToSupplierQuote;

  return (
    <div className="flex w-full items-center justify-end gap-1">
      <ValidatedNumberInput
        value={line.cost}
        formatDecimals={2}
        onValueChange={line.handleCostChange}
        disabled={isReadOnly || line.supplierLineLocked}
        className={
          compact
            ? 'w-full max-w-[5rem] flex-none text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed'
            : 'w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed'
        }
      />
      <span className="text-[9px] font-semibold text-zinc-400 shrink-0">{currency}</span>
      {!compact && <>{isLinkedToSupplierQuote && <SupplierQuoteCostHint />}</>}
    </div>
  );
};

const ClientOfferMolEditor: React.FC<{
  controller: ClientOffersController;
  line: ClientOfferLineContext;
  compact?: boolean;
}> = ({ controller, line, compact }) => {
  const { isReadOnly } = controller;

  return (
    <>
      <ValidatedNumberInput
        value={line.molPercentage}
        formatDecimals={MOL_PERCENTAGE_DECIMALS}
        onValueChange={line.handleMolChange}
        disabled={isReadOnly}
        className={
          compact
            ? 'w-full max-w-[5rem] flex-none text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed'
            : 'w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed'
        }
      />
      <span className="text-[9px] font-semibold text-zinc-400 shrink-0">%</span>
    </>
  );
};

const ClientOfferDiscountEditor: React.FC<{
  controller: ClientOffersController;
  item: ClientOfferItem;
  index: number;
  compact?: boolean;
}> = ({ controller, item, index, compact }) => (
  <div className="flex w-full items-center justify-center gap-1">
    <ValidatedNumberInput
      value={item.discount ?? 0}
      min={0}
      max={100}
      step="0.01"
      formatDecimals={2}
      aria-label={controller.t('common:labels.discount')}
      onValueChange={(value) =>
        controller.updateItem(index, 'discount', parseNumberInputValue(value) ?? 0)
      }
      disabled={controller.isReadOnly}
      className={
        compact
          ? 'w-full max-w-[5rem] flex-none text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed'
          : 'w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed'
      }
    />
    <span className="shrink-0 text-[9px] font-semibold text-zinc-400">%</span>
  </div>
);

const ClientOfferItemNote: React.FC<{
  controller: ClientOffersController;
  item: ClientOfferItem;
  index: number;
}> = ({ controller, item, index }) => {
  const { t, isReadOnly, updateItem } = controller;

  return (
    <Input
      type="text"
      placeholder={t('form:placeholderNotes', { defaultValue: 'Optional notes...' })}
      value={item.note || ''}
      onChange={(event) => updateItem(index, 'note', event.target.value)}
      disabled={isReadOnly}
    />
  );
};

const ClientOfferNotesSummarySection: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => (
  <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
    <ClientOfferNotesField controller={controller} />
    <ClientOfferSummaryPanel controller={controller} />
  </div>
);

const ClientOfferNotesField: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, formData, setFormData, isReadOnly, readOnlyStatus, statusLabel } = controller;

  return (
    <Field className="md:w-2/3">
      <ClientOfferSectionHeading
        label={t('sales:clientOffers.notes', { defaultValue: 'Notes' })}
        description={t('sales:fieldInfo.notes', {
          defaultValue: 'Additional notes for the entire document',
        })}
        status={readOnlyStatus}
        statusLabel={statusLabel}
      />
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
        onChange={(event) => setFormData((prev) => ({ ...prev, notes: event.target.value }))}
        className="min-h-28 resize-none"
      />
    </Field>
  );
};

const ClientOfferSummaryPanel: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, formData, setFormData, formTotals, currency, isReadOnly } = controller;
  const { discountValue, subtotal, discountAmount, total, margin, marginPercentage } = formTotals;

  return (
    <div className="space-y-2 md:w-1/3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        <span className="size-1.5 rounded-full bg-primary"></span>
        {t('sales:clientOffers.summary', { defaultValue: 'Summary' })}
      </h4>
      <CostSummaryPanel
        currency={currency}
        subtotal={subtotal}
        total={total}
        subtotalLabel={t('sales:clientOffers.subtotal', { defaultValue: 'Subtotal' })}
        totalLabel={t('sales:clientOffers.total', { defaultValue: 'Total' })}
        globalDiscount={{
          label: t('sales:clientOffers.globalDiscount', { defaultValue: 'Global Discount' }),
          value: formData.discount || 0,
          type: formData.discountType || 'percentage',
          onChange: (value) =>
            setFormData((prev) => ({
              ...prev,
              discount: value === '' ? 0 : Number(value),
            })),
          onTypeChange: (type) => setFormData((prev) => ({ ...prev, discountType: type })),
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
          label: `${t('sales:clientOffers.margin', { defaultValue: 'Margin' })} (${formatMolPercentage(marginPercentage)})`,
          amount: margin,
        }}
      />
    </div>
  );
};

const ClientOfferModalFooter: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const { t, closeModal, isReadOnly, expirationEditableWhileReadOnly, isSubmitting, editingOffer } =
    controller;

  return (
    <ModalFooter>
      <Button type="button" variant="outline" onClick={closeModal}>
        {t('common:buttons.cancel')}
      </Button>
      {(!isReadOnly || expirationEditableWhileReadOnly) && (
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? t('common:buttons.saving')
            : editingOffer
              ? t('common:buttons.update')
              : t('common:buttons.save')}
        </Button>
      )}
    </ModalFooter>
  );
};

const ClientOfferRevertModal: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const {
    t,
    isRevertConfirmOpen,
    closeRevertConfirm,
    offerToRevert,
    getStatusLabel,
    revertReason,
    dispatch,
    isReverting,
    handleRevertToDraft,
  } = controller;

  return (
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
                {t('sales:clientOffers.revertReasonLabel', { defaultValue: 'Reason' })}
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
  );
};

const ClientOfferDeleteDialogs: React.FC<{ controller: ClientOffersController }> = ({
  controller,
}) => {
  const {
    t,
    isDeleteConfirmOpen,
    isDeleting,
    dispatch,
    handleDelete,
    offerToDelete,
    productRowToDelete,
    setProductRowToDelete,
    removeItem,
  } = controller;

  return (
    <>
      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          if (isDeleting) return;
          dispatch({ type: 'closeDeleteConfirm' });
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title={t('sales:clientOffers.deleteTitle', { defaultValue: 'Delete offer?' })}
        description={offerToDelete?.id ?? ''}
      />
      <DeleteConfirmModal
        isOpen={productRowToDelete !== null}
        onClose={() => setProductRowToDelete(null)}
        onConfirm={() => {
          if (productRowToDelete !== null) {
            removeItem(productRowToDelete);
          }
          setProductRowToDelete(null);
        }}
        title={t('sales:clientOffers.removeProductTitle')}
        description={t('sales:clientOffers.removeProductConfirm')}
        zIndex={70}
      />
    </>
  );
};

const ClientOffersHeader: React.FC<{ controller: ClientOffersController }> = ({ controller }) => {
  const { t, onAddOffer, openAddModal } = controller;

  return (
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
  );
};

const ClientOffersTable: React.FC<{ controller: ClientOffersController }> = ({ controller }) => {
  const { t, offers, columns, openEditModal, isOfferExpired, tableInitialFilterState } = controller;

  return (
    <StandardTable<ClientOffer>
      title={t('sales:clientOffers.activeOffers', { defaultValue: 'Customer offers' })}
      viewKey="sales.client_offers"
      data={offers}
      columns={columns}
      defaultRowsPerPage={5}
      onRowClick={(row) => openEditModal(row)}
      rowClassName={(row) =>
        isOfferExpired(row)
          ? 'hover:bg-zinc-50/50 cursor-pointer bg-red-50/30'
          : 'cursor-pointer hover:bg-zinc-50/50'
      }
      initialFilterState={tableInitialFilterState}
    />
  );
};

export default ClientOffersView;
