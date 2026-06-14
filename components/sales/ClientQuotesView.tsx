import type React from 'react';
import { useCallback, useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { normalizeQuoteItem } from '../../services/api/normalizers';
import type { QuoteCommunicationChannel } from '../../services/api/quoteCommunicationChannels';
import type {
  Client,
  ClientOffer,
  DurationUnit,
  Product,
  Quote,
  QuoteItem,
  QuoteVersion,
  SupplierQuote,
  SupplierUnitType,
} from '../../types';
import {
  addMonthsToDateOnly,
  formatDateOnlyForLocale,
  formatInsertDate,
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
  formatDiscountValue,
  formatMolPercentage,
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
import {
  canTransitionClientQuote,
  effectiveQuoteStatus,
  isTerminalQuoteStatus,
  normalizeQuoteStatus,
} from '../../utils/quoteStatus';
import {
  buildSupplierQuoteItemIndex,
  isSupplierLineLocked,
  isSupplierLineStale,
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
import ProductSelectOrFallback from './ProductSelectOrFallback';
import QuoteCommunicationChannelField from './QuoteCommunicationChannelField';
import QuoteVersionsPanel from './QuoteVersionsPanel';
import {
  DEFAULT_QUOTE_COMMUNICATION_CHANNELS,
  noopQuoteCommunicationChannelMutation,
} from './quoteCommunicationChannelDefaults';

export interface ClientQuotesViewProps {
  quotes: Quote[];
  clients: Client[];
  products: Product[];
  supplierQuotes: SupplierQuote[];
  communicationChannels?: QuoteCommunicationChannel[];
  canManageCommunicationChannels?: boolean;
  onCreateCommunicationChannel?: (data: { name: string }) => Promise<void>;
  onUpdateCommunicationChannel?: (id: string, updates: { name: string }) => Promise<void>;
  onDeleteCommunicationChannel?: (id: string) => Promise<void>;
  onAddQuote: (quoteData: Partial<Quote>) => void | Promise<void>;
  onUpdateQuote: (id: string, updates: Partial<Quote>) => void | Promise<void>;
  onQuoteRestored?: (quote: Quote) => void;
  onDeleteQuote: (id: string) => void | Promise<void>;
  onCreateOffer?: (quote: Quote) => void;
  onViewOffer?: (offerId: string) => void;
  quoteFilterId?: string | null;
  quoteIdsWithOffers?: Set<string>;
  quoteOfferStatuses?: Record<string, ClientOffer['status']>;
  onViewOffers?: (quoteId: string) => void;
  currency: string;
  offers?: ClientOffer[];
  // Whether the current user can open the quick-view targets. The destination
  // views are guarded by their own permissions, so a quick link to a view the
  // user can't access would dead-end on a 404 — gate (hide) the link instead.
  canViewSupplierQuotes?: boolean;
  canViewInternalListing?: boolean;
}

const EMPTY_OFFERS: ClientOffer[] = [];

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

const getDefaultFormData = (): Partial<Quote> => ({
  id: '',
  clientId: '',
  clientName: '',
  items: [],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
  status: 'draft',
  expirationDate: addMonthsToDateOnly(getLocalDateString(), 1),
  communicationChannelId: '',
  notes: '',
});

const quoteToFormData = (quote: Quote): Partial<Quote> => ({
  id: quote.id,
  clientId: quote.clientId,
  clientName: quote.clientName,
  items: quote.items,
  paymentTerms: quote.paymentTerms,
  discount: quote.discount,
  discountType: quote.discountType || 'percentage',
  status: quote.status,
  expirationDate: quote.expirationDate ? normalizeDateOnlyString(quote.expirationDate) : '',
  communicationChannelId: quote.communicationChannelId ?? '',
  communicationChannelName: quote.communicationChannelName ?? '',
  notes: quote.notes || '',
});

// One label shape for a supplier-quote line item, shared by the picker options and the
// display-value lookup so the two can never drift.
const supplierQuoteItemLabel = (quote: SupplierQuote, item: SupplierQuote['items'][number]) =>
  `${quote.supplierName} · ${item.productName} (${item.unitPrice.toFixed(2)})`;

interface PendingClientChange {
  clientId: string;
  clientName: string;
}

interface ClientQuotesViewState {
  isModalOpen: boolean;
  editingQuote: Quote | null;
  isDeleteConfirmOpen: boolean;
  quoteToDelete: Quote | null;
  pendingClientChange: PendingClientChange | null;
  isSubmitting: boolean;
  isDeleting: boolean;
}

const INITIAL_CLIENT_QUOTES_VIEW_STATE: ClientQuotesViewState = {
  isModalOpen: false,
  editingQuote: null,
  isDeleteConfirmOpen: false,
  quoteToDelete: null,
  pendingClientChange: null,
  isSubmitting: false,
  isDeleting: false,
};

type ClientQuotesViewAction =
  | { type: 'openAddModal' }
  | { type: 'openEditModal'; quote: Quote }
  | { type: 'closeModal' }
  | { type: 'setEditingQuote'; quote: Quote | null }
  | { type: 'setPendingClientChange'; value: PendingClientChange | null }
  | { type: 'setIsSubmitting'; value: boolean }
  | { type: 'confirmDelete'; quote: Quote }
  | { type: 'closeDeleteConfirm' }
  | { type: 'deleteSuccess' }
  | { type: 'setIsDeleting'; value: boolean };

const clientQuotesViewReducer = (
  state: ClientQuotesViewState,
  action: ClientQuotesViewAction,
): ClientQuotesViewState => {
  switch (action.type) {
    case 'openAddModal':
      return { ...state, editingQuote: null, pendingClientChange: null, isModalOpen: true };
    case 'openEditModal':
      return {
        ...state,
        editingQuote: action.quote,
        pendingClientChange: null,
        isModalOpen: true,
      };
    case 'closeModal':
      return { ...state, isModalOpen: false };
    case 'setEditingQuote':
      return { ...state, editingQuote: action.quote };
    case 'setPendingClientChange':
      return { ...state, pendingClientChange: action.value };
    case 'setIsSubmitting':
      return { ...state, isSubmitting: action.value };
    case 'confirmDelete':
      return { ...state, quoteToDelete: action.quote, isDeleteConfirmOpen: true };
    case 'closeDeleteConfirm':
      return { ...state, isDeleteConfirmOpen: false };
    case 'deleteSuccess':
      return { ...state, isDeleteConfirmOpen: false, quoteToDelete: null };
    case 'setIsDeleting':
      return { ...state, isDeleting: action.value };
    default:
      return state;
  }
};

const ClientQuotesView: React.FC<ClientQuotesViewProps> = ({
  quotes,
  clients,
  products,
  supplierQuotes,
  communicationChannels = DEFAULT_QUOTE_COMMUNICATION_CHANNELS,
  canManageCommunicationChannels = false,
  onCreateCommunicationChannel = noopQuoteCommunicationChannelMutation,
  onUpdateCommunicationChannel = noopQuoteCommunicationChannelMutation,
  onDeleteCommunicationChannel = noopQuoteCommunicationChannelMutation,
  onAddQuote,
  onUpdateQuote,
  onQuoteRestored,
  onDeleteQuote,
  onCreateOffer,
  onViewOffer,
  quoteFilterId,
  quoteIdsWithOffers,
  quoteOfferStatuses,
  onViewOffers,
  currency,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of public API
  offers = EMPTY_OFFERS,
  canViewSupplierQuotes = true,
  canViewInternalListing = true,
}) => {
  const { t, i18n } = useTranslation(['sales', 'crm', 'common', 'form']);

  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);

  const tableInitialFilterState = useMemo(() => {
    if (quoteFilterId) {
      return { id: [quoteFilterId] };
    }
    return undefined;
  }, [quoteFilterId]);

  const STATUS_OPTIONS = useMemo(
    () => [
      { id: 'draft', name: t('sales:clientQuotes.statusDraft', { defaultValue: 'Draft' }) },
      { id: 'sent', name: t('sales:clientQuotes.statusSent', { defaultValue: 'Sent' }) },
      { id: 'offer', name: t('sales:clientQuotes.statusOffer', { defaultValue: 'Offer' }) },
      {
        id: 'accepted',
        name: t('sales:clientQuotes.statusAccepted', { defaultValue: 'Accepted' }),
      },
      { id: 'denied', name: t('sales:clientQuotes.statusDenied', { defaultValue: 'Denied' }) },
    ],
    [t],
  );

  const [state, dispatch] = useReducer(clientQuotesViewReducer, INITIAL_CLIENT_QUOTES_VIEW_STATE);
  const {
    isModalOpen,
    editingQuote,
    isDeleteConfirmOpen,
    quoteToDelete,
    pendingClientChange,
    isSubmitting,
    isDeleting,
  } = state;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [productRowToDelete, setProductRowToDelete] = useState<number | null>(null);

  const getStatusLabel = useCallback(
    (status: string) => {
      if (status === 'expired') {
        return t('sales:clientQuotes.statusExpired', { defaultValue: 'Expired' });
      }
      const option = STATUS_OPTIONS.find((o) => o.id === status);
      return option ? option.name : status;
    },
    [STATUS_OPTIONS, t],
  );

  const isExpired = useCallback(
    (expirationDate: string) => isDateOnlyBeforeToday(expirationDate),
    [],
  );

  const isQuoteExpired = useCallback(
    (quote: Quote) => {
      // Prefer the server-computed effective status (issue #779); fall back to the shared status
      // model — seeded with the response's `isExpired` hint when present — for optimistic updates
      // that haven't round-tripped yet.
      if (quote.effectiveStatus) return quote.effectiveStatus === 'expired';
      return (
        effectiveQuoteStatus(quote.status, quote.isExpired ?? isExpired(quote.expirationDate)) ===
        'expired'
      );
    },
    [isExpired],
  );

  // Single derived-status policy for the Status column: the badge, the filter options, and
  // sorting all use this value, so an expired quote surfaces as a filterable "Expired" entry
  // instead of hiding under its stored Draft/Sent (#779).
  const effectiveRowStatus = useCallback(
    (quote: Quote) => quote.effectiveStatus ?? (isQuoteExpired(quote) ? 'expired' : quote.status),
    [isQuoteExpired],
  );

  const hasOfferForQuote = useCallback(
    (quote: Quote) => Boolean(quote.linkedOfferId || quoteIdsWithOffers?.has(quote.id)),
    [quoteIdsWithOffers],
  );

  const getOfferStatusForQuote = useCallback(
    (quote: Quote) => quoteOfferStatuses?.[quote.id],
    [quoteOfferStatuses],
  );

  const isHistoryRow = useCallback(
    (quote: Quote) => {
      const expired = isQuoteExpired(quote);
      const hasOffer = hasOfferForQuote(quote);
      return quote.status === 'denied' || expired || hasOffer;
    },
    [isQuoteExpired, hasOfferForQuote],
  );

  // History rows are not editable, but some still OPEN in read-only mode: accepted/denied for
  // viewing, and expired (non-offer-linked) quotes so their expiration date can be extended out of
  // the `expired` state — the modal is the only place that action lives (issue #779).
  const canOpenQuoteModal = useCallback(
    (quote: Quote) =>
      !isHistoryRow(quote) ||
      isTerminalQuoteStatus(quote.status) ||
      normalizeQuoteStatus(quote.status) === 'offer' ||
      (isQuoteExpired(quote) && !hasOfferForQuote(quote)),
    [isHistoryRow, isQuoteExpired, hasOfferForQuote],
  );

  const [formData, setFormData] = useState<Partial<Quote>>(() => getDefaultFormData());
  const [previewVersion, setPreviewVersion] = useState<QuoteVersion | null>(null);
  // Expired quotes are read-only EXCEPT their expiration date, which stays editable so the user can
  // revalidate the quote (issue #779). Other read-only reasons (offer/accepted/denied) lock all.
  const isEditingExpired = Boolean(editingQuote && isQuoteExpired(editingQuote));
  const baseReadOnly = Boolean(
    editingQuote &&
      (editingQuote.linkedOfferId ||
        isTerminalQuoteStatus(editingQuote.status) ||
        isEditingExpired),
  );
  const isReadOnly = baseReadOnly || previewVersion !== null;
  // True when the ONLY reason the form is read-only is expiry — the expiration DateField stays
  // enabled in that case so the quote can be extended out of the `expired` state.
  const expirationEditableWhileReadOnly = Boolean(
    isEditingExpired &&
      previewVersion === null &&
      !editingQuote?.linkedOfferId &&
      !isTerminalQuoteStatus(editingQuote?.status ?? ''),
  );

  const readOnlyReason = editingQuote?.linkedOfferId
    ? t('sales:clientQuotes.readOnlyBecauseOffer', {
        defaultValue: 'Read-only due to linked offer',
      })
    : t('sales:clientQuotes.readOnlyBecauseFinal', {
        defaultValue: 'Read-only due to finalized status',
      });
  const supplierLockedReason = t('sales:fieldInfo.fieldLockedBySupplierQuote', {
    defaultValue: 'Locked due to linked supplier quote',
  });
  const statusEditable = t('sales:fieldInfo.statusEditable', { defaultValue: 'Editable' });
  const statusLabel = t('sales:fieldInfo.statusLabel', { defaultValue: 'Status:' });

  const readOnlyStatus = isReadOnly ? readOnlyReason : statusEditable;

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
  }, [formData.items, formData.discount, formData.discountType]);

  // Compute each row's pricing once per quotes change, so the column accessors and cells below
  // read from this map instead of recomputing calculatePricingTotals (an O(line-items) pass)
  // twice per column for every visible row.
  const quotePricingMap = useMemo(() => {
    const map = new Map<string, PricingTotals>();
    for (const quote of quotes) {
      map.set(
        quote.id,
        calculatePricingTotals(quote.items, quote.discount, 'hours', quote.discountType),
      );
    }
    return map;
  }, [quotes]);

  const formatDiscountPercentage = useCallback(
    (quote: Quote) => {
      if (quote.discountType !== 'currency') {
        return `${quote.discount}%`;
      }

      const { discountAmount, subtotal } = quotePricingMap.get(quote.id) ?? EMPTY_PRICING_TOTALS;
      if (subtotal <= 0) return '0%';

      return `${Number(((discountAmount / subtotal) * 100).toFixed(1))}%`;
    },
    [quotePricingMap],
  );

  const closeModal = useCallback(() => {
    dispatch({ type: 'closeModal' });
    setPreviewVersion(null);
    setProductRowToDelete(null);
  }, []);

  const openAddModal = () => {
    dispatch({ type: 'openAddModal' });
    setFormData({
      ...getDefaultFormData(),
      communicationChannelId: communicationChannels[0]?.id ?? '',
      communicationChannelName: communicationChannels[0]?.name ?? '',
    });
    setErrors({});
    setPreviewVersion(null);
  };

  const openEditModal = useCallback((quote: Quote) => {
    dispatch({ type: 'openEditModal', quote });
    setFormData(quoteToFormData(quote));
    setErrors({});
    setPreviewVersion(null);
  }, []);

  const handleVersionPreview = useCallback(
    (version: QuoteVersion) => {
      setPreviewVersion(version);
      setFormData(
        quoteToFormData({
          ...version.snapshot.quote,
          id: editingQuote?.id ?? version.snapshot.quote.id,
          items: version.snapshot.items.map(normalizeQuoteItem),
          status: version.snapshot.quote.status as Quote['status'],
          communicationChannelId:
            version.snapshot.quote.communicationChannelId ?? communicationChannels[0]?.id ?? '',
          communicationChannelName:
            version.snapshot.quote.communicationChannelName ?? communicationChannels[0]?.name ?? '',
        }),
      );
      setErrors({});
    },
    [communicationChannels, editingQuote],
  );

  const handleClearPreview = useCallback(() => {
    if (editingQuote) setFormData(quoteToFormData(editingQuote));
    setPreviewVersion(null);
  }, [editingQuote]);

  const handleVersionRestored = useCallback(
    (updated: Quote) => {
      dispatch({ type: 'setEditingQuote', quote: updated });
      setFormData(quoteToFormData(updated));
      setPreviewVersion(null);
      onQuoteRestored?.(updated);
    },
    [onQuoteRestored],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Expired quotes are read-only EXCEPT their expiration date: submitting in that mode extends
    // ONLY the expiration (lifting the quote out of `expired`). Every other field stays untouched —
    // and the server rejects content edits on an expired quote — so send just the date (issue #779).
    if (expirationEditableWhileReadOnly && editingQuote) {
      if (isSubmitting) return;
      // Revalidation needs a date from today onward; a cleared or still-past date would leave the
      // quote expired, so reject it loudly instead of silently "saving" (issue #779).
      if (!formData.expirationDate || isDateOnlyBeforeToday(formData.expirationDate)) {
        toastError(
          t('sales:clientQuotes.errors.expirationExtendInvalid', {
            defaultValue: 'Set an expiration date of today or later to revalidate the quote',
          }),
        );
        return;
      }
      dispatch({ type: 'setIsSubmitting', value: true });
      try {
        await onUpdateQuote(editingQuote.id, { expirationDate: formData.expirationDate });
      } catch (err) {
        toastError((err as Error).message || t('sales:clientQuotes.failedToSave'));
        return;
      } finally {
        dispatch({ type: 'setIsSubmitting', value: false });
      }
      closeModal();
      return;
    }

    if (isReadOnly) {
      return;
    }
    if (isSubmitting) return;

    const newErrors: Record<string, string> = {};
    const discountValue = formTotals.discountValue;

    if (!formData.clientId) {
      newErrors.clientId = t('sales:clientQuotes.errors.clientRequired');
    }

    if (editingQuote && !formData.id?.trim()) {
      newErrors.id = t('sales:clientQuotes.errors.quoteCodeRequired', {
        defaultValue: 'Quote Code is required',
      });
    }

    if (!formData.communicationChannelId) {
      newErrors.communicationChannelId = t('sales:communicationChannels.errors.required');
    }

    if (!formData.items || formData.items.length === 0) {
      newErrors.items = t('sales:clientQuotes.errors.itemsRequired');
    } else {
      const invalidItem = formData.items.find(
        (item) => !item.productId && !item.supplierQuoteItemId,
      );
      if (invalidItem) {
        newErrors.items = t('sales:clientQuotes.errors.productOrSupplierRequired', {
          defaultValue: 'Each item must have a product or a linked supplier quote',
        });
      }
      const invalidQuantity = formData.items.find(
        (item) =>
          item.quantity === undefined ||
          item.quantity === null ||
          Number.isNaN(item.quantity) ||
          item.quantity <= 0,
      );
      if (!newErrors.items && invalidQuantity) {
        newErrors.items = t('sales:clientQuotes.errors.quantityGreaterThanZero');
      }
      if (!newErrors.items) {
        const { total } = calculatePricingTotals(
          formData.items,
          discountValue,
          'hours',
          formData.discountType || 'percentage',
        );
        if (!Number.isFinite(total) || total <= 0) {
          newErrors.total = t('sales:clientQuotes.errors.totalGreaterThanZero');
        }
      }
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
        durationMonths: Number(item.durationMonths ?? 1) || 1,
        durationUnit: normalizeDurationUnit(item.durationUnit),
        productCost: Number(item.productCost ?? 0),
        productMolPercentage:
          item.productMolPercentage === undefined || item.productMolPercentage === null
            ? null
            : Number(item.productMolPercentage),
        // Supplier quote snapshot fields
        supplierQuoteId: item.supplierQuoteId ?? null,
        supplierQuoteItemId: item.supplierQuoteItemId ?? null,
        supplierQuoteSupplierName: item.supplierQuoteSupplierName ?? null,
        supplierQuoteUnitPrice:
          item.supplierQuoteUnitPrice === undefined || item.supplierQuoteUnitPrice === null
            ? null
            : Number(item.supplierQuoteUnitPrice),
      };
    });

    const payload = {
      ...formData,
      id: formData.id?.trim() || undefined,
      discount: formData.discount ? formData.discount : 0,
      items: itemsWithSnapshots,
    };

    dispatch({ type: 'setIsSubmitting', value: true });
    try {
      if (editingQuote) {
        await onUpdateQuote(editingQuote.id, payload);
      } else {
        await onAddQuote(payload);
      }
    } catch (err) {
      toastError((err as Error).message || t('sales:clientQuotes.failedToSave'));
      return;
    } finally {
      dispatch({ type: 'setIsSubmitting', value: false });
    }
    closeModal();
  };

  const confirmDelete = useCallback((quote: Quote) => {
    dispatch({ type: 'confirmDelete', quote });
  }, []);

  const handleStatusUpdate = async (id: string, updates: Partial<Quote>) => {
    try {
      await onUpdateQuote(id, updates);
    } catch (err) {
      toastError((err as Error).message || t('sales:clientQuotes.failedToUpdateStatus'));
    }
  };

  const handleDelete = async () => {
    if (!quoteToDelete) return;
    if (isDeleting) return;
    dispatch({ type: 'setIsDeleting', value: true });
    try {
      await onDeleteQuote(quoteToDelete.id);
      dispatch({ type: 'deleteSuccess' });
    } catch (err) {
      toastError((err as Error).message || t('sales:clientQuotes.failedToDelete'));
    } finally {
      dispatch({ type: 'setIsDeleting', value: false });
    }
  };

  const applyClientChange = (clientId: string, clientName: string, shouldReprice: boolean) => {
    if (isReadOnly) return;
    dispatch({ type: 'setPendingClientChange', value: null });
    setFormData((prev) => {
      const updatedItems = shouldReprice
        ? (prev.items || []).map((item) => {
            if (!item.productId) {
              return {
                ...item,
                supplierQuoteId: null,
                supplierQuoteItemId: null,
                supplierQuoteSupplierName: null,
                supplierQuoteUnitPrice: null,
              };
            }

            const product = products.find((p) => p.id === item.productId);
            if (!product) {
              return {
                ...item,
                supplierQuoteId: null,
                supplierQuoteItemId: null,
                supplierQuoteSupplierName: null,
                supplierQuoteUnitPrice: null,
              };
            }

            const mol = product.molPercentage ? Number(product.molPercentage) : 0;
            const cost = Number(product.costo);
            const unitPrice = convertUnitPrice(
              calcProductSalePrice(cost, mol),
              'hours',
              item.unitType || 'hours',
            );

            return {
              ...item,
              id:
                shouldReprice && editingQuote
                  ? `temp-reprice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                  : item.id,
              supplierQuoteId: null,
              supplierQuoteItemId: null,
              supplierQuoteSupplierName: null,
              supplierQuoteUnitPrice: null,

              unitPrice,
              productCost: Number(product.costo),
              productMolPercentage: product.molPercentage,
            };
          })
        : prev.items || [];

      return {
        ...prev,
        clientId,
        clientName,
        items: updatedItems,
      };
    });
  };

  const handleClientChange = (clientId: string) => {
    if (isReadOnly) return;
    const client = clients.find((c) => c.id === clientId);
    const nextClientName = client?.name || '';
    const shouldPromptReprice =
      Boolean(editingQuote) &&
      clientId !== formData.clientId &&
      Boolean(formData.items && formData.items.length > 0);

    if (shouldPromptReprice) {
      dispatch({
        type: 'setPendingClientChange',
        value: { clientId, clientName: nextClientName },
      });
      return;
    }

    applyClientChange(clientId, nextClientName, true);
    if (errors.clientId) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.clientId;
        return newErrors;
      });
    }
  };

  const handleClientChangeKeepSnapshots = () => {
    if (!pendingClientChange) return;
    applyClientChange(pendingClientChange.clientId, pendingClientChange.clientName, false);
    if (errors.clientId) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.clientId;
        return newErrors;
      });
    }
  };

  const handleClientChangeReprice = () => {
    if (!pendingClientChange) return;
    applyClientChange(pendingClientChange.clientId, pendingClientChange.clientName, true);
    if (errors.clientId) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.clientId;
        return newErrors;
      });
    }
  };

  const addProductRow = () => {
    if (isReadOnly) return;
    const newItem: Partial<QuoteItem> = {
      id: 'temp-' + Date.now(),
      productId: '',
      productName: '',
      quantity: 1,
      durationMonths: 1,
      durationUnit: 'months',
      unitType: 'hours',
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      // Supplier quote fields
      supplierQuoteId: null,
      supplierQuoteItemId: null,
      supplierQuoteSupplierName: null,
      supplierQuoteUnitPrice: null,

      discount: 0,
      note: '',
    };
    setFormData((prev) => ({ ...prev, items: [...(formData.items || []), newItem as QuoteItem] }));
    if (errors.items) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.items;
        return newErrors;
      });
    }
  };

  const removeProductRow = (index: number) => {
    if (isReadOnly) return;
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  const updateProductRow = (index: number, field: keyof QuoteItem, value: string | number) => {
    if (isReadOnly) return;
    const newItems = [...(formData.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'productId') {
      const product = activeProducts.find((p) => p.id === value);
      if (product) {
        newItems[index].productName = product.name;

        newItems[index].supplierQuoteId = null;
        newItems[index].supplierQuoteItemId = null;
        newItems[index].supplierQuoteSupplierName = null;
        newItems[index].supplierQuoteUnitPrice = null;
        newItems[index].supplierQuoteBaseQuantity = null;
        newItems[index].supplierQuoteBaseUnitPrice = null;

        // Use standard product cost with unit type handling
        if (product.type === 'supply') {
          newItems[index].unitType = 'hours';
        }
        const mol = product.molPercentage ? Number(product.molPercentage) : 0;
        newItems[index].unitPrice = convertUnitPrice(
          calcProductSalePrice(Number(product.costo), mol),
          'hours',
          newItems[index].unitType || 'hours',
        );
        newItems[index].productCost = Number(product.costo);
        newItems[index].productMolPercentage = product.molPercentage;
      }
    }

    if (field === 'supplierQuoteItemId') {
      if (!value || value === 'none') {
        // Clear supplier quote and revert to product cost
        newItems[index].supplierQuoteId = null;
        newItems[index].supplierQuoteItemId = null;
        newItems[index].supplierQuoteSupplierName = null;
        newItems[index].supplierQuoteUnitPrice = null;
        newItems[index].supplierQuoteBaseQuantity = null;
        newItems[index].supplierQuoteBaseUnitPrice = null;

        const product = products.find((p) => p.id === newItems[index].productId);
        if (product) {
          if (product.type === 'supply') {
            newItems[index].unitType = 'hours';
          }
          const mol = product.molPercentage ? Number(product.molPercentage) : 0;
          newItems[index].unitPrice = convertUnitPrice(
            calcProductSalePrice(Number(product.costo), mol),
            'hours',
            newItems[index].unitType || 'hours',
          );
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
        }
        setFormData((prev) => ({ ...prev, items: newItems }));
        return;
      }

      // Find the supplier quote item
      const selectedQuote = sourceableSupplierQuotes.find((quote) =>
        quote.items.some((item) => item.id === value),
      );
      const selectedQuoteItem = selectedQuote?.items.find((item) => item.id === value);

      if (selectedQuote && selectedQuoteItem) {
        const product = selectedQuoteItem.productId
          ? products.find((p) => p.id === selectedQuoteItem.productId)
          : undefined;

        const netCost = selectedQuoteItem.unitPrice;

        newItems[index].productId = selectedQuoteItem.productId || '';
        newItems[index].productName = product?.name || selectedQuoteItem.productName;
        newItems[index].supplierQuoteId = selectedQuote.id;
        newItems[index].supplierQuoteItemId = selectedQuoteItem.id;
        newItems[index].supplierQuoteSupplierName = selectedQuote.supplierName;
        newItems[index].unitType = selectedQuoteItem.unitType || 'hours';
        if (product) {
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
        } else {
          newItems[index].productCost = netCost;
          newItems[index].productMolPercentage = null;
        }
        // Same math as the refresh chip: refreshedSupplierLineFields recomputes the sale price
        // from the picked cost and the line MOL, converting FROM the supplier item's own unit
        // (#812 round 14) — the picked cost is priced in that unit, so converting from a
        // hardcoded 'hours' multiplied a days-priced item by 8 on initial selection.
        const refreshed = refreshedSupplierLineFields(newItems[index], selectedQuoteItem);
        newItems[index].quantity = refreshed.quantity;
        newItems[index].supplierQuoteUnitPrice = refreshed.supplierQuoteUnitPrice;
        // Pick-time baseline: lets the server tell a deliberate pre-save edit (pushed onto the
        // supplier item) from an untouched stale snapshot (server values win).
        newItems[index].supplierQuoteBaseQuantity = refreshed.supplierQuoteBaseQuantity;
        newItems[index].supplierQuoteBaseUnitPrice = refreshed.supplierQuoteBaseUnitPrice;
        newItems[index].unitPrice = refreshed.unitPrice;
      } else {
        // Supplier quote item not found - clear supplier quote and revert
        newItems[index].supplierQuoteItemId = null;
        newItems[index].supplierQuoteId = null;
        newItems[index].supplierQuoteSupplierName = null;
        newItems[index].supplierQuoteUnitPrice = null;
        newItems[index].supplierQuoteBaseQuantity = null;
        newItems[index].supplierQuoteBaseUnitPrice = null;

        const existingProduct = products.find((p) => p.id === newItems[index].productId);
        if (existingProduct) {
          const mol = existingProduct.molPercentage ? Number(existingProduct.molPercentage) : 0;
          newItems[index].unitPrice = calcProductSalePrice(Number(existingProduct.costo), mol);
          newItems[index].productCost = Number(existingProduct.costo);
          newItems[index].productMolPercentage = existingProduct.molPercentage;
        }
      }
    }

    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  const activeClients = useMemo(() => clients.filter((c) => !c.isDisabled), [clients]);
  const activeProducts = useMemo(() => products.filter((p) => !p.isDisabled), [products]);
  const activeProductOptions = useMemo(
    () => activeProducts.map((p) => ({ id: p.id, name: p.name })),
    [activeProducts],
  );
  const activeProductIds = useMemo(
    () => new Set(activeProducts.map((p) => p.id)),
    [activeProducts],
  );
  // All linkable record ids (including disabled products / non-accepted quotes),
  // so a quick-view link only renders when its target still exists — a stale id
  // left on a quote line by a hard-deleted record would otherwise dead-end on the
  // full listing instead of the referenced record.
  const allProductIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const allSupplierQuoteIds = useMemo(
    () => new Set(supplierQuotes.map((q) => q.id)),
    [supplierQuotes],
  );
  const today = getLocalDateString();

  // Lines source from DRAFT supplier quotes (#779 derived model): a supplier quote starts as
  // draft and progresses only with the client document that uses it, so accepted/sent ones are
  // already spoken for. Order-locked quotes are final procurement — sourcing them would mint a
  // line whose sync the server refuses. The date check is a stale-cache belt — expired never
  // reads as draft.
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
    const options: Array<{
      id: string;
      name: string;
      quoteId: string;
      productId?: string;
      unitPrice: number;
      unitType?: SupplierUnitType;
      quantity: number;
    }> = [];
    for (const quote of sourceableSupplierQuotes) {
      for (const item of quote.items) {
        options.push({
          id: item.id,
          name: supplierQuoteItemLabel(quote, item),
          quoteId: quote.id,
          productId: item.productId,
          unitPrice: item.unitPrice,
          unitType: item.unitType,
          quantity: item.quantity,
        });
      }
    }
    return options;
  }, [sourceableSupplierQuotes]);

  // item-id → its CURRENT supplier quote + item, across ALL supplier quotes (not just the
  // selectable ones), for the bidirectional-sync affordances (#779): lock detection
  // (order-locked/frozen sourced fields) and stale-data detection (the per-line
  // "data drifted — sync?" refresh button). Quick-view ids and display labels derive from it,
  // so an existing line referencing a no-longer-selectable but extant quote still resolves.
  const supplierQuoteItemIndex = useMemo(
    () => buildSupplierQuoteItemIndex(supplierQuotes),
    [supplierQuotes],
  );

  // O(1) item-id → parent-quote-id projection for the shared quick-view helpers.
  const quoteIdBySupplierQuoteItemId = useMemo(
    () => new Map(Array.from(supplierQuoteItemIndex, ([id, ref]) => [id, ref.quote.id] as const)),
    [supplierQuoteItemIndex],
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

  const isLinkedProductMissing = (item: QuoteItem) =>
    Boolean(item.supplierQuoteItemId && (!item.productId || !activeProductIds.has(item.productId)));

  const updateProductSelection = (index: number, productId: string) => {
    updateProductRow(index, 'productId', productId);
  };

  const handleUnitTypeChange = (index: number, newType: SupplierUnitType) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item) return;
    const oldType = item.unitType || 'hours';
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

  // Duration value entered in the item's chosen unit (issue #757). Stored canonically as whole
  // months; 'years' multiplies by 12. Empty/invalid input falls back to 1 of the chosen unit.
  const handleDurationValueChange = (index: number, value: string) => {
    if (isReadOnly) return;
    const unit = normalizeDurationUnit(formData.items?.[index]?.durationUnit);
    updateProductRow(index, 'durationMonths', parseDurationValueToMonths(value, unit));
  };

  // Switching months↔years keeps the displayed number and reinterprets it under the new unit
  // (e.g. "2" months → "2" years = 24 months), mirroring how the quantity unit selector behaves.
  const handleDurationUnitChange = (index: number, newUnit: DurationUnit) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return;
    // 'N/A' marks the line as duration-less: reset to the neutral 1 month so it never multiplies
    // (issue #775). Months/years instead keeps the displayed number under the new unit.
    const durationMonths =
      newUnit === 'na' ? 1 : durationValueToMonths(getDurationDisplayValue(item), newUnit);
    const newItems = [...(formData.items || [])];
    newItems[index] = {
      ...newItems[index],
      durationUnit: newUnit,
      durationMonths,
    };
    setFormData((prev) => ({ ...prev, items: newItems }));
  };

  // Column definitions for StandardTable
  const columns: Column<Quote>[] = [
    {
      header: t('sales:clientQuotes.quoteCodeColumn'),
      accessorKey: 'id',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      cell: ({ row }) => <span className="font-bold text-zinc-700">{row.id}</span>,
    },
    {
      header: t('crm:clients.tableHeaders.insertDate'),
      id: 'createdAt',
      accessorFn: (row) => row.createdAt ?? 0,
      className: 'whitespace-nowrap',
      cell: ({ row }) => {
        if (!row.createdAt) return <span className="text-xs text-zinc-400">-</span>;
        return (
          <span className="text-xs text-zinc-500 whitespace-nowrap">
            {formatInsertDate(row.createdAt)}
          </span>
        );
      },
      filterFormat: (value) => {
        const timestamp = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
        return formatInsertDate(timestamp);
      },
    },
    {
      header: t('sales:clientQuotes.clientColumn'),
      accessorKey: 'clientName',
      cell: ({ row }) => {
        const history = isHistoryRow(row);
        return (
          <div className={history ? 'font-bold text-zinc-400' : 'font-bold text-zinc-800'}>
            {row.clientName}
          </div>
        );
      },
    },
    {
      header: t('sales:clientQuotes.subtotal', { defaultValue: 'Subtotal' }),
      id: 'subtotal',
      accessorFn: (row) => quotePricingMap.get(row.id)?.subtotal ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { subtotal } = quotePricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        const history = isHistoryRow(row);
        return (
          <span
            className={`text-sm font-semibold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-zinc-700'}`}
          >
            {subtotal.toFixed(2)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientQuotes.discountPercentColumn'),
      id: 'globalDiscount',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableSorting: true,
      disableFiltering: true,
      cell: ({ row }) => {
        const history = isHistoryRow(row);
        return (
          <span
            className={`text-sm font-semibold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-zinc-600'}`}
          >
            {formatDiscountPercentage(row)}
          </span>
        );
      },
    },
    {
      header: t('common:labels.discount'),
      id: 'discountAmount',
      accessorFn: (row) => quotePricingMap.get(row.id)?.discountAmount ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { discountAmount } = quotePricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        const history = isHistoryRow(row);
        if (discountAmount <= 0) {
          return (
            <span
              className={`text-sm font-semibold ${history ? 'text-zinc-300' : 'text-zinc-400'}`}
            >
              -
            </span>
          );
        }
        return (
          <span
            className={`text-sm font-semibold whitespace-nowrap ${history ? 'text-amber-300' : 'text-amber-600'}`}
          >
            -{discountAmount.toFixed(2)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientQuotes.discountedTotalColumn'),
      id: 'total',
      accessorFn: (row) => quotePricingMap.get(row.id)?.total ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { total } = quotePricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        const history = isHistoryRow(row);
        return (
          <span
            className={`text-sm font-bold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-zinc-700'}`}
          >
            {total.toFixed(2)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientQuotes.marginLabel'),
      id: 'margin',
      accessorFn: (row) => quotePricingMap.get(row.id)?.margin ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { margin } = quotePricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        const history = isHistoryRow(row);
        return (
          <span
            className={`text-sm font-bold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-emerald-600'}`}
          >
            {margin.toFixed(2)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' }),
      id: 'mol',
      accessorFn: (row) => quotePricingMap.get(row.id)?.marginPercentage ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[6rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { marginPercentage } = quotePricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        const history = isHistoryRow(row);
        return (
          <span
            className={`text-sm font-bold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-emerald-600'}`}
          >
            {formatMolPercentage(marginPercentage)}
          </span>
        );
      },
    },
    {
      header: t('sales:clientQuotes.paymentTermsColumn'),
      accessorKey: 'paymentTerms',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[10rem]',
      cell: ({ row }) => {
        const history = isHistoryRow(row);
        return (
          <span className={`text-sm font-semibold ${history ? 'text-zinc-400' : 'text-zinc-600'}`}>
            {row.paymentTerms === 'immediate'
              ? t('sales:clientQuotes.immediatePayment')
              : row.paymentTerms}
          </span>
        );
      },
    },
    {
      header: t('sales:communicationChannels.fieldLabel'),
      id: 'communicationChannelName',
      accessorFn: (row) => row.communicationChannelName ?? '',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[10rem]',
      filterFormat: (value) => (value ? String(value) : '-'),
      cell: ({ row }) => {
        const history = isHistoryRow(row);
        return (
          <span className={`text-sm font-semibold ${history ? 'text-zinc-400' : 'text-zinc-600'}`}>
            {row.communicationChannelName || '-'}
          </span>
        );
      },
    },
    {
      header: t('sales:clientQuotes.expirationColumn'),
      accessorKey: 'expirationDate',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      cell: ({ row }) => {
        const expired = isQuoteExpired(row);
        const history = isHistoryRow(row);
        return (
          <div
            className={`text-sm ${
              history ? 'text-zinc-400' : expired ? 'text-red-600 font-bold' : 'text-zinc-600'
            }`}
          >
            {formatDateOnlyForLocale(row.expirationDate)}
            {expired && !history && (
              <span className="ml-2 text-[10px] font-black">
                {t('sales:clientQuotes.expiredLabel')}
              </span>
            )}
          </div>
        );
      },
    },
    {
      header: t('sales:clientQuotes.statusColumn'),
      accessorKey: 'status',
      // Filter/sort on the DERIVED status (#779): expired quotes get their own filter option.
      accessorFn: effectiveRowStatus,
      filterFormat: (value) => getStatusLabel(String(value ?? '')),
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      cell: ({ row }) => {
        const history = isHistoryRow(row);
        const badgeStatus = effectiveRowStatus(row) as StatusType;
        return (
          <div className={`flex items-center gap-1.5 ${history ? 'opacity-60' : ''}`}>
            <StatusBadge type={badgeStatus} label={getStatusLabel(badgeStatus)} />
            {row.linkedSupplierQuoteExpired && (
              <i
                role="img"
                className="fa-solid fa-triangle-exclamation text-red-600 text-xs"
                title={t('sales:clientQuotes.linkedSupplierQuoteExpired', {
                  defaultValue: 'The linked supplier quote has expired',
                })}
                aria-label={t('sales:clientQuotes.linkedSupplierQuoteExpired', {
                  defaultValue: 'The linked supplier quote has expired',
                })}
              ></i>
            )}
          </div>
        );
      },
    },
    {
      header: t('sales:clientQuotes.actionsColumn'),
      id: 'actions',
      align: 'right',
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      disableSorting: true,
      disableFiltering: true,
      cell: ({ row }) => {
        const expired = isQuoteExpired(row);
        const hasOffer = hasOfferForQuote(row);
        const offerStatus = getOfferStatusForQuote(row);
        const history = isHistoryRow(row);
        // A linked, expired supplier quote blocks progression to sent/offer/accepted (#779).
        const supplierExpired = Boolean(row.linkedSupplierQuoteExpired);
        const progressBlockedTitle = t('sales:clientQuotes.linkedSupplierQuoteExpiredBlocks', {
          defaultValue:
            'The linked supplier quote has expired — extend it before progressing this quote.',
        });

        const isDeleteDisabled = expired || row.status !== 'draft' || history;
        const deleteTitle = history
          ? t('sales:clientQuotes.historyActionsDisabled', {
              defaultValue: 'History entries cannot be modified.',
            })
          : expired
            ? t('sales:clientQuotes.errors.expiredCannotDelete')
            : t('sales:clientQuotes.deleteQuote');

        const isCreateOfferDisabled = history || hasOffer;
        const createOfferTitle = hasOffer
          ? t('sales:clientQuotes.offerAlreadyExists', {
              defaultValue: 'An offer for this quote already exists.',
            })
          : history
            ? t('sales:clientQuotes.historyActionsDisabled', {
                defaultValue: 'History entries cannot be modified.',
              })
            : t('sales:clientQuotes.convertToOffer', {
                defaultValue: 'Convert to offer',
              });

        const canRestore = !hasOffer || offerStatus === 'draft';
        const canRollbackDraftOffer =
          row.status === 'offer' && Boolean(row.linkedOfferId) && offerStatus === 'draft';
        // Back-to-draft is rejected by the server from accepted/denied/expired, and history rows are
        // immutable — so a sent/offer row whose EFFECTIVE status is expired must not show an enabled
        // restore button (it would 409). `history` already folds in the expired check.
        const restoreDisabled = !canRestore || (history && (!canRollbackDraftOffer || expired));
        const restoreTitle = !canRestore
          ? t('sales:clientQuotes.restoreDisabledOfferStatus', {
              defaultValue: 'Restore is only possible when the linked offer is in draft status.',
            })
          : history && (!canRollbackDraftOffer || expired)
            ? t('sales:clientQuotes.historyActionsDisabled', {
                defaultValue: 'History entries cannot be modified.',
              })
            : t('sales:clientQuotes.restoreQuote', { defaultValue: 'Restore quote' });

        // Gate the edit action on the SAME predicate as the row click (#812 round 13): some
        // history rows still open — accepted/denied read-only, expired (non-offer-linked) to
        // extend the date out of `expired` — and the pencil must not block that recovery path.
        const canOpen = canOpenQuoteModal(row);
        return (
          <div className="flex justify-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canOpen) return;
                      openEditModal(row);
                    }}
                    disabled={!canOpen}
                    aria-label={t('sales:clientQuotes.editQuote')}
                    className={`p-2 rounded-lg transition-all ${canOpen ? 'text-zinc-400 hover:text-praetor hover:bg-zinc-100' : 'cursor-not-allowed opacity-50 text-zinc-400'}`}
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {canOpen
                  ? t('sales:clientQuotes.editQuote')
                  : t('sales:clientQuotes.historyActionsDisabled', {
                      defaultValue: 'History entries cannot be modified.',
                    })}
              </TooltipContent>
            </Tooltip>
            {row.linkedOfferId && onViewOffer && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // biome-ignore lint/style/noNonNullAssertion: narrowed by truthy guard
                        onViewOffer(row.linkedOfferId!);
                      }}
                      aria-label={t('sales:clientQuotes.viewOffer', { defaultValue: 'View offer' })}
                      className="p-2 rounded-lg transition-all text-zinc-400 hover:text-praetor hover:bg-zinc-100"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('sales:clientQuotes.viewOffer', { defaultValue: 'View offer' })}
                </TooltipContent>
              </Tooltip>
            )}
            {row.status === 'accepted' && onCreateOffer && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isCreateOfferDisabled) return;
                        onCreateOffer(row);
                      }}
                      disabled={isCreateOfferDisabled}
                      aria-label={createOfferTitle}
                      className={`p-2 rounded-lg transition-all ${isCreateOfferDisabled ? 'cursor-not-allowed opacity-50 text-zinc-400' : 'text-zinc-400 hover:text-praetor hover:bg-zinc-100'}`}
                    >
                      <i className="fa-solid fa-file-signature"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{createOfferTitle}</TooltipContent>
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
                        if (history || supplierExpired) return;
                        handleStatusUpdate(row.id, { status: 'sent' });
                      }}
                      disabled={history || supplierExpired}
                      aria-label={t('sales:clientQuotes.markAsSent')}
                      className={`p-2 rounded-lg transition-all ${history || supplierExpired ? 'cursor-not-allowed opacity-50 text-blue-700' : 'text-blue-700 hover:text-blue-600 hover:bg-blue-50'}`}
                    >
                      <i className="fa-solid fa-paper-plane"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {history
                    ? t('sales:clientQuotes.historyActionsDisabled', {
                        defaultValue: 'History entries cannot be modified.',
                      })
                    : supplierExpired
                      ? progressBlockedTitle
                      : t('sales:clientQuotes.markAsSent')}
                </TooltipContent>
              </Tooltip>
            )}
            {row.status === 'sent' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (history || supplierExpired) return;
                        handleStatusUpdate(row.id, { status: 'offer' });
                      }}
                      disabled={history || supplierExpired}
                      aria-label={t('sales:clientQuotes.markAsOffer')}
                      className={`p-2 rounded-lg transition-all ${history || supplierExpired ? 'cursor-not-allowed opacity-50 text-indigo-700' : 'text-indigo-700 hover:text-indigo-600 hover:bg-indigo-50'}`}
                    >
                      <i className="fa-solid fa-file-signature"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {history
                    ? t('sales:clientQuotes.historyActionsDisabled', {
                        defaultValue: 'History entries cannot be modified.',
                      })
                    : supplierExpired
                      ? progressBlockedTitle
                      : t('sales:clientQuotes.markAsOffer')}
                </TooltipContent>
              </Tooltip>
            )}
            {row.status === 'offer' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (history || supplierExpired) return;
                        handleStatusUpdate(row.id, { status: 'accepted' });
                      }}
                      disabled={history || supplierExpired}
                      aria-label={t('sales:clientQuotes.markAsAccepted')}
                      className={`p-2 rounded-lg transition-all ${history || supplierExpired ? 'cursor-not-allowed opacity-50 text-emerald-700' : 'text-emerald-700 hover:text-emerald-600 hover:bg-emerald-50'}`}
                    >
                      <i className="fa-solid fa-check"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {history
                    ? t('sales:clientQuotes.historyActionsDisabled', {
                        defaultValue: 'History entries cannot be modified.',
                      })
                    : supplierExpired
                      ? progressBlockedTitle
                      : t('sales:clientQuotes.markAsAccepted')}
                </TooltipContent>
              </Tooltip>
            )}
            {/* "Mark as denied" is reachable from both sent and offer; one shared block keeps the
                guard, label and tooltip in sync (it renders last in both states). */}
            {(row.status === 'sent' || row.status === 'offer') && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (history) return;
                        handleStatusUpdate(row.id, { status: 'denied' });
                      }}
                      disabled={history}
                      aria-label={t('sales:clientQuotes.markAsDenied')}
                      className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-red-600' : 'text-red-600 hover:text-red-600 hover:bg-red-50'}`}
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {history
                    ? t('sales:clientQuotes.historyActionsDisabled', {
                        defaultValue: 'History entries cannot be modified.',
                      })
                    : t('sales:clientQuotes.markAsDenied')}
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
                        if (isDeleteDisabled) return;
                        confirmDelete(row);
                      }}
                      disabled={isDeleteDisabled}
                      aria-label={deleteTitle}
                      className={`p-2 text-red-600 rounded-lg transition-all ${isDeleteDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-red-600 hover:bg-red-50'}`}
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{deleteTitle}</TooltipContent>
              </Tooltip>
            )}
            {(!hasOffer || row.status === 'offer') &&
              canTransitionClientQuote(row.status, 'draft') && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (restoreDisabled) return;
                          // Back-to-draft is allowed only from sent/offer (#779); the server
                          // enforces the same rule and rejects it from accepted/denied/expired.
                          handleStatusUpdate(row.id, { status: 'draft' });
                        }}
                        disabled={restoreDisabled}
                        aria-label={restoreTitle}
                        className={`p-2 rounded-lg transition-all ${restoreDisabled ? 'cursor-not-allowed opacity-50 text-emerald-700' : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'}`}
                      >
                        <i className="fa-solid fa-rotate-left"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{restoreTitle}</TooltipContent>
                </Tooltip>
              )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal}>
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
          <ModalContent size="full" className="max-h-[90vh]">
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <ModalHeader>
                <ModalTitle className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                    <i
                      className={`fa-solid ${editingQuote ? 'fa-pen-to-square' : 'fa-plus'}`}
                      aria-hidden="true"
                    ></i>
                  </span>
                  {isReadOnly
                    ? t('sales:clientQuotes.viewQuote')
                    : editingQuote
                      ? t('sales:clientQuotes.editQuote')
                      : t('sales:clientQuotes.createNewQuote')}
                </ModalTitle>
                <ModalCloseButton onClick={closeModal} />
              </ModalHeader>

              <ModalBody className="flex-1 space-y-5">
                {previewVersion && (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
                    <span className="text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-2">
                      <i className="fa-solid fa-clock-rotate-left"></i>
                      {t('sales:clientQuotes.versionHistory.previewBanner', {
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
                      {t('sales:clientQuotes.versionHistory.backToCurrent', {
                        defaultValue: 'Back to current',
                      })}
                    </Button>
                  </div>
                )}
                {baseReadOnly && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
                    <span className="text-amber-700 dark:text-amber-300 text-xs font-bold">
                      {editingQuote?.linkedOfferId
                        ? t('sales:clientQuotes.readOnlyBecauseOffer', {
                            defaultValue: 'Read-only due to linked offer',
                          })
                        : t('sales:clientQuotes.readOnlyBecauseFinal', {
                            defaultValue: 'Read-only due to finalized status',
                          })}
                    </span>
                  </div>
                )}
                {editingQuote?.linkedOfferId && (
                  <LinkedRecordBanner
                    label={t('sales:clientQuotes.linkedOffer', { defaultValue: 'Linked Offer' })}
                    value={t('sales:clientQuotes.linkedOfferInfo', {
                      number: editingQuote.linkedOfferId,
                      defaultValue: 'Offer #{{number}}',
                    })}
                    note={t('sales:clientQuotes.offerDetailsReadOnly', {
                      defaultValue: '(Quote details are read-only)',
                    })}
                    action={
                      onViewOffers
                        ? {
                            label: t('sales:clientQuotes.viewOffer', {
                              defaultValue: 'View Offer',
                            }),
                            onClick: () => onViewOffers(editingQuote.id),
                          }
                        : undefined
                    }
                  />
                )}
                {editingQuote?.linkedSupplierQuoteExpired && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10">
                    <i
                      className="fa-solid fa-triangle-exclamation text-red-600"
                      aria-hidden="true"
                    ></i>
                    <span className="text-red-700 dark:text-red-300 text-xs font-bold">
                      {t('sales:clientQuotes.linkedSupplierQuoteExpiredBanner', {
                        defaultValue:
                          'The linked supplier quote has expired. Extend its validity before progressing this quote to Sent, Offer, or Accepted.',
                      })}
                    </span>
                  </div>
                )}
                {/* Client Selection */}
                <div className="space-y-2">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('sales:clientQuotes.clientInformation')}
                    <FieldTooltip
                      description={t('sales:fieldInfo.clientInformation', {
                        defaultValue: 'Client and document details',
                      })}
                      status={readOnlyStatus}
                      statusLabel={statusLabel}
                    />
                  </h4>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <Field data-invalid={Boolean(errors.clientId)}>
                      <SelectControl
                        id="client-quote-client"
                        options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                        value={formData.clientId || ''}
                        onChange={(val) => handleClientChange(val as string)}
                        placeholder={t('sales:clientQuotes.selectAClient')}
                        searchable={true}
                        disabled={isReadOnly}
                        label={t('sales:clientQuotes.client')}
                        required
                        buttonClassName="h-9"
                        className={errors.clientId ? 'border-red-300' : ''}
                      />
                      <FieldError className="text-xs">{errors.clientId}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(errors.id)}>
                      <FieldLabel htmlFor="client-quote-code" required={Boolean(editingQuote)}>
                        {t('sales:clientQuotes.quoteCode', { defaultValue: 'Quote Code' })}
                      </FieldLabel>
                      <Input
                        id="client-quote-code"
                        type="text"
                        value={formData.id || ''}
                        onChange={(e) => {
                          setFormData((prev) => ({ ...prev, id: e.target.value }));
                          if (errors.id) {
                            setErrors((prev) => {
                              const next = { ...prev };
                              delete next.id;
                              return next;
                            });
                          }
                        }}
                        placeholder={t('sales:clientQuotes.autoCodePlaceholder', {
                          defaultValue: 'Auto-generated',
                        })}
                        disabled={isReadOnly}
                        className={errors.id ? 'border-red-300 font-medium' : 'font-medium'}
                        aria-invalid={Boolean(errors.id)}
                      />
                      <FieldError className="text-xs">{errors.id}</FieldError>
                      {!editingQuote && (
                        <FieldDescription className="text-xs">
                          {t('sales:clientQuotes.autoCodeDescription', {
                            defaultValue: 'Leave blank to generate the next code automatically.',
                          })}
                        </FieldDescription>
                      )}
                    </Field>
                    <Field>
                      <SelectControl
                        id="client-quote-payment-terms"
                        options={paymentTermsOptions}
                        value={formData.paymentTerms || 'immediate'}
                        onChange={(val) =>
                          setFormData((prev) => ({
                            ...prev,
                            paymentTerms: val as Quote['paymentTerms'],
                          }))
                        }
                        searchable={false}
                        disabled={isReadOnly}
                        label={t('sales:clientQuotes.paymentTerms')}
                        buttonClassName="h-9"
                      />
                    </Field>
                    <Field data-invalid={Boolean(errors.communicationChannelId)}>
                      <QuoteCommunicationChannelField
                        id="client-quote-communication-channel"
                        channels={communicationChannels}
                        value={formData.communicationChannelId || ''}
                        error={errors.communicationChannelId}
                        disabled={isReadOnly}
                        canManage={canManageCommunicationChannels}
                        onChange={(value) => {
                          const selected = communicationChannels.find(
                            (channel) => channel.id === value,
                          );
                          setFormData((prev) => ({
                            ...prev,
                            communicationChannelId: value,
                            communicationChannelName: selected?.name ?? '',
                          }));
                          if (errors.communicationChannelId) {
                            setErrors((prev) => {
                              const next = { ...prev };
                              delete next.communicationChannelId;
                              return next;
                            });
                          }
                        }}
                        onCreate={onCreateCommunicationChannel}
                        onUpdate={onUpdateCommunicationChannel}
                        onDelete={onDeleteCommunicationChannel}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="client-quote-expiration-date" required>
                        {t('sales:clientQuotes.expirationDateLabel')}
                      </FieldLabel>
                      <DateField
                        id="client-quote-expiration-date"
                        required
                        value={formData.expirationDate}
                        onChange={(value) =>
                          setFormData((prev) => ({ ...prev, expirationDate: value }))
                        }
                        // Stays editable when the only read-only reason is expiry, so the quote
                        // can be extended out of the `expired` state (issue #779).
                        disabled={isReadOnly && !expirationEditableWhileReadOnly}
                      />
                    </Field>
                  </div>
                </div>

                {/* Products */}
                <div className="space-y-2 border-t border-border pt-4">
                  <div className="flex justify-between items-center">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('sales:clientQuotes.productsServices')}
                      <FieldTooltip
                        description={t('sales:fieldInfo.productsServices', {
                          defaultValue: 'Products and services for this quote',
                        })}
                        status={readOnlyStatus}
                        statusLabel={statusLabel}
                      />
                    </h4>
                    <Button type="button" size="sm" onClick={addProductRow} disabled={isReadOnly}>
                      <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                      {t('sales:clientQuotes.addProduct')}
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
                          {t('sales:clientQuotes.productsServices')}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:clientQuotes.qty')}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center whitespace-nowrap">
                          {t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('crm:internalListing.cost')}
                        </div>
                        <div className="col-span-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center whitespace-nowrap">
                          MOL
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
                        const product = products.find((p) => p.id === item.productId);
                        const isSupply = product?.type === 'supply';
                        const unitSalePrice = Number(item.unitPrice || 0);
                        const lineSalePrice = unitSalePrice * quantity * durationMonths;
                        const lineMargin = lineSalePrice - lineCost;

                        const isLinkedToSupplierQuote = Boolean(item.supplierQuoteItemId);
                        const linkedSupplierRef = item.supplierQuoteItemId
                          ? supplierQuoteItemIndex.get(item.supplierQuoteItemId)
                          : undefined;
                        // Fail-safe lock (#779): order-locked/frozen supplier quotes — or an
                        // unresolvable reference (no list permission, still loading) — freeze
                        // the sourced quantity/cost; otherwise they are editable and write back.
                        const supplierLineLocked = isSupplierLineLocked(item, linkedSupplierRef);
                        const supplierDataStale =
                          !isReadOnly &&
                          !supplierLineLocked &&
                          isSupplierLineStale(item, linkedSupplierRef?.item);
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
                          setFormData(makeCostUpdater<Partial<Quote>>(index, value));
                        };

                        const handleMolChange = (value: string) => {
                          if (isReadOnly) return;
                          setFormData(makeMolUpdater<Partial<Quote>>(index, value));
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
                                    {supplierDataStale && linkedSupplierRef && (
                                      <StaleSupplierDataButton
                                        onClick={() =>
                                          refreshLineFromSupplier(index, linkedSupplierRef.item)
                                        }
                                        className="ml-auto"
                                      />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <SelectControl
                                      options={[
                                        {
                                          id: 'none',
                                          name: t('sales:clientQuotes.noSupplierQuote'),
                                        },
                                        ...supplierQuoteItemOptions.map((o) => ({
                                          id: o.id,
                                          name: o.name,
                                        })),
                                      ]}
                                      value={item.supplierQuoteItemId || 'none'}
                                      onChange={(val) =>
                                        updateProductRow(
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
                                      // Drop the default bold (font-semibold) but keep
                                      // font-medium so the value reads as a solid field value,
                                      // not the washed-out gray that font-normal renders at.
                                      valueClassName="font-medium"
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
                                    {t('sales:clientQuotes.productsServices')}
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
                                      options={activeProductOptions}
                                      isProductMissing={isLinkedProductMissing(item)}
                                      isReadOnly={isReadOnly}
                                      ariaLabel={t('sales:clientQuotes.selectProduct', {
                                        defaultValue: 'Select product',
                                      })}
                                      placeholder={t('sales:clientQuotes.selectProduct')}
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
                                onClick={() => setProductRowToDelete(index)}
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
                                  {t('sales:clientQuotes.qty')}
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
                                    placeholder={t('sales:clientQuotes.qty')}
                                    value={item.quantity}
                                    onValueChange={(value) => {
                                      const parsed = parseFloat(value);
                                      updateProductRow(
                                        index,
                                        'quantity',
                                        value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                      );
                                    }}
                                    disabled={isReadOnly || supplierLineLocked}
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
                                  {t('sales:clientQuotes.durationColumn', {
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
                                  <ValidatedNumberInput
                                    step="1"
                                    min="1"
                                    placeholder={t('sales:clientQuotes.durationColumn', {
                                      defaultValue: 'Duration',
                                    })}
                                    value={durationValue}
                                    onValueChange={(value) =>
                                      handleDurationValueChange(index, value)
                                    }
                                    disabled={isReadOnly || durationUnit === 'na'}
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
                                    disabled={isReadOnly || supplierLineLocked}
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
                                  MOL (%)
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
                                    formatDecimals={MOL_PERCENTAGE_DECIMALS}
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
                            <div className="hidden lg:flex gap-2 items-center pt-5">
                              <div className="flex-1 min-w-0 grid grid-cols-16 gap-2 items-center">
                                <div className="relative col-span-3 min-w-0">
                                  {supplierDataStale && linkedSupplierRef && (
                                    <StaleSupplierDataButton
                                      onClick={() =>
                                        refreshLineFromSupplier(index, linkedSupplierRef.item)
                                      }
                                      // Floats in the same gutter band as the quick-view button,
                                      // left-aligned (#779 reverse sync affordance).
                                      className="lg:absolute lg:left-0 lg:-top-1 lg:z-10 lg:-translate-y-full h-6 px-2 text-[10px]"
                                    />
                                  )}
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
                                    options={[
                                      {
                                        id: 'none',
                                        name: t('sales:clientQuotes.noSupplierQuote'),
                                      },
                                      ...supplierQuoteItemOptions.map((o) => ({
                                        id: o.id,
                                        name: o.name,
                                      })),
                                    ]}
                                    value={item.supplierQuoteItemId || 'none'}
                                    onChange={(val) =>
                                      updateProductRow(
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
                                    // Drop the default bold (font-semibold) but keep
                                    // font-medium so the value reads as a solid field value,
                                    // not the washed-out gray that font-normal renders at.
                                    valueClassName="font-medium"
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
                                    options={activeProductOptions}
                                    isProductMissing={isLinkedProductMissing(item)}
                                    isReadOnly={isReadOnly}
                                    ariaLabel={t('sales:clientQuotes.selectProduct', {
                                      defaultValue: 'Select product',
                                    })}
                                    placeholder={t('sales:clientQuotes.selectProduct')}
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
                                      placeholder={t('sales:clientQuotes.qty')}
                                      value={item.quantity}
                                      onValueChange={(value) => {
                                        const parsed = parseFloat(value);
                                        updateProductRow(
                                          index,
                                          'quantity',
                                          value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                        );
                                      }}
                                      disabled={isReadOnly || supplierLineLocked}
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
                                  <ValidatedNumberInput
                                    step="1"
                                    min="1"
                                    placeholder={t('sales:clientQuotes.durationColumn', {
                                      defaultValue: 'Duration',
                                    })}
                                    value={durationValue}
                                    onValueChange={(value) =>
                                      handleDurationValueChange(index, value)
                                    }
                                    disabled={isReadOnly || durationUnit === 'na'}
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
                                      disabled={isReadOnly || supplierLineLocked}
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
                                    formatDecimals={MOL_PERCENTAGE_DECIMALS}
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
                                onClick={() => setProductRowToDelete(index)}
                                disabled={isReadOnly}
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                              >
                                <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                                <span className="sr-only">{t('common:buttons.delete')}</span>
                              </Button>
                            </div>
                            <Field>
                              <Input
                                type="text"
                                placeholder={t('form:placeholderNotes')}
                                value={item.note || ''}
                                onChange={(e) => updateProductRow(index, 'note', e.target.value)}
                                disabled={isReadOnly}
                              />
                            </Field>
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
                  <Field className="w-full md:w-2/3">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('sales:clientQuotes.notesLabel')}
                      <FieldTooltip
                        description={t('sales:fieldInfo.notes', {
                          defaultValue: 'Additional notes for the entire document',
                        })}
                        status={readOnlyStatus}
                        statusLabel={statusLabel}
                      />
                    </h4>
                    <FieldLabel htmlFor="client-quote-notes" className="sr-only">
                      {t('sales:clientQuotes.notesLabel')}
                    </FieldLabel>
                    <Textarea
                      id="client-quote-notes"
                      rows={4}
                      value={formData.notes}
                      onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder={t('sales:clientQuotes.additionalNotesPlaceholder')}
                      disabled={isReadOnly}
                      className="min-h-28 resize-none"
                    />
                  </Field>

                  <div className="w-full space-y-2 md:w-1/3">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('sales:clientQuotes.summary', { defaultValue: 'Summary' })}
                    </h4>
                    {errors.total && (
                      <p className="text-red-500 text-[10px] font-bold mb-2">{errors.total}</p>
                    )}
                    <CostSummaryPanel
                      currency={currency}
                      subtotal={formTotals.subtotal}
                      total={formTotals.total}
                      subtotalLabel={t('sales:clientQuotes.subtotal', { defaultValue: 'Subtotal' })}
                      totalLabel={t('sales:clientQuotes.totalLabel')}
                      globalDiscount={{
                        label: t('sales:clientQuotes.globalDiscount'),
                        value: formData.discount ?? 0,
                        type: formData.discountType || 'percentage',
                        onChange: (value) => {
                          const parsed = parseNumberInputValue(value);
                          setFormData((prev) => ({ ...prev, discount: parsed }));
                          if (errors.total) {
                            setErrors((prev) => {
                              const next = { ...prev };
                              delete next.total;
                              return next;
                            });
                          }
                        },
                        onTypeChange: (type) =>
                          setFormData((prev) => ({ ...prev, discountType: type })),
                        disabled: isReadOnly,
                      }}
                      discountRow={
                        formTotals.discountAmount > 0
                          ? {
                              label: t('sales:clientQuotes.discountAmount', {
                                value: formatDiscountValue(
                                  formData.discount ?? 0,
                                  formData.discountType ?? 'percentage',
                                  currency,
                                ),
                              }),
                              amount: formTotals.discountAmount,
                            }
                          : undefined
                      }
                      margin={{
                        label: `${t('sales:clientQuotes.marginLabel')} (${formatMolPercentage(formTotals.marginPercentage)})`,
                        amount: formTotals.margin,
                      }}
                    />
                  </div>
                </div>
              </ModalBody>

              <ModalFooter>
                <Button type="button" variant="outline" onClick={closeModal}>
                  {t('common:buttons.cancel')}
                </Button>
                {!previewVersion && (
                  <Button
                    type="submit"
                    disabled={(isReadOnly && !expirationEditableWhileReadOnly) || isSubmitting}
                  >
                    {isReadOnly && !expirationEditableWhileReadOnly
                      ? t('sales:clientQuotes.statusQuote', {
                          status: getStatusLabel(editingQuote?.effectiveStatus || ''),
                        })
                      : isSubmitting
                        ? t('common:buttons.saving')
                        : editingQuote
                          ? t('sales:clientQuotes.updateQuote')
                          : t('sales:clientQuotes.createQuote')}
                  </Button>
                )}
              </ModalFooter>
            </form>
          </ModalContent>
          {editingQuote?.id && (
            <QuoteVersionsPanel
              quoteId={editingQuote.id}
              selectedVersionId={previewVersion?.id ?? null}
              onPreview={handleVersionPreview}
              onClearPreview={handleClearPreview}
              onRestored={handleVersionRestored}
              disabled={baseReadOnly}
            />
          )}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(pendingClientChange)}
        onClose={() => dispatch({ type: 'setPendingClientChange', value: null })}
      >
        <ModalContent size="sm">
          <div className="space-y-5 p-6">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {t('sales:clientQuotes.clientChangeRepriceTitle')}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t('sales:clientQuotes.clientChangeRepriceMessage')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleClientChangeKeepSnapshots}
                className="w-full"
              >
                {t('sales:clientQuotes.clientChangeKeepSnapshots')}
              </Button>
              <Button type="button" onClick={handleClientChangeReprice} className="w-full">
                {t('sales:clientQuotes.clientChangeRepriceNow')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => dispatch({ type: 'setPendingClientChange', value: null })}
                className="w-full"
              >
                {t('sales:clientQuotes.clientChangeRepriceCancel')}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          if (isDeleting) return;
          dispatch({ type: 'closeDeleteConfirm' });
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title={`${t('sales:clientQuotes.deleteQuote')}?`}
        description={t('sales:clientQuotes.deleteConfirm', {
          clientName: quoteToDelete?.clientName,
        })}
      />

      {/* Line-item (product) delete confirmation */}
      <DeleteConfirmModal
        isOpen={productRowToDelete !== null}
        onClose={() => setProductRowToDelete(null)}
        onConfirm={() => {
          if (productRowToDelete !== null) {
            removeProductRow(productRowToDelete);
          }
          setProductRowToDelete(null);
        }}
        title={t('sales:clientQuotes.removeProductTitle')}
        description={t('sales:clientQuotes.removeProductConfirm')}
        zIndex={70}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">
              {t('sales:clientQuotes.quotesTitle')}
            </h2>
            <p className="text-zinc-500 text-sm">{t('sales:clientQuotes.quotesSubtitle')}</p>
          </div>
          <HeaderAddButton onClick={openAddModal}>
            {t('sales:clientQuotes.createNewQuote')}
          </HeaderAddButton>
        </div>
      </div>

      {/* Search and Filters */}

      <StandardTable<Quote>
        title={t('sales:clientQuotes.activeQuotes')}
        viewKey="sales.client_quotes"
        data={quotes}
        columns={columns}
        defaultRowsPerPage={5}
        initialFilterState={tableInitialFilterState}
        onRowClick={(row) => {
          // Accepted/denied open read-only (isReadOnly flag); expired opens read-only-except-date so
          // the expiration can be extended (#779); offer-linked history rows stay closed.
          if (canOpenQuoteModal(row)) {
            openEditModal(row);
          }
        }}
        rowClassName={(row) => {
          const expired = isQuoteExpired(row);
          const history = isHistoryRow(row);
          const cursorClass = canOpenQuoteModal(row) ? 'cursor-pointer' : 'cursor-not-allowed';
          return history
            ? `bg-zinc-50 text-zinc-400 hover:bg-zinc-100 ${cursorClass}`
            : expired
              ? `hover:bg-zinc-50/50 ${cursorClass} bg-red-50/30`
              : `hover:bg-zinc-50/50 ${cursorClass}`;
        }}
      />
    </div>
  );
};

export default ClientQuotesView;
