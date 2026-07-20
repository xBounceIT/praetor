import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDocumentCodePreview } from '../../hooks/useDocumentCodePreview';
import { ApiError } from '../../services/api/client';
import { normalizeQuote, normalizeQuoteItem } from '../../services/api/normalizers';
import type {
  QuoteCommunicationChannel,
  QuoteCommunicationChannelIcon,
} from '../../services/api/quoteCommunicationChannels';
import type {
  Client,
  ClientOffer,
  DurationUnit,
  Product,
  Quote,
  QuoteCandidate,
  QuoteItem,
  QuoteMutation,
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
import { formatDocumentCode } from '../../utils/document-code';
import { getLinkedFieldStatus } from '../../utils/fieldStatus';
import { getHistoryPreviewIds } from '../../utils/historyPreview';
import {
  createLineItemIndexResolver,
  createTemporaryLineItemId,
  isTemporaryLineItem,
} from '../../utils/lineItemIndex';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  durationValueToMonths,
  EMPTY_PRICING_TOTALS,
  formatDecimal,
  formatMolPercentage,
  formatNumber,
  getDurationInputValue,
  getItemPricingContext,
  isPositiveFiniteNumber,
  MAX_MOL_PERCENTAGE,
  MIN_MOL_PERCENTAGE,
  MOL_PERCENTAGE_DECIMALS,
  normalizeDurationForSubmit,
  normalizeDurationUnit,
  type PricingTotals,
  parseDurationValueToMonths,
  parseNumberInputValue,
  parseOptionalNumberInputValue,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import {
  makeCostUpdater,
  makeMolUpdater,
  makeRevenueUpdater,
  makeUnitPriceUpdater,
} from '../../utils/pricingHandlers';
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
  pickedSupplierLineFields,
  refreshedSupplierLineFields,
} from '../../utils/supplierLineSync';
import { toastError } from '../../utils/toast';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DateField from '../shared/DateField';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import DurationUnitSelector from '../shared/DurationUnitSelector';
import FieldTooltip, { type FieldTooltipProps } from '../shared/FieldTooltip';
import HeaderAddButton from '../shared/HeaderAddButton';
import {
  LINE_ITEM_NOTE_CELL_CLASSNAME,
  LINE_ITEM_NOTE_COLUMN_MIN_WIDTH,
} from '../shared/lineItemNoteStyles';
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
import { HistoryRail } from '../shared/RevisionHistoryPanel';
import SelectControl, { type Option } from '../shared/SelectControl';
import StaleSupplierDataButton from '../shared/StaleSupplierDataButton';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import SupplierQuoteCostHint from '../shared/SupplierQuoteCostHint';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import ProductSelectOrFallback from './ProductSelectOrFallback';
import QuoteCommunicationChannelField from './QuoteCommunicationChannelField';
import { QuoteRevisionsPanel } from './QuoteRevisionsPanel';
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
  onCreateCommunicationChannel?: (data: {
    name: string;
    icon: QuoteCommunicationChannelIcon;
  }) => Promise<void>;
  onUpdateCommunicationChannel?: (
    id: string,
    updates: { name: string; icon: QuoteCommunicationChannelIcon },
  ) => Promise<void>;
  onDeleteCommunicationChannel?: (id: string) => Promise<void>;
  onAddQuote: (quoteData: QuoteMutation) => void | Promise<void>;
  onUpdateQuote: (id: string, updates: QuoteMutation) => void | Promise<void>;
  onQuoteRestored?: (quote: Quote) => void;
  onDeleteQuote: (id: string) => void | Promise<void>;
  onCreateOfferFromLegacyQuote?: (quote: Quote) => void;
  onPromoteCandidate?: (quoteId: string, candidateId: string) => Promise<unknown>;
  onRollbackPromotion?: (quoteId: string) => Promise<unknown>;
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

const moveQuoteItem = (items: QuoteItem[], fromIndex: number, toIndex: number): QuoteItem[] => {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }
  const reordered = [...items];
  const [movedItem] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, movedItem);
  return reordered;
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

const makeCandidateDraftId = () =>
  'tmp_candidate_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

const candidateSuffix = (index: number): string => {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
};

const nextCandidateName = (candidates: QuoteCandidate[]): string => {
  const usedNames = new Set(
    candidates.map((candidate) => candidate.name.trim().toLocaleLowerCase()),
  );
  for (let index = 0; ; index++) {
    const name = `Variante ${candidateSuffix(index)}`;
    if (!usedNames.has(name.toLocaleLowerCase())) return name;
  }
};

const candidateToFormData = (
  quote: Pick<Quote, 'id' | 'clientId' | 'clientName' | 'status'>,
  candidate: QuoteCandidate,
): Partial<Quote> => ({
  id: quote.id,
  clientId: quote.clientId,
  clientName: quote.clientName,
  status: quote.status,
  items: candidate.items,
  paymentTerms: candidate.paymentTerms,
  discount: candidate.discount,
  discountType: candidate.discountType,
  expirationDate: normalizeDateOnlyString(candidate.expirationDate),
  communicationChannelId: candidate.communicationChannelId ?? '',
  communicationChannelName: candidate.communicationChannelName ?? '',
  notes: candidate.notes || '',
});

const quoteCandidatesForForm = (quote: Quote): QuoteCandidate[] =>
  quote.candidates?.length
    ? quote.candidates
    : [
        {
          id: quote.id,
          quoteId: quote.id,
          name: 'Variante A',
          position: 0,
          state: quote.linkedOfferId ? 'selected' : 'active',
          items: quote.items,
          paymentTerms: quote.paymentTerms,
          discount: quote.discount,
          discountType: quote.discountType,
          expirationDate: quote.expirationDate,
          communicationChannelId: quote.communicationChannelId,
          communicationChannelName: quote.communicationChannelName,
          notes: quote.notes,
          createdAt: quote.createdAt,
          updatedAt: quote.updatedAt,
        },
      ];

const formDataIntoCandidate = (
  candidate: QuoteCandidate,
  formData: Partial<Quote>,
): QuoteCandidate => ({
  ...candidate,
  items: (formData.items || []).map((item) => ({ ...item, candidateId: candidate.id })),
  paymentTerms: formData.paymentTerms || 'immediate',
  discount: Number(formData.discount || 0),
  discountType: formData.discountType || 'percentage',
  expirationDate: formData.expirationDate || '',
  communicationChannelId: formData.communicationChannelId || '',
  communicationChannelName: formData.communicationChannelName || '',
  notes: formData.notes || '',
});

// One label shape for a supplier-quote line item, shared by the picker options and the
// display-value lookup so the two can never drift.
const supplierQuoteItemLabel = (quote: SupplierQuote, item: SupplierQuote['items'][number]) =>
  `[${formatDocumentCode(quote.id, quote.revisionCode)}] ${quote.supplierName} · ${item.productName} (${formatDecimal(item.unitPrice)})`;

const getClientQuoteItemPricingContext = (item: QuoteItem) => getItemPricingContext(item);

const calculateClientQuotePricingTotals = (
  items: QuoteItem[],
  globalDiscount: number,
  discountType: Quote['discountType'],
): PricingTotals => calculatePricingTotals(items, globalDiscount, 'hours', discountType);

const isLegacyAcceptedQuote = (quote: Quote) => {
  const candidates = quote.candidates ?? [];
  const candidate = candidates[0];
  return (
    normalizeQuoteStatus(quote.status) === 'accepted' &&
    candidates.length === 1 &&
    candidate.quoteId === quote.id &&
    candidate.state === 'active'
  );
};

const isCandidatePromotable = (candidate: QuoteCandidate) =>
  candidate.state === 'active' && !candidate.isExpired && !candidate.linkedSupplierQuoteExpired;

const isQuoteCodeConflictError = (err: unknown) =>
  err instanceof ApiError && err.status === 409 && err.message === 'Quote ID already exists';

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

const useClientQuotesController = ({
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
  onCreateOfferFromLegacyQuote,
  onPromoteCandidate,
  onRollbackPromotion,
  onViewOffer,
  quoteFilterId,
  quoteIdsWithOffers,
  quoteOfferStatuses,
  onViewOffers,
  currency,
  offers = EMPTY_OFFERS,
  canViewSupplierQuotes = true,
  canViewInternalListing = true,
}: ClientQuotesViewProps) => {
  const { t, i18n } = useTranslation(['sales', 'crm', 'common', 'form']);

  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);

  const tableInitialFilterState = useMemo(() => {
    if (quoteFilterId) {
      const quote = quotes.find((candidate) => candidate.id === quoteFilterId);
      return { id: [formatDocumentCode(quoteFilterId, quote?.revisionCode)] };
    }
    return undefined;
  }, [quoteFilterId, quotes]);

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
  const { preview: clientQuoteCodePreview } = useDocumentCodePreview('client_quote', {
    enabled: isModalOpen && !editingQuote,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [productRowToDelete, setProductRowToDelete] = useState<number | null>(null);
  const [candidateToDeleteId, setCandidateToDeleteId] = useState<string | null>(null);

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
  const [candidateDrafts, setCandidateDrafts] = useState<QuoteCandidate[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [promotionQuote, setPromotionQuote] = useState<Quote | null>(null);
  const [promotionCandidateId, setPromotionCandidateId] = useState<string | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<QuoteVersion | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
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
      ...calculateClientQuotePricingTotals(
        formData.items || [],
        discountValue,
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
        calculateClientQuotePricingTotals(quote.items, quote.discount, quote.discountType),
      );
    }
    return map;
  }, [quotes]);

  const formatDiscountPercentage = useCallback(
    (quote: Quote) => {
      if (quote.discountType !== 'currency') {
        return `${formatNumber(quote.discount, { maximumFractionDigits: 20 })}%`;
      }

      const { discountAmount, subtotal } = quotePricingMap.get(quote.id) ?? EMPTY_PRICING_TOTALS;
      if (subtotal <= 0) return '0%';

      return `${formatNumber((discountAmount / subtotal) * 100, { maximumFractionDigits: 1 })}%`;
    },
    [quotePricingMap],
  );

  const closeModal = useCallback(() => {
    dispatch({ type: 'closeModal' });
    setPreviewVersion(null);
    setProductRowToDelete(null);
    setCandidateToDeleteId(null);
  }, []);

  const openAddModal = () => {
    dispatch({ type: 'openAddModal' });
    const defaults = {
      ...getDefaultFormData(),
      communicationChannelId: communicationChannels[0]?.id ?? '',
      communicationChannelName: communicationChannels[0]?.name ?? '',
    };
    const candidate: QuoteCandidate = {
      id: makeCandidateDraftId(),
      quoteId: '',
      name: 'Variante A',
      position: 0,
      state: 'active',
      items: [],
      paymentTerms: 'immediate',
      discount: 0,
      discountType: 'percentage',
      expirationDate: defaults.expirationDate || '',
      communicationChannelId: defaults.communicationChannelId,
      communicationChannelName: defaults.communicationChannelName,
      notes: '',
      createdAt: 0,
      updatedAt: 0,
    };
    setCandidateDrafts([candidate]);
    setActiveCandidateId(candidate.id);
    setFormData(defaults);
    setErrors({});
    setPreviewVersion(null);
  };

  const applyQuoteToCandidateForm = useCallback((quote: Quote) => {
    const candidates = quoteCandidatesForForm(quote);
    const primary =
      candidates.find((candidate) => candidate.state === 'selected') ??
      candidates.find((candidate) => candidate.state === 'active') ??
      candidates[0];
    setCandidateDrafts(candidates);
    setActiveCandidateId(primary.id);
    setFormData(candidateToFormData(quote, primary));
    setErrors({});
  }, []);

  const openEditModal = useCallback(
    (quote: Quote) => {
      dispatch({ type: 'openEditModal', quote });
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Modal event handler calls a form helper, not a functional state updater.
      applyQuoteToCandidateForm(quote);
      setPreviewVersion(null);
    },
    [applyQuoteToCandidateForm],
  );

  const currentCandidateDrafts = () =>
    candidateDrafts.map((candidate) =>
      candidate.id === activeCandidateId ? formDataIntoCandidate(candidate, formData) : candidate,
    );

  const handleSelectCandidate = (candidateId: string) => {
    const nextDrafts = currentCandidateDrafts();
    const next = nextDrafts.find((candidate) => candidate.id === candidateId);
    if (!next) return;
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Candidate selection handler queues independent state transitions.
    setCandidateDrafts(nextDrafts);
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Candidate selection handler queues independent state transitions.
    setActiveCandidateId(candidateId);
    setFormData(
      candidateToFormData(
        {
          id: formData.id || editingQuote?.id || '',
          clientId: formData.clientId || editingQuote?.clientId || '',
          clientName: formData.clientName || editingQuote?.clientName || '',
          status: formData.status || editingQuote?.status || 'draft',
        },
        next,
      ),
    );
    setErrors({});
  };

  const addCandidate = (
    duplicateCurrent: boolean,
    sourceCandidateId: string | null = activeCandidateId,
  ) => {
    const nextDrafts = currentCandidateDrafts();
    const source =
      nextDrafts.find((candidate) => candidate.id === sourceCandidateId) ?? nextDrafts[0];
    const nextIndex = nextDrafts.length;
    const name = nextCandidateName(nextDrafts);
    const candidate: QuoteCandidate = {
      ...(duplicateCurrent && source
        ? source
        : {
            ...source,
            items: [],
            paymentTerms: 'immediate',
            discount: 0,
            discountType: 'percentage',
            expirationDate: addMonthsToDateOnly(getLocalDateString(), 1),
            notes: '',
          }),
      id: makeCandidateDraftId(),
      quoteId: editingQuote?.id || '',
      name,
      position: nextIndex,
      state: 'active',
      items: duplicateCurrent
        ? (source?.items || []).map((item) => ({ ...item, id: makeCandidateDraftId() }))
        : [],
      createdAt: 0,
      updatedAt: 0,
    };
    const updated = [...nextDrafts, candidate];
    setCandidateDrafts(updated);
    setActiveCandidateId(candidate.id);
    setFormData(
      candidateToFormData(
        {
          id: formData.id || editingQuote?.id || '',
          clientId: formData.clientId || editingQuote?.clientId || '',
          clientName: formData.clientName || editingQuote?.clientName || '',
          status: formData.status || editingQuote?.status || 'draft',
        },
        candidate,
      ),
    );
  };

  const renameCandidate = (candidateId: string, name: string) => {
    setCandidateDrafts((current) =>
      current.map((candidate) =>
        candidate.id === candidateId ? { ...candidate, name } : candidate,
      ),
    );
  };

  const removeCandidate = (candidateId: string) => {
    if (candidateDrafts.length <= 1) return;
    const synchronizedDrafts = currentCandidateDrafts();
    const removedIndex = synchronizedDrafts.findIndex((candidate) => candidate.id === candidateId);
    if (removedIndex < 0) return;
    const nextDrafts: QuoteCandidate[] = [];
    for (const candidate of synchronizedDrafts) {
      if (candidate.id !== candidateId) {
        nextDrafts.push({ ...candidate, position: nextDrafts.length });
      }
    }
    setCandidateDrafts(nextDrafts);
    if (candidateId !== activeCandidateId) return;

    const next = nextDrafts[Math.min(removedIndex, nextDrafts.length - 1)];
    setActiveCandidateId(next.id);
    setFormData(
      candidateToFormData(
        {
          id: formData.id || editingQuote?.id || '',
          clientId: formData.clientId || editingQuote?.clientId || '',
          clientName: formData.clientName || editingQuote?.clientName || '',
          status: formData.status || editingQuote?.status || 'draft',
        },
        next,
      ),
    );
  };

  const promoteCandidate = async (quoteId: string, candidateId: string) => {
    if (!onPromoteCandidate || isPromoting) return;
    setIsPromoting(true);
    try {
      await onPromoteCandidate(quoteId, candidateId);
      setPromotionQuote(null);
      setPromotionCandidateId(null);
    } catch (error) {
      toastError((error as Error).message || t('sales:clientQuotes.failedToUpdateStatus'));
    } finally {
      setIsPromoting(false);
    }
  };

  const openPromotionDialog = (quote: Quote) => {
    const activeCandidates = (quote.candidates || []).filter(
      (candidate) => candidate.state === 'active',
    );
    const eligible = activeCandidates.find(isCandidatePromotable);
    if (activeCandidates.length === 1 && eligible) {
      void promoteCandidate(quote.id, eligible.id);
      return;
    }
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Dialog event handler queues independent state transitions.
    setPromotionQuote(quote);
    setPromotionCandidateId(eligible?.id ?? null);
  };

  const confirmCandidatePromotion = async () => {
    if (!promotionQuote || !promotionCandidateId) return;
    await promoteCandidate(promotionQuote.id, promotionCandidateId);
  };

  const rollbackCandidatePromotion = async (quoteId: string) => {
    if (!onRollbackPromotion) return;
    try {
      await onRollbackPromotion(quoteId);
    } catch (error) {
      toastError((error as Error).message || t('sales:clientQuotes.failedToUpdateStatus'));
    }
  };

  const handleVersionPreview = useCallback(
    (version: QuoteVersion) => {
      const quoteId = editingQuote?.id ?? version.snapshot.quote.id;
      const itemsByCandidateId = new Map<string, QuoteItem[]>();
      for (const item of version.snapshot.items) {
        if (!item.candidateId) continue;
        const candidateItems = itemsByCandidateId.get(item.candidateId) ?? [];
        candidateItems.push(item);
        itemsByCandidateId.set(item.candidateId, candidateItems);
      }
      const candidates = version.snapshot.candidates.map((candidate) => ({
        ...candidate,
        quoteId,
        communicationChannelId:
          candidate.communicationChannelId || communicationChannels[0]?.id || '',
        communicationChannelName:
          candidate.communicationChannelName || communicationChannels[0]?.name || '',
        items: (itemsByCandidateId.get(candidate.id) ?? []).map((item) =>
          normalizeQuoteItem({ ...item, quoteId }),
        ),
      }));
      const previewQuote = normalizeQuote({
        ...version.snapshot.quote,
        id: quoteId,
        items: [],
        candidates,
      });
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Version selection handler queues independent state transitions.
      setPreviewVersion(version);
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Version selection handler calls a form helper, not an updater callback.
      applyQuoteToCandidateForm(previewQuote);
    },
    [applyQuoteToCandidateForm, communicationChannels, editingQuote],
  );

  const handleClearPreview = useCallback(() => {
    if (editingQuote) applyQuoteToCandidateForm(editingQuote);
    setPreviewVersion(null);
  }, [applyQuoteToCandidateForm, editingQuote]);

  const handleVersionRestored = useCallback(
    (updated: Quote) => {
      dispatch({ type: 'setEditingQuote', quote: updated });
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Restore callback calls a form helper, not a functional state updater.
      applyQuoteToCandidateForm(updated);
      setPreviewVersion(null);
      onQuoteRestored?.(updated);
    },
    [applyQuoteToCandidateForm, onQuoteRestored],
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
      const invalidQuantity = formData.items.find((item) => !isPositiveFiniteNumber(item.quantity));
      if (!newErrors.items && invalidQuantity) {
        newErrors.items = t('sales:clientQuotes.errors.quantityGreaterThanZero');
      }
      if (!newErrors.items) {
        const { total } = calculateClientQuotePricingTotals(
          formData.items,
          discountValue,
          formData.discountType || 'percentage',
        );
        if (!Number.isFinite(total) || total <= 0) {
          newErrors.total = t('sales:clientQuotes.errors.totalGreaterThanZero');
        }
      }
    }

    const pendingCandidateDrafts = currentCandidateDrafts();
    const candidateNames = new Set<string>();
    for (const candidate of pendingCandidateDrafts) {
      const normalizedName = candidate.name.trim().toLocaleLowerCase();
      if (!normalizedName) {
        newErrors.candidates = t('sales:clientQuotes.candidates.nameRequired', {
          defaultValue: 'Every candidate needs a name.',
        });
        break;
      }
      if (candidateNames.has(normalizedName)) {
        newErrors.candidates = t('sales:clientQuotes.candidates.nameUnique', {
          defaultValue: 'Candidate names must be unique.',
        });
        break;
      }
      candidateNames.add(normalizedName);
      if (!candidate.items.length) {
        newErrors.candidates = t('sales:clientQuotes.candidates.itemsRequired', {
          defaultValue: 'Every candidate needs at least one line.',
        });
        break;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const serializeItems = (candidateItems: QuoteItem[]) =>
      candidateItems.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice ?? 0),
        discount: item.discount === undefined ? undefined : Number(item.discount),
        ...normalizeDurationForSubmit(item),
        productCost: item.productCost === undefined ? undefined : Number(item.productCost),
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
      }));
    const itemsWithSnapshots = serializeItems(formData.items || []);
    const candidatePayloads = pendingCandidateDrafts.map((candidate) => ({
      ...(candidate.id.startsWith('tmp_candidate_') ? {} : { id: candidate.id }),
      name: candidate.name,
      paymentTerms: candidate.paymentTerms,
      discount: candidate.discount,
      discountType: candidate.discountType,
      expirationDate: candidate.expirationDate,
      communicationChannelId: candidate.communicationChannelId,
      notes: candidate.notes,
      items:
        candidate.id === activeCandidateId ? itemsWithSnapshots : serializeItems(candidate.items),
    }));
    const primaryCandidate = candidatePayloads[0];

    const payload = {
      ...formData,
      id: formData.id?.trim() || undefined,
      paymentTerms: primaryCandidate.paymentTerms,
      discount: primaryCandidate.discount,
      discountType: primaryCandidate.discountType,
      expirationDate: primaryCandidate.expirationDate,
      communicationChannelId: primaryCandidate.communicationChannelId,
      notes: primaryCandidate.notes,
      items: primaryCandidate.items,
      candidates: candidatePayloads,
    };

    dispatch({ type: 'setIsSubmitting', value: true });
    try {
      if (editingQuote) {
        await onUpdateQuote(editingQuote.id, payload);
      } else {
        await onAddQuote(payload);
      }
    } catch (err) {
      if (isQuoteCodeConflictError(err)) {
        setErrors((prev) => ({
          ...prev,
          id: t('sales:clientQuotes.errors.quoteCodeAlreadyExists', {
            defaultValue: 'This quote code already exists',
          }),
        }));
        return;
      }
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

  const handleStatusUpdate = async (id: string, updates: QuoteMutation) => {
    try {
      const quote = quotes.find((entry) => entry.id === id);
      if (updates.status === 'sent' && quote?.candidates?.length) {
        await onUpdateQuote(id, {
          id: quote.id,
          clientId: quote.clientId,
          clientName: quote.clientName,
          status: updates.status,
          candidates: quote.candidates,
          items: quote.candidates[0].items,
          paymentTerms: quote.candidates[0].paymentTerms,
          discount: quote.candidates[0].discount,
          discountType: quote.candidates[0].discountType,
          expirationDate: quote.candidates[0].expirationDate,
          communicationChannelId: quote.candidates[0].communicationChannelId,
          notes: quote.candidates[0].notes,
        });
      } else {
        await onUpdateQuote(id, updates);
      }
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
                shouldReprice && editingQuote ? createTemporaryLineItemId('temp-reprice') : item.id,
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

    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Client-change handler calls a domain helper, not a functional state updater.
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
      id: createTemporaryLineItemId(),
      productId: '',
      productName: '',
      quantity: Number.NaN,
      durationUnit: 'months',
      unitType: 'hours',
      unitPrice: Number.NaN,
      productMolPercentage: null,
      // Supplier quote fields
      supplierQuoteId: null,
      supplierQuoteItemId: null,
      supplierQuoteSupplierName: null,
      supplierQuoteUnitPrice: null,

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

  const moveProductRow = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (isReadOnly || fromIndex === toIndex) return;
      setFormData((prev) => {
        const items = prev.items || [];
        const reordered = moveQuoteItem(items, fromIndex, toIndex);
        return reordered === items ? prev : { ...prev, items: reordered };
      });
    },
    [isReadOnly],
  );

  const handleProductRowDragStart = useCallback(
    (itemId: string, event: React.DragEvent<HTMLButtonElement>) => {
      if (isReadOnly) return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', itemId);
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Drag event handler queues one state transition.
      setDraggedItemId(itemId);
    },
    [isReadOnly],
  );

  const handleProductRowDrop = useCallback(
    (targetItemId: string, event: React.DragEvent<HTMLTableRowElement>) => {
      event.preventDefault();
      if (!isReadOnly && draggedItemId && draggedItemId !== targetItemId) {
        setFormData((prev) => {
          const items = prev.items || [];
          const fromIndex = items.findIndex((item) => item.id === draggedItemId);
          const toIndex = items.findIndex((item) => item.id === targetItemId);
          const reordered = moveQuoteItem(items, fromIndex, toIndex);
          return reordered === items ? prev : { ...prev, items: reordered };
        });
      }
      setDraggedItemId(null);
    },
    [draggedItemId, isReadOnly],
  );

  const handleProductRowDragEnd = useCallback(() => {
    setDraggedItemId(null);
  }, []);

  const handleProductRowKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (isReadOnly) return;
      const lastIndex = (formData.items?.length ?? 0) - 1;
      let targetIndex = index;
      if (event.key === 'ArrowUp') targetIndex = Math.max(0, index - 1);
      else if (event.key === 'ArrowDown') targetIndex = Math.min(lastIndex, index + 1);
      else if (event.key === 'Home') targetIndex = 0;
      else if (event.key === 'End') targetIndex = lastIndex;
      else return;

      event.preventDefault();
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Drop event handler calls a row-move helper, not an updater callback.
      moveProductRow(index, targetIndex);
    },
    [formData.items?.length, isReadOnly, moveProductRow],
  );

  const updateProductRow = (
    index: number,
    field: keyof QuoteItem,
    value: string | number | undefined,
  ) => {
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
        // Pull quantity, cost, sale price, and duration from the supplier item. The helper also
        // stamps the pick-time quantity/cost baseline used by the server's genuine-edit check.
        Object.assign(
          newItems[index],
          pickedSupplierLineFields(newItems[index], selectedQuoteItem),
        );
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

  const usedSupplierQuoteItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of formData.items || []) {
      if (item.supplierQuoteItemId) ids.add(item.supplierQuoteItemId);
    }
    return ids;
  }, [formData.items]);

  const supplierQuoteItemIdsUsedByOtherQuotes = useMemo(() => {
    const ids = new Set<string>();
    for (const quote of quotes) {
      if (quote.id === editingQuote?.id) continue;

      for (const item of quote.items) {
        if (item.supplierQuoteItemId) ids.add(item.supplierQuoteItemId);
      }
      for (const candidate of quote.candidates ?? []) {
        for (const item of candidate.items) {
          if (item.supplierQuoteItemId) ids.add(item.supplierQuoteItemId);
        }
      }
    }
    return ids;
  }, [editingQuote?.id, quotes]);

  const supplierQuoteItemOptions = useMemo(() => {
    const options: Option[] = [];
    for (const quote of sourceableSupplierQuotes) {
      for (const item of quote.items) {
        if (supplierQuoteItemIdsUsedByOtherQuotes.has(item.id)) continue;
        options.push({
          id: item.id,
          name: supplierQuoteItemLabel(quote, item),
          disabled: usedSupplierQuoteItemIds.has(item.id),
        });
      }
    }
    return options;
  }, [sourceableSupplierQuotes, supplierQuoteItemIdsUsedByOtherQuotes, usedSupplierQuoteItemIds]);

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

  // Pulls the linked supplier item's current quantity/cost back into the line. The customer sale
  // price stays unchanged and MOL is derived again from that price and the refreshed cost (#779).
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
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Product selection handler calls a domain helper, not a functional state updater.
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
  // months; 'years' multiplies by 12. An empty input stays empty while pricing uses neutral ×1.
  const handleDurationValueChange = (index: number, value: string) => {
    if (isReadOnly) return;
    const unit = normalizeDurationUnit(formData.items?.[index]?.durationUnit);
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Duration handler calls a domain helper, not a functional state updater.
    updateProductRow(
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- The rule anchors this multi-line helper call on its first argument.
      index,
      'durationMonths',
      value === '' ? undefined : parseDurationValueToMonths(value, unit),
    );
  };

  // Switching months↔years keeps the displayed number and reinterprets it under the new unit
  // (e.g. "2" months → "2" years = 24 months), mirroring how the quantity unit selector behaves.
  const handleDurationUnitChange = (index: number, newUnit: DurationUnit) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return;
    // 'N/A' marks the line as duration-less: reset to the neutral 1 month so it never multiplies
    // (issue #775). Months/years instead keeps the displayed number under the new unit.
    const durationValue = getDurationInputValue(item);
    const durationMonths =
      newUnit === 'na' || durationValue === undefined
        ? undefined
        : durationValueToMonths(durationValue, newUnit);
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
      id: 'id',
      accessorFn: (row) => formatDocumentCode(row.id, row.revisionCode),
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      cell: ({ row }) => (
        <span className="font-bold text-zinc-700">
          {formatDocumentCode(row.id, row.revisionCode)}
        </span>
      ),
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
      header: t('sales:clientQuotes.candidates.column', { defaultValue: 'Varianti' }),
      id: 'candidates',
      accessorFn: (row) => row.candidates?.length ?? 1,
      className: 'whitespace-nowrap',
      cell: ({ row }) => {
        const candidateCount = row.candidates?.length || 1;
        return (
          <Badge variant="secondary">
            {candidateCount > 1
              ? t('sales:clientQuotes.candidates.count', {
                  count: candidateCount,
                  defaultValue: '{{count}} varianti',
                })
              : t('sales:clientQuotes.candidates.notApplicable', { defaultValue: 'N/A' })}
          </Badge>
        );
      },
    },
    {
      header: t('sales:clientQuotes.subtotal', { defaultValue: 'Subtotal' }),
      id: 'subtotal',
      accessorFn: (row) => quotePricingMap.get(row.id)?.grossSubtotal ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { grossSubtotal } = quotePricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        const history = isHistoryRow(row);
        return (
          <span
            className={`text-sm font-semibold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-zinc-700'}`}
          >
            {formatDecimal(grossSubtotal)} {currency}
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
      header: t('common:labels.totalDiscount'),
      // Keep the historical id so saved table views retain their column order and width.
      id: 'discountAmount',
      accessorFn: (row) => quotePricingMap.get(row.id)?.totalDiscountAmount ?? 0,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { totalDiscountAmount } = quotePricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        const history = isHistoryRow(row);
        if (totalDiscountAmount <= 0) {
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
            -{formatDecimal(totalDiscountAmount)} {currency}
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
            {formatDecimal(total)} {currency}
          </span>
        );
      },
    },
    {
      header: t('sales:clientQuotes.marginLabel'),
      id: 'margin',
      accessorFn: (row) => quotePricingMap.get(row.id)?.margin ?? 0,
      className: 'whitespace-nowrap text-emerald-600',
      headerClassName: 'min-w-[8rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { margin } = quotePricingMap.get(row.id) ?? EMPTY_PRICING_TOTALS;
        const history = isHistoryRow(row);
        return (
          <span
            className={`text-sm font-bold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-emerald-600'}`}
          >
            {formatDecimal(margin)} {currency}
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
        const sendDisabled = history || supplierExpired;
        const denyDisabled = isPromoting || history;
        const hasCandidateMetadata = Boolean(row.candidates?.length);
        const hasPromotableCandidate = row.candidates?.some(isCandidatePromotable);
        // Sending presents every active variant, so one blocked supplier source blocks the family.
        // Promotion chooses exactly one winner, so the comparison must remain reachable whenever
        // at least one candidate is eligible.
        const promotionDisabled =
          isPromoting ||
          history ||
          (hasCandidateMetadata ? !hasPromotableCandidate : supplierExpired);
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

        const canRestore = !hasOffer || offerStatus === 'draft';
        const canRollbackDraftOffer =
          row.status === 'offer' && Boolean(row.linkedOfferId) && offerStatus === 'draft';
        // Back-to-draft is rejected by the server from accepted/denied/expired, and history rows are
        // immutable — so a sent/offer row whose EFFECTIVE status is expired must not show an enabled
        // restore button (it would 409). `history` already folds in the expired check.
        const restoreDisabled =
          isPromoting || !canRestore || (history && (!canRollbackDraftOffer || expired));
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
            {isLegacyAcceptedQuote(row) && !hasOffer && onCreateOfferFromLegacyQuote && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateOfferFromLegacyQuote(row);
                      }}
                      aria-label={t('sales:clientQuotes.convertToOffer', {
                        defaultValue: 'Convert to offer',
                      })}
                      className="p-2 rounded-lg transition-all text-zinc-400 hover:text-praetor hover:bg-zinc-100"
                    >
                      <i className="fa-solid fa-file-signature"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('sales:clientQuotes.convertToOffer', {
                    defaultValue: 'Convert to offer',
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
                        if (sendDisabled) return;
                        handleStatusUpdate(row.id, { status: 'sent' });
                      }}
                      disabled={sendDisabled}
                      aria-label={t('sales:clientQuotes.markAsSent')}
                      className={`p-2 rounded-lg transition-all ${sendDisabled ? 'cursor-not-allowed opacity-50 text-blue-700' : 'text-blue-700 hover:text-blue-600 hover:bg-blue-50'}`}
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
                        if (promotionDisabled) return;
                        openPromotionDialog(row);
                      }}
                      disabled={promotionDisabled}
                      aria-label={t('sales:clientQuotes.candidates.chooseTitle', {
                        defaultValue: 'Scegli candidato',
                      })}
                      className={`p-2 rounded-lg transition-all ${promotionDisabled ? 'cursor-not-allowed opacity-50 text-indigo-700' : 'text-indigo-700 hover:text-indigo-600 hover:bg-indigo-50'}`}
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
                      : t('sales:clientQuotes.candidates.chooseTitle', {
                          defaultValue: 'Scegli candidato',
                        })}
                </TooltipContent>
              </Tooltip>
            )}
            {/* A sent family can be rejected before a candidate is promoted. Once promoted,
                acceptance/rejection belongs to the generated offer, not to the quote family. */}
            {row.status === 'sent' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (denyDisabled) return;
                        handleStatusUpdate(row.id, { status: 'denied' });
                      }}
                      disabled={denyDisabled}
                      aria-label={t('sales:clientQuotes.markAsDenied')}
                      className={`p-2 rounded-lg transition-all ${denyDisabled ? 'cursor-not-allowed opacity-50 text-red-600' : 'text-red-600 hover:text-red-600 hover:bg-red-50'}`}
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
                          if (row.status === 'offer' && row.selectedCandidateId) {
                            rollbackCandidatePromotion(row.id);
                          } else {
                            handleStatusUpdate(row.id, { status: 'draft' });
                          }
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

  return {
    t,
    i18n,
    quotes,
    offers,
    products,
    communicationChannels,
    canManageCommunicationChannels,
    onCreateCommunicationChannel,
    onUpdateCommunicationChannel,
    onDeleteCommunicationChannel,
    onViewOffers,
    currency,
    canViewSupplierQuotes,
    canViewInternalListing,
    paymentTermsOptions,
    tableInitialFilterState,
    dispatch,
    isModalOpen,
    editingQuote,
    isDeleteConfirmOpen,
    quoteToDelete,
    pendingClientChange,
    isSubmitting,
    isDeleting,
    clientQuoteCodePreview,
    errors,
    setErrors,
    productRowToDelete,
    setProductRowToDelete,
    candidateToDeleteId,
    setCandidateToDeleteId,
    getStatusLabel,
    isQuoteExpired,
    isHistoryRow,
    canOpenQuoteModal,
    formData,
    setFormData,
    previewVersion,
    baseReadOnly,
    isReadOnly,
    expirationEditableWhileReadOnly,
    readOnlyReason,
    supplierLockedReason,
    statusEditable,
    statusLabel,
    readOnlyStatus,
    formTotals,
    closeModal,
    openAddModal,
    openEditModal,
    handleVersionPreview,
    handleClearPreview,
    handleVersionRestored,
    handleSubmit,
    handleDelete,
    handleClientChange,
    handleClientChangeKeepSnapshots,
    handleClientChangeReprice,
    addProductRow,
    removeProductRow,
    draggedItemId,
    handleProductRowDragStart,
    handleProductRowDrop,
    handleProductRowDragEnd,
    handleProductRowKeyDown,
    updateProductRow,
    activeClients,
    activeProductOptions,
    allProductIds,
    allSupplierQuoteIds,
    supplierQuoteItemOptions,
    supplierQuoteItemIndex,
    quoteIdBySupplierQuoteItemId,
    getSupplierQuoteItemDisplayValue,
    refreshLineFromSupplier,
    isLinkedProductMissing,
    updateProductSelection,
    handleUnitTypeChange,
    handleDurationValueChange,
    handleDurationUnitChange,
    candidateDrafts,
    activeCandidateId,
    handleSelectCandidate,
    addCandidate,
    renameCandidate,
    removeCandidate,
    promotionQuote,
    setPromotionQuote,
    promotionCandidateId,
    setPromotionCandidateId,
    isPromoting,
    openPromotionDialog,
    confirmCandidatePromotion,
    rollbackCandidatePromotion,
    columns,
  };
};

type ClientQuotesController = ReturnType<typeof useClientQuotesController>;

const ClientQuotesView: React.FC<ClientQuotesViewProps> = (props) => {
  // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Custom-hook invocation is misclassified as a state updater.
  const controller = useClientQuotesController(props);
  return <ClientQuotesLayout controller={controller} />;
};

const ClientQuotesLayout: React.FC<{ controller: ClientQuotesController }> = ({ controller }) => (
  <div className="space-y-8">
    <ClientQuoteFormModal controller={controller} />
    <ClientQuoteClientChangeModal controller={controller} />
    <ClientQuotePromotionModal controller={controller} />
    <ClientQuoteDeleteDialogs controller={controller} />
    <ClientQuotesHeader controller={controller} />
    <ClientQuotesTable controller={controller} />
  </div>
);

const ClientQuoteFormModal: React.FC<{ controller: ClientQuotesController }> = ({ controller }) => {
  const {
    isModalOpen,
    closeModal,
    handleSubmit,
    editingQuote,
    previewVersion,
    handleVersionPreview,
    handleClearPreview,
    handleVersionRestored,
    baseReadOnly,
  } = controller;
  const { revisionId: selectedRevisionId, versionId: selectedVersionId } =
    getHistoryPreviewIds(previewVersion);
  const revisionRestoreDisabled = Boolean(
    editingQuote?.linkedOfferId || (editingQuote && isTerminalQuoteStatus(editingQuote.status)),
  );

  return (
    <Modal isOpen={isModalOpen} onClose={closeModal}>
      <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
        <ModalContent size="full" className="max-h-[90vh]">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <ClientQuoteModalHeader controller={controller} />
            <ModalBody className="flex-1 space-y-5">
              <ClientQuoteCandidatesBar controller={controller} />
              <ClientQuoteModalAlerts controller={controller} />
              <ClientQuoteClientSection controller={controller} />
              <ClientQuoteItemsSection controller={controller} />
              <ClientQuoteNotesSummarySection controller={controller} />
            </ModalBody>
            <ClientQuoteModalFooter controller={controller} />
          </form>
        </ModalContent>
        {editingQuote?.id && (
          <HistoryRail>
            <QuoteRevisionsPanel
              quoteId={editingQuote.id}
              selectedRevisionId={selectedRevisionId}
              onPreview={(revision) =>
                handleVersionPreview({
                  ...revision,
                  quoteId: editingQuote.id,
                  reason: 'update',
                })
              }
              onClearPreview={handleClearPreview}
              onRestored={handleVersionRestored}
              disabled={revisionRestoreDisabled}
            />
            <QuoteVersionsPanel
              embedded
              quoteId={editingQuote.id}
              selectedVersionId={selectedVersionId}
              onPreview={handleVersionPreview}
              onClearPreview={handleClearPreview}
              onRestored={handleVersionRestored}
              disabled={baseReadOnly}
            />
          </HistoryRail>
        )}
      </div>
    </Modal>
  );
};

const ClientQuoteCandidatesBar: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const {
    t,
    candidateDrafts,
    activeCandidateId,
    handleSelectCandidate,
    addCandidate,
    renameCandidate,
    setCandidateToDeleteId,
    editingQuote,
    isReadOnly,
    errors,
    readOnlyStatus,
    statusLabel,
  } = controller;
  const [renamingCandidateId, setRenamingCandidateId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const contextMenuRenameRef = useRef<QuoteCandidate | null>(null);
  if (!candidateDrafts.length || !activeCandidateId) return null;
  const canChangeComposition = !editingQuote || editingQuote.status === 'draft';
  const canEditComposition = canChangeComposition && !isReadOnly;
  const canDeleteCandidate = canEditComposition && candidateDrafts.length > 1;

  const startRename = (candidate: QuoteCandidate) => {
    if (isReadOnly) return;
    if (candidate.id !== activeCandidateId) handleSelectCandidate(candidate.id);
    setRenameDraft(candidate.name);
    setRenamingCandidateId(candidate.id);
  };

  const finishRename = () => {
    if (!renamingCandidateId) return;
    renameCandidate(renamingCandidateId, renameDraft);
    setRenamingCandidateId(null);
  };

  return (
    <div className="space-y-2">
      <ClientQuoteSectionHeading
        label={t('sales:clientQuotes.candidates.column', { defaultValue: 'Varianti' })}
        description={t('sales:fieldInfo.variants', {
          defaultValue:
            'Configure alternatives for the same quote: each variant keeps its own items, prices, discounts, and terms.',
        })}
        status={readOnlyStatus}
        statusLabel={statusLabel}
        tooltipIcon="info"
      />
      <div
        data-testid="quote-candidate-tabs-scroll"
        className="overflow-x-auto overflow-y-hidden border-b border-border pt-1"
      >
        <Tabs
          value={activeCandidateId}
          onValueChange={handleSelectCandidate}
          className="min-w-max gap-0"
        >
          <div className="flex items-end gap-1">
            <TabsList className="h-auto min-w-max justify-start gap-1 rounded-none bg-transparent p-0">
              {candidateDrafts.map((candidate) => {
                const isActive = candidate.id === activeCandidateId;
                const totals = calculateClientQuotePricingTotals(
                  isActive ? controller.formData.items || [] : candidate.items,
                  isActive ? Number(controller.formData.discount || 0) : candidate.discount,
                  isActive
                    ? controller.formData.discountType || 'percentage'
                    : candidate.discountType,
                );
                const renameLabel = t('sales:clientQuotes.candidates.rename', {
                  name: candidate.name,
                  defaultValue: 'Rinomina {{name}}',
                });
                const deleteLabel = t('sales:clientQuotes.candidates.delete', {
                  name: candidate.name,
                  defaultValue: 'Elimina {{name}}',
                });
                return (
                  <ContextMenu key={candidate.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={`group -mb-px flex h-10 items-center rounded-t-lg border-x border-t border-border transition-colors ${
                          isActive ? 'bg-background' : 'bg-muted/60 hover:bg-muted'
                        }`}
                      >
                        {renamingCandidateId === candidate.id ? (
                          <>
                            <TabsTrigger value={candidate.id} className="sr-only">
                              {candidate.name}
                            </TabsTrigger>
                            <Input
                              aria-label={t('sales:clientQuotes.candidates.name', {
                                defaultValue: 'Nome variante',
                              })}
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onBlur={finishRename}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  finishRename();
                                }
                                event.stopPropagation();
                              }}
                              autoFocus
                              maxLength={100}
                              className="mx-1 h-8 w-40"
                            />
                          </>
                        ) : (
                          <TabsTrigger
                            value={candidate.id}
                            onDoubleClick={() => startRename(candidate)}
                            className="min-w-36 flex-1 justify-start rounded-none border-0 bg-transparent px-3 py-2 shadow-none after:hidden data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent"
                          >
                            <span>{candidate.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDecimal(totals.total)}
                            </span>
                            {candidate.state === 'selected' && (
                              <Badge>
                                {t('sales:clientQuotes.candidates.selected', {
                                  defaultValue: 'Scelta',
                                })}
                              </Badge>
                            )}
                            {candidate.state === 'discarded' && (
                              <Badge variant="secondary">
                                {t('sales:clientQuotes.candidates.discarded', {
                                  defaultValue: 'Scartata',
                                })}
                              </Badge>
                            )}
                          </TabsTrigger>
                        )}
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          disabled={isReadOnly}
                          onClick={() => startRename(candidate)}
                          aria-label={renameLabel}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          disabled={!canDeleteCandidate}
                          onClick={() => setCandidateToDeleteId(candidate.id)}
                          aria-label={deleteLabel}
                          className="mr-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent
                      onCloseAutoFocus={(event) => {
                        if (contextMenuRenameRef.current?.id !== candidate.id) return;
                        event.preventDefault();
                        const candidateToRename = contextMenuRenameRef.current;
                        contextMenuRenameRef.current = null;
                        startRename(candidateToRename);
                      }}
                    >
                      <ContextMenuItem
                        disabled={isReadOnly}
                        onSelect={() => {
                          contextMenuRenameRef.current = candidate;
                        }}
                      >
                        <Pencil aria-hidden="true" />
                        {renameLabel}
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={!canEditComposition}
                        onSelect={() => addCandidate(true, candidate.id)}
                      >
                        <Plus aria-hidden="true" />
                        {t('sales:clientQuotes.candidates.duplicate')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        disabled={!canDeleteCandidate}
                        onSelect={() => setCandidateToDeleteId(candidate.id)}
                      >
                        <Trash2 aria-hidden="true" />
                        {deleteLabel}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!canEditComposition}
                  aria-label={t('sales:clientQuotes.candidates.addMenu')}
                  className="mb-px"
                >
                  <Plus aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => addCandidate(false)}>
                  {t('sales:clientQuotes.candidates.add')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addCandidate(true)}>
                  {t('sales:clientQuotes.candidates.duplicate')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Tabs>
      </div>
      {errors.candidates && <FieldError>{errors.candidates}</FieldError>}
    </div>
  );
};

const ClientQuotePromotionModal: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const {
    t,
    promotionQuote,
    setPromotionQuote,
    promotionCandidateId,
    setPromotionCandidateId,
    confirmCandidatePromotion,
    isPromoting,
    currency,
  } = controller;
  if (!promotionQuote) return null;
  const activeCandidates = (promotionQuote.candidates || []).filter(
    (candidate) => candidate.state === 'active',
  );
  return (
    <Modal isOpen onClose={() => setPromotionQuote(null)}>
      <ModalContent size="6xl">
        <ModalHeader>
          <ModalTitle>
            {t('sales:clientQuotes.candidates.chooseTitle', {
              defaultValue: 'Scegli il candidato da promuovere',
            })}
          </ModalTitle>
          <ModalCloseButton onClick={() => setPromotionQuote(null)} />
        </ModalHeader>
        <ModalBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('sales:clientQuotes.candidates.chooseDescription', {
              count: Math.max(activeCandidates.length - 1, 0),
              defaultValue:
                'La variante scelta genererà una offerta; le altre {{count}} saranno archiviate.',
            })}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {activeCandidates.map((candidate) => {
              const totals = calculateClientQuotePricingTotals(
                candidate.items,
                candidate.discount,
                candidate.discountType,
              );
              const blocked = candidate.isExpired || candidate.linkedSupplierQuoteExpired;
              const selected = promotionCandidateId === candidate.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={blocked}
                  onClick={() => setPromotionCandidateId(candidate.id)}
                  className={
                    'rounded-lg border p-4 text-left transition-colors ' +
                    (selected ? 'border-primary bg-primary/5 ' : 'border-border bg-card ') +
                    (blocked ? 'cursor-not-allowed opacity-50' : 'hover:border-primary/50')
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{candidate.name}</span>
                    {blocked && (
                      <Badge variant="destructive">
                        {candidate.isExpired
                          ? t('sales:clientQuotes.statusExpired')
                          : t('sales:clientQuotes.candidates.supplierExpired', {
                              defaultValue: 'Fornitore scaduto',
                            })}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {t('sales:clientQuotes.discountedTotalColumn')}
                    </span>
                    <strong className="text-right">
                      {formatDecimal(totals.total)} {currency}
                    </strong>
                    <span className="text-muted-foreground">
                      {t('sales:clientQuotes.marginLabel')}
                    </span>
                    <strong className="text-right">
                      {formatDecimal(totals.margin)} {currency}
                    </strong>
                    <span className="text-muted-foreground">
                      {t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
                    </span>
                    <strong className="text-right">
                      {formatMolPercentage(totals.marginPercentage)}
                    </strong>
                    <span className="text-muted-foreground">
                      {t('sales:clientQuotes.expirationColumn')}
                    </span>
                    <span className="text-right">
                      {formatDateOnlyForLocale(candidate.expirationDate)}
                    </span>
                    <span className="text-muted-foreground">
                      {t('sales:clientQuotes.candidates.lines', { defaultValue: 'Voci' })}
                    </span>
                    <span className="text-right">{candidate.items.length}</span>
                  </div>
                  <div className="mt-3 border-t border-border pt-3 text-sm">
                    <div className="text-muted-foreground">
                      {t('sales:clientQuotes.notesLabel', { defaultValue: 'Note' })}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
                      {candidate.notes?.trim() || '—'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={() => setPromotionQuote(null)}>
            {t('common:buttons.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!promotionCandidateId || isPromoting}
            onClick={confirmCandidatePromotion}
          >
            {isPromoting
              ? t('common:buttons.saving')
              : t('sales:clientQuotes.candidates.promote', { defaultValue: 'Promuovi a offerta' })}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

const ClientQuoteModalHeader: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const { t, closeModal, editingQuote, isReadOnly } = controller;

  return (
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
  );
};

const ClientQuoteModalAlerts: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const {
    t,
    i18n,
    previewVersion,
    handleClearPreview,
    baseReadOnly,
    editingQuote,
    offers,
    onViewOffers,
  } = controller;
  const previewRevisionCode =
    previewVersion &&
    'revisionCode' in previewVersion &&
    typeof previewVersion.revisionCode === 'string'
      ? previewVersion.revisionCode
      : null;

  return (
    <>
      {previewVersion && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <span className="text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-2">
            <i className="fa-solid fa-clock-rotate-left"></i>
            {previewRevisionCode
              ? t('sales:clientQuotes.revisionHistory.previewBanner', {
                  code: previewRevisionCode,
                  date: formatInsertDateTime(previewVersion.createdAt, i18n.language),
                  defaultValue: 'Previewing {{code}} from {{date}}',
                })
              : t('sales:clientQuotes.versionHistory.previewBanner', {
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
            number: formatDocumentCode(
              editingQuote.linkedOfferId,
              editingQuote.linkedOfferRevisionCode ??
                offers.find((offer) => offer.id === editingQuote.linkedOfferId)?.revisionCode,
            ),
            defaultValue: 'Offer #{{number}}',
          })}
          note={t('sales:clientQuotes.offerDetailsReadOnly', {
            defaultValue: '(Quote details are read-only)',
          })}
          action={
            onViewOffers
              ? {
                  label: t('sales:clientQuotes.viewOffer', { defaultValue: 'View Offer' }),
                  onClick: () => onViewOffers(editingQuote.id),
                }
              : undefined
          }
        />
      )}
      {editingQuote?.linkedSupplierQuoteExpired && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10">
          <i className="fa-solid fa-triangle-exclamation text-red-600" aria-hidden="true"></i>
          <span className="text-red-700 dark:text-red-300 text-xs font-bold">
            {t('sales:clientQuotes.linkedSupplierQuoteExpiredBanner', {
              defaultValue:
                'The linked supplier quote has expired. Extend its validity before progressing this quote to Sent, Offer, or Accepted.',
            })}
          </span>
        </div>
      )}
    </>
  );
};

const ClientQuoteSectionHeading: React.FC<{
  label: React.ReactNode;
  description?: string;
  status?: string;
  statusLabel?: string;
  tooltipIcon?: FieldTooltipProps['icon'];
}> = ({ label, description, status, statusLabel, tooltipIcon }) => (
  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
    <span className="size-1.5 rounded-full bg-primary"></span>
    {label}
    {description && status && statusLabel && (
      <FieldTooltip
        description={description}
        status={status}
        statusLabel={statusLabel}
        icon={tooltipIcon}
      />
    )}
  </h4>
);

const ClientQuoteClientSection: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const { t, readOnlyStatus, statusLabel } = controller;

  return (
    <div className="space-y-2">
      <ClientQuoteSectionHeading
        label={t('sales:clientQuotes.clientInformation')}
        description={t('sales:fieldInfo.clientInformation', {
          defaultValue: 'Client and document details',
        })}
        status={readOnlyStatus}
        statusLabel={statusLabel}
      />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <ClientQuoteClientField controller={controller} />
        <ClientQuoteCodeField controller={controller} />
        <ClientQuotePaymentTermsField controller={controller} />
        <ClientQuoteCommunicationField controller={controller} />
        <ClientQuoteExpirationField controller={controller} />
      </div>
    </div>
  );
};

const ClientQuoteClientField: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const { t, errors, activeClients, formData, handleClientChange, isReadOnly } = controller;

  return (
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
  );
};

const ClientQuoteCodeField: React.FC<{ controller: ClientQuotesController }> = ({ controller }) => {
  const {
    t,
    errors,
    setErrors,
    formData,
    setFormData,
    editingQuote,
    isReadOnly,
    clientQuoteCodePreview,
  } = controller;

  return (
    <Field data-invalid={Boolean(errors.id)}>
      <div className="relative w-fit">
        <FieldLabel htmlFor="client-quote-code" required={Boolean(editingQuote)}>
          {t('sales:clientQuotes.quoteCode', { defaultValue: 'Quote Code' })}
        </FieldLabel>
        {editingQuote?.revisionCode && (
          <Badge
            variant="secondary"
            className="absolute top-1/2 left-full ml-2 -translate-y-1/2 font-mono"
          >
            {editingQuote.revisionCode}
          </Badge>
        )}
      </div>
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
        placeholder={
          clientQuoteCodePreview ??
          t('sales:clientQuotes.autoCodePlaceholder', { defaultValue: 'Auto-generated' })
        }
        disabled={isReadOnly}
        className={errors.id ? 'border-red-300 font-medium' : 'font-medium'}
        aria-invalid={Boolean(errors.id)}
      />
      <FieldError className="text-xs">{errors.id}</FieldError>
      {!editingQuote && (
        <FieldDescription className="text-xs">
          {clientQuoteCodePreview
            ? t('sales:clientQuotes.autoCodePreviewDescription', {
                preview: clientQuoteCodePreview,
                defaultValue:
                  'Leave blank to generate {{preview}} from the document code template.',
              })
            : t('sales:clientQuotes.autoCodeDescription', {
                defaultValue: 'Leave blank to generate the next code automatically.',
              })}
        </FieldDescription>
      )}
    </Field>
  );
};

const ClientQuotePaymentTermsField: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const { t, formData, setFormData, paymentTermsOptions, isReadOnly } = controller;

  return (
    <Field>
      <SelectControl
        id="client-quote-payment-terms"
        options={paymentTermsOptions}
        value={formData.paymentTerms || 'immediate'}
        onChange={(val) =>
          setFormData((prev) => ({ ...prev, paymentTerms: val as Quote['paymentTerms'] }))
        }
        searchable={false}
        disabled={isReadOnly}
        label={t('sales:clientQuotes.paymentTerms')}
        buttonClassName="h-9"
      />
    </Field>
  );
};

const ClientQuoteCommunicationField: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const {
    errors,
    setErrors,
    formData,
    setFormData,
    communicationChannels,
    canManageCommunicationChannels,
    onCreateCommunicationChannel,
    onUpdateCommunicationChannel,
    onDeleteCommunicationChannel,
    isReadOnly,
  } = controller;

  return (
    <Field data-invalid={Boolean(errors.communicationChannelId)}>
      <QuoteCommunicationChannelField
        id="client-quote-communication-channel"
        channels={communicationChannels}
        value={formData.communicationChannelId || ''}
        error={errors.communicationChannelId}
        disabled={isReadOnly}
        canManage={canManageCommunicationChannels}
        onChange={(value) => {
          const selected = communicationChannels.find((channel) => channel.id === value);
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
  );
};

const ClientQuoteExpirationField: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const { t, formData, setFormData, isReadOnly, expirationEditableWhileReadOnly } = controller;

  return (
    <Field>
      <FieldLabel htmlFor="client-quote-expiration-date" required>
        {t('sales:clientQuotes.expirationDateLabel')}
      </FieldLabel>
      <DateField
        id="client-quote-expiration-date"
        required
        value={formData.expirationDate}
        onChange={(value) => setFormData((prev) => ({ ...prev, expirationDate: value }))}
        disabled={isReadOnly && !expirationEditableWhileReadOnly}
      />
    </Field>
  );
};

const ClientQuoteReorderButton: React.FC<{
  controller: ClientQuotesController;
  item: QuoteItem;
  index: number;
}> = ({ controller, item, index }) => {
  if (controller.isReadOnly || (controller.formData.items?.length ?? 0) < 2) return null;

  const label = controller.t('sales:clientQuotes.reorderItem', {
    item: item.productName,
    position: index + 1,
    total: controller.formData.items?.length ?? 0,
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          draggable
          aria-label={label}
          aria-keyshortcuts="ArrowUp ArrowDown Home End"
          onDragStart={(event) => controller.handleProductRowDragStart(item.id, event)}
          onDragEnd={controller.handleProductRowDragEnd}
          onKeyDown={(event) => controller.handleProductRowKeyDown(index, event)}
          className="shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{controller.t('sales:clientQuotes.reorderItemHint')}</TooltipContent>
    </Tooltip>
  );
};

const getClientQuoteItemRevenue = (item: QuoteItem) =>
  getClientQuoteItemPricingContext(item).netRevenue;

const getClientQuoteItemMargin = (item: QuoteItem) =>
  getClientQuoteItemPricingContext(item).lineMargin;
const ClientQuoteItemsSection: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const { t, errors, formData, addProductRow, isReadOnly, currency } = controller;
  const items = formData.items;
  const getIndex = useMemo(() => createLineItemIndexResolver(items), [items]);
  const getLine = (item: QuoteItem) => getClientQuoteLineContext(controller, item, getIndex(item));
  const columns: Column<QuoteItem>[] = [
    {
      id: 'supplierQuote',
      header: t('sales:clientQuotes.supplierQuoteColumn'),
      minWidth: 264,
      accessorFn: (item) =>
        controller.getSupplierQuoteItemDisplayValue(item.supplierQuoteItemId) || '',
      cell: ({ row }) => {
        const index = getIndex(row);
        const line = getLine(row);
        return (
          <div className="relative flex min-w-[240px] items-center gap-1">
            <ClientQuoteReorderButton controller={controller} item={row} index={index} />
            {line.supplierDataStale && line.linkedSupplierRef && (
              <StaleSupplierDataButton
                onClick={() =>
                  line.linkedSupplierRef &&
                  controller.refreshLineFromSupplier(index, line.linkedSupplierRef.item)
                }
              />
            )}
            <ClientQuoteSupplierPicker
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
      header: t('sales:clientQuotes.productsServices'),
      minWidth: 244,
      accessorFn: (item) =>
        controller.products.find((product) => product.id === item.productId)?.name ||
        item.productName ||
        '',
      cell: ({ row }) => {
        const index = getIndex(row);
        return (
          <div className="relative flex min-w-[220px] items-center gap-1">
            <ClientQuoteProductPicker
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
      header: t('sales:clientQuotes.qty'),
      minWidth: 174,
      accessorKey: 'quantity',
      align: 'right',
      cell: ({ row }) => {
        const index = getIndex(row);
        return (
          <div className="min-w-[150px]">
            <ClientQuoteQuantityEditor
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
      header: t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' }),
      minWidth: 174,
      accessorFn: (item) => getItemPricingContext(item).durationMonths,
      align: 'right',
      cell: ({ row }) => {
        const index = getIndex(row);
        return (
          <div className="min-w-[150px]">
            <ClientQuoteDurationEditor
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
          <ClientQuoteCostEditor controller={controller} line={getLine(row)} compact />
        </div>
      ),
    },
    {
      id: 'unitPrice',
      header: t('crm:internalListing.salePrice'),
      accessorKey: 'unitPrice',
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[130px]">
          <ClientQuoteSalePriceEditor controller={controller} line={getLine(row)} />
        </div>
      ),
    },
    {
      id: 'mol',
      header: t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' }),
      accessorFn: (item) => getItemPricingContext(item).molPercentage,
      align: 'right',
      cell: ({ row }) => (
        <div className="flex min-w-[100px] items-center justify-end gap-1">
          <ClientQuoteMolEditor controller={controller} line={getLine(row)} compact />
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
          {formatDecimal(getItemPricingContext(row).lineCost)} {currency}
        </span>
      ),
    },
    {
      id: 'discount',
      header: t('common:labels.discount'),
      accessorFn: (item) => item.discount ?? 0,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[110px]">
          <ClientQuoteDiscountEditor
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
      accessorFn: getClientQuoteItemMargin,
      align: 'right',
      className: 'text-emerald-600',
      cell: ({ row }) => (
        <span className="font-semibold text-emerald-600 tabular-nums">
          {formatDecimal(getClientQuoteItemMargin(row))} {currency}
        </span>
      ),
    },
    {
      id: 'revenue',
      header: t('sales:clientQuotes.revenue'),
      accessorFn: getClientQuoteItemRevenue,
      align: 'right',
      cell: ({ row }) => (
        <div className="min-w-[130px]">
          <ClientQuoteRevenueEditor controller={controller} line={getLine(row)} />
        </div>
      ),
    },
    {
      id: 'note',
      header: t('common:labels.notes'),
      minWidth: LINE_ITEM_NOTE_COLUMN_MIN_WIDTH,
      accessorFn: (item) => item.note || '',
      cell: ({ row }) => (
        <div className={LINE_ITEM_NOTE_CELL_CLASSNAME}>
          <ClientQuoteItemNote controller={controller} item={row} index={getIndex(row)} />
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
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ClientQuoteSectionHeading label={t('sales:clientQuotes.productsServices')} />
        <Button type="button" size="sm" onClick={addProductRow} disabled={isReadOnly}>
          <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
          {t('sales:clientQuotes.addProduct')}
        </Button>
      </div>
      {errors.items && <p className="ml-1 text-[10px] font-bold text-red-500">{errors.items}</p>}
      <StandardTable<QuoteItem>
        title={t('sales:clientQuotes.productsServices')}
        persistenceKey="sales.clientQuotes.items"
        allowColumnHiding={false}
        getRowProps={(item) => ({
          'data-quote-item-id': item.id,
          onDragOver: (event) => {
            if (!controller.draggedItemId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          },
          onDrop: (event) => controller.handleProductRowDrop(item.id, event),
          className:
            controller.draggedItemId === item.id ? 'opacity-60 ring-2 ring-primary/40' : undefined,
        })}
        data={items ?? []}
        columns={columns}
        defaultRowsPerPage={5}
        autoRevealNewRows
        shouldBypassFilters={(item) =>
          isTemporaryLineItem(item) || !isPositiveFiniteNumber(item.quantity)
        }
        minBodyRows={0}
        tableContainerClassName="overflow-x-auto"
        emptyState={
          <div className="py-8 text-sm text-muted-foreground">
            {t('sales:clientQuotes.noProductsAdded')}
          </div>
        }
      />
    </div>
  );
};
const getClientQuoteLineContext = (
  controller: ClientQuotesController,
  item: QuoteItem,
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
    lineCost,
    netRevenue: lineSalePrice,
    lineMargin,
    revenueMultiplier,
  } = getClientQuoteItemPricingContext(item);
  const rawCost = item.supplierQuoteItemId ? item.supplierQuoteUnitPrice : item.productCost;
  const cost =
    rawCost === undefined || rawCost === null || !Number.isFinite(Number(rawCost))
      ? undefined
      : item.supplierQuoteItemId
        ? Number(rawCost)
        : convertUnitPrice(Number(rawCost), 'hours', item.unitType || 'hours');
  const molPercentage = item.productMolPercentage ?? undefined;
  const unitPrice = Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : undefined;
  const revenue = unitPrice === undefined ? undefined : lineSalePrice;
  const canEditRevenue = Number.isFinite(revenueMultiplier) && revenueMultiplier > 0;
  const durationUnit = normalizeDurationUnit(item.durationUnit);
  const durationValue = getDurationInputValue(item);
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
    setFormData(makeCostUpdater<Partial<Quote>>(index, value));
  };

  const handleMolChange = (value: string) => {
    if (isReadOnly) return;
    setFormData(makeMolUpdater<Partial<Quote>>(index, value));
  };

  const handleUnitPriceChange = (value: string) => {
    if (isReadOnly) return;
    setFormData(makeUnitPriceUpdater<Partial<Quote>>(index, value));
  };

  const handleRevenueChange = (value: string) => {
    if (isReadOnly || !canEditRevenue) return;
    setFormData(makeRevenueUpdater<Partial<Quote>>(index, value));
  };

  return {
    cost,
    unitPrice,
    revenue,
    molPercentage,
    lineCost,
    canEditRevenue,
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
    handleUnitPriceChange,
    handleMolChange,
    handleRevenueChange,
  };
};

type ClientQuoteLineContext = ReturnType<typeof getClientQuoteLineContext>;

const ClientQuoteSupplierPicker: React.FC<{
  controller: ClientQuotesController;
  item: QuoteItem;
  index: number;
  className: string;
  buttonClassName: string;
}> = ({ controller, item, index, className, buttonClassName }) => {
  const {
    t,
    supplierQuoteItemOptions,
    isReadOnly,
    updateProductRow,
    getSupplierQuoteItemDisplayValue,
  } = controller;

  return (
    <SelectControl
      options={[
        { id: 'none', name: t('sales:clientQuotes.noSupplierQuote') },
        ...supplierQuoteItemOptions,
      ]}
      value={item.supplierQuoteItemId || 'none'}
      onChange={(val) =>
        updateProductRow(index, 'supplierQuoteItemId', val === 'none' ? '' : (val as string))
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

const ClientQuoteProductPicker: React.FC<{
  controller: ClientQuotesController;
  item: QuoteItem;
  index: number;
  className: string;
  buttonClassName: string;
}> = ({ controller, item, index, className, buttonClassName }) => {
  const { t, activeProductOptions, isReadOnly, isLinkedProductMissing, updateProductSelection } =
    controller;

  return (
    <ProductSelectOrFallback
      item={item}
      index={index}
      options={activeProductOptions}
      isProductMissing={isLinkedProductMissing(item)}
      isReadOnly={isReadOnly}
      ariaLabel={t('sales:clientQuotes.selectProduct', { defaultValue: 'Select product' })}
      placeholder={t('sales:clientQuotes.selectProduct')}
      onProductChange={updateProductSelection}
      className={className}
      buttonClassName={buttonClassName}
    />
  );
};

const ClientQuoteQuantityEditor: React.FC<{
  controller: ClientQuotesController;
  item: QuoteItem;
  index: number;
  line: ClientQuoteLineContext;
  compact?: boolean;
}> = ({ controller, item, index, line, compact }) => {
  const { t, isReadOnly, updateProductRow, handleUnitTypeChange } = controller;

  return (
    <div className="flex items-center justify-end gap-1">
      <ValidatedNumberInput
        step="0.01"
        min="0"
        required
        placeholder="0,00"
        aria-label={t('sales:clientQuotes.qty')}
        value={item.quantity}
        onValueChange={(value) => {
          const parsed = parseFloat(value);
          updateProductRow(
            index,
            'quantity',
            value === '' || Number.isNaN(parsed) ? Number.NaN : parsed,
          );
        }}
        disabled={isReadOnly || line.supplierLineLocked}
        className={
          compact
            ? 'w-full max-w-[5rem] text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed'
            : 'w-full text-sm px-3 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed flex-1'
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

const ClientQuoteDurationEditor: React.FC<{
  controller: ClientQuotesController;
  index: number;
  line: ClientQuoteLineContext;
  compact?: boolean;
}> = ({ controller, index, line, compact }) => {
  const { t, isReadOnly, handleDurationValueChange, handleDurationUnitChange } = controller;

  return (
    <div className="flex items-center justify-end gap-1">
      <ValidatedNumberInput
        step="1"
        min="1"
        placeholder="0"
        aria-label={t('sales:clientQuotes.durationColumn', { defaultValue: 'Duration' })}
        value={line.durationValue}
        onValueChange={(value) => handleDurationValueChange(index, value)}
        disabled={isReadOnly || line.durationUnit === 'na'}
        className={
          compact
            ? 'w-full max-w-[5rem] text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed'
            : 'w-full text-sm px-3 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed flex-1'
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
        count={line.durationValue ?? 0}
        disabled={isReadOnly}
      />
    </div>
  );
};

const ClientQuoteCostEditor: React.FC<{
  controller: ClientQuotesController;
  line: ClientQuoteLineContext;
  compact?: boolean;
}> = ({ controller, line, compact }) => {
  const { currency, isReadOnly } = controller;
  const isLinkedToSupplierQuote = line.isLinkedToSupplierQuote;

  return (
    <div className="flex w-full items-center justify-end gap-1">
      <ValidatedNumberInput
        value={line.cost}
        placeholder="0,00"
        aria-label={controller.t('crm:internalListing.cost')}
        formatDecimals={2}
        onValueChange={line.handleCostChange}
        disabled={isReadOnly || line.supplierLineLocked}
        className={
          compact
            ? 'w-full max-w-[5rem] flex-none text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed'
            : 'w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed'
        }
      />
      <span className="text-[9px] font-semibold text-zinc-400 shrink-0">{currency}</span>
      {!compact && <>{isLinkedToSupplierQuote && <SupplierQuoteCostHint />}</>}
    </div>
  );
};

const ClientQuoteMolEditor: React.FC<{
  controller: ClientQuotesController;
  line: ClientQuoteLineContext;
  compact?: boolean;
}> = ({ controller, line, compact }) => {
  const { isReadOnly } = controller;

  return (
    <>
      <ValidatedNumberInput
        value={line.molPercentage}
        placeholder="0,00"
        min={MIN_MOL_PERCENTAGE}
        max={MAX_MOL_PERCENTAGE}
        allowNegative
        aria-label={controller.t('sales:clientQuotes.molLabel', { defaultValue: 'MOL' })}
        formatDecimals={MOL_PERCENTAGE_DECIMALS}
        onValueChange={line.handleMolChange}
        disabled={isReadOnly}
        className={
          compact
            ? 'w-full max-w-[5rem] flex-none text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed'
            : 'w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed'
        }
      />
      <span className="text-[9px] font-semibold text-zinc-400 shrink-0">%</span>
    </>
  );
};

const ClientQuoteSalePriceEditor: React.FC<{
  controller: ClientQuotesController;
  line: ClientQuoteLineContext;
}> = ({ controller, line }) => (
  <div className="flex w-full items-center justify-end gap-1">
    <ValidatedNumberInput
      value={line.unitPrice}
      placeholder="0,00"
      min={0}
      aria-label={controller.t('crm:internalListing.salePrice')}
      formatDecimals={2}
      onValueChange={line.handleUnitPriceChange}
      disabled={controller.isReadOnly}
      className="w-full max-w-[5rem] flex-none border-border bg-background px-1 py-2 text-right text-sm text-foreground"
    />
    <span className="shrink-0 text-[9px] font-semibold text-muted-foreground">
      {controller.currency}
    </span>
  </div>
);

const ClientQuoteRevenueEditor: React.FC<{
  controller: ClientQuotesController;
  line: ClientQuoteLineContext;
}> = ({ controller, line }) => (
  <div className="flex w-full items-center justify-end gap-1">
    <ValidatedNumberInput
      value={line.revenue}
      placeholder="0,00"
      min={0}
      aria-label={controller.t('sales:clientQuotes.revenue')}
      formatDecimals={2}
      onValueChange={line.handleRevenueChange}
      disabled={controller.isReadOnly || !line.canEditRevenue}
      className="w-full max-w-[5rem] flex-none border-border bg-background px-1 py-2 text-right text-sm text-foreground"
    />
    <span className="shrink-0 text-[9px] font-semibold text-muted-foreground">
      {controller.currency}
    </span>
  </div>
);

const ClientQuoteDiscountEditor: React.FC<{
  controller: ClientQuotesController;
  item: QuoteItem;
  index: number;
  compact?: boolean;
}> = ({ controller, item, index, compact }) => (
  <div className="flex w-full items-center justify-end gap-1">
    <ValidatedNumberInput
      value={item.discount}
      placeholder="0,00"
      min={0}
      max={100}
      step="0.01"
      formatDecimals={2}
      aria-label={controller.t('common:labels.discount')}
      onValueChange={(value) =>
        controller.updateProductRow(index, 'discount', parseOptionalNumberInputValue(value))
      }
      disabled={controller.isReadOnly}
      className={
        compact
          ? 'w-full max-w-[5rem] flex-none text-sm px-1 py-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed'
          : 'w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-right disabled:opacity-50 disabled:cursor-not-allowed'
      }
    />
    <span className="shrink-0 text-[9px] font-semibold text-zinc-400">%</span>
  </div>
);

const ClientQuoteItemNote: React.FC<{
  controller: ClientQuotesController;
  item: QuoteItem;
  index: number;
}> = ({ controller, item, index }) => {
  const { t, isReadOnly, updateProductRow } = controller;

  return (
    <Field>
      <Input
        type="text"
        placeholder={t('form:placeholderNotes')}
        value={item.note || ''}
        onChange={(e) => updateProductRow(index, 'note', e.target.value)}
        disabled={isReadOnly}
      />
    </Field>
  );
};

const ClientQuoteNotesSummarySection: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => (
  <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
    <ClientQuoteNotesField controller={controller} />
    <ClientQuoteSummaryPanel controller={controller} />
  </div>
);

const ClientQuoteNotesField: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const { t, formData, setFormData, isReadOnly, readOnlyStatus, statusLabel } = controller;

  return (
    <Field className="w-full md:w-2/3">
      <ClientQuoteSectionHeading
        label={t('sales:clientQuotes.notesLabel')}
        description={t('sales:fieldInfo.notes', {
          defaultValue: 'Additional notes for the entire document',
        })}
        status={readOnlyStatus}
        statusLabel={statusLabel}
      />
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
  );
};

const ClientQuoteSummaryPanel: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const { t, errors, setErrors, formData, setFormData, formTotals, currency, isReadOnly } =
    controller;

  return (
    <div className="w-full space-y-2 md:w-1/3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        <span className="size-1.5 rounded-full bg-primary"></span>
        {t('sales:clientQuotes.summary', { defaultValue: 'Summary' })}
      </h4>
      {errors.total && <p className="text-red-500 text-[10px] font-bold mb-2">{errors.total}</p>}
      <CostSummaryPanel
        currency={currency}
        subtotal={formTotals.grossSubtotal}
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
          onTypeChange: (type) => setFormData((prev) => ({ ...prev, discountType: type })),
          disabled: isReadOnly,
        }}
        discountRow={
          formTotals.totalDiscountAmount > 0
            ? {
                label: t('common:labels.totalDiscount'),
                amount: formTotals.totalDiscountAmount,
                percentage: formTotals.totalDiscountPercentage,
              }
            : undefined
        }
        margin={{
          label: `${t('sales:clientQuotes.marginLabel')} (${formatMolPercentage(formTotals.marginPercentage)})`,
          amount: formTotals.margin,
        }}
      />
    </div>
  );
};

const ClientQuoteModalFooter: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const {
    t,
    closeModal,
    previewVersion,
    isReadOnly,
    expirationEditableWhileReadOnly,
    isSubmitting,
    getStatusLabel,
    editingQuote,
  } = controller;

  return (
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
  );
};

const ClientQuoteClientChangeModal: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const {
    t,
    pendingClientChange,
    dispatch,
    handleClientChangeKeepSnapshots,
    handleClientChangeReprice,
  } = controller;

  return (
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
  );
};

const ClientQuoteDeleteDialogs: React.FC<{ controller: ClientQuotesController }> = ({
  controller,
}) => {
  const {
    t,
    isDeleteConfirmOpen,
    isDeleting,
    dispatch,
    handleDelete,
    quoteToDelete,
    productRowToDelete,
    setProductRowToDelete,
    candidateToDeleteId,
    setCandidateToDeleteId,
    removeProductRow,
    removeCandidate,
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
        title={`${t('sales:clientQuotes.deleteQuote')}?`}
        description={t('sales:clientQuotes.deleteConfirm', {
          clientName: quoteToDelete?.clientName,
        })}
      />
      <DeleteConfirmModal
        isOpen={candidateToDeleteId !== null}
        onClose={() => setCandidateToDeleteId(null)}
        onConfirm={() => {
          if (candidateToDeleteId) removeCandidate(candidateToDeleteId);
          setCandidateToDeleteId(null);
        }}
        title={t('sales:clientQuotes.candidates.removeTitle')}
        description={t('sales:clientQuotes.candidates.removeConfirm')}
        zIndex={70}
      />
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
    </>
  );
};

const ClientQuotesHeader: React.FC<{ controller: ClientQuotesController }> = ({ controller }) => {
  const { t, openAddModal } = controller;

  return (
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
  );
};

const ClientQuotesTable: React.FC<{ controller: ClientQuotesController }> = ({ controller }) => {
  const {
    t,
    quotes,
    columns,
    tableInitialFilterState,
    canOpenQuoteModal,
    openEditModal,
    isQuoteExpired,
    isHistoryRow,
  } = controller;

  return (
    <StandardTable<Quote>
      title={t('sales:clientQuotes.activeQuotes')}
      viewKey="sales.client_quotes"
      data={quotes}
      columns={columns}
      defaultRowsPerPage={5}
      initialFilterState={tableInitialFilterState}
      onRowClick={(row) => {
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
  );
};

export default ClientQuotesView;
