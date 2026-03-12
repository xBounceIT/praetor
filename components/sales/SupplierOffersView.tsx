import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Supplier, SupplierOffer, SupplierOfferItem } from '../../types';
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

const calculateTotals = (items: SupplierOfferItem[], globalDiscount: number) => {
  let subtotal = 0;
  let totalTax = 0;

  items.forEach((item) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineDiscount = (lineSubtotal * Number(item.discount ?? 0)) / 100;
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
    totalTax += lineNet * (1 - globalDiscount / 100) * (Number(item.productTaxRate ?? 0) / 100);
  });

  const discountAmount = subtotal * (globalDiscount / 100);
  const total = subtotal - discountAmount + totalTax;
  return { total };
};

export interface SupplierOffersViewProps {
  offers: SupplierOffer[];
  suppliers: Supplier[];
  products: Product[];
  onUpdateOffer: (id: string, updates: Partial<SupplierOffer>) => void | Promise<void>;
  onDeleteOffer: (id: string) => void | Promise<void>;
  onCreateOrder?: (offer: SupplierOffer) => void | Promise<void>;
  onViewQuote?: (quoteId: string, quoteCode: string) => void;
  currency: string;
  quoteFilterCode?: string | null;
  offerFilterCode?: string | null;
}

const SupplierOffersView: React.FC<SupplierOffersViewProps> = ({
  offers,
  suppliers,
  products,
  onUpdateOffer,
  onDeleteOffer,
  onCreateOrder,
  onViewQuote,
  currency,
  quoteFilterCode,
  offerFilterCode,
}) => {
  const { t } = useTranslation(['sales', 'common', 'crm', 'form']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const statusOptions = useMemo(
    () => [
      { id: 'draft', name: t('sales:supplierOffers.statusDraft', { defaultValue: 'Draft' }) },
      { id: 'sent', name: t('sales:supplierOffers.statusSent', { defaultValue: 'Sent' }) },
      {
        id: 'accepted',
        name: t('sales:supplierOffers.statusAccepted', { defaultValue: 'Accepted' }),
      },
      { id: 'denied', name: t('sales:supplierOffers.statusDenied', { defaultValue: 'Denied' }) },
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

  const [editingOffer, setEditingOffer] = useState<SupplierOffer | null>(null);
  const [offerToDelete, setOfferToDelete] = useState<SupplierOffer | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<SupplierOffer>>({
    offerCode: '',
    linkedQuoteId: '',
    linkedOrderId: undefined,
    supplierId: '',
    supplierName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'draft',
    expirationDate: getLocalDateString(),
    notes: '',
  });

  const isReadOnly = Boolean(editingOffer && editingOffer.status !== 'draft');
  const isSupplierLocked = Boolean(editingOffer?.linkedQuoteId);

  const filteredOffers = useMemo(() => {
    return offers;
  }, [offers]);

  const tableInitialFilterState = useMemo(() => {
    const filters: Record<string, string[]> = {};
    if (offerFilterCode) {
      filters.offerCode = [offerFilterCode];
    }
    if (quoteFilterCode) {
      filters.linkedQuoteCode = [quoteFilterCode];
    }
    return Object.keys(filters).length > 0 ? filters : undefined;
  }, [offerFilterCode, quoteFilterCode]);
  const totalAmount = calculateTotals(formData.items || [], Number(formData.discount || 0)).total;

  const inputClassName =
    'w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl ' +
    'focus:ring-2 focus:ring-praetor outline-none transition-all disabled:opacity-50 ' +
    'disabled:cursor-not-allowed';
  const itemInputClassName =
    'w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 ' +
    'focus:ring-praetor outline-none disabled:opacity-50 disabled:cursor-not-allowed';

  const openEditModal = useCallback((offer: SupplierOffer) => {
    setEditingOffer(offer);
    setFormData({
      ...offer,
      expirationDate: offer.expirationDate ? normalizeDateOnlyString(offer.expirationDate) : '',
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
    (index: number, field: keyof SupplierOfferItem, value: string | number) => {
      if (isReadOnly) return;
      setFormData((prev) => {
        const items = [...(prev.items || [])];
        const nextItem = { ...items[index], [field]: value };
        if (field === 'productId') {
          const product = products.find((item) => item.id === value);
          if (product) {
            nextItem.productName = product.name;
            nextItem.unitPrice = Number(product.costo);
            nextItem.productTaxRate = Number(product.taxRate ?? 0);
          }
        }
        items[index] = nextItem;
        return { ...prev, items };
      });
    },
    [isReadOnly, products],
  );

  const columns = useMemo<Column<SupplierOffer>[]>(
    () => [
      {
        header: t('sales:supplierOffers.offerCode', { defaultValue: 'Offer Code' }),
        accessorKey: 'offerCode',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        cell: ({ row }) => <span className="font-bold text-slate-700">{row.offerCode}</span>,
      },
      {
        header: t('sales:supplierOffers.supplier', { defaultValue: 'Supplier' }),
        accessorKey: 'supplierName',
        cell: ({ row }) => <div className="font-bold text-slate-800">{row.supplierName}</div>,
      },
      {
        header: t('sales:supplierOffers.total', { defaultValue: 'Total' }),
        id: 'total',
        accessorFn: (row) => calculateTotals(row.items, row.discount).total,
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[8rem]',
        disableFiltering: true,
        cell: ({ row }) => (
          <span className="text-sm font-bold text-slate-700">
            {calculateTotals(row.items, row.discount).total.toFixed(2)} {currency}
          </span>
        ),
      },
      {
        header: t('sales:supplierOffers.status', { defaultValue: 'Status' }),
        accessorKey: 'status',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        cell: ({ row }) => (
          <StatusBadge type={row.status as StatusType} label={getStatusLabel(row.status)} />
        ),
      },
      {
        header: t('sales:supplierOffers.actionsColumn', { defaultValue: 'Actions' }),
        id: 'actions',
        align: 'right',
        className: 'whitespace-nowrap',
        headerClassName: 'min-w-[9rem]',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            {row.linkedQuoteId && onViewQuote && row.linkedQuoteCode && (
              <Tooltip label={t('sales:supplierOffers.viewQuote', { defaultValue: 'View quote' })}>
                {() => {
                  const quoteId = row.linkedQuoteId;
                  const quoteCode = row.linkedQuoteCode as string;
                  return (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onViewQuote(quoteId, quoteCode);
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>
                  );
                }}
              </Tooltip>
            )}
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
            {row.status === 'draft' && (
              <Tooltip
                label={t('sales:supplierOffers.markSent', {
                  defaultValue: 'Mark as sent',
                })}
              >
                {() => (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onUpdateOffer(row.id, { status: 'sent' });
                    }}
                    className="p-2 rounded-lg transition-all text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                  >
                    <i className="fa-solid fa-paper-plane"></i>
                  </button>
                )}
              </Tooltip>
            )}
            {row.status === 'sent' && (
              <>
                <Tooltip
                  label={t('sales:supplierOffers.markAccepted', {
                    defaultValue: 'Mark as accepted',
                  })}
                >
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateOffer(row.id, { status: 'accepted' });
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                    >
                      <i className="fa-solid fa-check"></i>
                    </button>
                  )}
                </Tooltip>
                <Tooltip
                  label={t('sales:supplierOffers.markDenied', {
                    defaultValue: 'Mark as denied',
                  })}
                >
                  {() => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateOffer(row.id, { status: 'denied' });
                      }}
                      className="p-2 rounded-lg transition-all text-slate-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  )}
                </Tooltip>
              </>
            )}
            {row.status === 'accepted' && !row.linkedOrderId && onCreateOrder && (
              <Tooltip
                label={t('sales:supplierOffers.createOrder', {
                  defaultValue: 'Create sale order',
                })}
              >
                {() => (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateOrder(row);
                    }}
                    className="p-2 rounded-lg transition-all text-slate-400 hover:text-praetor hover:bg-slate-100"
                  >
                    <i className="fa-solid fa-cart-plus"></i>
                  </button>
                )}
              </Tooltip>
            )}
            {row.status === 'draft' && (
              <Tooltip label={t('common:buttons.delete', { defaultValue: 'Delete' })}>
                {() => (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setOfferToDelete(row);
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
    [currency, getStatusLabel, onCreateOrder, onUpdateOffer, onViewQuote, openEditModal, t],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingOffer) return;

    const nextErrors: Record<string, string> = {};
    if (!formData.supplierId) {
      nextErrors.supplierId = t('sales:supplierOffers.supplierRequired', {
        defaultValue: 'Supplier is required',
      });
    }
    if (!formData.offerCode?.trim()) {
      nextErrors.offerCode = t('sales:supplierOffers.offerCodeRequired', {
        defaultValue: 'Offer Code is required',
      });
    }
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('sales:supplierOffers.itemsRequired', {
        defaultValue: 'At least one item is required',
      });
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    await onUpdateOffer(editingOffer.id, {
      ...formData,
      discount: roundToTwoDecimals(Number(formData.discount ?? 0)),
      items: (formData.items || []).map((item) => ({
        ...item,
        unitPrice: roundToTwoDecimals(Number(item.unitPrice ?? 0)),
        productTaxRate: roundToTwoDecimals(Number(item.productTaxRate ?? 0)),
        discount: roundToTwoDecimals(Number(item.discount ?? 0)),
      })),
    });

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${isReadOnly ? 'fa-eye' : 'fa-pen-to-square'}`}></i>
              </div>
              {isReadOnly
                ? t('sales:supplierOffers.viewOffer', { defaultValue: 'View offer' })
                : t('sales:supplierOffers.editOffer', { defaultValue: 'Edit offer' })}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
            {editingOffer?.linkedQuoteId && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex items-center justify-between gap-3">
                <span>
                  {t('sales:supplierOffers.sourceQuote', {
                    defaultValue: 'Source quote: {{quoteId}}',
                    quoteId: editingOffer.linkedQuoteCode || editingOffer.linkedQuoteId,
                  })}
                </span>
                {onViewQuote && editingOffer.linkedQuoteCode && (
                  <button
                    type="button"
                    onClick={() => {
                      const quoteId = editingOffer.linkedQuoteId;
                      const quoteCode = editingOffer.linkedQuoteCode as string;
                      onViewQuote(quoteId, quoteCode);
                    }}
                    className="text-praetor font-bold hover:text-slate-700"
                  >
                    {t('sales:supplierOffers.viewQuote', { defaultValue: 'View quote' })}
                  </button>
                )}
              </div>
            )}

            {isReadOnly && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                <span className="text-amber-700 text-xs font-bold">
                  {t('sales:supplierOffers.readOnlyStatus', {
                    defaultValue:
                      'Non-draft offers are read-only. Change status from the list actions.',
                  })}
                </span>
              </div>
            )}

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('sales:supplierOffers.supplierInformation', {
                  defaultValue: 'Supplier Information',
                })}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierOffers.supplier', { defaultValue: 'Supplier' })}
                  </label>
                  <CustomSelect
                    options={activeSuppliers.map((supplier) => ({
                      id: supplier.id,
                      name: supplier.name,
                    }))}
                    value={formData.supplierId || ''}
                    onChange={(value) => handleSupplierChange(value as string)}
                    placeholder={t('sales:supplierOffers.selectSupplier', {
                      defaultValue: 'Select a supplier',
                    })}
                    searchable={true}
                    disabled={isReadOnly || isSupplierLocked}
                    className={errors.supplierId ? 'border-red-300' : ''}
                  />
                  {errors.supplierId && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.supplierId}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierOffers.offerCode', { defaultValue: 'Offer Code' })}
                  </label>
                  <input
                    type="text"
                    value={formData.offerCode || ''}
                    disabled={isReadOnly}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, offerCode: event.target.value }))
                    }
                    className={`${inputClassName} ${errors.offerCode ? 'border-red-300' : ''}`}
                  />
                  {errors.offerCode && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.offerCode}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('sales:supplierOffers.offerDetails', { defaultValue: 'Offer Details' })}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierOffers.paymentTerms', { defaultValue: 'Payment Terms' })}
                  </label>
                  <CustomSelect
                    options={paymentTermsOptions}
                    value={formData.paymentTerms || 'immediate'}
                    onChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        paymentTerms: value as SupplierOffer['paymentTerms'],
                      }))
                    }
                    searchable={false}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('sales:supplierOffers.discount', { defaultValue: 'Discount %' })}
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
                    {t('sales:supplierOffers.expirationDate', { defaultValue: 'Expiration Date' })}
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
                    {t('sales:supplierOffers.notes', { defaultValue: 'Notes' })}
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
                    {t('sales:supplierOffers.status', { defaultValue: 'Status' })}
                  </label>
                  <CustomSelect
                    options={statusOptions}
                    value={formData.status || 'draft'}
                    onChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        status: value as SupplierOffer['status'],
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
                  {t('sales:supplierOffers.items', { defaultValue: 'Items' })}
                </h4>
              </div>
              {errors.items && (
                <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
              )}

              {formData.items && formData.items.length > 0 && (
                <div className="px-3 mb-1">
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
                      {t('sales:supplierOffers.product', { defaultValue: 'Product' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierOffers.qty', { defaultValue: 'Qty' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierOffers.unitPrice', { defaultValue: 'Unit Price' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierOffers.discount', { defaultValue: 'Discount %' })}
                    </div>
                    <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">
                      {t('sales:supplierOffers.notes', { defaultValue: 'Notes' })}
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
                            placeholder={t('sales:supplierOffers.selectProduct', {
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
                  {t('sales:supplierOffers.noItemsAdded', {
                    defaultValue: 'No items added yet',
                  })}
                </div>
              )}
            </div>

            {formData.items && formData.items.length > 0 && (
              <div className="mt-4 flex flex-col items-end space-y-2 px-3">
                <div className="flex items-center gap-4 pt-2 mt-2 border-t border-slate-100">
                  <span className="text-lg font-black text-slate-400 uppercase tracking-widest">
                    {t('sales:supplierOffers.total', { defaultValue: 'Total' })}:
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
                  {t('common:buttons.update', { defaultValue: 'Update' })}
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
                {t('sales:supplierOffers.deleteTitle', { defaultValue: 'Delete supplier offer?' })}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {offerToDelete?.offerCode}
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
                  if (!offerToDelete) return;
                  await onDeleteOffer(offerToDelete.id);
                  setIsDeleteConfirmOpen(false);
                  setOfferToDelete(null);
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
              {t('sales:supplierOffers.title', { defaultValue: 'Supplier Offers' })}
            </h2>
            <p className="text-slate-500 text-sm">
              {t('sales:supplierOffers.subtitle', {
                defaultValue: 'Offers created from supplier quotes.',
              })}
            </p>
          </div>
        </div>
      </div>

      <StandardTable<SupplierOffer>
        title={
          quoteFilterCode
            ? t('sales:supplierOffers.activeOffersFiltered', {
                defaultValue: 'Active Offers for Quote',
              })
            : t('sales:supplierOffers.activeOffers', { defaultValue: 'Suppliers Offers' })
        }
        data={filteredOffers}
        columns={columns}
        defaultRowsPerPage={5}
        initialFilterState={tableInitialFilterState}
      />
    </div>
  );
};

export default SupplierOffersView;
