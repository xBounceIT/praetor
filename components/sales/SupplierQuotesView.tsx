import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDocumentCodePreview } from '../../hooks/useDocumentCodePreview';
import type { QuoteCommunicationChannel } from '../../services/api/quoteCommunicationChannels';
import { supplierQuotesApi } from '../../services/api/supplierQuotes';
import type {
  Client,
  DurationUnit,
  Product,
  Supplier,
  SupplierQuote,
  SupplierQuoteItem,
  SupplierQuoteVersion,
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
import { createLineItemIndexResolver } from '../../utils/lineItemIndex';
import {
  convertUnitPrice,
  durationValueToMonths,
  formatDecimal,
  getDurationInputValue,
  getEffectiveDurationMonths,
  normalizeDurationUnit,
  parseDurationValueToMonths,
  parseNumberInputValue,
  roundCurrency,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { isTerminalQuoteStatus } from '../../utils/quoteStatus';
import { uploadStagedAttachments } from '../../utils/supplierQuoteAttachments';
import { toastError } from '../../utils/toast';
import CostSummaryPanel from '../shared/CostSummaryPanel';
import DateField from '../shared/DateField';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import DurationUnitSelector from '../shared/DurationUnitSelector';
import FieldTooltip from '../shared/FieldTooltip';
import HeaderAddButton from '../shared/HeaderAddButton';
import LineItemNoteTextarea from '../shared/LineItemNoteTextarea';
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
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import QuoteCommunicationChannelField from './QuoteCommunicationChannelField';
import {
  DEFAULT_QUOTE_COMMUNICATION_CHANNELS,
  noopQuoteCommunicationChannelMutation,
} from './quoteCommunicationChannelDefaults';
import SupplierQuoteAttachmentsSection from './SupplierQuoteAttachmentsSection';
import SupplierQuoteAttachmentsStaging from './SupplierQuoteAttachmentsStaging';
import SupplierQuoteVersionsPanel from './SupplierQuoteVersionsPanel';

interface TotalsBreakdown {
  // Gross list total: Σ(Prezzo listino × Qtà), before the supplier discount.
  subtotal: number;
  // Total "Sconto a noi" granted across all lines: subtotal − total.
  discountAmount: number;
  // Net total: Σ(Costo unitario × Qtà).
  total: number;
}

// Derive a line's persisted-scale pricing. Mirrors the server helper
// (server/utils/supplier-quote-pricing.ts → deriveSupplierLinePricing): round Prezzo listino and
// Sconto a noi to the DB scale (NUMERIC(_,2)) FIRST, then derive Costo unitario from the rounded
// values. Keeping the modal in lockstep with the server means the previewed and submitted line
// totals match the saved quote even when the user types more than two decimals. The discount is also
// clamped into [0, 100] so the net cost can never go negative from a legacy/out-of-range value.
const deriveLinePricing = (
  listPrice: number,
  discountPercent: number,
): { listPrice: number; discountPercent: number; unitPrice: number } => {
  const roundedListPrice = roundCurrency(listPrice || 0);
  const roundedDiscountPercent = Math.min(100, Math.max(0, roundCurrency(discountPercent || 0)));
  const unitPrice = roundCurrency(roundedListPrice * (1 - roundedDiscountPercent / 100));
  return { listPrice: roundedListPrice, discountPercent: roundedDiscountPercent, unitPrice };
};

const calculateTotals = (items: SupplierQuoteItem[]): TotalsBreakdown => {
  let grossListTotal = 0;
  let netTotal = 0;
  items.forEach((item) => {
    // Legacy fallback: rows/snapshots that predate list price use the net unit price as the
    // list price (no discount), so gross == net and no discount surfaces for them.
    const listPrice = item.listPrice ?? item.unitPrice ?? 0;
    // Duration multiplies the line total alongside quantity (issue #776). Unit-measured lines
    // never carry a duration, so getEffectiveDurationMonths returns 1 for them.
    const durationMonths = getEffectiveDurationMonths(item);
    const quantity = Number(item.quantity) || 0;
    grossListTotal += quantity * (Number(listPrice) || 0) * durationMonths;
    netTotal += quantity * (Number(item.unitPrice) || 0) * durationMonths;
  });
  const subtotal = roundCurrency(grossListTotal);
  const total = roundCurrency(netTotal);
  return { subtotal, total, discountAmount: roundCurrency(subtotal - total) };
};

export interface SupplierQuotesViewProps {
  quotes: SupplierQuote[];
  suppliers: Supplier[];
  clients: Client[];
  products: Product[];
  communicationChannels?: QuoteCommunicationChannel[];
  canManageCommunicationChannels?: boolean;
  onCreateCommunicationChannel?: (data: { name: string }) => Promise<void>;
  onUpdateCommunicationChannel?: (id: string, updates: { name: string }) => Promise<void>;
  onDeleteCommunicationChannel?: (id: string) => Promise<void>;
  // Resolves to the created quote so the modal can upload any files staged during creation.
  onAddQuote: (quoteData: Partial<SupplierQuote>) => Promise<SupplierQuote>;
  onUpdateQuote: (id: string, updates: Partial<SupplierQuote>) => void | Promise<void>;
  onDeleteQuote: (id: string) => void | Promise<void>;
  onCreateOrder?: (quote: SupplierQuote) => void | Promise<void>;
  onQuoteRestored?: (quote: SupplierQuote) => void;
  quoteFilterId?: string | null;
  onViewOrders?: (quoteId: string) => void;
  currency: string;
}

const getDefaultFormData = (): Partial<SupplierQuote> => ({
  supplierId: '',
  supplierName: '',
  clientId: null,
  clientName: null,
  id: '',
  items: [],
  paymentTerms: 'immediate',
  status: 'draft',
  expirationDate: addMonthsToDateOnly(getLocalDateString(), 1),
  communicationChannelId: '',
  notes: '',
});

interface SupplierQuotesViewState {
  editingQuote: SupplierQuote | null;
  quoteToDelete: SupplierQuote | null;
  isModalOpen: boolean;
  isDeleteConfirmOpen: boolean;
  errors: Record<string, string>;
  formData: Partial<SupplierQuote>;
  previewVersion: SupplierQuoteVersion | null;
  isSubmitting: boolean;
  isDeleting: boolean;
  // A numeric zero can be a deliberate price, so keep draft rows whose list price has never been
  // entered separate from the numeric item data. This lets the input stay truly empty/required.
  blankListPriceItemIds: ReadonlySet<string>;
  // Files chosen while creating a new quote. A new quote has no id to upload against yet, so they
  // are buffered here and flushed to /attachments right after the quote is created.
  stagedAttachments: File[];
}

const getInitialSupplierQuotesState = (): SupplierQuotesViewState => ({
  editingQuote: null,
  quoteToDelete: null,
  isModalOpen: false,
  isDeleteConfirmOpen: false,
  errors: {},
  formData: getDefaultFormData(),
  previewVersion: null,
  isSubmitting: false,
  isDeleting: false,
  blankListPriceItemIds: new Set<string>(),
  stagedAttachments: [],
});

type SupplierQuotesViewAction =
  | { type: 'setEditingQuote'; value: SupplierQuote | null }
  | { type: 'setQuoteToDelete'; value: SupplierQuote | null }
  | { type: 'setIsModalOpen'; value: boolean }
  | { type: 'setIsDeleteConfirmOpen'; value: boolean }
  | { type: 'setErrors'; value: Record<string, string> }
  | { type: 'clearError'; key: string }
  | { type: 'setFormData'; value: Partial<SupplierQuote> }
  | { type: 'patchFormData'; value: Partial<SupplierQuote> }
  | { type: 'setPreviewVersion'; value: SupplierQuoteVersion | null }
  | { type: 'setIsSubmitting'; value: boolean }
  | { type: 'setIsDeleting'; value: boolean }
  | { type: 'closeModal' }
  | { type: 'openAddModal' }
  | { type: 'openEditModal'; quote: SupplierQuote; formData: Partial<SupplierQuote> }
  | { type: 'previewVersion'; version: SupplierQuoteVersion; formData: Partial<SupplierQuote> }
  | { type: 'restoreVersion'; quote: SupplierQuote; formData: Partial<SupplierQuote> }
  | {
      type: 'updateItem';
      index: number;
      field: keyof SupplierQuoteItem;
      value: string | number | undefined;
    }
  | { type: 'addItem'; item: SupplierQuoteItem }
  | { type: 'removeItem'; index: number }
  | { type: 'setItem'; index: number; item: SupplierQuoteItem }
  | { type: 'addStagedAttachment'; file: File }
  | { type: 'removeStagedAttachment'; index: number };

const omitError = (errors: Record<string, string>, key: string): Record<string, string> => {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
};

const supplierQuotesViewReducer = (
  state: SupplierQuotesViewState,
  action: SupplierQuotesViewAction,
): SupplierQuotesViewState => {
  switch (action.type) {
    case 'setEditingQuote':
      return { ...state, editingQuote: action.value };
    case 'setQuoteToDelete':
      return { ...state, quoteToDelete: action.value };
    case 'setIsModalOpen':
      return { ...state, isModalOpen: action.value };
    case 'setIsDeleteConfirmOpen':
      return { ...state, isDeleteConfirmOpen: action.value };
    case 'setErrors':
      return { ...state, errors: action.value };
    case 'clearError':
      return { ...state, errors: omitError(state.errors, action.key) };
    case 'setFormData':
      return { ...state, formData: action.value, blankListPriceItemIds: new Set<string>() };
    case 'patchFormData':
      return { ...state, formData: { ...state.formData, ...action.value } };
    case 'setPreviewVersion':
      return { ...state, previewVersion: action.value };
    case 'setIsSubmitting':
      return { ...state, isSubmitting: action.value };
    case 'setIsDeleting':
      return { ...state, isDeleting: action.value };
    case 'closeModal':
      return {
        ...state,
        isModalOpen: false,
        previewVersion: null,
        blankListPriceItemIds: new Set<string>(),
        stagedAttachments: [],
      };
    case 'openAddModal':
      return {
        ...state,
        editingQuote: null,
        formData: getDefaultFormData(),
        errors: {},
        previewVersion: null,
        isModalOpen: true,
        blankListPriceItemIds: new Set<string>(),
        stagedAttachments: [],
      };
    case 'openEditModal':
      return {
        ...state,
        editingQuote: action.quote,
        formData: action.formData,
        errors: {},
        previewVersion: null,
        isModalOpen: true,
        blankListPriceItemIds: new Set<string>(),
        // A persisted quote uses the live attachments section, not staging; drop any stale queue.
        stagedAttachments: [],
      };
    case 'previewVersion':
      return {
        ...state,
        previewVersion: action.version,
        formData: action.formData,
        errors: {},
        blankListPriceItemIds: new Set<string>(),
      };
    case 'restoreVersion':
      return {
        ...state,
        editingQuote: action.quote,
        formData: action.formData,
        previewVersion: null,
        blankListPriceItemIds: new Set<string>(),
      };
    case 'updateItem': {
      const items = [...(state.formData.items || [])];
      const current = items[action.index];
      if (!current) return state;
      const isListPriceUpdate = action.field === 'listPrice';
      const parsedListPrice = isListPriceUpdate
        ? parseNumberInputValue(String(action.value), Number.NaN)
        : undefined;
      const hasValidListPrice =
        typeof parsedListPrice === 'number' && Number.isFinite(parsedListPrice);
      const isBlankListPrice = isListPriceUpdate && !hasValidListPrice;
      let blankListPriceItemIds = state.blankListPriceItemIds;
      if (isListPriceUpdate) {
        const nextBlankListPriceItemIds = new Set(blankListPriceItemIds);
        if (isBlankListPrice) nextBlankListPriceItemIds.add(current.id);
        else nextBlankListPriceItemIds.delete(current.id);
        blankListPriceItemIds = nextBlankListPriceItemIds;
      }
      const normalizedValue = isListPriceUpdate
        ? hasValidListPrice
          ? parsedListPrice
          : 0
        : action.value;
      const next = { ...current, [action.field]: normalizedValue };
      // Prezzo listino / Sconto a noi edits re-derive the whole line at the persisted DB scale in
      // the same update, so the rounded list price/discount and the net cost — and every total that
      // reads them — stay in lockstep with what the server will store.
      if (action.field === 'listPrice' || action.field === 'discountPercent') {
        const hasDiscount = Number.isFinite(Number(next.discountPercent));
        const pricing = deriveLinePricing(next.listPrice, next.discountPercent);
        next.listPrice = pricing.listPrice;
        next.discountPercent = hasDiscount ? pricing.discountPercent : Number.NaN;
        next.unitPrice = pricing.unitPrice;
      }
      items[action.index] = next;
      return {
        ...state,
        formData: { ...state.formData, items },
        blankListPriceItemIds,
        errors:
          isListPriceUpdate && !isBlankListPrice && blankListPriceItemIds.size === 0
            ? omitError(state.errors, 'items')
            : state.errors,
      };
    }
    case 'addItem': {
      const blankListPriceItemIds = new Set(state.blankListPriceItemIds);
      blankListPriceItemIds.add(action.item.id);
      return {
        ...state,
        formData: { ...state.formData, items: [...(state.formData.items || []), action.item] },
        blankListPriceItemIds,
      };
    }
    case 'removeItem': {
      const items = [...(state.formData.items || [])];
      const removedItem = items[action.index];
      items.splice(action.index, 1);
      const blankListPriceItemIds = new Set(state.blankListPriceItemIds);
      if (removedItem) blankListPriceItemIds.delete(removedItem.id);
      return {
        ...state,
        formData: { ...state.formData, items },
        blankListPriceItemIds,
        errors:
          removedItem && blankListPriceItemIds.size === 0
            ? omitError(state.errors, 'items')
            : state.errors,
      };
    }
    case 'setItem': {
      const items = [...(state.formData.items || [])];
      items[action.index] = action.item;
      return { ...state, formData: { ...state.formData, items } };
    }
    case 'addStagedAttachment':
      return { ...state, stagedAttachments: [...state.stagedAttachments, action.file] };
    case 'removeStagedAttachment':
      return {
        ...state,
        stagedAttachments: state.stagedAttachments.filter((_, index) => index !== action.index),
      };
    default:
      return state;
  }
};

const useSupplierQuotesController = ({
  quotes,
  suppliers,
  clients,
  products,
  communicationChannels = DEFAULT_QUOTE_COMMUNICATION_CHANNELS,
  canManageCommunicationChannels = false,
  onCreateCommunicationChannel = noopQuoteCommunicationChannelMutation,
  onUpdateCommunicationChannel = noopQuoteCommunicationChannelMutation,
  onDeleteCommunicationChannel = noopQuoteCommunicationChannelMutation,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onCreateOrder,
  onQuoteRestored,
  quoteFilterId,
  onViewOrders,
  currency,
}: SupplierQuotesViewProps) => {
  const { t, i18n } = useTranslation(['sales', 'common', 'crm', 'form']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const statusOptions = useMemo(
    () => [
      { id: 'draft', name: t('sales:supplierQuotes.statusDraft', { defaultValue: 'Draft' }) },
      { id: 'sent', name: t('sales:supplierQuotes.statusSent', { defaultValue: 'Sent' }) },
      { id: 'offer', name: t('sales:supplierQuotes.statusOffer', { defaultValue: 'Offer' }) },
      {
        id: 'accepted',
        name: t('sales:supplierQuotes.statusAccepted', { defaultValue: 'Accepted' }),
      },
      { id: 'denied', name: t('sales:supplierQuotes.statusDenied', { defaultValue: 'Denied' }) },
    ],
    [t],
  );

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => !supplier.isDisabled),
    [suppliers],
  );

  // A quick-view deep link (or a cross-view "view quote" action) pre-filters the
  // table to one quote. It targets the visible "Codice" (id) column, so the
  // native column filter shows as active and stays clearable from its dropdown.
  const tableInitialFilterState = useMemo(() => {
    if (quoteFilterId) {
      return { id: [quoteFilterId] };
    }
    return undefined;
  }, [quoteFilterId]);

  const [state, dispatch] = useReducer(
    supplierQuotesViewReducer,
    undefined,
    getInitialSupplierQuotesState,
  );
  const {
    editingQuote,
    quoteToDelete,
    isModalOpen,
    isDeleteConfirmOpen,
    errors,
    formData,
    previewVersion,
    isSubmitting,
    isDeleting,
    blankListPriceItemIds,
    stagedAttachments,
  } = state;
  const { preview: supplierQuoteCodePreview } = useDocumentCodePreview('supplier_quote', {
    enabled: isModalOpen && !editingQuote,
  });

  // `status` is the EFFECTIVE status (synced from the linked client quote + the `expired` overlay,
  // issue #779), so a linked supplier quote mirroring a non-draft client quote is correctly
  // read-only here even when its own stored status is still draft.
  const baseReadOnly = Boolean(editingQuote && editingQuote.status !== 'draft');
  const isReadOnly = baseReadOnly || previewVersion !== null;
  // The expiration date stays editable while read-only due to status/sync/expiry (so the quote can
  // be revalidated) — but not once an order locks the quote, and not in version preview.
  const expirationEditableWhileReadOnly = Boolean(
    editingQuote && baseReadOnly && !editingQuote.linkedOrderId && previewVersion === null,
  );

  const readOnlyLinkedReason = t('sales:supplierQuotes.readOnlyLinked', {
    defaultValue: 'This quote is read-only because an order was created from it.',
  });
  const readOnlyStatusReason = t('sales:supplierQuotes.readOnlyStatus', {
    defaultValue: 'Read-only due to non-draft status',
  });
  const readOnlyReason = editingQuote?.linkedOrderId ? readOnlyLinkedReason : readOnlyStatusReason;
  const statusEditable = t('sales:fieldInfo.statusEditable', { defaultValue: 'Editable' });
  const statusLabel = t('sales:fieldInfo.statusLabel', { defaultValue: 'Status:' });
  const readOnlyStatus = isReadOnly ? readOnlyReason : statusEditable;

  const hasOrderForQuote = useCallback((quote: SupplierQuote) => Boolean(quote.linkedOrderId), []);

  const isHistoryRow = useCallback(
    (quote: SupplierQuote) => {
      const hasOrder = hasOrderForQuote(quote);
      return quote.status === 'denied' || hasOrder;
    },
    [hasOrderForQuote],
  );

  // History rows (denied / order-linked) are not editable, but terminal accepted/denied still OPEN
  // in read-only mode for viewing — one predicate keeps onRowClick and rowClassName in sync.
  const canOpenQuoteModal = useCallback(
    (quote: SupplierQuote) => !isHistoryRow(quote) || isTerminalQuoteStatus(quote.status),
    [isHistoryRow],
  );

  const totalsBreakdown = calculateTotals(formData.items || []);

  const itemInputClassName = 'font-medium';

  const closeModal = useCallback(() => {
    dispatch({ type: 'closeModal' });
  }, []);

  const openAddModal = useCallback(() => {
    dispatch({ type: 'openAddModal' });
    dispatch({
      type: 'patchFormData',
      value: {
        communicationChannelId: communicationChannels[0]?.id ?? '',
        communicationChannelName: communicationChannels[0]?.name ?? '',
      },
    });
  }, [communicationChannels]);

  const quoteToFormData = useCallback(
    (quote: SupplierQuote): Partial<SupplierQuote> => ({
      ...quote,
      expirationDate: quote.expirationDate ? normalizeDateOnlyString(quote.expirationDate) : '',
      communicationChannelId: quote.communicationChannelId ?? communicationChannels[0]?.id ?? '',
      communicationChannelName:
        quote.communicationChannelName ?? communicationChannels[0]?.name ?? '',
    }),
    [communicationChannels],
  );

  const openEditModal = useCallback(
    (quote: SupplierQuote) => {
      dispatch({ type: 'openEditModal', quote, formData: quoteToFormData(quote) });
    },
    [quoteToFormData],
  );

  const handleVersionPreview = useCallback(
    (version: SupplierQuoteVersion) => {
      dispatch({
        type: 'previewVersion',
        version,
        formData: {
          ...version.snapshot.quote,
          id: editingQuote?.id ?? version.snapshot.quote.id,
          items: version.snapshot.items,
          expirationDate: version.snapshot.quote.expirationDate
            ? normalizeDateOnlyString(version.snapshot.quote.expirationDate)
            : '',
          status: version.snapshot.quote.status as SupplierQuote['status'],
          communicationChannelId:
            version.snapshot.quote.communicationChannelId ?? communicationChannels[0]?.id ?? '',
          communicationChannelName:
            version.snapshot.quote.communicationChannelName ?? communicationChannels[0]?.name ?? '',
        },
      });
    },
    [communicationChannels, editingQuote],
  );

  const handleClearPreview = useCallback(() => {
    if (editingQuote) {
      dispatch({ type: 'setFormData', value: quoteToFormData(editingQuote) });
    }
    dispatch({ type: 'setPreviewVersion', value: null });
  }, [editingQuote, quoteToFormData]);

  const handleVersionRestored = useCallback(
    (updated: SupplierQuote) => {
      dispatch({ type: 'restoreVersion', quote: updated, formData: quoteToFormData(updated) });
      onQuoteRestored?.(updated);
    },
    [onQuoteRestored, quoteToFormData],
  );

  const getStatusLabel = useCallback(
    (status: string) => {
      if (status === 'expired') {
        return t('sales:supplierQuotes.statusExpired', { defaultValue: 'Expired' });
      }
      const option = statusOptions.find((item) => item.id === status);
      return option ? option.name : status;
    },
    [statusOptions, t],
  );

  const handleSupplierChange = useCallback(
    (supplierId: string) => {
      const supplier = suppliers.find((item) => item.id === supplierId);
      dispatch({
        type: 'patchFormData',
        value: { supplierId, supplierName: supplier?.name || '' },
      });
    },
    [suppliers],
  );

  // The customer link is mandatory (issue #777): every supplier quote must name a customer, so
  // there is no empty "No customer" option — the field starts on the placeholder and submission is
  // blocked until one is picked (see handleSubmit). Keep an already-linked-but-now-disabled client
  // visible so editing an existing quote doesn't hide its customer; otherwise only offer active ones.
  const clientOptions = useMemo(() => {
    const options = clients.flatMap((client) =>
      !client.isDisabled || client.id === editingQuote?.clientId
        ? [{ id: client.id, name: client.name }]
        : [],
    );
    // The linked client may be missing from a user-scoped /clients list (no crm.clients_all.view
    // and not assigned to it). Synthesize an option from the quote's stored name so the select
    // shows the customer instead of falling back to the placeholder.
    const linkedId = editingQuote?.clientId;
    if (linkedId && !options.some((option) => option.id === linkedId)) {
      options.push({ id: linkedId, name: editingQuote?.clientName || linkedId });
    }
    return options;
  }, [clients, editingQuote]);

  const handleClientChange = useCallback(
    (clientId: string) => {
      const client = clients.find((item) => item.id === clientId);
      dispatch({
        type: 'patchFormData',
        value: { clientId: clientId || null, clientName: client?.name || null },
      });
      // Mirror the Quote Code field: clear the required-customer error as soon as one is chosen.
      if (clientId) {
        dispatch({ type: 'clearError', key: 'clientId' });
      }
    },
    [clients],
  );

  const updateItem = useCallback(
    (index: number, field: keyof SupplierQuoteItem, value: string | number | undefined) => {
      if (isReadOnly) return;
      dispatch({ type: 'updateItem', index, field, value });
    },
    [isReadOnly],
  );

  const addItem = useCallback(() => {
    if (isReadOnly) return;
    dispatch({
      type: 'addItem',
      item: {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        quoteId: editingQuote?.id || '',
        productName: '',
        quantity: Number.NaN,
        listPrice: 0,
        discountPercent: Number.NaN,
        unitPrice: 0,
        unitType: 'unit' as const,
        durationUnit: 'months' as const,
        note: '',
      },
    });
  }, [editingQuote?.id, isReadOnly]);

  const removeItem = useCallback(
    (index: number) => {
      if (isReadOnly) return;
      dispatch({ type: 'removeItem', index });
    },
    [isReadOnly],
  );

  const handleUnitTypeChange = (index: number, newType: SupplierUnitType) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item) return;
    const oldType = item.unitType || 'unit';
    if (oldType === newType) return;
    // Convert the list price (the base of the pricing chain), then re-derive Costo unitario.
    const baseListPrice = item.listPrice ?? item.unitPrice ?? 0;
    const adjustedListPrice = convertUnitPrice(baseListPrice, oldType, newType);
    const pricing = deriveLinePricing(adjustedListPrice, item.discountPercent ?? 0);
    dispatch({
      type: 'setItem',
      index,
      item: {
        ...item,
        unitType: newType,
        listPrice: pricing.listPrice,
        discountPercent: pricing.discountPercent,
        unitPrice: pricing.unitPrice,
      },
    });
  };

  // Duration value entered in the item's chosen unit (issue #776). Stored canonically as whole
  // months; the Mese/Anno selector only changes how that value is displayed/entered.
  const handleDurationValueChange = (index: number, value: string) => {
    if (isReadOnly) return;
    const unit = normalizeDurationUnit(formData.items?.[index]?.durationUnit);
    updateItem(
      index,
      'durationMonths',
      value === '' ? undefined : parseDurationValueToMonths(value, unit),
    );
  };

  const handleDurationUnitChange = (index: number, newUnit: DurationUnit) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return;
    // Switching to 'na' (N/A) drops the multiplier to a single month — the value input is disabled
    // and the line never multiplies (issue #775). Other units convert the displayed value to months.
    const durationValue = getDurationInputValue(item);
    const durationMonths =
      newUnit === 'na' || durationValue === undefined
        ? undefined
        : durationValueToMonths(durationValue, newUnit);
    dispatch({
      type: 'setItem',
      index,
      item: {
        ...item,
        durationUnit: newUnit,
        durationMonths,
      },
    });
  };

  const columns = useMemo<Column<SupplierQuote>[]>(
    () => [
      {
        header: t('sales:supplierQuotes.quoteCode', { defaultValue: 'Quote Code' }),
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
        header: t('sales:supplierQuotes.supplier', { defaultValue: 'Supplier' }),
        accessorKey: 'supplierName',
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <div className={history ? 'font-bold text-zinc-400' : 'font-bold text-zinc-800'}>
              {row.supplierName}
            </div>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.client', { defaultValue: 'Customer' }),
        id: 'clientName',
        accessorFn: (row) => row.clientName ?? '',
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <div className={`text-sm ${history ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {row.clientName || '-'}
            </div>
          );
        },
        filterFormat: (value) => (value ? String(value) : '-'),
      },
      {
        header: t('sales:supplierQuotes.total', { defaultValue: 'Total' }),
        id: 'total',
        accessorFn: (row) => calculateTotals(row.items).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          const { total } = calculateTotals(row.items);
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
        header: t('sales:supplierQuotes.paymentTerms', { defaultValue: 'Payment Terms' }),
        accessorKey: 'paymentTerms',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[10rem]',
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <span
              className={`text-sm font-semibold ${history ? 'text-zinc-400' : 'text-zinc-600'}`}
            >
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
            <span
              className={`text-sm font-semibold ${history ? 'text-zinc-400' : 'text-zinc-600'}`}
            >
              {row.communicationChannelName || '-'}
            </span>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.expirationDate', { defaultValue: 'Expiration Date' }),
        accessorKey: 'expirationDate',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        filterFormat: (value) => (value ? formatDateOnlyForLocale(String(value)) : '-'),
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <div className={`text-sm ${history ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {row.expirationDate ? formatDateOnlyForLocale(row.expirationDate) : '-'}
            </div>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.status', { defaultValue: 'Status' }),
        accessorKey: 'status',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        filterFormat: (value) => getStatusLabel(String(value)),
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <div className={`flex items-center gap-1.5 ${history ? 'opacity-60' : ''}`}>
              <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status)} />
              {row.isStatusSynced && (
                <i
                  role="img"
                  className="fa-solid fa-link text-zinc-400 text-xs"
                  title={t('sales:supplierQuotes.syncedFromClientQuote', {
                    defaultValue: 'Status synced from the linked client quote',
                  })}
                  aria-label={t('sales:supplierQuotes.syncedFromClientQuote', {
                    defaultValue: 'Status synced from the linked client quote',
                  })}
                ></i>
              )}
            </div>
          );
        },
      },
      {
        header: t('sales:supplierQuotes.actionsColumn', { defaultValue: 'Actions' }),
        id: 'actions',
        align: 'right',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => {
          const hasOrder = hasOrderForQuote(row);
          const history = isHistoryRow(row);
          const isRowReadOnly = row.status !== 'draft';

          const isEditDisabled = hasOrder;
          const editTitle = hasOrder
            ? t('sales:supplierQuotes.orderAlreadyExists', {
                defaultValue: 'An order for this quote already exists.',
              })
            : isRowReadOnly
              ? t('sales:supplierQuotes.viewQuote', { defaultValue: 'View quote' })
              : t('common:buttons.edit', { defaultValue: 'Edit' });

          const isCreateOrderDisabled = history || hasOrder;
          const createOrderTitle = hasOrder
            ? t('sales:supplierQuotes.orderAlreadyExists', {
                defaultValue: 'An order for this quote already exists.',
              })
            : t('sales:supplierQuotes.createOrder', { defaultValue: 'Create order' });

          return (
            <div className="flex justify-end gap-2">
              {row.linkedOrderId && onViewOrders && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewOrders(row.id);
                        }}
                        aria-label={t('sales:supplierQuotes.viewOrder', {
                          defaultValue: 'View order',
                        })}
                        className="p-2 rounded-lg transition-all text-zinc-400 hover:text-praetor hover:bg-zinc-100"
                      >
                        <i className="fa-solid fa-link"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('sales:supplierQuotes.viewOrder', { defaultValue: 'View order' })}
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isEditDisabled) return;
                        openEditModal(row);
                      }}
                      disabled={isEditDisabled}
                      aria-label={editTitle}
                      className={`p-2 rounded-lg transition-all ${isEditDisabled ? 'cursor-not-allowed opacity-50 text-zinc-400' : 'text-zinc-400 hover:text-praetor hover:bg-zinc-100'}`}
                    >
                      <i
                        className={`fa-solid ${isRowReadOnly && !hasOrder ? 'fa-eye' : 'fa-pen-to-square'}`}
                      ></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{editTitle}</TooltipContent>
              </Tooltip>
              {row.status === 'accepted' && onCreateOrder && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isCreateOrderDisabled) return;
                          onCreateOrder(row);
                        }}
                        disabled={isCreateOrderDisabled}
                        aria-label={createOrderTitle}
                        className={`p-2 rounded-lg transition-all ${isCreateOrderDisabled ? 'cursor-not-allowed opacity-50 text-zinc-400' : 'text-zinc-400 hover:text-praetor hover:bg-zinc-100'}`}
                      >
                        <i className="fa-solid fa-cart-shopping"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{createOrderTitle}</TooltipContent>
                </Tooltip>
              )}
              {row.status === 'draft' && !hasOrder && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          dispatch({ type: 'setQuoteToDelete', value: row });
                          dispatch({ type: 'setIsDeleteConfirmOpen', value: true });
                        }}
                        aria-label={t('common:buttons.delete', { defaultValue: 'Delete' })}
                        className="p-2 rounded-lg transition-all text-red-600 hover:text-red-600 hover:bg-red-50"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('common:buttons.delete', { defaultValue: 'Delete' })}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        },
      },
    ],
    [
      currency,
      getStatusLabel,
      onCreateOrder,
      onViewOrders,
      openEditModal,
      t,
      isHistoryRow,
      hasOrderForQuote,
    ],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const nextErrors: Record<string, string> = {};
    if (!formData.supplierId) {
      nextErrors.supplierId = t('sales:supplierQuotes.errors.supplierRequired', {
        defaultValue: 'Supplier is required',
      });
    }
    if (!formData.clientId) {
      nextErrors.clientId = t('sales:supplierQuotes.errors.clientRequired', {
        defaultValue: 'Customer is required',
      });
    }
    if (editingQuote && !formData.id?.trim()) {
      nextErrors.id = t('sales:supplierQuotes.errors.quoteCodeRequired', {
        defaultValue: 'Quote Code is required',
      });
    }
    if (!formData.communicationChannelId) {
      nextErrors.communicationChannelId = t('sales:communicationChannels.errors.required');
    }
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('sales:supplierQuotes.errors.itemsRequired', {
        defaultValue: 'At least one item is required',
      });
    } else if (formData.items.some((item) => blankListPriceItemIds.has(item.id))) {
      nextErrors.items = t('sales:supplierQuotes.errors.listPriceRequired', {
        defaultValue: 'List price is required for every item',
      });
    }

    if (Object.keys(nextErrors).length > 0) {
      dispatch({ type: 'setErrors', value: nextErrors });
      return;
    }

    const payload: Partial<SupplierQuote> = {
      ...formData,
      id: formData.id?.trim() || undefined,
      items: (formData.items || []).map((item) => ({
        ...item,
        // Submit the same persisted-scale pricing the server derives, so what the user reviewed
        // is exactly what gets saved (legacy rows fall back to the net price as the list price).
        ...deriveLinePricing(
          Number(item.listPrice ?? item.unitPrice ?? 0),
          Number(item.discountPercent ?? 0),
        ),
        // Duration applies to every line type now (issue #775); 'na' is gated server-side via
        // effectiveDurationMonths, so the chosen value/unit is submitted verbatim.
        durationMonths: Number(item.durationMonths ?? 1) || 1,
        durationUnit: normalizeDurationUnit(item.durationUnit),
      })),
    };
    if (editingQuote) {
      // Status is fully derived server-side (issue #779) and the PUT ignores a client-sent
      // value; never carry the formData copy (the derived `expired`/`offer` projection) through
      // the content form.
      delete payload.status;
    }

    dispatch({ type: 'setIsSubmitting', value: true });
    try {
      if (editingQuote) {
        await onUpdateQuote(editingQuote.id, payload);
      } else {
        const created = await onAddQuote(payload);
        if (stagedAttachments.length > 0) {
          // The quote now exists, so flush the files staged during creation to it.
          const { failed } = await uploadStagedAttachments(
            created.id,
            stagedAttachments,
            (quoteId, file) => supplierQuotesApi.uploadAttachment(quoteId, file),
          );
          if (failed.length > 0) {
            toastError(
              t('sales:supplierQuotes.attachments.uploadPartialFailed', {
                count: failed.length,
                names: failed.map((file) => file.name).join(', '),
                defaultValue:
                  'Quote saved, but {{count}} attachment(s) could not be uploaded: {{names}}. Retry from the saved quote.',
              }),
            );
            // The quote is persisted; reopen it in edit mode so the user sees what uploaded and can
            // retry the rest from the live attachments section instead of losing their work.
            dispatch({
              type: 'openEditModal',
              quote: created,
              formData: quoteToFormData(created),
            });
            return;
          }
        }
      }
    } catch (err) {
      toastError((err as Error).message || t('sales:supplierQuotes.failedToSave'));
      return;
    } finally {
      dispatch({ type: 'setIsSubmitting', value: false });
    }
    closeModal();
  };

  return {
    activeSuppliers,
    addItem,
    baseReadOnly,
    canManageCommunicationChannels,
    canOpenQuoteModal,
    clientOptions,
    closeModal,
    columns,
    communicationChannels,
    blankListPriceItemIds,
    currency,
    dispatch,
    editingQuote,
    errors,
    expirationEditableWhileReadOnly,
    formData,
    handleClearPreview,
    handleClientChange,
    handleDurationUnitChange,
    handleDurationValueChange,
    handleSubmit,
    handleSupplierChange,
    handleUnitTypeChange,
    handleVersionPreview,
    handleVersionRestored,
    i18n,
    isDeleteConfirmOpen,
    isDeleting,
    isHistoryRow,
    isModalOpen,
    isReadOnly,
    isSubmitting,
    itemInputClassName,
    onCreateCommunicationChannel,
    onDeleteCommunicationChannel,
    onDeleteQuote,
    onUpdateCommunicationChannel,
    onUpdateQuote,
    onViewOrders,
    openAddModal,
    openEditModal,
    paymentTermsOptions,
    previewVersion,
    products,
    quoteToDelete,
    quotes,
    readOnlyReason,
    readOnlyStatus,
    removeItem,
    stagedAttachments,
    statusLabel,
    supplierQuoteCodePreview,
    t,
    tableInitialFilterState,
    totalsBreakdown,
    updateItem,
  };
};

type SupplierQuotesController = ReturnType<typeof useSupplierQuotesController>;

const SupplierQuotesView: React.FC<SupplierQuotesViewProps> = (props) => {
  const controller = useSupplierQuotesController(props);
  return <SupplierQuotesLayout controller={controller} />;
};

const SupplierQuotesLayout: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <div className="space-y-8">
    <SupplierQuoteModal controller={controller} />
    <SupplierQuotesDeleteDialog controller={controller} />
    <SupplierQuotesHeader controller={controller} />
    <SupplierQuotesTable controller={controller} />
  </div>
);

const SupplierQuoteModal: React.FC<{ controller: SupplierQuotesController }> = ({ controller }) => (
  <Modal isOpen={controller.isModalOpen} onClose={controller.closeModal}>
    <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
      <ModalContent size="full" className="max-h-[90vh]">
        <form onSubmit={controller.handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <SupplierQuoteModalHeader controller={controller} />
          <ModalBody className="flex-1 space-y-5">
            <SupplierQuoteModalAlerts controller={controller} />
            <SupplierQuoteDetailsSection controller={controller} />
            <SupplierQuoteItemsSection controller={controller} />
            <SupplierQuoteAttachmentsArea controller={controller} />
            <SupplierQuoteNotesSummarySection controller={controller} />
          </ModalBody>
          <SupplierQuoteModalFooter controller={controller} />
        </form>
      </ModalContent>
      {controller.editingQuote?.id && (
        <SupplierQuoteVersionsPanel
          quoteId={controller.editingQuote.id}
          selectedVersionId={controller.previewVersion?.id ?? null}
          onPreview={controller.handleVersionPreview}
          onClearPreview={controller.handleClearPreview}
          onRestored={controller.handleVersionRestored}
          disabled={controller.baseReadOnly}
        />
      )}
    </div>
  </Modal>
);

const SupplierQuoteModalHeader: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <ModalHeader>
    <ModalTitle className="gap-3">
      <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
        <i
          className={`fa-solid ${
            controller.isReadOnly
              ? 'fa-eye'
              : controller.editingQuote
                ? 'fa-pen-to-square'
                : 'fa-plus'
          }`}
          aria-hidden="true"
        ></i>
      </span>
      {controller.isReadOnly
        ? controller.t('sales:supplierQuotes.viewQuote', { defaultValue: 'View quote' })
        : controller.editingQuote
          ? controller.t('sales:supplierQuotes.editQuote', { defaultValue: 'Edit quote' })
          : controller.t('sales:supplierQuotes.newQuote', { defaultValue: 'New quote' })}
    </ModalTitle>
    <ModalCloseButton onClick={controller.closeModal} />
  </ModalHeader>
);

const SupplierQuoteModalAlerts: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => {
  const editingQuote = controller.editingQuote;

  return (
    <>
      {controller.previewVersion && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <span className="text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-2">
            <i className="fa-solid fa-clock-rotate-left"></i>
            {controller.t('sales:supplierQuotes.versionHistory.previewBanner', {
              date: formatInsertDateTime(
                controller.previewVersion.createdAt,
                controller.i18n.language,
              ),
              defaultValue: 'Previewing version from {{date}}',
            })}
          </span>
          <Button
            type="button"
            variant="link"
            onClick={controller.handleClearPreview}
            className="h-auto px-0 text-xs font-semibold text-amber-800 dark:text-amber-300"
          >
            {controller.t('sales:supplierQuotes.versionHistory.backToCurrent', {
              defaultValue: 'Back to current',
            })}
          </Button>
        </div>
      )}
      {controller.baseReadOnly && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <span className="text-amber-700 dark:text-amber-300 text-xs font-bold">
            {controller.readOnlyReason}
          </span>
        </div>
      )}
      {editingQuote?.linkedOrderId && (
        <LinkedRecordBanner
          label={controller.t('sales:supplierQuotes.linkedOrderTitle', {
            defaultValue: 'Linked Order',
          })}
          value={controller.t('sales:supplierQuotes.linkedOrderInfo', {
            number: editingQuote.linkedOrderId,
            defaultValue: 'Order #{{number}}',
          })}
          note={controller.t('sales:supplierQuotes.orderDetailsReadOnly', {
            defaultValue: '(Quote details are read-only)',
          })}
          action={
            controller.onViewOrders
              ? {
                  label: controller.t('sales:supplierQuotes.viewOrder', {
                    defaultValue: 'View Order',
                  }),
                  onClick: () => controller.onViewOrders?.(editingQuote.id),
                }
              : undefined
          }
        />
      )}
    </>
  );
};

const SupplierQuoteSectionTitle: React.FC<{
  children: React.ReactNode;
  description?: string;
  status?: string;
  statusLabel?: string;
}> = ({ children, description, status, statusLabel }) => (
  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
    <span className="size-1.5 rounded-full bg-primary"></span>
    {children}
    {description && status && statusLabel && (
      <FieldTooltip description={description} status={status} statusLabel={statusLabel} />
    )}
  </h4>
);

const SupplierQuoteDetailsSection: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <div className="space-y-2">
    <SupplierQuoteSectionTitle
      description={controller.t('sales:fieldInfo.supplierInformation', {
        defaultValue: 'Supplier and document details',
      })}
      status={controller.readOnlyStatus}
      statusLabel={controller.statusLabel}
    >
      {controller.t('sales:supplierQuotes.supplierInformation', {
        defaultValue: 'Supplier Information',
      })}
    </SupplierQuoteSectionTitle>
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <SupplierQuoteSupplierField controller={controller} />
      <SupplierQuoteClientField controller={controller} />
      <SupplierQuoteCodeField controller={controller} />
      <SupplierQuotePaymentTermsField controller={controller} />
      <SupplierQuoteCommunicationField controller={controller} />
      <SupplierQuoteExpirationField controller={controller} />
    </div>
  </div>
);

const SupplierQuoteSupplierField: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <Field data-invalid={Boolean(controller.errors.supplierId)}>
    <SelectControl
      id="supplier-quote-supplier"
      options={controller.activeSuppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
      }))}
      value={controller.formData.supplierId || ''}
      onChange={(value) => controller.handleSupplierChange(value as string)}
      placeholder={controller.t('sales:supplierQuotes.selectSupplier', {
        defaultValue: 'Select a supplier',
      })}
      searchable={true}
      disabled={controller.isReadOnly}
      label={controller.t('sales:supplierQuotes.supplier', { defaultValue: 'Supplier' })}
      required
      buttonClassName="h-9"
      className={controller.errors.supplierId ? 'border-red-300' : ''}
    />
    <FieldError className="text-xs">{controller.errors.supplierId}</FieldError>
  </Field>
);

const SupplierQuoteClientField: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <Field data-invalid={Boolean(controller.errors.clientId)}>
    <SelectControl
      id="supplier-quote-client"
      options={controller.clientOptions}
      value={controller.formData.clientId || ''}
      onChange={(value) => controller.handleClientChange(value as string)}
      placeholder={controller.t('sales:supplierQuotes.selectClient', {
        defaultValue: 'Select a customer',
      })}
      searchable={true}
      disabled={controller.isReadOnly}
      label={controller.t('sales:supplierQuotes.client', { defaultValue: 'Customer' })}
      required
      buttonClassName="h-9"
      className={controller.errors.clientId ? 'border-red-300' : ''}
    />
    <FieldError className="text-xs">{controller.errors.clientId}</FieldError>
  </Field>
);

const SupplierQuoteCodeField: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <Field data-invalid={Boolean(controller.errors.id)}>
    <FieldLabel htmlFor="supplier-quote-code" required={Boolean(controller.editingQuote)}>
      {controller.t('sales:supplierQuotes.quoteCode', { defaultValue: 'Quote Code' })}
    </FieldLabel>
    <Input
      id="supplier-quote-code"
      type="text"
      value={controller.formData.id || ''}
      disabled={controller.isReadOnly}
      onChange={(event) => {
        controller.dispatch({ type: 'patchFormData', value: { id: event.target.value } });
        if (controller.errors.id) {
          controller.dispatch({ type: 'clearError', key: 'id' });
        }
      }}
      placeholder={
        controller.supplierQuoteCodePreview ??
        controller.t('sales:supplierQuotes.autoCodePlaceholder', {
          defaultValue: 'Auto-generated',
        })
      }
      className={controller.errors.id ? 'border-red-300' : ''}
      aria-invalid={Boolean(controller.errors.id)}
    />
    <FieldError className="text-xs">{controller.errors.id}</FieldError>
    {!controller.editingQuote && (
      <FieldDescription className="text-xs">
        {controller.supplierQuoteCodePreview
          ? controller.t('sales:supplierQuotes.autoCodePreviewDescription', {
              preview: controller.supplierQuoteCodePreview,
              defaultValue: 'Leave blank to generate {{preview}} from the document code template.',
            })
          : controller.t('sales:supplierQuotes.autoCodeDescription', {
              defaultValue: 'Leave blank to generate the next code automatically.',
            })}
      </FieldDescription>
    )}
  </Field>
);

const SupplierQuotePaymentTermsField: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <Field>
    <SelectControl
      id="supplier-quote-payment-terms"
      options={controller.paymentTermsOptions}
      value={controller.formData.paymentTerms || 'immediate'}
      onChange={(value) =>
        controller.dispatch({
          type: 'patchFormData',
          value: { paymentTerms: value as SupplierQuote['paymentTerms'] },
        })
      }
      searchable={false}
      disabled={controller.isReadOnly}
      label={controller.t('sales:supplierQuotes.paymentTerms', {
        defaultValue: 'Payment Terms',
      })}
      buttonClassName="h-9"
    />
  </Field>
);

const SupplierQuoteCommunicationField: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <Field data-invalid={Boolean(controller.errors.communicationChannelId)}>
    <QuoteCommunicationChannelField
      id="supplier-quote-communication-channel"
      channels={controller.communicationChannels}
      value={controller.formData.communicationChannelId || ''}
      error={controller.errors.communicationChannelId}
      disabled={controller.isReadOnly}
      canManage={controller.canManageCommunicationChannels}
      onChange={(value) => {
        const selected = controller.communicationChannels.find((channel) => channel.id === value);
        controller.dispatch({
          type: 'patchFormData',
          value: {
            communicationChannelId: value,
            communicationChannelName: selected?.name ?? '',
          },
        });
        if (controller.errors.communicationChannelId) {
          controller.dispatch({ type: 'clearError', key: 'communicationChannelId' });
        }
      }}
      onCreate={controller.onCreateCommunicationChannel}
      onUpdate={controller.onUpdateCommunicationChannel}
      onDelete={controller.onDeleteCommunicationChannel}
    />
  </Field>
);

const SupplierQuoteExpirationField: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <Field>
    <FieldLabel htmlFor="supplier-quote-expiration-date">
      {controller.t('sales:supplierQuotes.expirationDate', { defaultValue: 'Expiration Date' })}
    </FieldLabel>
    <DateField
      id="supplier-quote-expiration-date"
      value={controller.formData.expirationDate || ''}
      disabled={controller.isReadOnly && !controller.expirationEditableWhileReadOnly}
      onChange={(value) => handleSupplierQuoteExpirationChange(controller, value)}
    />
  </Field>
);

const handleSupplierQuoteExpirationChange = (
  controller: SupplierQuotesController,
  value: string,
): void => {
  controller.dispatch({ type: 'patchFormData', value: { expirationDate: value } });
  if (!(controller.expirationEditableWhileReadOnly && controller.editingQuote)) return;

  if (!value || isDateOnlyBeforeToday(value)) {
    toastError(
      controller.t('sales:supplierQuotes.errors.expirationExtendInvalid', {
        defaultValue: 'Set an expiration date of today or later to revalidate the supplier quote',
      }),
    );
    return;
  }

  Promise.resolve(
    controller.onUpdateQuote(controller.editingQuote.id, { expirationDate: value }),
  ).catch((err: unknown) => {
    toastError(
      (err as Error).message ||
        controller.t('sales:supplierQuotes.failedToSave', {
          defaultValue: 'Failed to save the supplier quote. Please retry.',
        }),
    );
    controller.dispatch({
      type: 'patchFormData',
      value: { expirationDate: controller.editingQuote?.expirationDate || '' },
    });
  });
};

const SupplierQuoteItemsSection: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => {
  const items = controller.formData.items;
  const getIndex = useMemo(() => createLineItemIndexResolver(items), [items]);
  const getContext = (item: SupplierQuoteItem) =>
    getSupplierQuoteItemContext(controller, item, getIndex(item));
  const columns: Column<SupplierQuoteItem>[] = [
    {
      id: 'product',
      header: controller.t('sales:supplierQuotes.product', { defaultValue: 'Product' }),
      minWidth: 244,
      accessorFn: (item) => item.productName || '',
      cell: ({ row }) => (
        <SupplierQuoteProductInput context={getContext(row)} className="min-w-[220px]" />
      ),
    },
    {
      id: 'listPrice',
      header: controller.t('sales:supplierQuotes.listPrice', { defaultValue: 'List Price' }),
      accessorFn: (item) => item.listPrice ?? item.unitPrice ?? 0,
      align: 'right',
      cell: ({ row }) => (
        <SupplierQuoteListPriceInput
          context={getContext(row)}
          className="flex min-w-[140px] items-center gap-1.5"
          inputClassName={`${controller.itemInputClassName} flex-1 text-right`}
        />
      ),
    },
    {
      id: 'discountPercent',
      header: controller.t('sales:supplierQuotes.discountToUs', {
        defaultValue: 'Discount to Us (%)',
      }),
      accessorFn: (item) => item.discountPercent ?? 0,
      align: 'right',
      cell: ({ row }) => (
        <SupplierQuoteDiscountInput
          context={getContext(row)}
          className="flex min-w-[120px] items-center justify-end gap-1"
          inputClassName={`${controller.itemInputClassName} max-w-[5rem] text-right`}
        />
      ),
    },
    {
      id: 'unitCost',
      header: controller.t('sales:supplierQuotes.unitCost', { defaultValue: 'Unit Cost' }),
      accessorFn: (item) => item.unitPrice ?? 0,
      align: 'right',
      cell: ({ row }) => (
        <SupplierQuoteUnitCostValue
          context={getContext(row)}
          className="flex min-w-[110px] items-center justify-end gap-1.5"
        />
      ),
    },
    {
      id: 'quantity',
      header: controller.t('sales:supplierQuotes.qty', { defaultValue: 'Qty' }),
      minWidth: 174,
      accessorKey: 'quantity',
      align: 'right',
      cell: ({ row }) => (
        <SupplierQuoteQuantityInput
          context={getContext(row)}
          className="flex min-w-[150px] items-center justify-end gap-1"
          inputClassName={`${controller.itemInputClassName} max-w-[5rem] text-right`}
        />
      ),
    },
    {
      id: 'duration',
      header: controller.t('sales:supplierQuotes.durationColumn', { defaultValue: 'Duration' }),
      minWidth: 174,
      accessorFn: (item) => getEffectiveDurationMonths(item),
      align: 'right',
      cell: ({ row }) => (
        <SupplierQuoteDurationInput
          context={getContext(row)}
          className="flex min-w-[150px] items-center justify-end gap-1"
          inputClassName="w-full max-w-[5rem] rounded-lg border border-zinc-200 bg-white px-1 py-2 text-right text-sm outline-none focus:ring-1 focus:ring-praetor disabled:cursor-not-allowed disabled:opacity-50"
        />
      ),
    },
    {
      id: 'total',
      header: controller.t('sales:supplierQuotes.total', { defaultValue: 'Total' }),
      accessorFn: (item) =>
        Number(item.quantity || 0) * Number(item.unitPrice || 0) * getEffectiveDurationMonths(item),
      align: 'right',
      cell: ({ row }) => (
        <SupplierQuoteLineTotalValue
          context={getContext(row)}
          className="flex min-w-[110px] items-center justify-end"
        />
      ),
    },
    {
      id: 'note',
      header: controller.t('common:labels.notes', { defaultValue: 'Notes' }),
      minWidth: LINE_ITEM_NOTE_COLUMN_MIN_WIDTH,
      accessorFn: (item) => item.note || '',
      cell: ({ row }) => (
        <div className={LINE_ITEM_NOTE_CELL_CLASSNAME}>
          <SupplierQuoteItemNoteField context={getContext(row)} />
        </div>
      ),
    },
    {
      id: 'actions',
      header: controller.t('common:labels.actions', { defaultValue: 'Actions' }),
      align: 'right',
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => controller.removeItem(getContext(row).index)}
          disabled={controller.isReadOnly}
          className="text-muted-foreground hover:text-destructive"
        >
          <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
          <span className="sr-only">{controller.t('common:buttons.delete')}</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SupplierQuoteSectionTitle>
          {controller.t('sales:supplierQuotes.items', { defaultValue: 'Items' })}
        </SupplierQuoteSectionTitle>
        {!controller.isReadOnly && (
          <Button type="button" size="sm" onClick={controller.addItem}>
            <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
            {controller.t('sales:supplierQuotes.addItem', { defaultValue: 'Add item' })}
          </Button>
        )}
      </div>
      {controller.errors.items && (
        <p className="ml-1 text-[10px] font-bold text-red-500">{controller.errors.items}</p>
      )}
      <StandardTable<SupplierQuoteItem>
        title={controller.t('sales:supplierQuotes.items', { defaultValue: 'Items' })}
        persistenceKey="sales.supplierQuotes.items"
        allowColumnHiding={false}
        data={items ?? []}
        columns={columns}
        defaultRowsPerPage={5}
        minBodyRows={0}
        tableContainerClassName="overflow-x-auto"
        emptyState={
          <div className="py-8 text-sm text-muted-foreground">
            {controller.t('sales:supplierQuotes.noItemsAdded', {
              defaultValue: 'No items added yet',
            })}
          </div>
        }
      />
    </div>
  );
};
interface SupplierQuoteItemContext {
  controller: SupplierQuotesController;
  item: SupplierQuoteItem;
  index: number;
  durationUnit: DurationUnit;
  durationValue?: number;
  isSupply: boolean;
  itemDiscountPercent?: number;
  isListPriceBlank: boolean;
  itemListPrice: number;
  itemUnitCost: number;
  lineTotal: number;
}

const getSupplierQuoteItemContext = (
  controller: SupplierQuotesController,
  item: SupplierQuoteItem,
  index: number,
): SupplierQuoteItemContext => {
  const itemListPrice = item.listPrice ?? item.unitPrice ?? 0;
  const itemDiscountPercent = Number.isFinite(Number(item.discountPercent))
    ? item.discountPercent
    : undefined;
  const itemUnitCost = item.unitPrice ?? 0;
  const durationUnit = normalizeDurationUnit(item.durationUnit);
  const durationValue = getDurationInputValue(item);
  const lineTotal = (Number(item.quantity) || 0) * itemUnitCost * getEffectiveDurationMonths(item);
  const itemProduct = item.productId
    ? controller.products.find((product) => product.id === item.productId)
    : undefined;

  return {
    controller,
    durationUnit,
    durationValue,
    index,
    isSupply: itemProduct?.type === 'supply',
    item,
    itemDiscountPercent,
    isListPriceBlank: controller.blankListPriceItemIds.has(item.id),
    itemListPrice,
    itemUnitCost,
    lineTotal,
  };
};
const SupplierQuoteFieldLabel: React.FC<{ children?: React.ReactNode }> = ({ children }) =>
  children ? (
    <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
      {children}
    </div>
  ) : null;

const SupplierQuoteProductInput: React.FC<{
  context: SupplierQuoteItemContext;
  className?: string;
  label?: React.ReactNode;
}> = ({ context, className, label }) => (
  <div className={className}>
    <SupplierQuoteFieldLabel>{label}</SupplierQuoteFieldLabel>
    <Input
      type="text"
      value={context.item.productName || ''}
      disabled={context.controller.isReadOnly}
      onChange={(event) =>
        context.controller.updateItem(context.index, 'productName', event.target.value)
      }
      placeholder={context.controller.t('sales:supplierQuotes.product', {
        defaultValue: 'Product',
      })}
    />
  </div>
);

const SupplierQuoteQuantityInput: React.FC<{
  context: SupplierQuoteItemContext;
  className?: string;
  inputClassName?: string;
  label?: React.ReactNode;
  wrapperClassName?: string;
}> = ({ context, className, inputClassName, label, wrapperClassName }) => (
  <div className={wrapperClassName}>
    <SupplierQuoteFieldLabel>{label}</SupplierQuoteFieldLabel>
    <div className={className}>
      <ValidatedNumberInput
        value={context.item.quantity}
        required
        placeholder="0,00"
        aria-label={context.controller.t('sales:supplierQuotes.qty', { defaultValue: 'Qty' })}
        onValueChange={(value) =>
          context.controller.updateItem(
            context.index,
            'quantity',
            parseNumberInputValue(value, Number.NaN),
          )
        }
        disabled={context.controller.isReadOnly}
        className={cn('min-w-[4rem]', inputClassName)}
      />
      <span className="text-xs font-semibold text-zinc-400 shrink-0">/</span>
      <UnitTypeSelector
        value={context.item.unitType || 'unit'}
        onChange={(value) => context.controller.handleUnitTypeChange(context.index, value)}
        isSupply={context.isSupply}
        quantity={Number(context.item.quantity) || 0}
        disabled={context.controller.isReadOnly}
        i18nPrefix="sales:supplierQuotes"
      />
    </div>
  </div>
);

const SupplierQuoteDurationInput: React.FC<{
  context: SupplierQuoteItemContext;
  className?: string;
  inputClassName?: string;
  label?: React.ReactNode;
  wrapperClassName?: string;
}> = ({ context, className, inputClassName, label, wrapperClassName }) => (
  <div className={wrapperClassName}>
    {label && (
      <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1">
        {label}
        <FieldTooltip
          description={context.controller.t('sales:fieldInfo.duration', {
            defaultValue: 'Number of months the service runs',
          })}
          status={context.controller.readOnlyStatus}
          statusLabel={context.controller.statusLabel}
        />
      </div>
    )}
    <div className={className ?? 'flex items-center gap-1'}>
      <ValidatedNumberInput
        step="1"
        min="1"
        placeholder="0"
        aria-label={context.controller.t('sales:supplierQuotes.durationColumn', {
          defaultValue: 'Duration',
        })}
        value={context.durationValue}
        onValueChange={(value) =>
          context.controller.handleDurationValueChange(context.index, value)
        }
        disabled={context.controller.isReadOnly || context.durationUnit === 'na'}
        className={inputClassName}
      />
      <span className="text-[9px] font-semibold text-zinc-400 shrink-0">/</span>
      <DurationUnitSelector
        value={context.durationUnit}
        onChange={(value) => context.controller.handleDurationUnitChange(context.index, value)}
        count={context.durationValue ?? 0}
        disabled={context.controller.isReadOnly}
        i18nPrefix="sales:supplierQuotes"
      />
    </div>
  </div>
);

const SupplierQuoteListPriceInput: React.FC<{
  context: SupplierQuoteItemContext;
  className?: string;
  inputClassName?: string;
  label?: React.ReactNode;
}> = ({ context, className, inputClassName, label }) => (
  <div className={className}>
    <SupplierQuoteFieldLabel>{label}</SupplierQuoteFieldLabel>
    <div className="flex items-center gap-1">
      <ValidatedNumberInput
        value={context.isListPriceBlank ? '' : context.itemListPrice}
        formatDecimals={2}
        aria-required="true"
        placeholder="0,00"
        aria-label={context.controller.t('sales:supplierQuotes.listPrice', {
          defaultValue: 'List Price',
        })}
        onValueChange={(value) => context.controller.updateItem(context.index, 'listPrice', value)}
        disabled={context.controller.isReadOnly}
        className={inputClassName}
      />
      <span className="text-xs font-semibold text-zinc-400 shrink-0 whitespace-nowrap">
        {context.controller.currency}
      </span>
    </div>
  </div>
);

const SupplierQuoteDiscountInput: React.FC<{
  context: SupplierQuoteItemContext;
  className?: string;
  inputClassName?: string;
  label?: React.ReactNode;
}> = ({ context, className, inputClassName, label }) => (
  <div className={className}>
    <SupplierQuoteFieldLabel>{label}</SupplierQuoteFieldLabel>
    <div className="flex items-center gap-1">
      <ValidatedNumberInput
        value={context.itemDiscountPercent}
        placeholder="0,00"
        aria-label={context.controller.t('sales:supplierQuotes.discountToUs', {
          defaultValue: 'Discount to Us',
        })}
        min={0}
        max={100}
        onValueChange={(value) =>
          context.controller.updateItem(
            context.index,
            'discountPercent',
            parseNumberInputValue(value, Number.NaN),
          )
        }
        disabled={context.controller.isReadOnly}
        className={inputClassName}
      />
      <span className="text-xs font-semibold text-zinc-400 shrink-0">%</span>
    </div>
  </div>
);

const SupplierQuoteUnitCostValue: React.FC<{
  context: SupplierQuoteItemContext;
  className?: string;
  label?: React.ReactNode;
}> = ({ context, className, label }) => (
  <div className={className}>
    <SupplierQuoteFieldLabel>{label}</SupplierQuoteFieldLabel>
    <div className="text-xs font-bold text-zinc-700 whitespace-nowrap">
      {formatDecimal(context.itemUnitCost)} {context.controller.currency}
    </div>
  </div>
);

const SupplierQuoteLineTotalValue: React.FC<{
  context: SupplierQuoteItemContext;
  className?: string;
  label?: React.ReactNode;
}> = ({ context, className, label }) => (
  <div className={className}>
    <SupplierQuoteFieldLabel>{label}</SupplierQuoteFieldLabel>
    <span className="text-sm font-bold text-zinc-800 whitespace-nowrap">
      {formatDecimal(context.lineTotal)} {context.controller.currency}
    </span>
  </div>
);

const SupplierQuoteItemNoteField: React.FC<{ context: SupplierQuoteItemContext }> = ({
  context,
}) => (
  <div>
    <LineItemNoteTextarea
      value={context.item.note || ''}
      disabled={context.controller.isReadOnly}
      onChange={(event) => context.controller.updateItem(context.index, 'note', event.target.value)}
      placeholder={context.controller.t('form:placeholderNotes', { defaultValue: 'Notes' })}
    />
  </div>
);

const SupplierQuoteAttachmentsArea: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => {
  if (controller.editingQuote?.id && controller.previewVersion === null) {
    return (
      <SupplierQuoteAttachmentsSection
        quoteId={controller.editingQuote.id}
        isReadOnly={controller.baseReadOnly}
        readOnlyStatus={controller.readOnlyStatus}
        statusLabel={controller.statusLabel}
      />
    );
  }

  if (controller.editingQuote) return null;

  return (
    <SupplierQuoteAttachmentsStaging
      files={controller.stagedAttachments}
      onAdd={(file) => controller.dispatch({ type: 'addStagedAttachment', file })}
      onRemove={(index) => controller.dispatch({ type: 'removeStagedAttachment', index })}
      disabled={controller.isSubmitting}
      readOnlyStatus={controller.readOnlyStatus}
      statusLabel={controller.statusLabel}
    />
  );
};

const SupplierQuoteNotesSummarySection: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => {
  const { t } = controller;

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
      <Field className="w-full md:w-2/3">
        <SupplierQuoteSectionTitle
          description={t('sales:fieldInfo.notes', {
            defaultValue: 'Additional notes for the entire document',
          })}
          status={controller.readOnlyStatus}
          statusLabel={controller.statusLabel}
        >
          {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
        </SupplierQuoteSectionTitle>
        <FieldLabel htmlFor="supplier-quote-notes" className="sr-only">
          {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
        </FieldLabel>
        <Textarea
          id="supplier-quote-notes"
          rows={4}
          value={controller.formData.notes || ''}
          disabled={controller.isReadOnly}
          placeholder={controller.t('form:placeholderNotes', { defaultValue: 'Optional notes...' })}
          onChange={(event) =>
            controller.dispatch({ type: 'patchFormData', value: { notes: event.target.value } })
          }
          className="min-h-28 resize-none"
        />
      </Field>

      <div className="w-full space-y-2 md:w-1/3">
        <SupplierQuoteSectionTitle>
          {controller.t('sales:supplierQuotes.summary', { defaultValue: 'Summary' })}
        </SupplierQuoteSectionTitle>
        <CostSummaryPanel
          currency={controller.currency}
          subtotal={controller.totalsBreakdown.subtotal}
          total={controller.totalsBreakdown.total}
          subtotalLabel={controller.t('sales:supplierQuotes.subtotal', {
            defaultValue: 'Subtotal',
          })}
          discountRow={{
            label: controller.t('sales:supplierQuotes.discountAmount', {
              defaultValue: 'Discount',
            }),
            amount: controller.totalsBreakdown.discountAmount,
          }}
          totalLabel={controller.t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
        />
      </div>
    </div>
  );
};

const SupplierQuoteModalFooter: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <ModalFooter>
    <Button type="button" variant="outline" onClick={controller.closeModal}>
      {controller.t('common:buttons.cancel', { defaultValue: 'Cancel' })}
    </Button>
    {!controller.isReadOnly && (
      <Button type="submit" disabled={controller.isSubmitting}>
        {controller.isSubmitting
          ? controller.t('common:buttons.saving')
          : controller.editingQuote
            ? controller.t('common:buttons.update', { defaultValue: 'Update' })
            : controller.t('common:buttons.save', { defaultValue: 'Save' })}
      </Button>
    )}
  </ModalFooter>
);

const SupplierQuotesDeleteDialog: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <DeleteConfirmModal
    isOpen={controller.isDeleteConfirmOpen}
    onClose={() => {
      if (controller.isDeleting) return;
      controller.dispatch({ type: 'setIsDeleteConfirmOpen', value: false });
    }}
    onConfirm={async () => {
      if (!controller.quoteToDelete || controller.isDeleting) return;
      controller.dispatch({ type: 'setIsDeleting', value: true });
      try {
        await controller.onDeleteQuote(controller.quoteToDelete.id);
        controller.dispatch({ type: 'setIsDeleteConfirmOpen', value: false });
        controller.dispatch({ type: 'setQuoteToDelete', value: null });
      } catch (err) {
        toastError((err as Error).message || controller.t('sales:supplierQuotes.failedToDelete'));
      } finally {
        controller.dispatch({ type: 'setIsDeleting', value: false });
      }
    }}
    isDeleting={controller.isDeleting}
    title={controller.t('sales:supplierQuotes.deleteTitle', {
      defaultValue: 'Delete supplier quote?',
    })}
    description={controller.quoteToDelete?.id ?? ''}
  />
);

const SupplierQuotesHeader: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <div className="space-y-4">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-800">
          {controller.t('sales:supplierQuotes.title', { defaultValue: 'Supplier Quotes' })}
        </h2>
        <p className="text-zinc-500 text-sm">
          {controller.t('sales:supplierQuotes.subtitle', {
            defaultValue: 'Quotes that can be converted into supplier orders.',
          })}
        </p>
      </div>
      <HeaderAddButton onClick={controller.openAddModal}>
        {controller.t('sales:supplierQuotes.addQuote', { defaultValue: 'Add quote' })}
      </HeaderAddButton>
    </div>
  </div>
);

const SupplierQuotesTable: React.FC<{ controller: SupplierQuotesController }> = ({
  controller,
}) => (
  <StandardTable<SupplierQuote>
    title={controller.t('sales:supplierQuotes.activeQuotes', { defaultValue: 'Active Quotes' })}
    data={controller.quotes}
    columns={controller.columns}
    defaultRowsPerPage={5}
    onRowClick={(row) => {
      if (controller.canOpenQuoteModal(row)) {
        controller.openEditModal(row);
      }
    }}
    rowClassName={(row) => {
      const history = controller.isHistoryRow(row);
      const cursorClass = controller.canOpenQuoteModal(row)
        ? 'cursor-pointer'
        : 'cursor-not-allowed';
      return history
        ? `bg-zinc-50 text-zinc-400 hover:bg-zinc-100 ${cursorClass}`
        : `hover:bg-zinc-50/50 ${cursorClass}`;
    }}
    initialFilterState={controller.tableInitialFilterState}
  />
);

export default SupplierQuotesView;
