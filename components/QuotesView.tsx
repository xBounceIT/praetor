import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Quote, QuoteItem, Client, Product, SpecialBid, Sale } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable, { Column } from './StandardTable';
import ValidatedNumberInput from './ValidatedNumberInput';
import StatusBadge, { StatusType } from './StatusBadge';
import { parseNumberInputValue, roundToTwoDecimals } from '../utils/numbers';
import Modal from './Modal';

interface QuotesViewProps {
  quotes: Quote[];
  clients: Client[];
  products: Product[];
  specialBids: SpecialBid[];
  onAddQuote: (quoteData: Partial<Quote>) => void | Promise<void>;
  onUpdateQuote: (id: string, updates: Partial<Quote>) => void | Promise<void>;
  onDeleteQuote: (id: string) => void;
  onCreateSale?: (quote: Quote) => void;
  quoteFilterId?: string | null;
  quoteIdsWithSales?: Set<string>;
  quoteSaleStatuses?: Record<string, Sale['status']>;
  currency: string;
}

const calcProductSalePrice = (costo: number, molPercentage: number) => {
  if (molPercentage >= 100) return costo;
  return costo / (1 - molPercentage / 100);
};

const QuotesView: React.FC<QuotesViewProps> = ({
  quotes,
  clients,
  products,
  specialBids,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onCreateSale,
  quoteIdsWithSales,
  quoteSaleStatuses,
  currency,
}) => {
  const { t } = useTranslation(['crm', 'common', 'form']);

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

  const STATUS_OPTIONS = useMemo(
    () => [
      { id: 'draft', name: t('crm:quotes.statusQuoted') },
      { id: 'sent', name: t('crm:quotes.statusConfirmed') },
      { id: 'accepted', name: t('crm:quotes.statusAccepted') },
      { id: 'denied', name: t('crm:quotes.statusDenied') },
    ],
    [t],
  );

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const getStatusLabel = useCallback(
    (status: string) => {
      const option = STATUS_OPTIONS.find((o) => o.id === status);
      return option ? option.name : status;
    },
    [STATUS_OPTIONS],
  );

  // Helper: Check if quote is expired
  const isExpired = useCallback((expirationDate: string) => {
    const normalizedDate = expirationDate.includes('T')
      ? expirationDate
      : `${expirationDate}T00:00:00`;
    const expiry = new Date(normalizedDate);
    expiry.setDate(expiry.getDate() + 1);
    return new Date() >= expiry;
  }, []);

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

  const hasSaleForQuote = useCallback(
    (quote: Quote) => Boolean(quoteIdsWithSales?.has(quote.id)),
    [quoteIdsWithSales],
  );

  const getSaleStatusForQuote = useCallback(
    (quote: Quote) => quoteSaleStatuses?.[quote.id],
    [quoteSaleStatuses],
  );

  const isHistoryRow = useCallback(
    (quote: Quote) => {
      const expired = isQuoteExpired(quote);
      const hasSale = hasSaleForQuote(quote);
      return quote.status === 'denied' || expired || hasSale;
    },
    [isQuoteExpired, hasSaleForQuote],
  );

  // Calculate totals for a quote
  const calculateQuoteTotals = useCallback(
    (items: QuoteItem[], globalDiscount: number) => {
      let subtotal = 0;
      let totalCost = 0;
      const taxGroups: Record<number, number> = {};

      items.forEach((item) => {
        const product = products.find((p) => p.id === item.productId);
        const lineSubtotal = item.quantity * item.unitPrice;
        const lineDiscount = item.discount ? (lineSubtotal * item.discount) / 100 : 0;
        const lineNet = lineSubtotal - lineDiscount;

        subtotal += lineNet;

        if (product) {
          const taxRate = product.taxRate;
          const lineNetAfterGlobal = lineNet * (1 - globalDiscount / 100);
          const taxAmount = lineNetAfterGlobal * (taxRate / 100);
          taxGroups[taxRate] = (taxGroups[taxRate] || 0) + taxAmount;

          const cost = item.specialBidId
            ? Number(item.specialBidUnitPrice ?? 0)
            : Number(item.productCost ?? product.costo);
          totalCost += item.quantity * cost;
        }
      });

      const discountAmount = subtotal * (globalDiscount / 100);
      const taxableAmount = subtotal - discountAmount;
      const totalTax = Object.values(taxGroups).reduce((sum, val) => sum + val, 0);
      const total = taxableAmount + totalTax;
      const margin = taxableAmount - totalCost;
      const marginPercentage = taxableAmount > 0 ? (margin / taxableAmount) * 100 : 0;

      return {
        subtotal,
        taxableAmount,
        discountAmount,
        totalTax,
        total,
        margin,
        marginPercentage,
        taxGroups,
      };
    },
    [products],
  );

  // Form State
  const [formData, setFormData] = useState<Partial<Quote>>({
    quoteCode: '',
    clientId: '',
    clientName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'draft',
    expirationDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const isReadOnly = Boolean(
    editingQuote &&
    (editingQuote.status === 'sent' ||
      editingQuote.status === 'accepted' ||
      editingQuote.status === 'denied'),
  );

  const openAddModal = () => {
    setEditingQuote(null);
    setFormData({
      quoteCode: '',
      clientId: '',
      clientName: '',
      items: [],
      paymentTerms: 'immediate',
      discount: 0,
      status: 'draft',
      expirationDate: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = useCallback((quote: Quote) => {
    setEditingQuote(quote);
    // Ensure expirationDate is in YYYY-MM-DD format for the date input
    const formattedDate = quote.expirationDate
      ? new Date(quote.expirationDate).toISOString().split('T')[0]
      : '';
    setFormData({
      quoteCode: quote.quoteCode,
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
    const discountValue = Number.isNaN(formData.discount ?? 0) ? 0 : (formData.discount ?? 0);

    if (!formData.clientId) {
      newErrors.clientId = t('crm:quotes.errors.clientRequired');
    }

    if (!formData.quoteCode?.trim()) {
      newErrors.quoteCode = t('crm:quotes.errors.quoteCodeRequired', {
        defaultValue: 'Quote Code is required',
      });
    }

    if (!formData.items || formData.items.length === 0) {
      newErrors.items = t('crm:quotes.errors.itemsRequired');
    } else {
      const invalidItem = formData.items.find((item) => !item.productId);
      if (invalidItem) {
        newErrors.items = 'Please select a product for all items';
      }
      const invalidQuantity = formData.items.find(
        (item) =>
          item.quantity === undefined ||
          item.quantity === null ||
          Number.isNaN(item.quantity) ||
          item.quantity <= 0,
      );
      if (!newErrors.items && invalidQuantity) {
        newErrors.items = t('crm:quotes.errors.quantityGreaterThanZero');
      }
      if (!newErrors.items) {
        const { total } = calculateTotals(formData.items, discountValue);
        if (!Number.isFinite(total) || total <= 0) {
          newErrors.total = t('crm:quotes.errors.totalGreaterThanZero');
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const itemsWithSnapshots = (formData.items || []).map((item) => {
      const product = products.find((p) => p.id === item.productId);
      const bid = item.specialBidId
        ? specialBids.find((b) => b.id === item.specialBidId)
        : undefined;
      const hasBid = Boolean(item.specialBidId);

      const productCost = Number(item.productCost ?? product?.costo ?? 0);
      const productMolPercentage = item.productMolPercentage ?? product?.molPercentage ?? null;

      const specialBidUnitPrice = hasBid
        ? Number(item.specialBidUnitPrice ?? bid?.unitPrice ?? 0)
        : null;
      const specialBidMolPercentage = hasBid
        ? (item.specialBidMolPercentage ?? bid?.molPercentage ?? null)
        : null;

      return {
        ...item,
        unitPrice: roundToTwoDecimals(item.unitPrice),
        discount: item.discount ? roundToTwoDecimals(item.discount) : 0,
        productCost: roundToTwoDecimals(productCost),
        productMolPercentage:
          productMolPercentage !== null ? roundToTwoDecimals(Number(productMolPercentage)) : null,
        specialBidUnitPrice:
          specialBidUnitPrice !== null ? roundToTwoDecimals(specialBidUnitPrice) : null,
        specialBidMolPercentage:
          specialBidMolPercentage !== null
            ? roundToTwoDecimals(Number(specialBidMolPercentage))
            : null,
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

  const handleClientChange = (clientId: string) => {
    if (isReadOnly) return;
    const client = clients.find((c) => c.id === clientId);
    setFormData((prev) => {
      const updatedItems = (prev.items || []).map((item) => {
        if (!item.productId) {
          if (item.specialBidId) {
            return { ...item, specialBidId: '' };
          }
          return item;
        }

        const product = products.find((p) => p.id === item.productId);
        if (!product) {
          return { ...item, specialBidId: '' };
        }

        const applicableBid = activeSpecialBids.find(
          (b) => b.clientId === clientId && b.productId === item.productId,
        );
        const molSource = applicableBid?.molPercentage ?? product.molPercentage;
        const mol = molSource ? Number(molSource) : 0;
        const cost = applicableBid ? Number(applicableBid.unitPrice) : Number(product.costo);

        return {
          ...item,
          specialBidId: applicableBid ? applicableBid.id : '',
          unitPrice: calcProductSalePrice(cost, mol),
          productCost: Number(product.costo),
          productMolPercentage: product.molPercentage,
          specialBidUnitPrice: applicableBid ? Number(applicableBid.unitPrice) : null,
          specialBidMolPercentage: applicableBid?.molPercentage ?? null,
        };
      });

      return {
        ...prev,
        clientId,
        clientName: client?.name || '',
        items: updatedItems,
      };
    });
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
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      specialBidUnitPrice: null,
      specialBidMolPercentage: null,
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

        // Check for applicable special bid
        const applicableBid = activeSpecialBids.find(
          (b) => b.clientId === formData.clientId && b.productId === value,
        );

        if (applicableBid) {
          newItems[index].specialBidId = applicableBid.id;
          // Bid price is the new COST. Calculate sale price based on this cost and margin.
          const molSource = applicableBid.molPercentage ?? product.molPercentage;
          const mol = molSource ? Number(molSource) : 0;
          console.log(`[SpecialBid] Bid: ${applicableBid.unitPrice}, Mol: ${mol}`);
          newItems[index].unitPrice = calcProductSalePrice(Number(applicableBid.unitPrice), mol);
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
          newItems[index].specialBidUnitPrice = Number(applicableBid.unitPrice);
          newItems[index].specialBidMolPercentage = applicableBid.molPercentage ?? null;
        } else {
          const mol = product.molPercentage ? Number(product.molPercentage) : 0;
          newItems[index].unitPrice = calcProductSalePrice(Number(product.costo), mol);
          newItems[index].specialBidId = '';
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
          newItems[index].specialBidUnitPrice = null;
          newItems[index].specialBidMolPercentage = null;
        }
      }
    }

    if (field === 'specialBidId') {
      if (!value) {
        newItems[index].specialBidId = '';
        newItems[index].specialBidUnitPrice = null;
        newItems[index].specialBidMolPercentage = null;
        // Revert to standard product cost
        const product = products.find((p) => p.id === newItems[index].productId);
        if (product) {
          const mol = product.molPercentage ? Number(product.molPercentage) : 0;
          newItems[index].unitPrice = calcProductSalePrice(Number(product.costo), mol);
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
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
          // Bid selected: Use bid price as COST
          const molSource = bid.molPercentage ?? product.molPercentage;
          const mol = molSource ? Number(molSource) : 0;
          newItems[index].unitPrice = calcProductSalePrice(Number(bid.unitPrice), mol);
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
          newItems[index].specialBidUnitPrice = Number(bid.unitPrice);
          newItems[index].specialBidMolPercentage = bid.molPercentage ?? null;
        }
      }
    }

    setFormData({ ...formData, items: newItems });
  };

  // Calculate totals (used in form)
  const calculateTotals = useCallback(
    (items: QuoteItem[], globalDiscount: number) => {
      let subtotal = 0;
      let totalCost = 0;
      const taxGroups: Record<number, number> = {};

      items.forEach((item) => {
        const product = products.find((p) => p.id === item.productId);
        const lineSubtotal = item.quantity * item.unitPrice;
        const lineDiscount = item.discount ? (lineSubtotal * item.discount) / 100 : 0;
        const lineNet = lineSubtotal - lineDiscount;

        subtotal += lineNet;

        if (product) {
          const taxRate = product.taxRate;
          // Applying global discount proportionally to the tax base
          const lineNetAfterGlobal = lineNet * (1 - globalDiscount / 100);
          const taxAmount = lineNetAfterGlobal * (taxRate / 100);
          taxGroups[taxRate] = (taxGroups[taxRate] || 0) + taxAmount;

          // Determine cost: use stored snapshot values to avoid retroactive changes
          const cost = item.specialBidId
            ? Number(item.specialBidUnitPrice ?? 0)
            : Number(item.productCost ?? product.costo);

          totalCost += item.quantity * cost;
        }
      });

      const discountAmount = subtotal * (globalDiscount / 100);
      const taxableAmount = subtotal - discountAmount;
      const totalTax = Object.values(taxGroups).reduce((sum, val) => sum + val, 0);
      const total = taxableAmount + totalTax;
      const margin = taxableAmount - totalCost;
      const marginPercentage = taxableAmount > 0 ? (margin / taxableAmount) * 100 : 0;

      return {
        subtotal,
        taxableAmount,
        discountAmount,
        totalTax,
        total,
        margin,
        marginPercentage,
        taxGroups,
      };
    },
    [products],
  );

  const activeClients = clients.filter((c) => !c.isDisabled);
  const activeProducts = products.filter((p) => !p.isDisabled);
  const activeSpecialBids = specialBids.filter((b) => {
    const now = new Date();
    const startDate = b.startDate ? new Date(b.startDate) : null;
    const endDate = b.endDate ? new Date(b.endDate) : null;
    if (!startDate || !endDate) return true;
    return now >= startDate && now <= endDate;
  });
  const clientSpecialBids = formData.clientId
    ? activeSpecialBids.filter((b) => b.clientId === formData.clientId)
    : activeSpecialBids;

  const getBidDisplayValue = (bidId?: string) => {
    if (!bidId) return t('crm:quotes.noSpecialBid');
    const bid =
      activeSpecialBids.find((b) => b.id === bidId) || specialBids.find((b) => b.id === bidId);
    return bid ? `${bid.clientName} · ${bid.productName}` : t('crm:quotes.noSpecialBid');
  };

  // Helper functions are now defined above with useCallback

  // Column definitions for StandardTable
  const columns = useMemo<Column<Quote>[]>(
    () => [
      {
        header: t('crm:quotes.clientColumn'),
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
        header: t('crm:quotes.quoteCodeColumn'),
        accessorKey: 'quoteCode',
        cell: ({ row }) => (
          <div className="font-mono text-sm font-bold text-slate-500">{row.quoteCode}</div>
        ),
      },
      {
        header: t('crm:quotes.totalColumn'),
        id: 'total',
        accessorFn: (row) => calculateQuoteTotals(row.items, row.discount).total,
        disableFiltering: true,
        cell: ({ row }) => {
          const { total } = calculateQuoteTotals(row.items, row.discount);
          const history = isHistoryRow(row);
          return (
            <span className={`text-sm font-bold ${history ? 'text-slate-400' : 'text-slate-700'}`}>
              {total.toFixed(2)} {currency}
            </span>
          );
        },
      },
      {
        header: t('crm:quotes.paymentTermsColumn'),
        accessorKey: 'paymentTerms',
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <span
              className={`text-sm font-semibold ${history ? 'text-slate-400' : 'text-slate-600'}`}
            >
              {row.paymentTerms === 'immediate'
                ? t('crm:quotes.immediatePayment')
                : row.paymentTerms}
            </span>
          );
        },
      },
      {
        header: t('crm:quotes.expirationColumn'),
        accessorKey: 'expirationDate',
        cell: ({ row }) => {
          const expired = isQuoteExpired(row);
          const history = isHistoryRow(row);
          return (
            <div
              className={`text-sm ${
                history ? 'text-slate-400' : expired ? 'text-red-600 font-bold' : 'text-slate-600'
              }`}
            >
              {new Date(row.expirationDate).toLocaleDateString()}
              {expired && !history && (
                <span className="ml-2 text-[10px] font-black">{t('crm:quotes.expiredLabel')}</span>
              )}
            </div>
          );
        },
      },
      {
        header: t('crm:quotes.statusColumn'),
        accessorKey: 'status',
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
        header: t('crm:quotes.actionsColumn'),
        id: 'actions',
        align: 'right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => {
          const expired = isQuoteExpired(row);
          const hasSale = hasSaleForQuote(row);
          const saleStatus = getSaleStatusForQuote(row);
          const history = isHistoryRow(row);

          const isDeleteDisabled = expired || row.status !== 'draft' || history;
          const deleteTitle = history
            ? t('crm:quotes.historyActionsDisabled', {
                defaultValue: 'History entries cannot be modified.',
              })
            : expired
              ? t('crm:quotes.errors.expiredCannotDelete')
              : t('crm:quotes.deleteQuote');

          const isCreateSaleDisabled = history || hasSale;
          const createSaleTitle = hasSale
            ? t('crm:quotes.saleAlreadyExists', {
                defaultValue: 'A sale order for this quote already exists.',
              })
            : history
              ? t('crm:quotes.historyActionsDisabled', {
                  defaultValue: 'History entries cannot be modified.',
                })
              : t('crm:quotes.convertToSale');

          const canRestore = !hasSale || saleStatus === 'draft';
          const restoreTitle = !canRestore
            ? t('crm:quotes.restoreDisabledSaleStatus', {
                defaultValue:
                  'Restore is only possible when the linked sale order is in draft status.',
              })
            : t('crm:quotes.restoreQuote', { defaultValue: 'Restore quote' });

          return (
            <div className="flex justify-end gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (history) return;
                  openEditModal(row);
                }}
                disabled={history}
                className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
                title={
                  history
                    ? t('crm:quotes.historyActionsDisabled', {
                        defaultValue: 'History entries cannot be modified.',
                      })
                    : t('crm:quotes.editQuote')
                }
              >
                <i className="fa-solid fa-pen-to-square"></i>
              </button>
              {row.status === 'accepted' && onCreateSale && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCreateSaleDisabled) return;
                    onCreateSale(row);
                  }}
                  disabled={isCreateSaleDisabled}
                  className={`p-2 rounded-lg transition-all ${isCreateSaleDisabled ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
                  title={createSaleTitle}
                >
                  <i className="fa-solid fa-cart-plus"></i>
                </button>
              )}
              {row.status === 'draft' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (history) return;
                    onUpdateQuote(row.id, { status: 'sent' });
                  }}
                  disabled={history}
                  className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                  title={
                    history
                      ? t('crm:quotes.historyActionsDisabled', {
                          defaultValue: 'History entries cannot be modified.',
                        })
                      : t('crm:quotes.markAsSent')
                  }
                >
                  <i className="fa-solid fa-paper-plane"></i>
                </button>
              )}
              {row.status === 'sent' && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (history) return;
                      onUpdateQuote(row.id, { status: 'accepted' });
                    }}
                    disabled={history}
                    className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                    title={
                      history
                        ? t('crm:quotes.historyActionsDisabled', {
                            defaultValue: 'History entries cannot be modified.',
                          })
                        : t('crm:quotes.markAsConfirmed')
                    }
                  >
                    <i className="fa-solid fa-check"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (history) return;
                      onUpdateQuote(row.id, { status: 'denied' });
                    }}
                    disabled={history}
                    className={`p-2 rounded-lg transition-all ${history ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                    title={
                      history
                        ? t('crm:quotes.historyActionsDisabled', {
                            defaultValue: 'History entries cannot be modified.',
                          })
                        : t('crm:quotes.markAsDenied')
                    }
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </>
              )}
              {row.status === 'draft' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isDeleteDisabled) return;
                    confirmDelete(row);
                  }}
                  disabled={isDeleteDisabled}
                  className={`p-2 text-slate-400 rounded-lg transition-all ${isDeleteDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-red-600 hover:bg-red-50'}`}
                  title={deleteTitle}
                >
                  <i className="fa-solid fa-trash-can"></i>
                </button>
              )}
              {history && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canRestore) return;
                    onUpdateQuote(row.id, { status: 'draft', isExpired: false });
                  }}
                  disabled={!canRestore}
                  className={`p-2 rounded-lg transition-all ${canRestore ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50' : 'cursor-not-allowed opacity-50 text-slate-400'}`}
                  title={restoreTitle}
                >
                  <i className="fa-solid fa-rotate-left"></i>
                </button>
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
      hasSaleForQuote,
      getSaleStatusForQuote,
      calculateQuoteTotals,
      getStatusLabel,
      onCreateSale,
      onUpdateQuote,
      confirmDelete,
      openEditModal,
    ],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingQuote ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {isReadOnly
                ? t('crm:quotes.viewQuote')
                : editingQuote
                  ? t('crm:quotes.editQuote')
                  : t('crm:quotes.createNewQuote')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
            {isReadOnly && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                <span className="text-amber-700 text-xs font-bold">
                  {t('crm:quotes.readOnlyStatus', {
                    status: getStatusLabel(editingQuote?.status || ''),
                  })}
                </span>
              </div>
            )}
            {/* Client Selection */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:quotes.clientInformation')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:quotes.client')}
                  </label>
                  <CustomSelect
                    options={activeClients.map((c) => ({ id: c.id, name: c.name }))}
                    value={formData.clientId || ''}
                    onChange={(val) => handleClientChange(val as string)}
                    placeholder={t('crm:quotes.selectAClient')}
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
                    {t('crm:quotes.quoteCode', { defaultValue: 'Quote Code' })}
                  </label>
                  <input
                    type="text"
                    value={formData.quoteCode || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, quoteCode: e.target.value });
                      if (errors.quoteCode) {
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.quoteCode;
                          return next;
                        });
                      }
                    }}
                    placeholder="Q0000"
                    disabled={isReadOnly}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border ${
                      errors.quoteCode ? 'border-red-300' : 'border-slate-200'
                    } rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                  {errors.quoteCode && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.quoteCode}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:quotes.paymentTerms')}
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
                    {t('crm:quotes.globalDiscount')}
                  </label>
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
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:quotes.expirationDateLabel')}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.expirationDate}
                    onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                    disabled={isReadOnly}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="col-span-full space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:quotes.notesLabel')}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder={t('crm:quotes.additionalNotesPlaceholder')}
                    disabled={isReadOnly}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* Products */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('crm:quotes.productsServices')}
                </h4>
                <button
                  type="button"
                  onClick={addProductRow}
                  disabled={isReadOnly}
                  className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="fa-solid fa-plus"></i> {t('crm:quotes.addProduct')}
                </button>
              </div>
              {errors.items && (
                <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
              )}

              {formData.items && formData.items.length > 0 && (
                <div className="flex gap-3 px-3 mb-1 items-center">
                  <div className="flex-1 grid grid-cols-12 gap-3">
                    <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                      {t('crm:specialBids.title')}
                    </div>
                    <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      {t('crm:quotes.productsServices')}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('crm:quotes.qty')}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('crm:products.cost')}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      MOL (%)
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('crm:quotes.marginLabel')}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('crm:products.salePrice')}
                    </div>
                  </div>
                  <div className="w-10 flex-shrink-0"></div>
                </div>
              )}

              {formData.items && formData.items.length > 0 ? (
                <div className="space-y-3">
                  {formData.items.map((item, index) => {
                    const selectedProduct = activeProducts.find((p) => p.id === item.productId);
                    const selectedBid = item.specialBidId
                      ? specialBids.find((b) => b.id === item.specialBidId)
                      : undefined;

                    // Cost is the bid price if selected, otherwise product cost
                    const cost = item.specialBidId
                      ? (item.specialBidUnitPrice ?? selectedBid?.unitPrice ?? 0)
                      : (item.productCost ?? selectedProduct?.costo ?? 0);

                    const molSource = item.specialBidId
                      ? (item.specialBidMolPercentage ?? selectedBid?.molPercentage)
                      : (item.productMolPercentage ?? selectedProduct?.molPercentage);
                    const molPercentage = molSource ? Number(molSource) : 0;
                    const quantity = Number(item.quantity || 0);
                    const lineCost = cost * quantity;
                    const unitSalePrice = calcProductSalePrice(cost, molPercentage);
                    const lineSalePrice = unitSalePrice * quantity;
                    const lineMargin = lineSalePrice - lineCost;
                    return (
                      <div key={item.id} className="bg-slate-50 p-3 rounded-xl space-y-2">
                        <div className="flex gap-3 items-center">
                          <div className="flex-1 grid grid-cols-12 gap-3 items-center">
                            <div className="col-span-3">
                              <CustomSelect
                                options={[
                                  { id: 'none', name: t('crm:quotes.noSpecialBidOption') },
                                  ...clientSpecialBids.map((b) => ({
                                    id: b.id,
                                    name: `${b.clientName} · ${b.productName}`,
                                  })),
                                ]}
                                value={item.specialBidId || 'none'}
                                onChange={(val) =>
                                  updateProductRow(
                                    index,
                                    'specialBidId',
                                    val === 'none' ? '' : (val as string),
                                  )
                                }
                                placeholder={t('crm:quotes.selectBid')}
                                displayValue={getBidDisplayValue(item.specialBidId)}
                                searchable={true}
                                disabled={isReadOnly}
                                buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                              />
                            </div>
                            <div className="col-span-3">
                              <CustomSelect
                                options={activeProducts.map((p) => ({ id: p.id, name: p.name }))}
                                value={item.productId}
                                onChange={(val) =>
                                  updateProductRow(index, 'productId', val as string)
                                }
                                placeholder={t('crm:quotes.selectProduct')}
                                searchable={true}
                                disabled={isReadOnly}
                                buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                              />
                            </div>
                            <div className="col-span-1">
                              <ValidatedNumberInput
                                step="0.01"
                                min="0"
                                required
                                placeholder={t('crm:quotes.qty')}
                                value={item.quantity}
                                onValueChange={(value) => {
                                  const parsed = parseFloat(value);
                                  updateProductRow(
                                    index,
                                    'quantity',
                                    value === '' || Number.isNaN(parsed) ? 0 : parsed,
                                  );
                                }}
                                disabled={isReadOnly}
                                className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                            </div>
                            <div className="col-span-1 flex flex-col items-center justify-center gap-1">
                              {selectedBid && (
                                <span className="px-2 py-0.5 rounded-full bg-praetor text-white text-[8px] font-black uppercase tracking-wider">
                                  {t('crm:quotes.bidBadge')}
                                </span>
                              )}
                              <span className="text-xs font-bold text-slate-600">
                                {lineCost.toFixed(2)} {currency}
                              </span>
                            </div>
                            <div className="col-span-1 flex items-center justify-center">
                              <span className="text-xs font-bold text-slate-600">
                                {molPercentage.toFixed(1)}%
                              </span>
                            </div>
                            <div className="col-span-1 flex items-center justify-center">
                              <span className="text-xs font-bold text-emerald-600">
                                {lineMargin.toFixed(2)} {currency}
                              </span>
                            </div>
                            <div className="col-span-2 flex items-center justify-center">
                              <span
                                className={`text-sm font-semibold ${selectedBid ? 'text-praetor' : 'text-slate-800'}`}
                              >
                                {lineSalePrice.toFixed(2)} {currency}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeProductRow(index)}
                            disabled={isReadOnly}
                            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  {t('crm:quotes.noProductsAdded')}
                </div>
              )}
            </div>

            {/* Totals Section - Right Aligned */}
            {formData.items && formData.items.length > 0 && (
              <div className="mt-4 flex flex-col items-end space-y-2 px-3">
                {(() => {
                  const discountValue = Number.isNaN(formData.discount ?? 0)
                    ? 0
                    : (formData.discount ?? 0);
                  const { subtotal, discountAmount, total, margin, marginPercentage, taxGroups } =
                    calculateTotals(formData.items, discountValue);
                  return (
                    <>
                      {errors.total && (
                        <p className="text-red-500 text-[10px] font-bold mb-2">{errors.total}</p>
                      )}

                      {/* Imponibile */}
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-bold text-slate-500">
                          {t('crm:quotes.taxableAmount')}:
                        </span>
                        <span className="text-sm font-black text-slate-800">
                          {subtotal.toFixed(2)} {currency}
                        </span>
                      </div>

                      {/* Sconto */}
                      {formData.discount! > 0 && (
                        <div className="flex items-center gap-4">
                          <span className="text-sm font-bold text-slate-500">
                            {t('crm:quotes.discountLabel', { defaultValue: 'Sconto' })} (
                            {formData.discount}%):
                          </span>
                          <span className="text-sm font-black text-amber-600">
                            -{discountAmount.toFixed(2)} {currency}
                          </span>
                        </div>
                      )}

                      {/* IVA */}
                      {Object.entries(taxGroups).map(([rate, amount]) => (
                        <div key={rate} className="flex items-center gap-4">
                          <span className="text-sm font-bold text-slate-500">
                            {t('crm:quotes.ivaTax', { rate })}:
                          </span>
                          <span className="text-sm font-black text-slate-800">
                            {amount.toFixed(2)} {currency}
                          </span>
                        </div>
                      ))}

                      {/* Margin */}
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-bold text-emerald-600">
                          {t('crm:quotes.marginLabel')} ({(marginPercentage || 0).toFixed(1)}%):
                        </span>
                        <span className="text-sm font-black text-emerald-600">
                          {margin.toFixed(2)} {currency}
                        </span>
                      </div>

                      {/* Total */}
                      <div className="flex items-center gap-4 pt-2 mt-2 border-t border-slate-100">
                        <span className="text-lg font-black text-slate-400 uppercase tracking-widest">
                          {t('crm:quotes.totalLabel')}:
                        </span>
                        <span className="text-3xl font-black text-praetor">
                          {total.toFixed(2)}{' '}
                          <span className="text-lg text-slate-400 font-bold">{currency}</span>
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            <div className="flex justify-between items-center pt-8 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-8 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                disabled={isReadOnly}
                className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isReadOnly
                  ? t('crm:quotes.statusQuote', {
                      status: getStatusLabel(editingQuote?.status || ''),
                    })
                  : editingQuote
                    ? t('crm:quotes.updateQuote')
                    : t('crm:quotes.createQuote')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">{t('crm:quotes.deleteQuote')}?</h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('crm:quotes.deleteConfirm', { clientName: quoteToDelete?.clientName })}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('common:buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('crm:quotes.quotesTitle')}</h2>
          <p className="text-slate-500 text-sm">{t('crm:quotes.quotesSubtitle')}</p>
        </div>
      </div>

      {/* Search and Filters */}

      <StandardTable<Quote>
        title={t('crm:quotes.activeQuotes')}
        data={quotes}
        columns={columns}
        defaultRowsPerPage={5}
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
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('crm:quotes.createNewQuote')}
          </button>
        }
      />
    </div>
  );
};

export default QuotesView;
