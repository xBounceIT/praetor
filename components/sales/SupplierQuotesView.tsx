import type React from 'react';
import { useCallback, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import {
  convertUnitPrice,
  durationValueToMonths,
  getDurationDisplayValue,
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
    grossListTotal += item.quantity * listPrice * durationMonths;
    netTotal += item.quantity * item.unitPrice * durationMonths;
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
  | { type: 'updateItem'; index: number; field: keyof SupplierQuoteItem; value: string | number }
  | { type: 'addItem'; item: SupplierQuoteItem }
  | { type: 'removeItem'; index: number }
  | { type: 'setItem'; index: number; item: SupplierQuoteItem }
  | { type: 'addStagedAttachment'; file: File }
  | { type: 'removeStagedAttachment'; index: number };

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
    case 'clearError': {
      const next = { ...state.errors };
      delete next[action.key];
      return { ...state, errors: next };
    }
    case 'setFormData':
      return { ...state, formData: action.value };
    case 'patchFormData':
      return { ...state, formData: { ...state.formData, ...action.value } };
    case 'setPreviewVersion':
      return { ...state, previewVersion: action.value };
    case 'setIsSubmitting':
      return { ...state, isSubmitting: action.value };
    case 'setIsDeleting':
      return { ...state, isDeleting: action.value };
    case 'closeModal':
      return { ...state, isModalOpen: false, previewVersion: null, stagedAttachments: [] };
    case 'openAddModal':
      return {
        ...state,
        editingQuote: null,
        formData: getDefaultFormData(),
        errors: {},
        previewVersion: null,
        isModalOpen: true,
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
        // A persisted quote uses the live attachments section, not staging; drop any stale queue.
        stagedAttachments: [],
      };
    case 'previewVersion':
      return {
        ...state,
        previewVersion: action.version,
        formData: action.formData,
        errors: {},
      };
    case 'restoreVersion':
      return {
        ...state,
        editingQuote: action.quote,
        formData: action.formData,
        previewVersion: null,
      };
    case 'updateItem': {
      const items = [...(state.formData.items || [])];
      const current = items[action.index];
      if (!current) return state;
      const next = { ...current, [action.field]: action.value };
      // Prezzo listino / Sconto a noi edits re-derive the whole line at the persisted DB scale in
      // the same update, so the rounded list price/discount and the net cost — and every total that
      // reads them — stay in lockstep with what the server will store.
      if (action.field === 'listPrice' || action.field === 'discountPercent') {
        const pricing = deriveLinePricing(next.listPrice, next.discountPercent);
        next.listPrice = pricing.listPrice;
        next.discountPercent = pricing.discountPercent;
        next.unitPrice = pricing.unitPrice;
      }
      items[action.index] = next;
      return { ...state, formData: { ...state.formData, items } };
    }
    case 'addItem':
      return {
        ...state,
        formData: { ...state.formData, items: [...(state.formData.items || []), action.item] },
      };
    case 'removeItem': {
      const items = [...(state.formData.items || [])];
      items.splice(action.index, 1);
      return { ...state, formData: { ...state.formData, items } };
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

const SupplierQuotesView: React.FC<SupplierQuotesViewProps> = ({
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
}) => {
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
    stagedAttachments,
  } = state;

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
    (index: number, field: keyof SupplierQuoteItem, value: string | number) => {
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
        id: `tmp-${Date.now()}`,
        quoteId: editingQuote?.id || '',
        productName: '',
        quantity: 1,
        listPrice: 0,
        discountPercent: 0,
        unitPrice: 0,
        unitType: 'unit' as const,
        durationMonths: 1,
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
    updateItem(index, 'durationMonths', parseDurationValueToMonths(value, unit));
  };

  const handleDurationUnitChange = (index: number, newUnit: DurationUnit) => {
    if (isReadOnly) return;
    const item = formData.items?.[index];
    if (!item || normalizeDurationUnit(item.durationUnit) === newUnit) return;
    // Switching to 'na' (N/A) drops the multiplier to a single month — the value input is disabled
    // and the line never multiplies (issue #775). Other units convert the displayed value to months.
    const durationMonths =
      newUnit === 'na' ? 1 : durationValueToMonths(getDurationDisplayValue(item), newUnit);
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
              {total.toFixed(2)} {currency}
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
    if (!formData.id?.trim()) {
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
    }

    if (Object.keys(nextErrors).length > 0) {
      dispatch({ type: 'setErrors', value: nextErrors });
      return;
    }

    const payload: Partial<SupplierQuote> = {
      ...formData,
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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={closeModal}>
        <div className="flex max-w-[calc(100vw-2rem)] items-start gap-4">
          <ModalContent size="full" className="max-h-[90vh]">
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <ModalHeader>
                <ModalTitle className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                    <i
                      className={`fa-solid ${
                        isReadOnly ? 'fa-eye' : editingQuote ? 'fa-pen-to-square' : 'fa-plus'
                      }`}
                      aria-hidden="true"
                    ></i>
                  </span>
                  {isReadOnly
                    ? t('sales:supplierQuotes.viewQuote', { defaultValue: 'View quote' })
                    : editingQuote
                      ? t('sales:supplierQuotes.editQuote', { defaultValue: 'Edit quote' })
                      : t('sales:supplierQuotes.newQuote', { defaultValue: 'New quote' })}
                </ModalTitle>
                <ModalCloseButton onClick={closeModal} />
              </ModalHeader>

              <ModalBody className="flex-1 space-y-5">
                {previewVersion && (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
                    <span className="text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-2">
                      <i className="fa-solid fa-clock-rotate-left"></i>
                      {t('sales:supplierQuotes.versionHistory.previewBanner', {
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
                      {t('sales:supplierQuotes.versionHistory.backToCurrent', {
                        defaultValue: 'Back to current',
                      })}
                    </Button>
                  </div>
                )}
                {baseReadOnly && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
                    <span className="text-amber-700 dark:text-amber-300 text-xs font-bold">
                      {readOnlyReason}
                    </span>
                  </div>
                )}
                {editingQuote?.linkedOrderId && (
                  <LinkedRecordBanner
                    label={t('sales:supplierQuotes.linkedOrderTitle', {
                      defaultValue: 'Linked Order',
                    })}
                    value={t('sales:supplierQuotes.linkedOrderInfo', {
                      number: editingQuote.linkedOrderId,
                      defaultValue: 'Order #{{number}}',
                    })}
                    note={t('sales:supplierQuotes.orderDetailsReadOnly', {
                      defaultValue: '(Quote details are read-only)',
                    })}
                    action={
                      onViewOrders
                        ? {
                            label: t('sales:supplierQuotes.viewOrder', {
                              defaultValue: 'View Order',
                            }),
                            onClick: () => onViewOrders(editingQuote.id),
                          }
                        : undefined
                    }
                  />
                )}

                <div className="space-y-2">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="size-1.5 rounded-full bg-primary"></span>
                    {t('sales:supplierQuotes.supplierInformation', {
                      defaultValue: 'Supplier Information',
                    })}
                    <FieldTooltip
                      description={t('sales:fieldInfo.supplierInformation', {
                        defaultValue: 'Supplier and document details',
                      })}
                      status={readOnlyStatus}
                      statusLabel={statusLabel}
                    />
                  </h4>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <Field data-invalid={Boolean(errors.supplierId)}>
                      <SelectControl
                        id="supplier-quote-supplier"
                        options={activeSuppliers.map((supplier) => ({
                          id: supplier.id,
                          name: supplier.name,
                        }))}
                        value={formData.supplierId || ''}
                        onChange={(value) => handleSupplierChange(value as string)}
                        placeholder={t('sales:supplierQuotes.selectSupplier', {
                          defaultValue: 'Select a supplier',
                        })}
                        searchable={true}
                        disabled={isReadOnly}
                        label={t('sales:supplierQuotes.supplier', { defaultValue: 'Supplier' })}
                        required
                        buttonClassName="h-9"
                        className={errors.supplierId ? 'border-red-300' : ''}
                      />
                      <FieldError className="text-xs">{errors.supplierId}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(errors.clientId)}>
                      <SelectControl
                        id="supplier-quote-client"
                        options={clientOptions}
                        value={formData.clientId || ''}
                        onChange={(value) => handleClientChange(value as string)}
                        placeholder={t('sales:supplierQuotes.selectClient', {
                          defaultValue: 'Select a customer',
                        })}
                        searchable={true}
                        disabled={isReadOnly}
                        label={t('sales:supplierQuotes.client', { defaultValue: 'Customer' })}
                        required
                        buttonClassName="h-9"
                        className={errors.clientId ? 'border-red-300' : ''}
                      />
                      <FieldError className="text-xs">{errors.clientId}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(errors.id)}>
                      <FieldLabel htmlFor="supplier-quote-code" required>
                        {t('sales:supplierQuotes.quoteCode', { defaultValue: 'Quote Code' })}
                      </FieldLabel>
                      <Input
                        id="supplier-quote-code"
                        type="text"
                        value={formData.id || ''}
                        disabled={isReadOnly}
                        onChange={(event) => {
                          dispatch({ type: 'patchFormData', value: { id: event.target.value } });
                          if (errors.id) {
                            dispatch({ type: 'clearError', key: 'id' });
                          }
                        }}
                        className={errors.id ? 'border-red-300' : ''}
                        aria-invalid={Boolean(errors.id)}
                      />
                      <FieldError className="text-xs">{errors.id}</FieldError>
                    </Field>
                    <Field>
                      <SelectControl
                        id="supplier-quote-payment-terms"
                        options={paymentTermsOptions}
                        value={formData.paymentTerms || 'immediate'}
                        onChange={(value) =>
                          dispatch({
                            type: 'patchFormData',
                            value: { paymentTerms: value as SupplierQuote['paymentTerms'] },
                          })
                        }
                        searchable={false}
                        disabled={isReadOnly}
                        label={t('sales:supplierQuotes.paymentTerms', {
                          defaultValue: 'Payment Terms',
                        })}
                        buttonClassName="h-9"
                      />
                    </Field>
                    <Field data-invalid={Boolean(errors.communicationChannelId)}>
                      <QuoteCommunicationChannelField
                        id="supplier-quote-communication-channel"
                        channels={communicationChannels}
                        value={formData.communicationChannelId || ''}
                        error={errors.communicationChannelId}
                        disabled={isReadOnly}
                        canManage={canManageCommunicationChannels}
                        onChange={(value) => {
                          const selected = communicationChannels.find(
                            (channel) => channel.id === value,
                          );
                          dispatch({
                            type: 'patchFormData',
                            value: {
                              communicationChannelId: value,
                              communicationChannelName: selected?.name ?? '',
                            },
                          });
                          if (errors.communicationChannelId) {
                            dispatch({ type: 'clearError', key: 'communicationChannelId' });
                          }
                        }}
                        onCreate={onCreateCommunicationChannel}
                        onUpdate={onUpdateCommunicationChannel}
                        onDelete={onDeleteCommunicationChannel}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="supplier-quote-expiration-date">
                        {t('sales:supplierQuotes.expirationDate', {
                          defaultValue: 'Expiration Date',
                        })}
                      </FieldLabel>
                      <DateField
                        id="supplier-quote-expiration-date"
                        value={formData.expirationDate || ''}
                        // Editable while synced/expired so the supplier quote can be revalidated
                        // (and the linked client quote unblocked) — issue #779.
                        disabled={isReadOnly && !expirationEditableWhileReadOnly}
                        onChange={(value) => {
                          dispatch({ type: 'patchFormData', value: { expirationDate: value } });
                          // When the form is read-only except the expiration (synced/expired/
                          // non-draft, #779), the quote has no submit button — so picking a date
                          // saves immediately as an "extend validity" action that re-syncs the
                          // linked client quote and clears its expired-supplier block.
                          if (expirationEditableWhileReadOnly && editingQuote) {
                            // Revalidation needs a date from today onward; a cleared or past date
                            // would leave the quote expired — say so instead of silently saving.
                            if (!value || isDateOnlyBeforeToday(value)) {
                              toastError(
                                t('sales:supplierQuotes.errors.expirationExtendInvalid', {
                                  defaultValue:
                                    'Set an expiration date of today or later to revalidate the supplier quote',
                                }),
                              );
                              return;
                            }
                            // onUpdateQuote may return void or a promise; normalize so a rejection
                            // is surfaced rather than swallowed.
                            Promise.resolve(
                              onUpdateQuote(editingQuote.id, { expirationDate: value }),
                            ).catch((err: unknown) => {
                              // Surface the failure and resync the field — the optimistic patch
                              // above already painted the new date into the form.
                              toastError(
                                (err as Error).message ||
                                  t('sales:supplierQuotes.failedToSave', {
                                    defaultValue:
                                      'Failed to save the supplier quote. Please retry.',
                                  }),
                              );
                              dispatch({
                                type: 'patchFormData',
                                value: { expirationDate: editingQuote.expirationDate || '' },
                              });
                            });
                          }
                        }}
                      />
                    </Field>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('sales:supplierQuotes.items', { defaultValue: 'Items' })}
                      <FieldTooltip
                        description={t('sales:fieldInfo.supplierItems', {
                          defaultValue: 'Line items for this quote',
                        })}
                        status={readOnlyStatus}
                        statusLabel={statusLabel}
                      />
                    </h4>
                    {!isReadOnly && (
                      <Button type="button" size="sm" onClick={addItem}>
                        <i className="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                        {t('sales:supplierQuotes.addItem', { defaultValue: 'Add item' })}
                      </Button>
                    )}
                  </div>
                  {errors.items && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
                  )}

                  {formData.items && formData.items.length > 0 && (
                    <div className="hidden lg:flex gap-2 px-3 mb-1 items-center">
                      <div className="flex-1 min-w-0 grid grid-cols-16 gap-2">
                        <div className="col-span-6 text-[10px] font-black text-zinc-400 uppercase tracking-wider ml-1">
                          {t('sales:supplierQuotes.product', { defaultValue: 'Product' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider ml-1">
                          {t('sales:supplierQuotes.listPrice', { defaultValue: 'List Price' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:supplierQuotes.discountToUs', {
                            defaultValue: 'Discount to Us (%)',
                          })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:supplierQuotes.unitCost', { defaultValue: 'Unit Cost' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:supplierQuotes.qty', { defaultValue: 'Qty' })}
                        </div>
                        <div className="col-span-2 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-center">
                          {t('sales:supplierQuotes.durationColumn', { defaultValue: 'Duration' })}
                        </div>
                      </div>
                      <div className="w-24 shrink-0 text-[10px] font-black text-zinc-400 uppercase tracking-wider text-right">
                        {t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                      </div>
                      <div className="w-10 shrink-0" />
                    </div>
                  )}

                  {formData.items && formData.items.length > 0 ? (
                    <div className="space-y-3">
                      {formData.items.map((item, index) => {
                        // Display with legacy fallbacks: rows/snapshots that predate list price use
                        // the stored net unit price as the list price (with no discount).
                        const itemListPrice = item.listPrice ?? item.unitPrice ?? 0;
                        const itemDiscountPercent = item.discountPercent ?? 0;
                        const itemUnitCost = item.unitPrice ?? 0;
                        // Duration multiplies the line total alongside quantity (issue #776).
                        const durationMonths = getEffectiveDurationMonths(item);
                        const lineTotal = item.quantity * itemUnitCost * durationMonths;
                        // Duration is stored as canonical months; show it in the item's unit.
                        const durationUnit = normalizeDurationUnit(item.durationUnit);
                        const durationValue = getDurationDisplayValue(item);
                        const itemProduct = item.productId
                          ? products.find((p) => p.id === item.productId)
                          : undefined;
                        const isSupply = itemProduct?.type === 'supply';
                        return (
                          <div
                            key={item.id}
                            className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
                          >
                            <div className="lg:hidden flex items-start gap-3">
                              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                    {t('sales:supplierQuotes.product', { defaultValue: 'Product' })}
                                  </div>
                                  <Input
                                    type="text"
                                    value={item.productName || ''}
                                    disabled={isReadOnly}
                                    onChange={(event) =>
                                      updateItem(index, 'productName', event.target.value)
                                    }
                                    placeholder={t('sales:supplierQuotes.product', {
                                      defaultValue: 'Product',
                                    })}
                                  />
                                </div>
                                <div>
                                  <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                    {t('sales:supplierQuotes.qty', { defaultValue: 'Qty' })}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <ValidatedNumberInput
                                      value={item.quantity}
                                      onValueChange={(value) =>
                                        updateItem(index, 'quantity', parseNumberInputValue(value))
                                      }
                                      disabled={isReadOnly}
                                      className={`${itemInputClassName} text-center flex-1`}
                                    />
                                    <span className="text-xs font-semibold text-zinc-400 shrink-0">
                                      /
                                    </span>
                                    <UnitTypeSelector
                                      value={item.unitType || 'unit'}
                                      onChange={(val) => handleUnitTypeChange(index, val)}
                                      isSupply={isSupply}
                                      quantity={Number(item.quantity) || 0}
                                      disabled={isReadOnly}
                                      i18nPrefix="sales:supplierQuotes"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <div className="mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                    {t('sales:supplierQuotes.durationColumn', {
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
                                      placeholder={t('sales:supplierQuotes.durationColumn', {
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
                                      i18nPrefix="sales:supplierQuotes"
                                    />
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
                            <div className="grid grid-cols-2 gap-3 lg:hidden">
                              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                  {t('sales:supplierQuotes.listPrice', {
                                    defaultValue: 'List Price',
                                  })}
                                </div>
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={itemListPrice}
                                    formatDecimals={2}
                                    onValueChange={(value) =>
                                      updateItem(index, 'listPrice', parseNumberInputValue(value))
                                    }
                                    disabled={isReadOnly}
                                    className="w-full text-sm p-2 bg-white border border-zinc-200 rounded-lg focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                  />
                                  <span className="text-[9px] font-semibold text-zinc-400 shrink-0">
                                    {currency}
                                  </span>
                                </div>
                              </div>
                              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                  {t('sales:supplierQuotes.discountToUs', {
                                    defaultValue: 'Discount to Us (%)',
                                  })}
                                </div>
                                <div className="flex items-center gap-1">
                                  <ValidatedNumberInput
                                    value={itemDiscountPercent}
                                    min={0}
                                    max={100}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'discountPercent',
                                        parseNumberInputValue(value),
                                      )
                                    }
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
                                  {t('sales:supplierQuotes.unitCost', {
                                    defaultValue: 'Unit Cost',
                                  })}
                                </div>
                                <div className="text-xs font-bold text-zinc-700 whitespace-nowrap">
                                  {itemUnitCost.toFixed(2)} {currency}
                                </div>
                              </div>
                              <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 space-y-1">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                  {t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                                </div>
                                <div className="text-xs font-bold text-zinc-700 whitespace-nowrap">
                                  {lineTotal.toFixed(2)} {currency}
                                </div>
                              </div>
                            </div>
                            <div className="hidden lg:flex gap-2 items-center">
                              <div className="flex-1 min-w-0 grid grid-cols-16 gap-2 items-center">
                                <div className="col-span-6">
                                  <Input
                                    type="text"
                                    value={item.productName || ''}
                                    disabled={isReadOnly}
                                    onChange={(event) =>
                                      updateItem(index, 'productName', event.target.value)
                                    }
                                    placeholder={t('sales:supplierQuotes.product', {
                                      defaultValue: 'Product',
                                    })}
                                  />
                                </div>
                                <div className="col-span-2 flex items-center gap-1.5">
                                  <ValidatedNumberInput
                                    value={itemListPrice}
                                    formatDecimals={2}
                                    onValueChange={(value) =>
                                      updateItem(index, 'listPrice', parseNumberInputValue(value))
                                    }
                                    disabled={isReadOnly}
                                    className={`${itemInputClassName} flex-1 text-right`}
                                  />
                                  <span className="text-xs font-semibold text-zinc-400 shrink-0 whitespace-nowrap">
                                    {currency}
                                  </span>
                                </div>
                                <div className="col-span-2 flex items-center justify-center gap-1">
                                  <ValidatedNumberInput
                                    value={itemDiscountPercent}
                                    min={0}
                                    max={100}
                                    onValueChange={(value) =>
                                      updateItem(
                                        index,
                                        'discountPercent',
                                        parseNumberInputValue(value),
                                      )
                                    }
                                    disabled={isReadOnly}
                                    className={`${itemInputClassName} text-center max-w-[5rem]`}
                                  />
                                  <span className="text-xs font-semibold text-zinc-400 shrink-0">
                                    %
                                  </span>
                                </div>
                                <div className="col-span-2 flex items-center justify-center gap-1.5">
                                  <span className="text-sm font-semibold text-zinc-700 whitespace-nowrap tabular-nums">
                                    {itemUnitCost.toFixed(2)}
                                  </span>
                                  <span className="text-xs font-semibold text-zinc-400 shrink-0 whitespace-nowrap">
                                    {currency}
                                  </span>
                                </div>
                                <div className="col-span-2 flex items-center justify-center gap-1">
                                  <ValidatedNumberInput
                                    value={item.quantity}
                                    onValueChange={(value) =>
                                      updateItem(index, 'quantity', parseNumberInputValue(value))
                                    }
                                    disabled={isReadOnly}
                                    className={`${itemInputClassName} text-center max-w-[5rem]`}
                                  />
                                  <span className="text-xs font-semibold text-zinc-400 shrink-0">
                                    /
                                  </span>
                                  <UnitTypeSelector
                                    value={item.unitType || 'unit'}
                                    onChange={(val) => handleUnitTypeChange(index, val)}
                                    isSupply={isSupply}
                                    quantity={Number(item.quantity) || 0}
                                    disabled={isReadOnly}
                                    i18nPrefix="sales:supplierQuotes"
                                  />
                                </div>
                                <div className="col-span-2 flex items-center justify-center gap-1">
                                  <ValidatedNumberInput
                                    step="1"
                                    min="1"
                                    placeholder={t('sales:supplierQuotes.durationColumn', {
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
                                    i18nPrefix="sales:supplierQuotes"
                                  />
                                </div>
                              </div>
                              <div className="w-24 shrink-0 flex items-center justify-end">
                                <span className="text-sm font-bold text-zinc-800 whitespace-nowrap">
                                  {lineTotal.toFixed(2)} {currency}
                                </span>
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
                            <div>
                              <Input
                                type="text"
                                value={item.note || ''}
                                disabled={isReadOnly}
                                onChange={(event) => updateItem(index, 'note', event.target.value)}
                                placeholder={t('form:placeholderNotes', {
                                  defaultValue: 'Notes',
                                })}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                      {t('sales:supplierQuotes.noItemsAdded', {
                        defaultValue: 'No items added yet',
                      })}
                    </div>
                  )}
                </div>

                {editingQuote?.id && previewVersion === null ? (
                  <SupplierQuoteAttachmentsSection
                    quoteId={editingQuote.id}
                    isReadOnly={baseReadOnly}
                    readOnlyStatus={readOnlyStatus}
                    statusLabel={statusLabel}
                  />
                ) : (
                  !editingQuote && (
                    <SupplierQuoteAttachmentsStaging
                      files={stagedAttachments}
                      onAdd={(file) => dispatch({ type: 'addStagedAttachment', file })}
                      onRemove={(index) => dispatch({ type: 'removeStagedAttachment', index })}
                      disabled={isSubmitting}
                      readOnlyStatus={readOnlyStatus}
                      statusLabel={statusLabel}
                    />
                  )
                )}

                <div className="flex flex-col gap-4 border-t border-border pt-4 md:flex-row">
                  <Field className="w-full md:w-2/3">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
                      <FieldTooltip
                        description={t('sales:fieldInfo.notes', {
                          defaultValue: 'Additional notes for the entire document',
                        })}
                        status={readOnlyStatus}
                        statusLabel={statusLabel}
                      />
                    </h4>
                    <FieldLabel htmlFor="supplier-quote-notes" className="sr-only">
                      {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
                    </FieldLabel>
                    <Textarea
                      id="supplier-quote-notes"
                      rows={4}
                      value={formData.notes || ''}
                      disabled={isReadOnly}
                      placeholder={t('form:placeholderNotes', {
                        defaultValue: 'Optional notes...',
                      })}
                      onChange={(event) =>
                        dispatch({ type: 'patchFormData', value: { notes: event.target.value } })
                      }
                      className="min-h-28 resize-none"
                    />
                  </Field>

                  <div className="w-full space-y-2 md:w-1/3">
                    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                      <span className="size-1.5 rounded-full bg-primary"></span>
                      {t('sales:supplierQuotes.summary', { defaultValue: 'Summary' })}
                    </h4>
                    <CostSummaryPanel
                      currency={currency}
                      subtotal={totalsBreakdown.subtotal}
                      total={totalsBreakdown.total}
                      subtotalLabel={t('sales:supplierQuotes.subtotal', {
                        defaultValue: 'Subtotal',
                      })}
                      discountRow={{
                        label: t('sales:supplierQuotes.discountAmount', {
                          defaultValue: 'Discount',
                        }),
                        amount: totalsBreakdown.discountAmount,
                      }}
                      totalLabel={t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                    />
                  </div>
                </div>
              </ModalBody>

              <ModalFooter>
                <Button type="button" variant="outline" onClick={closeModal}>
                  {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
                </Button>
                {!isReadOnly && (
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting
                      ? t('common:buttons.saving')
                      : editingQuote
                        ? t('common:buttons.update', { defaultValue: 'Update' })
                        : t('common:buttons.save', { defaultValue: 'Save' })}
                  </Button>
                )}
              </ModalFooter>
            </form>
          </ModalContent>
          {editingQuote?.id && (
            <SupplierQuoteVersionsPanel
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

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          if (isDeleting) return;
          dispatch({ type: 'setIsDeleteConfirmOpen', value: false });
        }}
        onConfirm={async () => {
          if (!quoteToDelete) return;
          if (isDeleting) return;
          dispatch({ type: 'setIsDeleting', value: true });
          try {
            await onDeleteQuote(quoteToDelete.id);
            dispatch({ type: 'setIsDeleteConfirmOpen', value: false });
            dispatch({ type: 'setQuoteToDelete', value: null });
          } catch (err) {
            toastError((err as Error).message || t('sales:supplierQuotes.failedToDelete'));
          } finally {
            dispatch({ type: 'setIsDeleting', value: false });
          }
        }}
        isDeleting={isDeleting}
        title={t('sales:supplierQuotes.deleteTitle', { defaultValue: 'Delete supplier quote?' })}
        description={quoteToDelete?.id ?? ''}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">
              {t('sales:supplierQuotes.title', { defaultValue: 'Supplier Quotes' })}
            </h2>
            <p className="text-zinc-500 text-sm">
              {t('sales:supplierQuotes.subtitle', {
                defaultValue: 'Quotes that can be converted into supplier orders.',
              })}
            </p>
          </div>
          <HeaderAddButton onClick={openAddModal}>
            {t('sales:supplierQuotes.addQuote', { defaultValue: 'Add quote' })}
          </HeaderAddButton>
        </div>
      </div>

      <StandardTable<SupplierQuote>
        title={t('sales:supplierQuotes.activeQuotes', { defaultValue: 'Active Quotes' })}
        data={quotes}
        columns={columns}
        defaultRowsPerPage={5}
        onRowClick={(row) => {
          if (canOpenQuoteModal(row)) {
            openEditModal(row);
          }
        }}
        rowClassName={(row) => {
          const history = isHistoryRow(row);
          const cursorClass = canOpenQuoteModal(row) ? 'cursor-pointer' : 'cursor-not-allowed';
          return history
            ? `bg-zinc-50 text-zinc-400 hover:bg-zinc-100 ${cursorClass}`
            : `hover:bg-zinc-50/50 ${cursorClass}`;
        }}
        initialFilterState={tableInitialFilterState}
      />
    </div>
  );
};

export default SupplierQuotesView;
