import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Quote, QuoteItem, Client, Product, SpecialBid, Sale } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import ValidatedNumberInput from './ValidatedNumberInput';
import StatusBadge, { StatusType } from './StatusBadge';
import { parseNumberInputValue } from '../utils/numbers';

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

  const getStatusLabel = (status: string) => {
    const option = STATUS_OPTIONS.find((o) => o.id === status);
    return option ? option.name : status;
  };

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_quotes_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_quotes_rowsPerPage', value.toString());
    setCurrentPage(1); // Reset to first page
    setHistoryPage(1);
  };

  // Filter State
  /* Filters removed */
  const filteredQuotes = quotes;

  // Form State
  const [formData, setFormData] = useState<Partial<Quote>>({
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

  const openEditModal = (quote: Quote) => {
    setEditingQuote(quote);
    // Ensure expirationDate is in YYYY-MM-DD format for the date input
    const formattedDate = quote.expirationDate
      ? new Date(quote.expirationDate).toISOString().split('T')[0]
      : '';
    setFormData({
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
  };

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
        productCost,
        productMolPercentage,
        specialBidUnitPrice,
        specialBidMolPercentage,
      };
    });

    const payload = {
      ...formData,
      items: itemsWithSnapshots,
    };

    if (editingQuote) {
      await onUpdateQuote(editingQuote.id, payload);
    } else {
      await onAddQuote(payload);
    }
    setIsModalOpen(false);
  };

  const confirmDelete = (quote: Quote) => {
    setQuoteToDelete(quote);
    setIsDeleteConfirmOpen(true);
  };

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

  // Calculate totals
  const calculateTotals = (items: QuoteItem[], globalDiscount: number) => {
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
  };

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

  // Check if quote is expired
  const isExpired = (expirationDate: string) => {
    const normalizedDate = expirationDate.includes('T')
      ? expirationDate
      : `${expirationDate}T00:00:00`;
    const expiry = new Date(normalizedDate);
    expiry.setDate(expiry.getDate() + 1);
    return new Date() >= expiry;
  };

  const isQuoteExpired = (quote: Quote) =>
    quote.status !== 'accepted' &&
    quote.status !== 'denied' &&
    quote.isExpired !== false &&
    (quote.isExpired === true || isExpired(quote.expirationDate));
  const hasSaleForQuote = (quote: Quote) => Boolean(quoteIdsWithSales?.has(quote.id));
  const getSaleStatusForQuote = (quote: Quote) => quoteSaleStatuses?.[quote.id];
  const isQuoteHistory = (quote: Quote) =>
    quote.status === 'denied' || isQuoteExpired(quote) || hasSaleForQuote(quote);
  const sortedQuotes = filteredQuotes;
  const filteredActiveQuotes = sortedQuotes.filter((quote) => !isQuoteHistory(quote));
  const filteredHistoryQuotes = sortedQuotes.filter((quote) => isQuoteHistory(quote));

  // Pagination Logic
  const activeTotalPages = Math.ceil(filteredActiveQuotes.length / rowsPerPage);
  const activeStartIndex = (currentPage - 1) * rowsPerPage;
  const paginatedActiveQuotes = filteredActiveQuotes.slice(
    activeStartIndex,
    activeStartIndex + rowsPerPage,
  );

  const historyTotalPages = Math.ceil(filteredHistoryQuotes.length / rowsPerPage);
  const historyStartIndex = (historyPage - 1) * rowsPerPage;
  const paginatedHistoryQuotes = filteredHistoryQuotes.slice(
    historyStartIndex,
    historyStartIndex + rowsPerPage,
  );

  const renderQuoteRow = (quote: Quote, isHistory = false) => {
    const { total } = calculateTotals(quote.items, quote.discount);
    const expired = isQuoteExpired(quote);
    const hasSale = hasSaleForQuote(quote);
    const saleStatus = getSaleStatusForQuote(quote);
    const isHistoryRow = Boolean(isHistory);

    const isDeleteDisabled = expired || quote.status !== 'draft' || isHistoryRow;
    const deleteTitle = isHistoryRow
      ? t('crm:quotes.historyActionsDisabled', {
          defaultValue: 'History entries cannot be modified.',
        })
      : expired
        ? t('crm:quotes.errors.expiredCannotDelete')
        : t('crm:quotes.deleteQuote');

    const isCreateSaleDisabled = isHistoryRow || hasSale;
    const createSaleTitle = hasSale
      ? t('crm:quotes.saleAlreadyExists', {
          defaultValue: 'A sale order for this quote already exists.',
        })
      : isHistoryRow
        ? t('crm:quotes.historyActionsDisabled', {
            defaultValue: 'History entries cannot be modified.',
          })
        : t('crm:quotes.convertToSale');

    const canRestore = !hasSale || saleStatus === 'draft';
    const restoreTitle = !canRestore
      ? t('crm:quotes.restoreDisabledSaleStatus', {
          defaultValue: 'Restore is only possible when the linked sale order is in draft status.',
        })
      : t('crm:quotes.restoreQuote', { defaultValue: 'Restore quote' });
    return (
      <tr
        key={quote.id}
        onClick={isHistoryRow ? undefined : () => openEditModal(quote)}
        className={`transition-colors group ${isHistoryRow ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50/50 cursor-pointer'} ${!isHistoryRow && expired ? 'bg-red-50/30' : ''}`}
      >
        <td className="px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
              <i className="fa-solid fa-file-invoice"></i>
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-400 tracking-wider">
                ID {quote.id}
              </div>
              <div
                className={isHistoryRow ? 'font-bold text-slate-400' : 'font-bold text-slate-800'}
              >
                {quote.clientName}
              </div>
              <div className="text-[10px] font-black text-slate-400 uppercase">
                {t('crm:quotes.itemsCount', { count: quote.items.length })}
              </div>
            </div>
          </div>
        </td>
        <td className="px-8 py-5">
          <div className={isHistoryRow ? 'opacity-60' : ''}>
            <StatusBadge
              type={expired ? 'expired' : (quote.status as StatusType)}
              label={getStatusLabel(quote.status)}
            />
          </div>
        </td>
        <td
          className={`px-8 py-5 text-sm font-bold ${
            isHistoryRow ? 'text-slate-400' : 'text-slate-700'
          }`}
        >
          {total.toFixed(2)} {currency}
        </td>
        <td
          className={`px-8 py-5 text-sm font-semibold ${
            isHistoryRow ? 'text-slate-400' : 'text-slate-600'
          }`}
        >
          {quote.paymentTerms === 'immediate'
            ? t('crm:quotes.immediatePayment')
            : quote.paymentTerms}
        </td>
        <td className="px-8 py-5">
          <div
            className={`text-sm ${
              isHistoryRow
                ? 'text-slate-400'
                : expired
                  ? 'text-red-600 font-bold'
                  : 'text-slate-600'
            }`}
          >
            {new Date(quote.expirationDate).toLocaleDateString()}
            {expired && !isHistoryRow && (
              <span className="ml-2 text-[10px] font-black">{t('crm:quotes.expiredLabel')}</span>
            )}
          </div>
        </td>
        <td className="px-8 py-5">
          <div className="flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isHistoryRow) return;
                openEditModal(quote);
              }}
              disabled={isHistoryRow}
              className={`p-2 rounded-lg transition-all ${isHistoryRow ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
              title={
                isHistoryRow
                  ? t('crm:quotes.historyActionsDisabled', {
                      defaultValue: 'History entries cannot be modified.',
                    })
                  : t('crm:quotes.editQuote')
              }
            >
              <i className="fa-solid fa-pen-to-square"></i>
            </button>
            {quote.status === 'accepted' && onCreateSale && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isCreateSaleDisabled) return;
                  onCreateSale(quote);
                }}
                disabled={isCreateSaleDisabled}
                className={`p-2 rounded-lg transition-all ${isCreateSaleDisabled ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
                title={createSaleTitle}
              >
                <i className="fa-solid fa-cart-plus"></i>
              </button>
            )}
            {quote.status === 'draft' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isHistoryRow) return;
                  onUpdateQuote(quote.id, { status: 'sent' });
                }}
                disabled={isHistoryRow}
                className={`p-2 rounded-lg transition-all ${isHistoryRow ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                title={
                  isHistoryRow
                    ? t('crm:quotes.historyActionsDisabled', {
                        defaultValue: 'History entries cannot be modified.',
                      })
                    : t('crm:quotes.markAsSent')
                }
              >
                <i className="fa-solid fa-paper-plane"></i>
              </button>
            )}
            {quote.status === 'sent' && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isHistoryRow) return;
                    onUpdateQuote(quote.id, { status: 'accepted' });
                  }}
                  disabled={isHistoryRow}
                  className={`p-2 rounded-lg transition-all ${isHistoryRow ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                  title={
                    isHistoryRow
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
                    if (isHistoryRow) return;
                    onUpdateQuote(quote.id, { status: 'denied' });
                  }}
                  disabled={isHistoryRow}
                  className={`p-2 rounded-lg transition-all ${isHistoryRow ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                  title={
                    isHistoryRow
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
            {quote.status === 'draft' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDeleteDisabled) return;
                  confirmDelete(quote);
                }}
                disabled={isDeleteDisabled}
                className={`p-2 text-slate-400 rounded-lg transition-all ${isDeleteDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-red-600 hover:bg-red-50'}`}
                title={deleteTitle}
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            )}
            {isHistoryRow && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canRestore) return;
                  onUpdateQuote(quote.id, { status: 'draft', isExpired: false });
                }}
                disabled={!canRestore}
                className={`p-2 rounded-lg transition-all ${canRestore ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50' : 'cursor-not-allowed opacity-50 text-slate-400'}`}
                title={restoreTitle}
              >
                <i className="fa-solid fa-rotate-left"></i>
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
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
                      status: '',
                    }).replace(': {{status}}', ':')}
                  </span>
                  <StatusBadge
                    type={editingQuote?.status as StatusType}
                    label={getStatusLabel(editingQuote?.status || '')}
                  />
                </div>
              )}
              {/* Client Selection */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('crm:quotes.clientInformation')}
                </h4>
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

              {/* Quote Details */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('crm:quotes.quoteDetails')}
                </h4>
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

              {/* Totals Section */}
              {formData.items && formData.items.length > 0 && (
                <div className="pt-8 border-t border-slate-100">
                  {(() => {
                    const discountValue = Number.isNaN(formData.discount ?? 0)
                      ? 0
                      : (formData.discount ?? 0);
                    const {
                      subtotal,
                      discountAmount,

                      total,
                      margin,
                      marginPercentage,
                      taxGroups,
                    } = calculateTotals(formData.items, discountValue);
                    return (
                      <>
                        {errors.total && (
                          <p className="text-red-500 text-[10px] font-bold ml-1 mb-2">
                            {errors.total}
                          </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
                          {/* Left Column: Detailed Breakdown */}
                          <div className="flex flex-col justify-center space-y-3 h-full">
                            <div className="flex justify-between items-center px-2">
                              <span className="text-sm font-bold text-slate-500">
                                {t('crm:quotes.taxableAmount')}:
                              </span>
                              <span className="text-sm font-black text-slate-800">
                                {subtotal.toFixed(2)} {currency}
                              </span>
                            </div>

                            {formData.discount! > 0 && (
                              <div className="flex justify-between items-center px-2">
                                <span className="text-sm font-bold text-slate-500">
                                  {t('crm:quotes.discountAmount', { discount: formData.discount })}:
                                </span>
                                <span className="text-sm font-black text-amber-600">
                                  -{discountAmount.toFixed(2)} {currency}
                                </span>
                              </div>
                            )}

                            {Object.entries(taxGroups).map(([rate, amount]) => (
                              <div key={rate} className="flex justify-between items-center px-2">
                                <span className="text-sm font-bold text-slate-500">
                                  {t('crm:quotes.ivaTax', { rate })}:
                                </span>
                                <span className="text-sm font-black text-slate-800">
                                  {amount.toFixed(2)} {currency}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Middle Column: Final Total */}
                          <div className="flex flex-col items-center justify-center py-4 bg-slate-50/50 rounded-2xl border border-slate-100/50">
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">
                              {t('crm:quotes.totalLabel')}:
                            </span>
                            <span className="text-4xl font-black text-praetor leading-none">
                              {total.toFixed(2)}
                              <span className="text-xl ml-1 opacity-60 text-slate-400">
                                {currency}
                              </span>
                            </span>
                          </div>

                          {/* Right Column: Margin */}
                          <div className="bg-emerald-50/40 rounded-2xl p-6 flex flex-col items-center justify-center border border-emerald-100/30">
                            <span className="text-xs font-black text-emerald-600 uppercase tracking-widest mb-2">
                              {t('crm:quotes.marginLabel')}:
                            </span>
                            <div className="text-center">
                              <div className="text-2xl font-black text-emerald-700 leading-none mb-1">
                                {margin.toFixed(2)} {currency}
                              </div>
                              <div className="text-xs font-black text-emerald-500 opacity-60">
                                ({marginPercentage.toFixed(1)}%)
                              </div>
                            </div>
                          </div>
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
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {t('crm:quotes.deleteQuote')}?
                </h3>
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
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('crm:quotes.quotesTitle')}</h2>
          <p className="text-slate-500 text-sm">{t('crm:quotes.quotesSubtitle')}</p>
        </div>
      </div>

      {/* Search and Filters */}

      <StandardTable
        title={t('crm:quotes.activeQuotes')}
        totalCount={filteredActiveQuotes.length}
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('crm:quotes.createNewQuote')}
          </button>
        }
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('crm:quotes.rowsPerPage')}
              </span>
              <CustomSelect
                options={[
                  { id: '5', name: '5' },
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={rowsPerPage.toString()}
                onChange={(val) => handleRowsPerPageChange(val as string)}
                className="w-20"
                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                searchable={false}
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('common:pagination.showing', {
                  start: paginatedActiveQuotes.length > 0 ? activeStartIndex + 1 : 0,
                  end: Math.min(activeStartIndex + rowsPerPage, filteredActiveQuotes.length),
                  total: filteredActiveQuotes.length,
                })}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-left text-xs"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: activeTotalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      currentPage === page
                        ? 'bg-praetor text-white shadow-md shadow-slate-200'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(activeTotalPages, prev + 1))}
                disabled={currentPage === activeTotalPages || activeTotalPages === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-right text-xs"></i>
              </button>
            </div>
          </>
        }
      >
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.clientColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.statusColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.totalColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.paymentTermsColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.expirationColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                {t('crm:quotes.actionsColumn')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedActiveQuotes.map((quote) => renderQuoteRow(quote, false))}
            {filteredActiveQuotes.length === 0 && (
              <tr>
                <td colSpan={6} className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                    <i className="fa-solid fa-file-invoice text-2xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-bold">{t('crm:quotes.noQuotes')}</p>
                  <button
                    onClick={openAddModal}
                    className="mt-4 text-praetor text-sm font-black hover:underline"
                  >
                    {t('crm:quotes.createYourFirstQuote')}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StandardTable>

      <StandardTable
        title={t('crm:quotes.historyQuotes', { defaultValue: 'History' })}
        totalCount={filteredHistoryQuotes.length}
        totalLabel={t('crm:quotes.totalLabel')}
        containerClassName="border-dashed bg-slate-50"
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('crm:quotes.rowsPerPage')}
              </span>
              <CustomSelect
                options={[
                  { id: '5', name: '5' },
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={rowsPerPage.toString()}
                onChange={(val) => handleRowsPerPageChange(val as string)}
                className="w-20"
                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                searchable={false}
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('common:pagination.showing', {
                  start: paginatedHistoryQuotes.length > 0 ? historyStartIndex + 1 : 0,
                  end: Math.min(historyStartIndex + rowsPerPage, filteredHistoryQuotes.length),
                  total: filteredHistoryQuotes.length,
                })}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                disabled={historyPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-left text-xs"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: historyTotalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setHistoryPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      historyPage === page
                        ? 'bg-praetor text-white shadow-md shadow-slate-200'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1))}
                disabled={historyPage === historyTotalPages || historyTotalPages === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-right text-xs"></i>
              </button>
            </div>
          </>
        }
      >
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.clientColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.statusColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.totalColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.paymentTermsColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:quotes.expirationColumn')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                {t('crm:quotes.actionsColumn')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedHistoryQuotes.map((quote) => renderQuoteRow(quote, true))}
            {filteredHistoryQuotes.length === 0 && (
              <tr>
                <td colSpan={6} className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                    <i className="fa-solid fa-file-invoice text-2xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-bold">
                    {t('crm:quotes.noHistoryQuotes', { defaultValue: t('crm:quotes.noQuotes') })}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StandardTable>
    </div>
  );
};

export default QuotesView;
