import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Client,
  ClientOffer,
  Product,
  Quote,
  QuoteItem,
  SpecialBid,
  SupplierQuote,
  SupplierUnitType,
} from '../../types';
import {
  addMonthsToDateOnly,
  formatDateOnlyForLocale,
  formatInsertDate,
  getLocalDateString,
  isDateOnlyBeforeToday,
  isDateOnlyWithinInclusiveRange,
  normalizeDateOnlyString,
} from '../../utils/date';
import { convertUnitPrice, parseNumberInputValue, roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface ClientQuotesViewProps {
  quotes: Quote[];
  clients: Client[];
  products: Product[];
  specialBids: SpecialBid[];
  supplierQuotes: SupplierQuote[];
  onAddQuote: (quoteData: Partial<Quote>) => void | Promise<void>;
  onUpdateQuote: (id: string, updates: Partial<Quote>) => void | Promise<void>;
  onDeleteQuote: (id: string) => void;
  onCreateOffer?: (quote: Quote) => void;
  onViewOffer?: (offerId: string) => void;
  quoteFilterId?: string | null;
  quoteIdsWithOffers?: Set<string>;
  quoteOfferStatuses?: Record<string, ClientOffer['status']>;
  onViewOffers?: (quoteId: string) => void;
  currency: string;
  offers?: ClientOffer[];
}

const calcProductSalePrice = (costo: number, molPercentage: number) => {
  if (molPercentage >= 100) return costo;
  return costo / (1 - molPercentage / 100);
};

const getEffectiveCost = (item: QuoteItem): number => {
  if (item.supplierQuoteItemId) {
    return Number(item.supplierQuoteUnitPrice ?? 0);
  }
  if (item.specialBidId) {
    return Number(item.specialBidUnitPrice ?? 0);
  }
  return Number(item.productCost ?? 0);
};

const getDefaultFormData = (): Partial<Quote> => ({
  id: '',
  clientId: '',
  clientName: '',
  items: [],
  paymentTerms: 'immediate',
  discount: 0,
  status: 'draft',
  expirationDate: addMonthsToDateOnly(getLocalDateString(), 1),
  notes: '',
});

const ClientQuotesView: React.FC<ClientQuotesViewProps> = ({
  quotes,
  clients,
  products,
  specialBids,
  supplierQuotes,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onCreateOffer,
  onViewOffer,
  quoteFilterId,
  quoteIdsWithOffers,
  quoteOfferStatuses,
  onViewOffers,
  currency,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of public API
  offers = [],
}) => {
  const { t } = useTranslation(['sales', 'crm', 'common', 'form']);

  const PAYMENT_TERMS_OPTIONS = useMemo(
    () => [
      { id: 'immediate', name: t('crm:paymentTerms.immediate') },
      { id: '15gg', name: t('crm:paymentTerms.15gg') },
      { id: '21gg', name: t('crm:paymentTerms.21gg') },
      { id: '30gg', name: t('crm:paymentTerms.30gg') },
      { id: '45gg', name: t('crm:paymentTerms.45gg') },
      { id: '60gg', name: t('crm:paymentTerms.60gg') },
      { id: '90gg', name: t('crm:paymentTerms.90gg') },
      { id: '120gg', name: t('crm:paymentTerms.120gg') },
      { id: '180gg', name: t('crm:paymentTerms.180gg') },
      { id: '240gg', name: t('crm:paymentTerms.240gg') },
      { id: '365gg', name: t('crm:paymentTerms.365gg') },
    ],
    [t],
  );

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

  const calculateQuoteTotals = useCallback((items: QuoteItem[], globalDiscount: number) => {
    let subtotal = 0;
    let totalCost = 0;

    items.forEach((item) => {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineDiscount = item.discount ? (lineSubtotal * item.discount) / 100 : 0;
      const lineNet = lineSubtotal - lineDiscount;

      subtotal += lineNet;

      const cost = getEffectiveCost(item);
      totalCost += item.quantity * convertUnitPrice(cost, 'hours', item.unitType || 'hours');
    });

    const discountAmount = subtotal * (globalDiscount / 100);
    const total = subtotal - discountAmount;
    const margin = total - totalCost;
    const marginPercentage = total > 0 ? (margin / total) * 100 : 0;

    return {
      subtotal,
      discountAmount,
      total,
      margin,
      marginPercentage,
    };
  }, []);

  const [formData, setFormData] = useState<Partial<Quote>>(getDefaultFormData());
  const isReadOnly = Boolean(
    editingQuote &&
      (editingQuote.linkedOfferId ||
        editingQuote.status === 'sent' ||
        editingQuote.status === 'accepted' ||
        editingQuote.status === 'denied'),
  );

  const formTotals = useMemo(() => {
    const discountValue = Number.isNaN(formData.discount ?? 0) ? 0 : (formData.discount ?? 0);
    return {
      discountValue,
      ...calculateQuoteTotals(formData.items || [], discountValue),
    };
  }, [formData.items, formData.discount, calculateQuoteTotals]);

  const openAddModal = () => {
    setEditingQuote(null);
    setPendingClientChange(null);
    setFormData(getDefaultFormData());
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = useCallback((quote: Quote) => {
    setEditingQuote(quote);
    setPendingClientChange(null);
    const formattedDate = quote.expirationDate ? normalizeDateOnlyString(quote.expirationDate) : '';
    setFormData({
      id: quote.id,
      clientId: quote.clientId,
      clientName: quote.clientName,
      items: quote.items,
      paymentTerms: quote.paymentTerms,
      discount: quote.discount,
      status: quote.status,
      expirationDate: formattedDate,
      notes: quote.notes || '',
    });
    setErrors({});
    setIsModalOpen(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isReadOnly) {
      return;
    }

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
        const { total } = calculateQuoteTotals(formData.items, discountValue);
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
        unitPrice: roundToTwoDecimals(item.unitPrice),
        discount: item.discount ? roundToTwoDecimals(item.discount) : 0,
        productCost: roundToTwoDecimals(Number(item.productCost ?? 0)),
        productMolPercentage:
          item.productMolPercentage === undefined || item.productMolPercentage === null
            ? null
            : roundToTwoDecimals(Number(item.productMolPercentage)),
        specialBidUnitPrice:
          item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
            ? null
            : roundToTwoDecimals(Number(item.specialBidUnitPrice)),
        specialBidMolPercentage:
          item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
            ? null
            : roundToTwoDecimals(Number(item.specialBidMolPercentage)),
        supplierQuoteId: item.supplierQuoteId ?? null,
        supplierQuoteItemId: item.supplierQuoteItemId ?? null,
        supplierQuoteSupplierName: item.supplierQuoteSupplierName ?? null,
        supplierQuoteUnitPrice:
          item.supplierQuoteUnitPrice === undefined || item.supplierQuoteUnitPrice === null
            ? null
            : roundToTwoDecimals(Number(item.supplierQuoteUnitPrice)),
        supplierQuoteItemDiscount:
          item.supplierQuoteItemDiscount === undefined || item.supplierQuoteItemDiscount === null
            ? null
            : roundToTwoDecimals(Number(item.supplierQuoteItemDiscount)),
        supplierQuoteDiscount:
          item.supplierQuoteDiscount === undefined || item.supplierQuoteDiscount === null
            ? null
            : roundToTwoDecimals(Number(item.supplierQuoteDiscount)),
      };
    });

    const payload = {
      ...formData,
      discount: formData.discount ? roundToTwoDecimals(formData.discount) : 0,
      items: itemsWithSnapshots,
    };

    if (editingQuote) {
      await onUpdateQuote(editingQuote.id, payload);
    } else {
      await onAddQuote(payload);
    }
    setIsModalOpen(false);
  };

  const confirmDelete = useCallback((quote: Quote) => {
    setQuoteToDelete(quote);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = () => {
    if (quoteToDelete) {
      onDeleteQuote(quoteToDelete.id);
      setIsDeleteConfirmOpen(false);
      setQuoteToDelete(null);
    }
  };

  const applyClientChange = (clientId: string, clientName: string, shouldReprice: boolean) => {
    if (isReadOnly) return;
    setPendingClientChange(null);
    setFormData((prev) => {
      const updatedItems = shouldReprice
        ? (prev.items || []).map((item) => {
            if (!item.productId) {
              if (item.specialBidId) {
                return {
                  ...item,
                  specialBidId: '',
                  supplierQuoteId: null,
                  supplierQuoteItemId: null,
                  supplierQuoteSupplierName: null,
                  supplierQuoteUnitPrice: null,
                  supplierQuoteItemDiscount: null,
                  supplierQuoteDiscount: null,
                };
              }
              return item;
            }

            const product = products.find((p) => p.id === item.productId);
            if (!product) {
              return {
                ...item,
                specialBidId: '',
                supplierQuoteId: null,
                supplierQuoteItemId: null,
                supplierQuoteSupplierName: null,
                supplierQuoteUnitPrice: null,
                supplierQuoteItemDiscount: null,
                supplierQuoteDiscount: null,
              };
            }

            const applicableBid = activeSpecialBids.find(
              (b) => b.clientId === clientId && b.productId === item.productId,
            );
            const molSource = applicableBid?.molPercentage ?? product.molPercentage;
            const mol = molSource ? Number(molSource) : 0;
            const cost = applicableBid ? Number(applicableBid.unitPrice) : Number(product.costo);
            let unitPrice = convertUnitPrice(
              calcProductSalePrice(cost, mol),
              'hours',
              item.unitType || 'hours',
            );
            unitPrice = roundToTwoDecimals(unitPrice);

            return {
              ...item,
              id:
                shouldReprice && editingQuote
                  ? `temp-reprice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                  : item.id,
              specialBidId: applicableBid ? applicableBid.id : '',
              supplierQuoteId: null,
              supplierQuoteItemId: null,
              supplierQuoteSupplierName: null,
              supplierQuoteUnitPrice: null,
              supplierQuoteItemDiscount: null,
              supplierQuoteDiscount: null,
              unitPrice,
              productCost: Number(product.costo),
              productMolPercentage: product.molPercentage,
              specialBidUnitPrice: applicableBid ? Number(applicableBid.unitPrice) : null,
              specialBidMolPercentage: applicableBid?.molPercentage ?? null,
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
      unitType: 'hours',
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      specialBidUnitPrice: null,
      specialBidMolPercentage: null,
      // Supplier quote fields
      supplierQuoteId: null,
      supplierQuoteItemId: null,
      supplierQuoteSupplierName: null,
      supplierQuoteUnitPrice: null,
      supplierQuoteItemDiscount: null,
      supplierQuoteDiscount: null,
      discount: 0,
      note: '',
    };
    setFormData({
      ...formData,
      items: [...(formData.items || []), newItem as QuoteItem],
    });
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
    setFormData({ ...formData, items: newItems });
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
        newItems[index].supplierQuoteItemDiscount = null;
        newItems[index].supplierQuoteDiscount = null;
        newItems[index].specialBidId = '';
        newItems[index].specialBidUnitPrice = null;
        newItems[index].specialBidMolPercentage = null;

        // Use standard product cost with unit type handling
        if (product.type === 'supply') {
          newItems[index].unitType = 'hours';
        }
        const mol = product.molPercentage ? Number(product.molPercentage) : 0;
        newItems[index].unitPrice = roundToTwoDecimals(
          convertUnitPrice(
            calcProductSalePrice(Number(product.costo), mol),
            'hours',
            newItems[index].unitType || 'hours',
          ),
        );
        newItems[index].productCost = Number(product.costo);
        newItems[index].productMolPercentage = product.molPercentage;
      }
    }

    if (field === 'supplierQuoteItemId') {
      if (!value || value === 'none') {
        // Clear supplier quote and revert to product cost or special bid if available
        newItems[index].supplierQuoteId = null;
        newItems[index].supplierQuoteItemId = null;
        newItems[index].supplierQuoteSupplierName = null;
        newItems[index].supplierQuoteUnitPrice = null;
        newItems[index].supplierQuoteItemDiscount = null;
        newItems[index].supplierQuoteDiscount = null;

        const product = products.find((p) => p.id === newItems[index].productId);
        if (product) {
          const applicableBid = activeSpecialBids.find(
            (b) => b.clientId === formData.clientId && b.productId === newItems[index].productId,
          );

          if (applicableBid) {
            newItems[index].specialBidId = applicableBid.id;
            if (product.type === 'supply') {
              newItems[index].unitType = 'hours';
            }
            const molSource = applicableBid.molPercentage ?? product.molPercentage;
            const mol = molSource ? Number(molSource) : 0;
            newItems[index].unitPrice = roundToTwoDecimals(
              convertUnitPrice(
                calcProductSalePrice(Number(applicableBid.unitPrice), mol),
                'hours',
                newItems[index].unitType || 'hours',
              ),
            );
            newItems[index].productCost = Number(product.costo);
            newItems[index].productMolPercentage = product.molPercentage;
            newItems[index].specialBidUnitPrice = Number(applicableBid.unitPrice);
            newItems[index].specialBidMolPercentage = applicableBid.molPercentage ?? null;
          } else {
            if (product.type === 'supply') {
              newItems[index].unitType = 'hours';
            }
            const mol = product.molPercentage ? Number(product.molPercentage) : 0;
            newItems[index].specialBidId = '';
            newItems[index].unitPrice = roundToTwoDecimals(
              convertUnitPrice(
                calcProductSalePrice(Number(product.costo), mol),
                'hours',
                newItems[index].unitType || 'hours',
              ),
            );
            newItems[index].productCost = Number(product.costo);
            newItems[index].productMolPercentage = product.molPercentage;
            newItems[index].specialBidUnitPrice = null;
            newItems[index].specialBidMolPercentage = null;
          }
        }
        setFormData({ ...formData, items: newItems });
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

        const lineDiscountedCost =
          selectedQuoteItem.unitPrice * (1 - (selectedQuoteItem.discount ?? 0) / 100);
        const netCost = lineDiscountedCost * (1 - selectedQuote.discount / 100);

        newItems[index].productId = selectedQuoteItem.productId || '';
        newItems[index].productName = product?.name || selectedQuoteItem.productName;
        newItems[index].supplierQuoteId = selectedQuote.id;
        newItems[index].supplierQuoteItemId = selectedQuoteItem.id;
        newItems[index].supplierQuoteSupplierName = selectedQuote.supplierName;
        newItems[index].supplierQuoteUnitPrice = netCost;
        newItems[index].supplierQuoteItemDiscount = selectedQuoteItem.discount ?? 0;
        newItems[index].supplierQuoteDiscount = selectedQuote.discount;

        newItems[index].unitType = selectedQuoteItem.unitType || 'hours';
        newItems[index].quantity = selectedQuoteItem.quantity;

        newItems[index].specialBidId = '';
        newItems[index].specialBidUnitPrice = null;
        newItems[index].specialBidMolPercentage = null;

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
        newItems[index].unitPrice = roundToTwoDecimals(
          convertUnitPrice(salePrice, 'hours', newItems[index].unitType || 'hours'),
        );
      } else {
        // Supplier quote item not found - clear supplier quote and revert
        newItems[index].supplierQuoteItemId = null;
        newItems[index].supplierQuoteId = null;
        newItems[index].supplierQuoteSupplierName = null;
        newItems[index].supplierQuoteUnitPrice = null;
        newItems[index].supplierQuoteItemDiscount = null;
        newItems[index].supplierQuoteDiscount = null;

        const existingProduct = products.find((p) => p.id === newItems[index].productId);
        if (existingProduct) {
          const mol = existingProduct.molPercentage ? Number(existingProduct.molPercentage) : 0;
          newItems[index].unitPrice = calcProductSalePrice(Number(existingProduct.costo), mol);
          newItems[index].productCost = Number(existingProduct.costo);
          newItems[index].productMolPercentage = existingProduct.molPercentage;
        }
      }
    }

    if (field === 'specialBidId') {
      if (!value) {
        newItems[index].specialBidId = '';
        newItems[index].specialBidUnitPrice = null;
        newItems[index].specialBidMolPercentage = null;

        // Check for supplier quote first, then revert to product cost
        if (newItems[index].supplierQuoteItemId) {
          // Keep supplier quote data
        } else {
          const product = products.find((p) => p.id === newItems[index].productId);
          if (product) {
            const mol = product.molPercentage ? Number(product.molPercentage) : 0;
            newItems[index].unitPrice = roundToTwoDecimals(
              convertUnitPrice(
                calcProductSalePrice(Number(product.costo), mol),
                'hours',
                newItems[index].unitType || 'hours',
              ),
            );
            newItems[index].productCost = Number(product.costo);
            newItems[index].productMolPercentage = product.molPercentage;
          }
        }
        setFormData({ ...formData, items: newItems });
        return;
      }

      const bid = specialBids.find((b) => b.id === value);
      if (bid) {
        const product = products.find((p) => p.id === bid.productId);
        if (product) {
          newItems[index].productId = bid.productId;
          newItems[index].productName = product.name;
          if (product.type === 'supply') {
            newItems[index].unitType = 'hours';
          }
          const molSource = bid.molPercentage ?? product.molPercentage;
          const mol = molSource ? Number(molSource) : 0;
          newItems[index].unitPrice = roundToTwoDecimals(
            convertUnitPrice(
              calcProductSalePrice(Number(bid.unitPrice), mol),
              'hours',
              newItems[index].unitType || 'hours',
            ),
          );
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
          newItems[index].specialBidId = bid.id;
          newItems[index].specialBidUnitPrice = Number(bid.unitPrice);
          newItems[index].specialBidMolPercentage = bid.molPercentage ?? null;

          newItems[index].supplierQuoteId = null;
          newItems[index].supplierQuoteItemId = null;
          newItems[index].supplierQuoteSupplierName = null;
          newItems[index].supplierQuoteUnitPrice = null;
          newItems[index].supplierQuoteItemDiscount = null;
          newItems[index].supplierQuoteDiscount = null;
        }
      }
    }

    setFormData({ ...formData, items: newItems });
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
  const today = getLocalDateString();
  const activeSpecialBids = useMemo(
    () => specialBids.filter((b) => isDateOnlyWithinInclusiveRange(today, b.startDate, b.endDate)),
    [specialBids, today],
  );

  const acceptedSupplierQuotes = useMemo(
    () =>
      supplierQuotes.filter(
        (q) => q.status === 'accepted' && !isDateOnlyBeforeToday(q.expirationDate),
      ),
    [supplierQuotes],
  );

  const supplierQuoteItemOptions = useMemo(() => {
    const options: Array<{
      id: string;
      name: string;
      quoteId: string;
      productId?: string;
      unitPrice: number;
      discount: number;
      quoteDiscount: number;
      unitType?: SupplierUnitType;
      quantity: number;
    }> = [];
    for (const quote of acceptedSupplierQuotes) {
      for (const item of quote.items) {
        options.push({
          id: item.id,
          name: `${quote.supplierName} · ${item.productName} (${item.unitPrice.toFixed(2)}${item.discount ? ` -${item.discount}%` : ''})`,
          quoteId: quote.id,
          productId: item.productId,
          unitPrice: item.unitPrice,
          discount: item.discount ?? 0,
          quoteDiscount: quote.discount,
          unitType: item.unitType,
          quantity: item.quantity,
        });
      }
    }
    return options;
  }, [acceptedSupplierQuotes]);

  const getSupplierQuoteItemDisplayValue = (itemId?: string | null) => {
    if (!itemId) return t('sales:clientQuotes.noSupplierQuote');
    const option = supplierQuoteItemOptions.find((o) => o.id === itemId);
    return option?.name ?? t('sales:clientQuotes.noSupplierQuote');
  };

  const isLinkedProductMissing = (item: QuoteItem) =>
    Boolean(item.supplierQuoteItemId && (!item.productId || !activeProductIds.has(item.productId)));

  const renderProductSelectOrFallback = (
    item: QuoteItem,
    index: number,
    selectProps: { className?: string; buttonClassName?: string },
  ) => {
    if (isLinkedProductMissing(item)) {
      return (
        <input
          type="text"
          readOnly
          value={item.productName || ''}
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600"
        />
      );
    }
    return (
      <CustomSelect
        options={activeProductOptions}
        value={item.productId}
        onChange={(val) => updateProductRow(index, 'productId', val as string)}
        placeholder={t('sales:clientQuotes.selectProduct')}
        searchable={true}
        disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
        className={selectProps.className}
        buttonClassName={selectProps.buttonClassName}
      />
    );
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
      unitPrice: roundToTwoDecimals(adjustedPrice),
    };
    setFormData({ ...formData, items: newItems });
  };

  const renderUnitSelector = (index: number, item: Partial<QuoteItem>) => {
    const product = products.find((p) => p.id === item.productId);
    const isSupply = product?.type === 'supply';
    const qty = Number(item.quantity) || 0;

    if (isSupply) {
      return (
        <span className="text-xs font-semibold text-slate-400 shrink-0 whitespace-nowrap">
          {qty === 1 ? t('sales:clientQuotes.unit') : t('sales:clientQuotes.units')}
        </span>
      );
    }

    return (
      <select
        value={item.unitType || 'hours'}
        onChange={(e) => handleUnitTypeChange(index, e.target.value as SupplierUnitType)}
        disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
        className="text-xs px-1.5 py-1 bg-white border border-slate-200 rounded-md focus:ring-1 focus:ring-praetor outline-none shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="hours">{t(`sales:clientQuotes.${qty === 1 ? 'hour' : 'hours'}`)}</option>
        <option value="days">{t(`sales:clientQuotes.${qty === 1 ? 'day' : 'days'}`)}</option>
        <option value="unit">{t(`sales:clientQuotes.${qty === 1 ? 'unit' : 'units'}`)}</option>
      </select>
    );
  };

  // Column definitions for StandardTable
  const columns = useMemo<Column<Quote>[]>(
    () => [
      {
        header: t('sales:clientQuotes.quoteCodeColumn'),
        accessorKey: 'id',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }) => <span className="font-bold text-slate-700">{row.id}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (row) => row.createdAt ?? 0,
        className: 'whitespace-nowrap',
        cell: ({ row }) => {
          if (!row.createdAt) return <span className="text-xs text-slate-400">-</span>;
          return (
            <span className="text-xs text-slate-500 whitespace-nowrap">
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
            <div className={history ? 'font-bold text-slate-400' : 'font-bold text-slate-800'}>
              {row.clientName}
            </div>
          );
        },
      },
      {
        header: t('sales:clientQuotes.totalColumn'),
        id: 'total',
        accessorFn: (row) => calculateQuoteTotals(row.items, row.discount).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row }) => {
          const { total } = calculateQuoteTotals(row.items, row.discount);
          const history = isHistoryRow(row);
          return (
            <span
              className={`text-sm font-bold whitespace-nowrap ${history ? 'text-slate-400' : 'text-slate-700'}`}
            >
              {total.toFixed(2)} {currency}
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
            <span
              className={`text-sm font-semibold ${history ? 'text-slate-400' : 'text-slate-600'}`}
            >
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
                history ? 'text-slate-400' : expired ? 'text-red-600 font-bold' : 'text-slate-600'
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
              <Tooltip
                label={
                  history
                    ? t('sales:clientQuotes.historyActionsDisabled', {
                        defaultValue: 'History entries cannot be modified.',
                      })
                    : t('sales:clientQuotes.editQuote')
                }
              >
                {() => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (history) return;
                      openEditModal(row);
                    }}
                    disabled={history}
                    className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                )}
              </Tooltip>
              {row.linkedOfferId && onViewOffer && (
                <Tooltip label={t('sales:clientQuotes.viewOffer', { defaultValue: 'View offer' })}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // biome-ignore lint/style/noNonNullAssertion: narrowed by truthy guard
                        onViewOffer(row.linkedOfferId!);
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {row.status === 'accepted' && onCreateOffer && (
                <Tooltip label={createOfferTitle}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isCreateOfferDisabled) return;
                        onCreateOffer(row);
                      }}
                      disabled={isCreateOfferDisabled}
                      className={`p-2 rounded-lg transition-all ${isCreateOfferDisabled ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
                    >
                      <i className="fa-solid fa-file-signature"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {row.status === 'draft' && (
                <Tooltip
                  label={
                    history
                      ? t('sales:clientQuotes.historyActionsDisabled', {
                          defaultValue: 'History entries cannot be modified.',
                        })
                      : t('sales:clientQuotes.markAsSent')
                  }
                >
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (history) return;
                        onUpdateQuote(row.id, { status: 'sent' });
                      }}
                      disabled={history}
                      className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                    >
                      <i className="fa-solid fa-paper-plane"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {row.status === 'sent' && (
                <>
                  <Tooltip
                    label={
                      history
                        ? t('sales:clientQuotes.historyActionsDisabled', {
                            defaultValue: 'History entries cannot be modified.',
                          })
                        : t('sales:clientQuotes.markAsConfirmed')
                    }
                  >
                    {() => (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (history) return;
                          onUpdateQuote(row.id, { status: 'accepted' });
                        }}
                        disabled={history}
                        className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    )}
                  </Tooltip>
                  <Tooltip
                    label={
                      history
                        ? t('sales:clientQuotes.historyActionsDisabled', {
                            defaultValue: 'History entries cannot be modified.',
                          })
                        : t('sales:clientQuotes.markAsDenied')
                    }
                  >
                    {() => (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (history) return;
                          onUpdateQuote(row.id, { status: 'denied' });
                        }}
                        disabled={history}
                        className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </Tooltip>
                </>
              )}
              {row.status === 'draft' && (
                <Tooltip label={deleteTitle}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isDeleteDisabled) return;
                        confirmDelete(row);
                      }}
                      disabled={isDeleteDisabled}
                      className={`p-2 text-slate-400 rounded-lg transition-all ${isDeleteDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-red-600 hover:bg-red-50'}`}
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {history && (
                <Tooltip label={restoreTitle}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canRestore) return;
                        onUpdateQuote(row.id, { status: 'draft', isExpired: false });
                      }}
                      disabled={!canRestore}
                      className={`p-2 rounded-lg transition-all ${canRestore ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50' : 'cursor-not-allowed opacity-50 text-slate-400'}`}
                    >
                      <i className="fa-solid fa-rotate-left"></i>
                    </button>
                  )}
                </Tooltip>
              )}
            </div>
          );
        },
      },
    ],
    [
      t,
      currency,
      isHistoryRow,
      isQuoteExpired,
      hasOfferForQuote,
      getOfferStatusForQuote,
      calculateQuoteTotals,
      getStatusLabel,
      onCreateOffer,
      onViewOffer,
      onUpdateQuote,
      confirmDelete,
      openEditModal,
    ],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingQuote ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {isReadOnly
                ? t('sales:clientQuotes.viewQuote')
                : editingQuote
                  ? t('sales:clientQuotes.editQuote')
                  : t('sales:clientQuotes.createNewQuote')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 space-y-8 overflow-y-auto p-8">
            {isReadOnly && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                <span className="text-amber-700 text-xs font-bold">
                  {t('sales:clientQuotes.readOnlyBecauseOffer', {
                    defaultValue: 'This quote is read-only because an offer was created from it.',
                  })}
                </span>
              </div>
            )}
            {editingQuote?.linkedOfferId && (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                    <i className="fa-solid fa-link"></i>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {t('sales:clientQuotes.linkedOffer', { defaultValue: 'Linked Offer' })}
                    </div>
                    <div className="text-xs text-praetor">
                      {t('sales:clientQuotes.linkedOfferInfo', {
                        number: editingQuote.linkedOfferId,
                        defaultValue: 'Offer #{{number}}',
                      })}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {t('sales:clientQuotes.offerDetailsReadOnly', {
                        defaultValue: '(Quote details are read-only)',
                      })}
                    </div>
                  </div>
                </div>
                {onViewOffers && (
                  <button
                    type="button"
                    onClick={() => onViewOffers(editingQuote.id)}
                    className="text-xs font-bold text-praetor hover:text-slate-800 hover:underline"
                  >
                    {t('sales:clientQuotes.viewOffer', { defaultValue: 'View Offer' })}
                  </button>
                )}
              </div>
            )}
            {/* Client Selection */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('sales:clientQuotes.clientInformation')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientQuotes.client')}
                  </label>
                  <CustomSelect
                    options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                    value={formData.clientId || ''}
                    onChange={(val) => handleClientChange(val as string)}
                    placeholder={t('sales:clientQuotes.selectAClient')}
                    searchable={true}
                    disabled={isReadOnly}
                    className={errors.clientId ? 'border-red-300' : ''}
                  />
                  {errors.clientId && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientQuotes.quoteCode', { defaultValue: 'Quote Code' })}
                  </label>
                  <input
                    type="text"
                    value={formData.id || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, id: e.target.value });
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
                    className={`w-full rounded-xl border ${
                      errors.id ? 'border-red-300' : 'border-slate-200'
                    } bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-praetor disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                  {errors.id && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.id}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientQuotes.paymentTerms')}
                  </label>
                  <CustomSelect
                    options={PAYMENT_TERMS_OPTIONS}
                    value={formData.paymentTerms || 'immediate'}
                    onChange={(val) =>
                      setFormData({ ...formData, paymentTerms: val as Quote['paymentTerms'] })
                    }
                    searchable={false}
                    disabled={isReadOnly}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:clientQuotes.expirationDateLabel')}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.expirationDate}
                    onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                    disabled={isReadOnly}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-praetor disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* Products */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('sales:clientQuotes.productsServices')}
                </h4>
                <button
                  type="button"
                  onClick={addProductRow}
                  disabled={isReadOnly}
                  className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="fa-solid fa-plus"></i> {t('sales:clientQuotes.addProduct')}
                </button>
              </div>
              {errors.items && (
                <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
              )}

              {formData.items && formData.items.length > 0 && (
                <div className="hidden lg:flex gap-3 px-3 mb-1 items-center">
                  <div className="flex-1 min-w-0 grid grid-cols-13 gap-3">
                    <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                      {t('sales:clientQuotes.supplierQuoteColumn')}
                    </div>
                    <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      {t('sales:clientQuotes.productsServices')}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientQuotes.qty')}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('crm:internalListing.cost')}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      MOL (%)
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientQuotes.marginLabel')}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:clientQuotes.revenue')}
                    </div>
                  </div>
                  <div className="w-10 shrink-0"></div>
                </div>
              )}

              {formData.items && formData.items.length > 0 ? (
                <div className="space-y-3">
                  {formData.items.map((item, index) => {
                    const selectedBid = item.specialBidId
                      ? specialBids.find((b) => b.id === item.specialBidId)
                      : undefined;
                    const selectedSupplierQuote = item.supplierQuoteItemId
                      ? supplierQuoteItemOptions.find((o) => o.id === item.supplierQuoteItemId)
                      : undefined;

                    // Cost is from supplier quote if available, then special bid, then product cost
                    const baseCost = getEffectiveCost(item);
                    const unitMultiplier = item.unitType === 'days' ? 8 : 1;
                    const cost = baseCost * unitMultiplier;

                    const molSource = item.specialBidId
                      ? item.specialBidMolPercentage
                      : item.productMolPercentage;
                    const molPercentage = molSource ? Number(molSource) : 0;
                    const quantity = Number(item.quantity || 0);
                    const lineCost = cost * quantity;
                    const unitSalePrice = Number(item.unitPrice || 0);
                    const lineSalePrice = unitSalePrice * quantity;
                    const lineMargin = lineSalePrice - lineCost;

                    const handleCostChange = (value: string) => {
                      if (isReadOnly) return;
                      const newCost = parseNumberInputValue(value);
                      const unitMult = item.unitType === 'days' ? 8 : 1;
                      const newUnitPrice = calcProductSalePrice(newCost, molPercentage);
                      const updated = [...(formData.items || [])];
                      updated[index] = {
                        ...updated[index],
                        unitPrice: roundToTwoDecimals(newUnitPrice),
                        ...(item.supplierQuoteItemId
                          ? {
                              supplierQuoteUnitPrice: roundToTwoDecimals(newCost / unitMult),
                            }
                          : {
                              productCost: roundToTwoDecimals(newCost / unitMult),
                            }),
                      };
                      setFormData({ ...formData, items: updated });
                    };

                    const handleMolChange = (value: string) => {
                      if (isReadOnly) return;
                      const newMol = parseNumberInputValue(value);
                      const newUnitPrice = calcProductSalePrice(cost, newMol);
                      const updated = [...(formData.items || [])];
                      updated[index] = {
                        ...updated[index],
                        unitPrice: roundToTwoDecimals(newUnitPrice),
                        productMolPercentage: roundToTwoDecimals(newMol),
                      };
                      setFormData({ ...formData, items: updated });
                    };

                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3"
                      >
                        <div className="lg:hidden flex items-start gap-3">
                          <div className="grid flex-1 min-w-0 grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                {t('sales:clientQuotes.supplierQuoteColumn')}
                              </div>
                              <CustomSelect
                                options={[
                                  { id: 'none', name: t('sales:clientQuotes.noSupplierQuote') },
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
                                searchable={true}
                                disabled={isReadOnly}
                                className="min-w-0"
                                buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                {t('sales:clientQuotes.productsServices')}
                              </div>
                              {renderProductSelectOrFallback(item, index, {
                                className: 'min-w-0',
                                buttonClassName:
                                  'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm',
                              })}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeProductRow(index)}
                            disabled={isReadOnly}
                            className="mt-5 w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-5 lg:hidden">
                          <div>
                            <div className="mb-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('sales:clientQuotes.qty')}
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
                                disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed flex-1"
                              />
                              <span className="text-xs font-semibold text-slate-400 shrink-0">
                                /
                              </span>
                              {renderUnitSelector(index, item)}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('crm:internalListing.cost')}
                            </div>
                            {selectedSupplierQuote && (
                              <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[8px] font-black uppercase tracking-wider">
                                {t('sales:clientQuotes.supplierQuoteBadge')}
                              </span>
                            )}
                            {selectedBid && !selectedSupplierQuote && (
                              <span className="inline-flex px-2 py-0.5 rounded-full bg-praetor text-white text-[8px] font-black uppercase tracking-wider">
                                {t('sales:clientQuotes.bidBadge')}
                              </span>
                            )}
                            <div className="flex items-center gap-1">
                              <ValidatedNumberInput
                                value={cost.toFixed(2)}
                                onValueChange={handleCostChange}
                                disabled={isReadOnly}
                                className="w-full text-xs px-2 py-1 bg-white border border-slate-200 rounded-md focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                {currency}
                              </span>
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              MOL (%)
                            </div>
                            <div className="flex items-center gap-1">
                              <ValidatedNumberInput
                                value={molPercentage.toFixed(1)}
                                onValueChange={handleMolChange}
                                disabled={isReadOnly}
                                className="w-full text-xs px-2 py-1 bg-white border border-slate-200 rounded-md focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                %
                              </span>
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('sales:clientQuotes.marginLabel')}
                            </div>
                            <div className="text-xs font-bold text-emerald-600 whitespace-nowrap">
                              {lineMargin.toFixed(2)} {currency}
                            </div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1 col-span-2 md:col-span-1">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                              {t('sales:clientQuotes.revenue')}
                            </div>
                            <div
                              className={`text-sm font-semibold whitespace-nowrap ${selectedSupplierQuote ? 'text-emerald-600' : selectedBid ? 'text-praetor' : 'text-slate-800'}`}
                            >
                              {lineSalePrice.toFixed(2)} {currency}
                            </div>
                          </div>
                        </div>
                        <div className="hidden lg:flex gap-3 items-center">
                          <div className="flex-1 min-w-0 grid grid-cols-13 gap-3 items-center">
                            <div className="col-span-3 min-w-0">
                              <CustomSelect
                                options={[
                                  { id: 'none', name: t('sales:clientQuotes.noSupplierQuote') },
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
                                searchable={true}
                                disabled={isReadOnly}
                                className="min-w-0"
                                buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                              />
                            </div>
                            <div className="col-span-3 min-w-0">
                              {renderProductSelectOrFallback(item, index, {
                                className: 'min-w-0',
                                buttonClassName:
                                  'w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm',
                              })}
                            </div>
                            <div className="col-span-2">
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
                                  disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
                                  className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                <span className="text-xs font-semibold text-slate-400 shrink-0">
                                  /
                                </span>
                                {renderUnitSelector(index, item)}
                              </div>
                            </div>
                            <div className="col-span-1 flex flex-col items-center justify-center gap-1">
                              {selectedSupplierQuote && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[8px] font-black uppercase tracking-wider">
                                  {t('sales:clientQuotes.supplierQuoteBadge')}
                                </span>
                              )}
                              {selectedBid && !selectedSupplierQuote && (
                                <span className="px-2 py-0.5 rounded-full bg-praetor text-white text-[8px] font-black uppercase tracking-wider">
                                  {t('sales:clientQuotes.bidBadge')}
                                </span>
                              )}
                              <div className="flex items-center gap-0.5 w-full">
                                <ValidatedNumberInput
                                  value={cost.toFixed(2)}
                                  onValueChange={handleCostChange}
                                  disabled={isReadOnly}
                                  className="w-full text-xs px-1 py-1 bg-white border border-slate-200 rounded-md focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                  {currency}
                                </span>
                              </div>
                            </div>
                            <div className="col-span-1 flex items-center justify-center">
                              <div className="flex items-center gap-0.5 w-full">
                                <ValidatedNumberInput
                                  value={molPercentage.toFixed(1)}
                                  onValueChange={handleMolChange}
                                  disabled={isReadOnly}
                                  className="w-full text-xs px-1 py-1 bg-white border border-slate-200 rounded-md focus:ring-1 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                <span className="text-[9px] font-semibold text-slate-400 shrink-0">
                                  %
                                </span>
                              </div>
                            </div>
                            <div className="col-span-1 flex items-center justify-center">
                              <span className="text-xs font-bold text-emerald-600 whitespace-nowrap">
                                {lineMargin.toFixed(2)} {currency}
                              </span>
                            </div>
                            <div className="col-span-2 flex items-center justify-center">
                              <span
                                className={`text-sm font-semibold whitespace-nowrap ${selectedSupplierQuote ? 'text-emerald-600' : selectedBid ? 'text-praetor' : 'text-slate-800'}`}
                              >
                                {lineSalePrice.toFixed(2)} {currency}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeProductRow(index)}
                            disabled={isReadOnly}
                            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </div>
                        <div>
                          <input
                            type="text"
                            placeholder={t('form:placeholderNotes')}
                            value={item.note || ''}
                            onChange={(e) => updateProductRow(index, 'note', e.target.value)}
                            disabled={isReadOnly}
                            className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 text-sm">
                  {t('sales:clientQuotes.noProductsAdded')}
                </div>
              )}
            </div>

            {/* Notes & Cost Summary */}
            <div className="flex flex-col gap-8 border-t border-slate-100 pt-6 md:flex-row">
              <div className="w-full space-y-4 md:w-2/3">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('sales:clientQuotes.notesLabel')}
                </h4>
                <textarea
                  rows={4}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder={t('sales:clientQuotes.additionalNotesPlaceholder')}
                  disabled={isReadOnly}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="w-full space-y-3 md:w-1/3">
                <h4 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('sales:clientQuotes.totalLabel')}
                </h4>
                {errors.total && (
                  <p className="text-red-500 text-[10px] font-bold mb-2">{errors.total}</p>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-500">
                    {t('sales:clientQuotes.globalDiscount')}
                  </span>
                  <ValidatedNumberInput
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.discount}
                    onValueChange={(value) => {
                      const parsed = parseNumberInputValue(value);
                      setFormData({ ...formData, discount: parsed });
                      if (errors.total) {
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.total;
                          return next;
                        });
                      }
                    }}
                    disabled={isReadOnly}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-right outline-none focus:ring-2 focus:ring-praetor disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-slate-500">
                    {t('sales:clientQuotes.subtotal', { defaultValue: 'Subtotal' })}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {formTotals.subtotal.toFixed(2)} {currency}
                  </span>
                </div>
                {formTotals.discountValue > 0 && (
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-500">
                      {t('sales:clientQuotes.discountAmount', {
                        defaultValue: 'Discount',
                        discount: formTotals.discountValue,
                      })}
                    </span>
                    <span className="text-sm font-bold text-amber-600">
                      -{formTotals.discountAmount.toFixed(2)} {currency}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-emerald-600">
                    {t('sales:clientQuotes.marginLabel')} (
                    {(formTotals.marginPercentage || 0).toFixed(1)}%)
                  </span>
                  <span className="text-sm font-bold text-emerald-600">
                    {formTotals.margin.toFixed(2)} {currency}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-3">
                  <span className="text-lg font-black text-slate-800">
                    {t('sales:clientQuotes.totalLabel')}
                  </span>
                  <span className="text-lg font-black text-praetor">
                    {formTotals.total.toFixed(2)} {currency}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-xl px-6 py-3 font-bold text-slate-500 hover:bg-slate-50"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                disabled={isReadOnly}
                className="rounded-xl bg-praetor px-8 py-3 font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isReadOnly
                  ? t('sales:clientQuotes.statusQuote', {
                      status: getStatusLabel(editingQuote?.status || ''),
                    })
                  : editingQuote
                    ? t('sales:clientQuotes.updateQuote')
                    : t('sales:clientQuotes.createQuote')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={Boolean(pendingClientChange)} onClose={() => setPendingClientChange(null)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 space-y-5">
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('sales:clientQuotes.clientChangeRepriceTitle')}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('sales:clientQuotes.clientChangeRepriceMessage')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleClientChangeKeepSnapshots}
                className="w-full py-3 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                {t('sales:clientQuotes.clientChangeKeepSnapshots')}
              </button>
              <button
                type="button"
                onClick={handleClientChangeReprice}
                className="w-full py-3 text-sm font-bold text-white bg-praetor hover:bg-slate-700 rounded-xl transition-colors"
              >
                {t('sales:clientQuotes.clientChangeRepriceNow')}
              </button>
              <button
                type="button"
                onClick={() => setPendingClientChange(null)}
                className="w-full py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('sales:clientQuotes.clientChangeRepriceCancel')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="w-full max-w-sm space-y-4 overflow-hidden rounded-2xl bg-white p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
          </div>
          <h3 className="text-lg font-black text-slate-800">
            {t('sales:clientQuotes.deleteQuote')}?
          </h3>
          <p className="text-sm text-slate-500">
            {t('sales:clientQuotes.deleteConfirm', { clientName: quoteToDelete?.clientName })}
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 rounded-xl py-3 font-bold text-slate-500 hover:bg-slate-50"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700"
            >
              {t('common:buttons.delete')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">
              {t('sales:clientQuotes.quotesTitle')}
            </h2>
            <p className="text-slate-500 text-sm">{t('sales:clientQuotes.quotesSubtitle')}</p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('sales:clientQuotes.createNewQuote')}
          </button>
        </div>
      </div>

      {/* Search and Filters */}

      <StandardTable<Quote>
        title={t('sales:clientQuotes.activeQuotes')}
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
            ? `bg-slate-50 text-slate-400 hover:bg-slate-100 ${cursorClass}`
            : expired
              ? `hover:bg-slate-50/50 ${cursorClass} bg-red-50/30`
              : `hover:bg-slate-50/50 ${cursorClass}`;
        }}
      />
    </div>
  );
};

export default ClientQuotesView;
