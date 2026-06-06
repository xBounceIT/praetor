import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkedRecordBanner } from '@/components/shared/LinkedRecordBanner';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { normalizeQuoteItem } from '../../services/api/normalizers';
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
import { buildViewDeepLink } from '../../utils/hashCanonicalization';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  durationValueToMonths,
  formatDiscountValue,
  getDurationDisplayValue,
  getItemPricingContext,
  normalizeDurationUnit,
  parseDurationValueToMonths,
  parseNumberInputValue,
} from '../../utils/numbers';
import { getPaymentTermsOptions } from '../../utils/options';
import { makeCostUpdater, makeMolUpdater } from '../../utils/pricingHandlers';
import { toastError } from '../../utils/toast';
import CostSummaryPanel from '../shared/CostSummaryPanel';
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
import SupplierQuoteCostHint from '../shared/SupplierQuoteCostHint';
import UnitTypeSelector from '../shared/UnitTypeSelector';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';
import ProductSelectOrFallback from './ProductSelectOrFallback';
import QuoteVersionsPanel from './QuoteVersionsPanel';

export interface ClientQuotesViewProps {
  quotes: Quote[];
  clients: Client[];
  products: Product[];
  supplierQuotes: SupplierQuote[];
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
  notes: quote.notes || '',
});

// Per-line quick-view shortcut: opens the referenced supplier quote / product on
// its own pre-filtered page in a new browser tab, so the in-progress quote dialog
// stays open and untouched. Rendered only when the row actually references a record.
const QuickViewLinkButton: React.FC<{
  href: string;
  label: string;
  className?: string;
  iconClassName?: string;
}> = ({ href, label, className, iconClassName }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        asChild
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        className={cn('shrink-0 text-muted-foreground hover:text-primary', className)}
      >
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
        >
          <i
            className={cn('fa-solid fa-up-right-from-square text-[11px]', iconClassName)}
            aria-hidden="true"
          ></i>
          <span className="sr-only">{label}</span>
        </a>
      </Button>
    </TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>
);

const ClientQuotesView: React.FC<ClientQuotesViewProps> = ({
  quotes,
  clients,
  products,
  supplierQuotes,
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
      {
        id: 'accepted',
        name: t('sales:clientQuotes.statusAccepted', { defaultValue: 'Accepted' }),
      },
      { id: 'denied', name: t('sales:clientQuotes.statusDenied', { defaultValue: 'Denied' }) },
    ],
    [t],
  );

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
  const [pendingClientChange, setPendingClientChange] = useState<{
    clientId: string;
    clientName: string;
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const getStatusLabel = useCallback(
    (status: string) => {
      const option = STATUS_OPTIONS.find((o) => o.id === status);
      return option ? option.name : status;
    },
    [STATUS_OPTIONS],
  );

  const isExpired = useCallback(
    (expirationDate: string) => isDateOnlyBeforeToday(expirationDate),
    [],
  );

  const isQuoteExpired = useCallback(
    (quote: Quote) => {
      return (
        quote.status !== 'accepted' &&
        quote.status !== 'denied' &&
        quote.isExpired !== false &&
        (quote.isExpired === true || isExpired(quote.expirationDate))
      );
    },
    [isExpired],
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

  const [formData, setFormData] = useState<Partial<Quote>>(() => getDefaultFormData());
  const [previewVersion, setPreviewVersion] = useState<QuoteVersion | null>(null);
  const baseReadOnly = Boolean(
    editingQuote &&
      (editingQuote.linkedOfferId ||
        editingQuote.status === 'accepted' ||
        editingQuote.status === 'denied' ||
        // Backend stores 'confirmed' for finalized quotes (PUT and restore both 409 it).
        // The Quote type doesn't include this status today, but rows from the API can
        // have it - cast to compare without widening the union project-wide.
        (editingQuote.status as string) === 'confirmed'),
  );
  const isReadOnly = baseReadOnly || previewVersion !== null;

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

  const formatDiscountPercentage = useCallback((quote: Quote) => {
    if (quote.discountType !== 'currency') {
      return `${quote.discount}%`;
    }

    const { discountAmount, subtotal } = calculatePricingTotals(
      quote.items,
      quote.discount,
      'hours',
      quote.discountType,
    );
    if (subtotal <= 0) return '0%';

    return `${Number(((discountAmount / subtotal) * 100).toFixed(1))}%`;
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setPreviewVersion(null);
  }, []);

  const openAddModal = () => {
    setEditingQuote(null);
    setPendingClientChange(null);
    setFormData(getDefaultFormData());
    setErrors({});
    setPreviewVersion(null);
    setIsModalOpen(true);
  };

  const openEditModal = useCallback((quote: Quote) => {
    setEditingQuote(quote);
    setPendingClientChange(null);
    setFormData(quoteToFormData(quote));
    setErrors({});
    setPreviewVersion(null);
    setIsModalOpen(true);
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
        }),
      );
      setErrors({});
    },
    [editingQuote],
  );

  const handleClearPreview = useCallback(() => {
    if (editingQuote) setFormData(quoteToFormData(editingQuote));
    setPreviewVersion(null);
  }, [editingQuote]);

  const handleVersionRestored = useCallback(
    (updated: Quote) => {
      setEditingQuote(updated);
      setFormData(quoteToFormData(updated));
      setPreviewVersion(null);
      onQuoteRestored?.(updated);
    },
    [onQuoteRestored],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isReadOnly) {
      return;
    }
    if (isSubmitting) return;

    const newErrors: Record<string, string> = {};
    const discountValue = formTotals.discountValue;

    if (!formData.clientId) {
      newErrors.clientId = t('sales:clientQuotes.errors.clientRequired');
    }

    if (!formData.id?.trim()) {
      newErrors.id = t('sales:clientQuotes.errors.quoteCodeRequired', {
        defaultValue: 'Quote Code is required',
      });
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
      discount: formData.discount ? formData.discount : 0,
      items: itemsWithSnapshots,
    };

    setIsSubmitting(true);
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
      setIsSubmitting(false);
    }
    closeModal();
  };

  const confirmDelete = useCallback((quote: Quote) => {
    setQuoteToDelete(quote);
    setIsDeleteConfirmOpen(true);
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
    setIsDeleting(true);
    try {
      await onDeleteQuote(quoteToDelete.id);
      setIsDeleteConfirmOpen(false);
      setQuoteToDelete(null);
    } catch (err) {
      toastError((err as Error).message || t('sales:clientQuotes.failedToDelete'));
    } finally {
      setIsDeleting(false);
    }
  };

  const applyClientChange = (clientId: string, clientName: string, shouldReprice: boolean) => {
    if (isReadOnly) return;
    setPendingClientChange(null);
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
      setPendingClientChange({ clientId, clientName: nextClientName });
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
      const selectedQuote = acceptedSupplierQuotes.find((quote) =>
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
        newItems[index].supplierQuoteUnitPrice = netCost;

        newItems[index].unitType = selectedQuoteItem.unitType || 'hours';
        newItems[index].quantity = selectedQuoteItem.quantity;

        let salePrice: number;
        if (product) {
          const mol = product.molPercentage ? Number(product.molPercentage) : 0;
          salePrice = calcProductSalePrice(netCost, mol);
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
        } else {
          salePrice = netCost;
          newItems[index].productCost = netCost;
          newItems[index].productMolPercentage = null;
        }
        newItems[index].unitPrice = convertUnitPrice(
          salePrice,
          'hours',
          newItems[index].unitType || 'hours',
        );
      } else {
        // Supplier quote item not found - clear supplier quote and revert
        newItems[index].supplierQuoteItemId = null;
        newItems[index].supplierQuoteId = null;
        newItems[index].supplierQuoteSupplierName = null;
        newItems[index].supplierQuoteUnitPrice = null;

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

  const acceptedSupplierQuotes = useMemo(
    () =>
      supplierQuotes.filter(
        (q) => q.status === 'accepted' && !isDateOnlyBeforeToday(q.expirationDate, today),
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
    for (const quote of acceptedSupplierQuotes) {
      for (const item of quote.items) {
        options.push({
          id: item.id,
          name: `${quote.supplierName} · ${item.productName} (${item.unitPrice.toFixed(2)})`,
          quoteId: quote.id,
          productId: item.productId,
          unitPrice: item.unitPrice,
          unitType: item.unitType,
          quantity: item.quantity,
        });
      }
    }
    return options;
  }, [acceptedSupplierQuotes]);

  // O(1) lookup from a supplier-quote item id to its parent quote id, so the
  // quick-view shortcut doesn't scan the options array per row on every render.
  const quoteIdBySupplierQuoteItemId = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of supplierQuoteItemOptions) {
      map.set(option.id, option.quoteId);
    }
    return map;
  }, [supplierQuoteItemOptions]);

  const getSupplierQuoteItemDisplayValue = (itemId?: string | null) => {
    if (!itemId) return t('sales:clientQuotes.noSupplierQuote');
    const option = supplierQuoteItemOptions.find((o) => o.id === itemId);
    return option?.name ?? t('sales:clientQuotes.noSupplierQuote');
  };

  const isLinkedProductMissing = (item: QuoteItem) =>
    Boolean(item.supplierQuoteItemId && (!item.productId || !activeProductIds.has(item.productId)));

  // Parent supplier-quote id for a row, used to deep-link the quick-view shortcut.
  // Prefers the snapshot stored on the item, falling back to the selected option.
  const getLinkedSupplierQuoteId = (item: QuoteItem): string | null => {
    if (item.supplierQuoteId) return item.supplierQuoteId;
    if (item.supplierQuoteItemId) {
      return quoteIdBySupplierQuoteItemId.get(item.supplierQuoteItemId) ?? null;
    }
    return null;
  };

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
    const displayValue = getDurationDisplayValue(item);
    const newItems = [...(formData.items || [])];
    newItems[index] = {
      ...newItems[index],
      durationUnit: newUnit,
      durationMonths: durationValueToMonths(displayValue, newUnit),
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
      accessorFn: (row) =>
        calculatePricingTotals(row.items, row.discount, 'hours', row.discountType).total,
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      disableFiltering: true,
      cell: ({ row }) => {
        const { total } = calculatePricingTotals(
          row.items,
          row.discount,
          'hours',
          row.discountType,
        );
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
        const history = isHistoryRow(row);
        return (
          <span
            className={`text-sm font-bold whitespace-nowrap ${history ? 'text-zinc-400' : 'text-emerald-600'}`}
          >
            {marginPercentage.toFixed(1)}%
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
      className: 'whitespace-nowrap',
      headerClassName: 'min-w-[9rem]',
      cell: ({ row }) => {
        const expired = isQuoteExpired(row);
        const history = isHistoryRow(row);
        return (
          <div className={history ? 'opacity-60' : ''}>
            <StatusBadge
              type={expired ? 'expired' : (row.status as StatusType)}
              label={getStatusLabel(row.status)}
            />
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
        const restoreTitle = !canRestore
          ? t('sales:clientQuotes.restoreDisabledOfferStatus', {
              defaultValue: 'Restore is only possible when the linked offer is in draft status.',
            })
          : t('sales:clientQuotes.restoreQuote', { defaultValue: 'Restore quote' });

        return (
          <div className="flex justify-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (history) return;
                      openEditModal(row);
                    }}
                    disabled={history}
                    aria-label={t('sales:clientQuotes.editQuote')}
                    className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-zinc-400' : 'text-zinc-400 hover:text-praetor hover:bg-zinc-100'}`}
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {history
                  ? t('sales:clientQuotes.historyActionsDisabled', {
                      defaultValue: 'History entries cannot be modified.',
                    })
                  : t('sales:clientQuotes.editQuote')}
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
                        if (history) return;
                        handleStatusUpdate(row.id, { status: 'sent' });
                      }}
                      disabled={history}
                      aria-label={t('sales:clientQuotes.markAsSent')}
                      className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-blue-700' : 'text-blue-700 hover:text-blue-600 hover:bg-blue-50'}`}
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
                    : t('sales:clientQuotes.markAsSent')}
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
                          if (history) return;
                          handleStatusUpdate(row.id, { status: 'accepted' });
                        }}
                        disabled={history}
                        aria-label={t('sales:clientQuotes.markAsConfirmed')}
                        className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-emerald-700' : 'text-emerald-700 hover:text-emerald-600 hover:bg-emerald-50'}`}
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
                      : t('sales:clientQuotes.markAsConfirmed')}
                  </TooltipContent>
                </Tooltip>
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
              </>
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
            {!row.linkedOfferId &&
              (row.status === 'accepted' || row.status === 'denied' || isQuoteExpired(row)) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canRestore) return;
                          handleStatusUpdate(row.id, { status: 'draft', isExpired: false });
                        }}
                        disabled={!canRestore}
                        aria-label={restoreTitle}
                        className={`p-2 rounded-lg transition-all ${canRestore ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50' : 'cursor-not-allowed opacity-50 text-emerald-700'}`}
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
                  <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50">
                    <span className="text-amber-800 text-xs font-bold flex items-center gap-2">
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
                      className="h-auto px-0 text-xs font-semibold text-amber-800"
                    >
                      {t('sales:clientQuotes.versionHistory.backToCurrent', {
                        defaultValue: 'Back to current',
                      })}
                    </Button>
                  </div>
                )}
                {baseReadOnly && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                    <span className="text-amber-700 text-xs font-bold">
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
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                        buttonClassName="h-9"
                        className={errors.clientId ? 'border-red-300' : ''}
                      />
                      <FieldError className="text-xs">{errors.clientId}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(errors.id)}>
                      <FieldLabel htmlFor="client-quote-code">
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
                        placeholder="Q0000"
                        disabled={isReadOnly}
                        className={errors.id ? 'border-red-300 font-medium' : 'font-medium'}
                        aria-invalid={Boolean(errors.id)}
                      />
                      <FieldError className="text-xs">{errors.id}</FieldError>
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
                    <Field>
                      <FieldLabel htmlFor="client-quote-expiration-date">
                        {t('sales:clientQuotes.expirationDateLabel')}
                      </FieldLabel>
                      <Input
                        id="client-quote-expiration-date"
                        type="date"
                        required
                        value={formData.expirationDate}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, expirationDate: e.target.value }))
                        }
                        disabled={isReadOnly}
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
                        const linkedSupplierQuoteId = getLinkedSupplierQuoteId(item);
                        const supplierQuoteHref =
                          canViewSupplierQuotes &&
                          linkedSupplierQuoteId &&
                          allSupplierQuoteIds.has(linkedSupplierQuoteId)
                            ? buildViewDeepLink('sales/supplier-quotes', linkedSupplierQuoteId)
                            : null;
                        const productHref =
                          canViewInternalListing &&
                          item.productId &&
                          allProductIds.has(item.productId)
                            ? buildViewDeepLink('catalog/internal-listing', item.productId)
                            : null;
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
                                      searchable={true}
                                      disabled={isReadOnly}
                                      className="min-w-0 flex-1"
                                      buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                    />
                                    {supplierQuoteHref && (
                                      <QuickViewLinkButton
                                        href={supplierQuoteHref}
                                        label={t('sales:clientQuotes.openSupplierQuoteInNewTab')}
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
                                    {productHref && (
                                      <QuickViewLinkButton
                                        href={productHref}
                                        label={t('sales:clientQuotes.openProductInNewTab')}
                                      />
                                    )}
                                  </div>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => removeProductRow(index)}
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
                                  {supplierQuoteHref && (
                                    <QuickViewLinkButton
                                      href={supplierQuoteHref}
                                      label={t('sales:clientQuotes.openSupplierQuoteInNewTab')}
                                      className="absolute right-1 -top-1 z-10 h-6 w-6 -translate-y-full"
                                      iconClassName="text-[10px]"
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
                                    searchable={true}
                                    disabled={isReadOnly}
                                    className="w-full min-w-0"
                                    buttonClassName="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm"
                                  />
                                </div>
                                <div className="relative col-span-3 min-w-0">
                                  {productHref && (
                                    <QuickViewLinkButton
                                      href={productHref}
                                      label={t('sales:clientQuotes.openProductInNewTab')}
                                      className="absolute right-1 -top-1 z-10 h-6 w-6 -translate-y-full"
                                      iconClassName="text-[10px]"
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
                                onClick={() => removeProductRow(index)}
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
                        label: `${t('sales:clientQuotes.marginLabel')} (${(formTotals.marginPercentage || 0).toFixed(1)}%)`,
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
                  <Button type="submit" disabled={isReadOnly || isSubmitting}>
                    {isReadOnly
                      ? t('sales:clientQuotes.statusQuote', {
                          status: getStatusLabel(editingQuote?.status || ''),
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

      <Modal isOpen={Boolean(pendingClientChange)} onClose={() => setPendingClientChange(null)}>
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
                onClick={() => setPendingClientChange(null)}
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
          setIsDeleteConfirmOpen(false);
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title={`${t('sales:clientQuotes.deleteQuote')}?`}
        description={t('sales:clientQuotes.deleteConfirm', {
          clientName: quoteToDelete?.clientName,
        })}
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
          // Allow viewing/editing for all quotes except those in history (expired/denied with special handling)
          // Accepted and denied quotes open in read-only mode via isReadOnly flag
          const canOpenModal =
            !isHistoryRow(row) || row.status === 'accepted' || row.status === 'denied';
          if (canOpenModal) {
            openEditModal(row);
          }
        }}
        rowClassName={(row) => {
          const expired = isQuoteExpired(row);
          const history = isHistoryRow(row);
          const canOpenModal =
            !isHistoryRow(row) || row.status === 'accepted' || row.status === 'denied';
          const cursorClass = canOpenModal ? 'cursor-pointer' : 'cursor-not-allowed';
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
