import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Product,
  Supplier,
  SupplierOffer,
  SupplierQuote,
  SupplierQuoteItem,
} from '../../types';
import { getLocalDateString, normalizeDateOnlyString } from '../../utils/date';
import { roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

const getPaymentTermsOptions = (t: (key: string, options?: Record<string, unknown>) => string) => [
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
];

interface TotalsBreakdown {
  subtotal: number;
  discountAmount: number;
  totalTax: number;
  taxGroups: Record<number, number>;
  total: number;
}

const calculateTotals = (
  items: SupplierQuoteItem[],
  globalDiscount: number,
  products: Product[],
): TotalsBreakdown => {
  let subtotal = 0;
  const taxGroups: Record<number, number> = {};
  items.forEach((item) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
    const product = products.find((candidate) => candidate.id === item.productId);
    const taxRate = Number(product?.taxRate ?? 0);
    const lineNetAfterGlobal = lineNet * (1 - globalDiscount / 100);
    const taxAmount = lineNetAfterGlobal * (taxRate / 100);
    taxGroups[taxRate] = (taxGroups[taxRate] || 0) + taxAmount;
  });
  const discountAmount = subtotal * (globalDiscount / 100);
  const totalTax = Object.values(taxGroups).reduce((sum, val) => sum + val, 0);
  const total = subtotal - discountAmount + totalTax;
  return { subtotal, discountAmount, totalTax, taxGroups, total };
};

export interface SupplierQuotesViewProps {
  quotes: SupplierQuote[];
  suppliers: Supplier[];
  products: Product[];
  onAddQuote: (quoteData: Partial<SupplierQuote>) => void | Promise<void>;
  onUpdateQuote: (id: string, updates: Partial<SupplierQuote>) => void | Promise<void>;
  onDeleteQuote: (id: string) => void | Promise<void>;
  onCreateOffer?: (quote: SupplierQuote) => void | Promise<void>;
  quoteFilterId?: string | null;
  quoteIdsWithOffers?: Set<string>;
  quoteIdsWithOrders?: Set<string>;
  onViewOffers?: (quoteId: string) => void;
  onViewOrder?: (quoteId: string) => void;
  onViewOffer?: (offerId: string) => void;
  currency: string;
  offers?: SupplierOffer[];
}

const SupplierQuotesView: React.FC<SupplierQuotesViewProps> = ({
  quotes,
  suppliers,
  products,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onCreateOffer,
  quoteFilterId,
  quoteIdsWithOffers,
  quoteIdsWithOrders,
  onViewOffers,
  onViewOrder,
  onViewOffer,
  currency,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: kept for API compatibility
  offers = [],
}) => {
  const { t } = useTranslation(['sales', 'common', 'crm', 'form']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const statusOptions = useMemo(
    () => [
      { id: 'draft', name: t('sales:supplierQuotes.statusDraft', { defaultValue: 'Draft' }) },
      { id: 'sent', name: t('sales:supplierQuotes.statusSent', { defaultValue: 'Sent' }) },
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
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );

  const filteredQuotes = useMemo(() => {
    if (quoteFilterId) {
      return quotes.filter((q) => q.id === quoteFilterId);
    }
    return quotes;
  }, [quotes, quoteFilterId]);

  const [editingQuote, setEditingQuote] = useState<SupplierQuote | null>(null);
  const [quoteToDelete, setQuoteToDelete] = useState<SupplierQuote | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<SupplierQuote>>({
    supplierId: '',
    supplierName: '',
    quoteCode: '',
    purchaseOrderNumber: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'draft',
    expirationDate: getLocalDateString(),
    notes: '',
  });

  const isReadOnly = Boolean(editingQuote?.linkedOfferId);

  const hasOfferForQuote = useCallback(
    (quote: SupplierQuote) => Boolean(quote.linkedOfferId || quoteIdsWithOffers?.has(quote.id)),
    [quoteIdsWithOffers],
  );

  const isHistoryRow = useCallback(
    (quote: SupplierQuote) => {
      const hasOffer = hasOfferForQuote(quote);
      return quote.status === 'denied' || hasOffer;
    },
    [hasOfferForQuote],
  );

  const totalsBreakdown = calculateTotals(
    formData.items || [],
    Number(formData.discount || 0),
    products,
  );

  const inputClassName =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-praetor disabled:opacity-50 disabled:cursor-not-allowed';
  const itemInputClassName =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-praetor disabled:opacity-50 disabled:cursor-not-allowed';

  const openAddModal = useCallback(() => {
    setEditingQuote(null);
    setFormData({
      supplierId: '',
      supplierName: '',
      quoteCode: '',
      purchaseOrderNumber: '',
      items: [],
      paymentTerms: 'immediate',
      discount: 0,
      status: 'draft',
      expirationDate: getLocalDateString(),
      notes: '',
    });
    setErrors({});
    setIsModalOpen(true);
  }, []);

  const openEditModal = useCallback((quote: SupplierQuote) => {
    setEditingQuote(quote);
    setFormData({
      ...quote,
      quoteCode: quote.quoteCode || quote.purchaseOrderNumber || '',
      purchaseOrderNumber: quote.quoteCode || quote.purchaseOrderNumber || '',
      expirationDate: quote.expirationDate ? normalizeDateOnlyString(quote.expirationDate) : '',
    });
    setErrors({});
    setIsModalOpen(true);
  }, []);

  const getStatusLabel = useCallback(
    (status: string) => {
      const option = statusOptions.find((item) => item.id === status);
      return option ? option.name : status;
    },
    [statusOptions],
  );

  const handleSupplierChange = useCallback(
    (supplierId: string) => {
      const supplier = suppliers.find((item) => item.id === supplierId);
      setFormData((prev) => ({
        ...prev,
        supplierId,
        supplierName: supplier?.name || '',
      }));
    },
    [suppliers],
  );

  const updateItem = useCallback(
    (index: number, field: keyof SupplierQuoteItem, value: string | number) => {
      if (isReadOnly) return;
      setFormData((prev) => {
        const items = [...(prev.items || [])];
        const nextItem = { ...items[index], [field]: value };
        if (field === 'productId') {
          const product = products.find((item) => item.id === value);
          if (product) {
            nextItem.productName = product.name;
            nextItem.unitPrice = Number(product.costo);
          }
        }
        items[index] = nextItem;
        return { ...prev, items };
      });
    },
    [isReadOnly, products],
  );

  const addItem = useCallback(() => {
    if (isReadOnly) return;
    setFormData((prev) => ({
      ...prev,
      items: [
        ...(prev.items || []),
        {
          id: `tmp-${Date.now()}`,
          quoteId: editingQuote?.id || '',
          productId: '',
          productName: '',
          quantity: 1,
          unitPrice: 0,
          discount: 0,
          note: '',
        },
      ],
    }));
  }, [editingQuote?.id, isReadOnly]);

  const columns = useMemo<Column<SupplierQuote>[]>(
    () => [
      {
        header: t('sales:supplierQuotes.quoteCode', { defaultValue: 'Quote Code' }),
        id: 'quoteCode',
        accessorFn: (row) => row.quoteCode || row.purchaseOrderNumber || '',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }) => (
          <span className="font-bold text-slate-700">
            {row.quoteCode || row.purchaseOrderNumber}
          </span>
        ),
      },
      {
        header: t('sales:supplierQuotes.supplier', { defaultValue: 'Supplier' }),
        accessorKey: 'supplierName',
        cell: ({ row }) => <div className="font-bold text-slate-800">{row.supplierName}</div>,
      },
      {
        header: t('sales:supplierQuotes.total', { defaultValue: 'Total' }),
        id: 'total',
        accessorFn: (row) => calculateTotals(row.items, row.discount, products).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          const { total } = calculateTotals(row.items, row.discount, products);
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
        header: t('sales:supplierQuotes.status', { defaultValue: 'Status' }),
        accessorKey: 'status',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }) => {
          const history = isHistoryRow(row);
          return (
            <div className={history ? 'opacity-60' : ''}>
              <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status)} />
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
          const hasOrder = quoteIdsWithOrders?.has(row.id);
          const hasOffer = hasOfferForQuote(row);
          const history = isHistoryRow(row);

          const isEditDisabled = hasOffer;
          const editTitle = hasOffer
            ? t('sales:supplierQuotes.offerAlreadyExists', {
                defaultValue: 'An offer for this quote already exists.',
              })
            : t('common:buttons.edit', { defaultValue: 'Edit' });

          const isCreateOfferDisabled = history || hasOffer;
          const createOfferTitle = hasOffer
            ? t('sales:supplierQuotes.offerAlreadyExists', {
                defaultValue: 'An offer for this quote already exists.',
              })
            : t('sales:supplierQuotes.createOffer', { defaultValue: 'Create offer' });

          return (
            <div className="flex justify-end gap-2">
              {row.linkedOfferId && onViewOffer && (
                <Tooltip
                  label={t('sales:supplierQuotes.viewOffer', { defaultValue: 'View offer' })}
                >
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
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
              {onViewOrder && hasOrder && (
                <Tooltip
                  label={t('accounting:supplierOrders.viewOrder', { defaultValue: 'View order' })}
                >
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onViewOrder(row.id);
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                    >
                      <i className="fa-solid fa-file-invoice"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              <Tooltip label={editTitle}>
                {() => (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isEditDisabled) return;
                      openEditModal(row);
                    }}
                    disabled={isEditDisabled}
                    className={`p-2 rounded-lg transition-all ${isEditDisabled ? 'cursor-not-allowed opacity-50 text-slate-400' : 'text-slate-400 hover:text-praetor hover:bg-slate-100'}`}
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                )}
              </Tooltip>
              {row.status === 'draft' && !hasOffer && (
                <Tooltip
                  label={t('sales:supplierQuotes.markSent', { defaultValue: 'Mark as sent' })}
                >
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateQuote(row.id, { status: 'sent' });
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                    >
                      <i className="fa-solid fa-paper-plane"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              {row.status === 'sent' && !hasOffer && (
                <>
                  <Tooltip
                    label={t('sales:supplierQuotes.markAccepted', {
                      defaultValue: 'Mark as accepted',
                    })}
                  >
                    {() => (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateQuote(row.id, { status: 'accepted' });
                        }}
                        className="p-2 rounded-lg transition-all text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                      >
                        <i className="fa-solid fa-check"></i>
                      </button>
                    )}
                  </Tooltip>
                  <Tooltip
                    label={t('sales:supplierQuotes.markDenied', {
                      defaultValue: 'Mark as denied',
                    })}
                  >
                    {() => (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateQuote(row.id, { status: 'denied' });
                        }}
                        className="p-2 rounded-lg transition-all text-slate-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </Tooltip>
                </>
              )}
              {row.status === 'accepted' && onCreateOffer && (
                <Tooltip label={createOfferTitle}>
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
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
              {row.status === 'draft' && !hasOffer && (
                <Tooltip label={t('common:buttons.delete', { defaultValue: 'Delete' })}>
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setQuoteToDelete(row);
                        setIsDeleteConfirmOpen(true);
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <i className="fa-solid fa-trash-can"></i>
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
      currency,
      getStatusLabel,
      onCreateOffer,
      onUpdateQuote,
      onViewOffer,
      openEditModal,
      products,
      quoteIdsWithOrders,
      onViewOrder,
      t,
      isHistoryRow,
      hasOfferForQuote,
    ],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!formData.supplierId) {
      nextErrors.supplierId = t('sales:supplierQuotes.errors.supplierRequired', {
        defaultValue: 'Supplier is required',
      });
    }
    if (!formData.quoteCode?.trim()) {
      nextErrors.quoteCode = t('sales:supplierQuotes.errors.quoteCodeRequired', {
        defaultValue: 'Quote Code is required',
      });
    }
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('sales:supplierQuotes.errors.itemsRequired', {
        defaultValue: 'At least one item is required',
      });
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const payload: Partial<SupplierQuote> = {
      ...formData,
      quoteCode: formData.quoteCode,
      purchaseOrderNumber: formData.quoteCode,
      discount: roundToTwoDecimals(Number(formData.discount ?? 0)),
      items: (formData.items || []).map((item) => ({
        ...item,
        unitPrice: roundToTwoDecimals(Number(item.unitPrice ?? 0)),
        discount: roundToTwoDecimals(Number(item.discount ?? 0)),
      })),
    };

    if (editingQuote) {
      await onUpdateQuote(editingQuote.id, payload);
    } else {
      await onAddQuote(payload);
    }

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i
                  className={`fa-solid ${
                    isReadOnly ? 'fa-eye' : editingQuote ? 'fa-pen-to-square' : 'fa-plus'
                  }`}
                ></i>
              </div>
              {isReadOnly
                ? t('sales:supplierQuotes.viewQuote', { defaultValue: 'View quote' })
                : editingQuote
                  ? t('sales:supplierQuotes.editQuote', { defaultValue: 'Edit quote' })
                  : t('sales:supplierQuotes.newQuote', { defaultValue: 'New quote' })}
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
                  {t('sales:supplierQuotes.readOnlyLinked', {
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
                      {t('sales:supplierQuotes.linkedOfferTitle', { defaultValue: 'Linked Offer' })}
                    </div>
                    <div className="text-xs text-praetor">
                      {t('sales:supplierQuotes.linkedOfferInfo', {
                        number: editingQuote.linkedOfferCode || editingQuote.linkedOfferId,
                        defaultValue: 'Offer #{{number}}',
                      })}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {t('sales:supplierQuotes.offerDetailsReadOnly', {
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
                    {t('sales:supplierQuotes.viewOffer', { defaultValue: 'View Offer' })}
                  </button>
                )}
              </div>
            )}

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('sales:supplierQuotes.supplierInformation', {
                  defaultValue: 'Supplier Information',
                })}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierQuotes.supplier', { defaultValue: 'Supplier' })}
                  </label>
                  <CustomSelect
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
                    className={errors.supplierId ? 'border-red-300' : ''}
                  />
                  {errors.supplierId && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.supplierId}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierQuotes.quoteCode', { defaultValue: 'Quote Code' })}
                  </label>
                  <input
                    type="text"
                    value={formData.quoteCode || ''}
                    disabled={isReadOnly}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        quoteCode: event.target.value,
                        purchaseOrderNumber: event.target.value,
                      }))
                    }
                    className={`${inputClassName} ${errors.quoteCode ? 'border-red-300' : ''}`}
                  />
                  {errors.quoteCode && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.quoteCode}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('sales:supplierQuotes.quoteDetails', { defaultValue: 'Quote Details' })}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierQuotes.paymentTerms', { defaultValue: 'Payment Terms' })}
                  </label>
                  <CustomSelect
                    options={paymentTermsOptions}
                    value={formData.paymentTerms || 'immediate'}
                    onChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        paymentTerms: value as SupplierQuote['paymentTerms'],
                      }))
                    }
                    searchable={false}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierQuotes.discount', { defaultValue: 'Discount %' })}
                  </label>
                  <ValidatedNumberInput
                    value={formData.discount || 0}
                    onValueChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        discount: value === '' ? 0 : Number(value),
                      }))
                    }
                    disabled={isReadOnly}
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierQuotes.expirationDate', { defaultValue: 'Expiration Date' })}
                  </label>
                  <input
                    type="date"
                    value={formData.expirationDate || ''}
                    disabled={isReadOnly}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, expirationDate: event.target.value }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierQuotes.status', { defaultValue: 'Status' })}
                  </label>
                  <CustomSelect
                    options={statusOptions}
                    value={formData.status || 'draft'}
                    onChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        status: value as SupplierQuote['status'],
                      }))
                    }
                    searchable={false}
                    disabled={isReadOnly}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('sales:supplierQuotes.items', { defaultValue: 'Items' })}
                </h4>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={addItem}
                    className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1"
                  >
                    <i className="fa-solid fa-plus"></i>
                    {t('sales:supplierQuotes.addItem', { defaultValue: 'Add item' })}
                  </button>
                )}
              </div>
              {errors.items && (
                <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
              )}

              {formData.items && formData.items.length > 0 && (
                <div className="px-3 mb-1">
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                      {t('sales:supplierQuotes.product', { defaultValue: 'Product' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierQuotes.qty', { defaultValue: 'Qty' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierQuotes.unitPrice', { defaultValue: 'Unit Price' })}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierQuotes.discount', { defaultValue: 'Disc %' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                    </div>
                    <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
                    </div>
                  </div>
                </div>
              )}

              {formData.items && formData.items.length > 0 ? (
                <div className="space-y-3">
                  {formData.items.map((item, index) => {
                    const lineSubtotal = item.quantity * item.unitPrice;
                    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
                    const lineTotal = lineSubtotal - lineDiscount;
                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2"
                      >
                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-12 md:col-span-4">
                            <CustomSelect
                              options={activeProducts.map((product) => ({
                                id: product.id,
                                name: product.name,
                              }))}
                              value={item.productId}
                              onChange={(value) => updateItem(index, 'productId', value as string)}
                              placeholder={t('sales:supplierQuotes.selectProduct', {
                                defaultValue: 'Select product',
                              })}
                              searchable={true}
                              disabled={isReadOnly}
                              buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                            />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <ValidatedNumberInput
                              value={item.quantity}
                              onValueChange={(value) =>
                                updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                              }
                              disabled={isReadOnly}
                              className={`${itemInputClassName} text-center`}
                            />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <ValidatedNumberInput
                              value={item.unitPrice}
                              onValueChange={(value) =>
                                updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                              }
                              disabled={isReadOnly}
                              className={`${itemInputClassName} text-center`}
                            />
                          </div>
                          <div className="col-span-4 md:col-span-1">
                            <ValidatedNumberInput
                              value={item.discount || 0}
                              onValueChange={(value) =>
                                updateItem(index, 'discount', value === '' ? 0 : Number(value))
                              }
                              disabled={isReadOnly}
                              className={`${itemInputClassName} text-center`}
                            />
                          </div>
                          <div className="col-span-4 md:col-span-2 flex items-center justify-center">
                            <span className="text-sm font-bold text-slate-800 whitespace-nowrap">
                              {lineTotal.toFixed(2)} {currency}
                            </span>
                          </div>
                          <div className="col-span-4 md:col-span-1">
                            <input
                              type="text"
                              value={item.note || ''}
                              disabled={isReadOnly}
                              onChange={(event) => updateItem(index, 'note', event.target.value)}
                              placeholder={t('form:placeholderNotes', {
                                defaultValue: 'Notes',
                              })}
                              className={`${itemInputClassName} text-center`}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 text-sm">
                  {t('sales:supplierQuotes.noItemsAdded', {
                    defaultValue: 'No items added yet',
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-8 border-t border-slate-100 pt-6 md:flex-row">
              <div className="w-full space-y-4 md:w-2/3">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
                </h4>
                <textarea
                  rows={4}
                  value={formData.notes || ''}
                  disabled={isReadOnly}
                  placeholder={t('form:placeholderNotes', {
                    defaultValue: 'Optional notes...',
                  })}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="w-full space-y-3 md:w-1/3">
                <h4 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-praetor">
                  <span className="h-1.5 w-1.5 rounded-full bg-praetor"></span>
                  {t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                </h4>
                {formData.items && formData.items.length > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-sm font-bold text-slate-500">
                        {t('sales:supplierQuotes.subtotal', { defaultValue: 'Subtotal' })}
                      </span>
                      <span className="text-sm font-bold text-slate-700">
                        {totalsBreakdown.subtotal.toFixed(2)} {currency}
                      </span>
                    </div>
                    {Number(formData.discount || 0) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-sm font-bold text-slate-500">
                          {t('sales:supplierQuotes.discountAmount', {
                            defaultValue: 'Discount',
                          })}{' '}
                          ({formData.discount}%)
                        </span>
                        <span className="text-sm font-bold text-amber-600">
                          -{totalsBreakdown.discountAmount.toFixed(2)} {currency}
                        </span>
                      </div>
                    )}
                    {Object.entries(totalsBreakdown.taxGroups).map(([rate, amount]) => (
                      <div key={rate} className="flex justify-between text-xs">
                        <span className="font-semibold text-slate-500">
                          {t('sales:supplierQuotes.taxRate', {
                            rate,
                            defaultValue: 'Tax {{rate}}%',
                          })}
                        </span>
                        <span className="font-semibold text-slate-700">
                          {amount.toFixed(2)} {currency}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-200 pt-3">
                      <span className="text-lg font-black text-slate-800">
                        {t('sales:supplierQuotes.total', { defaultValue: 'Total' })}
                      </span>
                      <span className="text-lg font-black text-praetor">
                        {totalsBreakdown.total.toFixed(2)} {currency}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-xl px-6 py-3 font-bold text-slate-500 hover:bg-slate-50"
              >
                {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  className="rounded-xl bg-praetor px-8 py-3 font-bold text-white shadow-lg shadow-slate-200 hover:bg-slate-700"
                >
                  {editingQuote
                    ? t('common:buttons.update', { defaultValue: 'Update' })
                    : t('common:buttons.save', { defaultValue: 'Save' })}
                </button>
              )}
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="w-full max-w-sm space-y-4 overflow-hidden rounded-2xl bg-white p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
          </div>
          <h3 className="text-lg font-black text-slate-800">
            {t('sales:supplierQuotes.deleteTitle', { defaultValue: 'Delete supplier quote?' })}
          </h3>
          <p className="text-sm text-slate-500">{quoteToDelete?.quoteCode}</p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 rounded-xl py-3 font-bold text-slate-500 hover:bg-slate-50"
            >
              {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              onClick={async () => {
                if (!quoteToDelete) return;
                await onDeleteQuote(quoteToDelete.id);
                setIsDeleteConfirmOpen(false);
                setQuoteToDelete(null);
              }}
              className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700"
            >
              {t('common:buttons.delete', { defaultValue: 'Delete' })}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">
              {t('sales:supplierQuotes.title', { defaultValue: 'Supplier Quotes' })}
            </h2>
            <p className="text-slate-500 text-sm">
              {t('sales:supplierQuotes.subtitle', {
                defaultValue: 'Quotes that can be converted into supplier offers.',
              })}
            </p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>
            {t('sales:supplierQuotes.addQuote', { defaultValue: 'Add quote' })}
          </button>
        </div>
      </div>

      <StandardTable<SupplierQuote>
        title={
          quoteFilterId
            ? t('sales:supplierQuotes.activeQuotesFiltered', {
                defaultValue: 'Active Quotes for Quote',
              })
            : t('sales:supplierQuotes.activeQuotes', { defaultValue: 'Active Quotes' })
        }
        data={filteredQuotes}
        columns={columns}
        defaultRowsPerPage={5}
        onRowClick={openEditModal}
      />
    </div>
  );
};

export default SupplierQuotesView;
