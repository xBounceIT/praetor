import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Supplier, SupplierQuote, SupplierQuoteItem } from '../types';
import { roundToTwoDecimals } from '../utils/numbers';
import CustomSelect from './shared/CustomSelect';
import Modal from './shared/Modal';
import StandardTable, { type Column } from './shared/StandardTable';
import StatusBadge, { type StatusType } from './shared/StatusBadge';
import Tooltip from './shared/Tooltip';
import ValidatedNumberInput from './shared/ValidatedNumberInput';

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

const calculateTotals = (
  items: SupplierQuoteItem[],
  globalDiscount: number,
  products: Product[],
) => {
  let subtotal = 0;
  let totalTax = 0;
  items.forEach((item) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
    const product = products.find((candidate) => candidate.id === item.productId);
    totalTax += lineNet * (1 - globalDiscount / 100) * (Number(product?.taxRate ?? 0) / 100);
  });
  return subtotal - subtotal * (globalDiscount / 100) + totalTax;
};

export interface SupplierQuotesViewProps {
  quotes: SupplierQuote[];
  suppliers: Supplier[];
  products: Product[];
  onAddQuote: (quoteData: Partial<SupplierQuote>) => void | Promise<void>;
  onUpdateQuote: (id: string, updates: Partial<SupplierQuote>) => void | Promise<void>;
  onDeleteQuote: (id: string) => void | Promise<void>;
  onCreateOffer?: (quote: SupplierQuote) => void | Promise<void>;
  currency: string;
}

const SupplierQuotesView: React.FC<SupplierQuotesViewProps> = ({
  quotes,
  suppliers,
  products,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onCreateOffer,
  currency,
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
    expirationDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const isReadOnly = Boolean(editingQuote?.linkedOfferId);
  const totalAmount = calculateTotals(
    formData.items || [],
    Number(formData.discount || 0),
    products,
  );

  const inputClassName =
    'w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl ' +
    'focus:ring-2 focus:ring-praetor outline-none transition-all disabled:opacity-50 ' +
    'disabled:cursor-not-allowed';
  const itemInputClassName =
    'w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 ' +
    'focus:ring-praetor outline-none disabled:opacity-50 disabled:cursor-not-allowed';

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
      expirationDate: new Date().toISOString().split('T')[0],
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
      expirationDate: quote.expirationDate?.split('T')[0] || '',
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
        header: t('sales:supplierQuotes.supplier', { defaultValue: 'Supplier' }),
        accessorKey: 'supplierName',
        cell: ({ row }) => (
          <div>
            <div className="font-bold text-slate-800">{row.supplierName}</div>
            <div className="text-xs text-slate-400">
              {row.linkedOfferId
                ? `${t('sales:supplierQuotes.linkedOffer', {
                    defaultValue: 'Linked to offer',
                  })} ${row.linkedOfferId}`
                : row.expirationDate
                  ? new Date(row.expirationDate).toLocaleDateString()
                  : ''}
            </div>
          </div>
        ),
      },
      {
        header: t('sales:supplierQuotes.quoteCode', { defaultValue: 'Quote Code' }),
        id: 'quoteCode',
        accessorFn: (row) => row.quoteCode || row.purchaseOrderNumber || '',
        cell: ({ row }) => (
          <div className="font-mono text-sm font-bold text-slate-500">
            {row.quoteCode || row.purchaseOrderNumber}
          </div>
        ),
      },
      {
        header: t('sales:supplierQuotes.total', { defaultValue: 'Total' }),
        id: 'total',
        accessorFn: (row) => calculateTotals(row.items, row.discount, products),
        disableFiltering: true,
        cell: ({ row }) => (
          <span className="text-sm font-bold text-slate-700">
            {calculateTotals(row.items, row.discount, products).toFixed(2)} {currency}
          </span>
        ),
      },
      {
        header: t('sales:supplierQuotes.status', { defaultValue: 'Status' }),
        accessorKey: 'status',
        cell: ({ row }) => (
          <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status)} />
        ),
      },
      {
        header: t('sales:supplierQuotes.actionsColumn', { defaultValue: 'Actions' }),
        id: 'actions',
        align: 'right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Tooltip label={t('common:buttons.edit', { defaultValue: 'Edit' })}>
              {() => (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditModal(row);
                  }}
                  className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                >
                  <i className="fa-solid fa-pen-to-square"></i>
                </button>
              )}
            </Tooltip>
            {row.status === 'draft' && !row.linkedOfferId && (
              <Tooltip label={t('sales:supplierQuotes.markSent', { defaultValue: 'Mark as sent' })}>
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
            {row.status === 'sent' && !row.linkedOfferId && (
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
            {row.status === 'accepted' && !row.linkedOfferId && onCreateOffer && (
              <Tooltip
                label={t('sales:supplierQuotes.createOffer', { defaultValue: 'Create offer' })}
              >
                {() => (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateOffer(row);
                    }}
                    className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                  >
                    <i className="fa-solid fa-file-signature"></i>
                  </button>
                )}
              </Tooltip>
            )}
            {row.status === 'draft' && !row.linkedOfferId && (
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
        ),
      },
    ],
    [currency, getStatusLabel, onCreateOffer, onUpdateQuote, openEditModal, products, t],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!formData.supplierId) {
      nextErrors.supplierId = t('crm:quotes.errors.clientRequired', {
        defaultValue: 'Supplier is required',
      });
    }
    if (!formData.quoteCode?.trim()) {
      nextErrors.quoteCode = t('crm:quotes.errors.quoteCodeRequired', {
        defaultValue: 'Quote Code is required',
      });
    }
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('crm:quotes.errors.itemsRequired', {
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
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

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
            {isReadOnly && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                <span className="text-amber-700 text-xs font-bold">
                  {t('sales:supplierQuotes.readOnlyLinked', {
                    defaultValue: 'This quote is read-only because an offer was created from it.',
                  })}
                </span>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.notes || ''}
                    disabled={isReadOnly}
                    placeholder={t('form:placeholderNotes', {
                      defaultValue: 'Optional notes...',
                    })}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    className={`${inputClassName} resize-none`}
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
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierQuotes.discount', { defaultValue: 'Discount %' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierQuotes.notes', { defaultValue: 'Notes' })}
                    </div>
                  </div>
                </div>
              )}

              {formData.items && formData.items.length > 0 ? (
                <div className="space-y-3">
                  {formData.items.map((item, index) => (
                    <div key={item.id} className="bg-slate-50 p-3 rounded-xl space-y-2">
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
                        <div className="col-span-6 md:col-span-2">
                          <ValidatedNumberInput
                            value={item.discount || 0}
                            onValueChange={(value) =>
                              updateItem(index, 'discount', value === '' ? 0 : Number(value))
                            }
                            disabled={isReadOnly}
                            className={`${itemInputClassName} text-center`}
                          />
                        </div>
                        <div className="col-span-6 md:col-span-2">
                          <input
                            type="text"
                            value={item.note || ''}
                            disabled={isReadOnly}
                            onChange={(event) => updateItem(index, 'note', event.target.value)}
                            placeholder={t('form:placeholderNotes', {
                              defaultValue: 'Optional notes...',
                            })}
                            className={itemInputClassName}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 text-sm">
                  {t('sales:supplierQuotes.noItemsAdded', {
                    defaultValue: 'No items added yet',
                  })}
                </div>
              )}
            </div>

            {formData.items && formData.items.length > 0 && (
              <div className="mt-4 flex flex-col items-end space-y-2 px-3">
                <div className="flex items-center gap-4 pt-2 mt-2 border-t border-slate-100">
                  <span className="text-lg font-black text-slate-400 uppercase tracking-widest">
                    {t('sales:supplierQuotes.total', { defaultValue: 'Total' })}:
                  </span>
                  <span className="text-3xl font-black text-praetor">
                    {totalAmount.toFixed(2)}{' '}
                    <span className="text-lg text-slate-400 font-bold">{currency}</span>
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-8 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-8 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('sales:supplierQuotes.deleteTitle', { defaultValue: 'Delete supplier quote?' })}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {quoteToDelete?.quoteCode}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
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
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('common:buttons.delete', { defaultValue: 'Delete' })}
              </button>
            </div>
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
        title={t('sales:supplierQuotes.activeQuotes', { defaultValue: 'Active Quotes' })}
        data={quotes}
        columns={columns}
        defaultRowsPerPage={5}
      />
    </div>
  );
};

export default SupplierQuotesView;
