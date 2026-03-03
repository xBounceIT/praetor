import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Supplier, SupplierQuote, SupplierQuoteItem } from '../types';
import { roundToTwoDecimals } from '../utils/numbers';
import CustomSelect from './shared/CustomSelect';
import Modal from './shared/Modal';
import StatusBadge, { type StatusType } from './shared/StatusBadge';
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
  const { t } = useTranslation(['sales', 'common', 'crm']);
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
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
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

  const filteredQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      const code = quote.quoteCode || quote.purchaseOrderNumber || '';
      const matchesSearch =
        searchTerm.trim() === '' ||
        quote.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        code.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || quote.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [quotes, searchTerm, filterStatus]);

  const openAddModal = () => {
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
  };

  const openEditModal = (quote: SupplierQuote) => {
    setEditingQuote(quote);
    setFormData({
      ...quote,
      quoteCode: quote.quoteCode || quote.purchaseOrderNumber || '',
      purchaseOrderNumber: quote.quoteCode || quote.purchaseOrderNumber || '',
      expirationDate: quote.expirationDate?.split('T')[0] || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const updateItem = (index: number, field: keyof SupplierQuoteItem, value: string | number) => {
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
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800">
              {editingQuote
                ? t('sales:supplierQuotes.editQuote', { defaultValue: 'Supplier Quote' })
                : t('sales:supplierQuotes.newQuote', { defaultValue: 'New Supplier Quote' })}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 rounded-xl text-slate-400 hover:bg-slate-100"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
          <form
            onSubmit={async (event) => {
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
            }}
            className="p-6 space-y-6 max-h-[85vh] overflow-y-auto"
          >
            {isReadOnly && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                {t('sales:supplierQuotes.readOnlyLinked', {
                  defaultValue: 'This quote is read-only because an offer was created from it.',
                })}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:supplierQuotes.supplier')}
                </label>
                <CustomSelect
                  options={activeSuppliers.map((supplier) => ({
                    id: supplier.id,
                    name: supplier.name,
                  }))}
                  value={formData.supplierId || ''}
                  onChange={(value) => {
                    const supplier = suppliers.find((item) => item.id === value);
                    setFormData((prev) => ({
                      ...prev,
                      supplierId: value as string,
                      supplierName: supplier?.name || '',
                    }));
                  }}
                  searchable={true}
                  disabled={isReadOnly}
                />
                {errors.supplierId && (
                  <p className="text-red-500 text-xs mt-1">{errors.supplierId}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:supplierQuotes.quoteCode')}
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
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
                {errors.quoteCode && (
                  <p className="text-red-500 text-xs mt-1">{errors.quoteCode}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:supplierQuotes.paymentTerms')}
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
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:supplierQuotes.expirationDate')}
                </label>
                <input
                  type="date"
                  value={formData.expirationDate || ''}
                  disabled={isReadOnly}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, expirationDate: event.target.value }))
                  }
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase tracking-widest text-praetor">
                  {t('sales:supplierQuotes.items')}
                </h4>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() =>
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
                      }))
                    }
                    className="text-sm font-bold text-praetor"
                  >
                    <i className="fa-solid fa-plus mr-1"></i>
                    {t('sales:supplierQuotes.addItem')}
                  </button>
                )}
              </div>
              {(formData.items || []).map((item, index) => (
                <div
                  key={item.id}
                  className="grid grid-cols-12 gap-2 items-start bg-slate-50 p-3 rounded-xl"
                >
                  <div className="col-span-12 md:col-span-4">
                    <CustomSelect
                      options={activeProducts.map((product) => ({
                        id: product.id,
                        name: product.name,
                      }))}
                      value={item.productId}
                      onChange={(value) => updateItem(index, 'productId', value as string)}
                      searchable={true}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.quantity}
                      onValueChange={(value) =>
                        updateItem(index, 'quantity', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.unitPrice}
                      onValueChange={(value) =>
                        updateItem(index, 'unitPrice', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <ValidatedNumberInput
                      value={item.discount || 0}
                      onValueChange={(value) =>
                        updateItem(index, 'discount', value === '' ? 0 : Number(value))
                      }
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <input
                      type="text"
                      value={item.note || ''}
                      disabled={isReadOnly}
                      onChange={(event) => updateItem(index, 'note', event.target.value)}
                      className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:supplierQuotes.discount')}
                </label>
                <ValidatedNumberInput
                  value={formData.discount || 0}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, discount: value === '' ? 0 : Number(value) }))
                  }
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:supplierQuotes.status')}
                </label>
                <CustomSelect
                  options={statusOptions}
                  value={formData.status || 'draft'}
                  onChange={(value) =>
                    setFormData((prev) => ({ ...prev, status: value as SupplierQuote['status'] }))
                  }
                  searchable={false}
                  disabled={isReadOnly}
                />
              </div>
              <div className="flex items-end justify-end text-right">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                    {t('sales:supplierQuotes.total')}
                  </div>
                  <div className="text-2xl font-black text-praetor">
                    {calculateTotals(
                      formData.items || [],
                      Number(formData.discount || 0),
                      products,
                    ).toFixed(2)}{' '}
                    {currency}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('sales:supplierQuotes.notes')}
              </label>
              <textarea
                rows={3}
                value={formData.notes || ''}
                disabled={isReadOnly}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, notes: event.target.value }))
                }
                className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
              />
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600"
              >
                {t('common.cancel')}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-praetor text-white text-sm font-bold"
                >
                  {editingQuote ? t('common.update') : t('common.save')}
                </button>
              )}
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 className="text-lg font-black text-slate-800">
            {t('sales:supplierQuotes.deleteTitle', { defaultValue: 'Delete supplier quote?' })}
          </h3>
          <p className="text-sm text-slate-500">{quoteToDelete?.quoteCode}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                if (!quoteToDelete) return;
                await onDeleteQuote(quoteToDelete.id);
                setIsDeleteConfirmOpen(false);
                setQuoteToDelete(null);
              }}
              className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold"
            >
              {t('common.yesDelete')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">
            {t('sales:supplierQuotes.title', { defaultValue: 'Supplier Quotes' })}
          </h2>
          <p className="text-sm text-slate-500">
            {t('sales:supplierQuotes.subtitle', {
              defaultValue: 'Quotes that can be converted into supplier offers.',
            })}
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-4 py-2.5 rounded-xl bg-praetor text-white text-sm font-bold"
        >
          <i className="fa-solid fa-plus mr-2"></i>
          {t('sales:supplierQuotes.addQuote', { defaultValue: 'Add quote' })}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={t('common.search')}
          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm"
        />
        <CustomSelect
          options={[
            { id: 'all', name: t('common.all', { defaultValue: 'All' }) },
            ...statusOptions,
          ]}
          value={filterStatus}
          onChange={(value) => setFilterStatus(value as string)}
          searchable={false}
          buttonClassName="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:supplierQuotes.supplier')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:supplierQuotes.quoteCode')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:supplierQuotes.status')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:supplierQuotes.total')}
              </th>
              <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-slate-400">
                {t('common.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredQuotes.map((quote) => (
              <tr key={quote.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-4">
                  <div className="font-bold text-slate-800">{quote.supplierName}</div>
                  <div className="text-xs text-slate-400">
                    {quote.linkedOfferId
                      ? `${t('sales:supplierQuotes.linkedOffer', { defaultValue: 'Linked to offer' })} ${quote.linkedOfferId}`
                      : new Date(quote.expirationDate).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-4 py-4 font-mono text-sm font-bold text-slate-600">
                  {quote.quoteCode || quote.purchaseOrderNumber}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge
                    type={quote.status as StatusType}
                    label={
                      statusOptions.find((option) => option.id === quote.status)?.name ||
                      quote.status
                    }
                  />
                </td>
                <td className="px-4 py-4 text-sm font-bold text-slate-700">
                  {calculateTotals(quote.items, quote.discount, products).toFixed(2)} {currency}
                </td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => openEditModal(quote)}
                      className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                      title={t('common.edit')}
                    >
                      <i className="fa-solid fa-pen-to-square"></i>
                    </button>
                    {quote.status === 'draft' && !quote.linkedOfferId && (
                      <button
                        onClick={() => onUpdateQuote(quote.id, { status: 'sent' })}
                        className="w-10 h-10 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                        title={t('sales:supplierQuotes.markSent')}
                      >
                        <i className="fa-solid fa-paper-plane"></i>
                      </button>
                    )}
                    {quote.status === 'sent' && !quote.linkedOfferId && (
                      <>
                        <button
                          onClick={() => onUpdateQuote(quote.id, { status: 'accepted' })}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                          title={t('sales:supplierQuotes.markAccepted')}
                        >
                          <i className="fa-solid fa-check"></i>
                        </button>
                        <button
                          onClick={() => onUpdateQuote(quote.id, { status: 'denied' })}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title={t('sales:supplierQuotes.markDenied')}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </>
                    )}
                    {quote.status === 'accepted' && !quote.linkedOfferId && onCreateOffer && (
                      <button
                        onClick={() => onCreateOffer(quote)}
                        className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                        title={t('sales:supplierQuotes.createOffer')}
                      >
                        <i className="fa-solid fa-file-signature"></i>
                      </button>
                    )}
                    {quote.status === 'draft' && !quote.linkedOfferId && (
                      <button
                        onClick={() => {
                          setQuoteToDelete(quote);
                          setIsDeleteConfirmOpen(true);
                        }}
                        className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                        title={t('common.delete')}
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SupplierQuotesView;
