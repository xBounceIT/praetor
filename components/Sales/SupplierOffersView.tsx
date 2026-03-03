import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Supplier, SupplierOffer, SupplierOfferItem } from '../../types';
import { roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
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
  onViewQuote?: (quoteId: string) => void;
  currency: string;
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
}) => {
  const { t } = useTranslation(['sales', 'common', 'crm']);
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
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
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
    expirationDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const isReadOnly = Boolean(editingOffer && editingOffer.status !== 'draft');
  const isSupplierLocked = Boolean(editingOffer?.linkedQuoteId);

  const filteredOffers = useMemo(() => {
    return offers.filter((offer) => {
      const matchesSearch =
        searchTerm.trim() === '' ||
        offer.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        offer.offerCode.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || offer.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [offers, searchTerm, filterStatus]);

  const openEditModal = (offer: SupplierOffer) => {
    setEditingOffer(offer);
    setFormData({
      ...offer,
      expirationDate: offer.expirationDate?.split('T')[0] || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const updateItem = (index: number, field: keyof SupplierOfferItem, value: string | number) => {
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
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800">
              {t('sales:supplierOffers.editOffer', { defaultValue: 'Supplier Offer' })}
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
              if (!editingOffer) return;
              const nextErrors: Record<string, string> = {};
              if (!formData.supplierId) {
                nextErrors.supplierId =
                  t('sales:supplierOffers.supplier', { defaultValue: 'Supplier' }) + ' is required';
              }
              if (!formData.offerCode?.trim()) {
                nextErrors.offerCode =
                  t('sales:supplierOffers.offerCode', { defaultValue: 'Offer Code' }) +
                  ' is required';
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
            }}
            className="p-6 space-y-6 max-h-[85vh] overflow-y-auto"
          >
            {editingOffer?.linkedQuoteId && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex items-center justify-between">
                <span>
                  {t('sales:supplierOffers.sourceQuote', {
                    defaultValue: 'Source quote: {{quoteId}}',
                    quoteId: editingOffer.linkedQuoteId,
                  })}
                </span>
                {onViewQuote && (
                  <button
                    type="button"
                    onClick={() => onViewQuote(editingOffer.linkedQuoteId)}
                    className="text-praetor font-bold"
                  >
                    {t('sales:supplierOffers.viewQuote', { defaultValue: 'View quote' })}
                  </button>
                )}
              </div>
            )}
            {isReadOnly && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                {t('sales:supplierOffers.readOnlyStatus', {
                  defaultValue:
                    'Non-draft offers are read-only. Change status from the list actions.',
                })}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:supplierOffers.supplier', { defaultValue: 'Supplier' })}
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
                  disabled={isReadOnly || isSupplierLocked}
                />
                {errors.supplierId && (
                  <p className="text-red-500 text-xs mt-1">{errors.supplierId}</p>
                )}
              </div>
              <div>
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
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
                {errors.offerCode && (
                  <p className="text-red-500 text-xs mt-1">{errors.offerCode}</p>
                )}
              </div>
              <div>
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
              <div>
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
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-3">
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
                  {t('sales:supplierOffers.discount', { defaultValue: 'Discount %' })}
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
                  {t('sales:supplierOffers.status', { defaultValue: 'Status' })}
                </label>
                <CustomSelect
                  options={statusOptions}
                  value={formData.status || 'draft'}
                  onChange={(value) =>
                    setFormData((prev) => ({ ...prev, status: value as SupplierOffer['status'] }))
                  }
                  searchable={false}
                  disabled={isReadOnly}
                />
              </div>
              <div className="flex items-end justify-end text-right">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                    {t('sales:supplierOffers.total', { defaultValue: 'Total' })}
                  </div>
                  <div className="text-2xl font-black text-praetor">
                    {calculateTotals(
                      formData.items || [],
                      Number(formData.discount || 0),
                    ).total.toFixed(2)}{' '}
                    {currency}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('sales:supplierOffers.notes', { defaultValue: 'Notes' })}
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
                  {t('common.update')}
                </button>
              )}
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 className="text-lg font-black text-slate-800">
            {t('sales:supplierOffers.deleteTitle', { defaultValue: 'Delete supplier offer?' })}
          </h3>
          <p className="text-sm text-slate-500">{offerToDelete?.offerCode}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                if (!offerToDelete) return;
                await onDeleteOffer(offerToDelete.id);
                setIsDeleteConfirmOpen(false);
                setOfferToDelete(null);
              }}
              className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold"
            >
              {t('common.yesDelete')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="space-y-1">
        <h2 className="text-2xl font-black text-slate-800">
          {t('sales:supplierOffers.title', { defaultValue: 'Supplier Offers' })}
        </h2>
        <p className="text-sm text-slate-500">
          {t('sales:supplierOffers.subtitle', {
            defaultValue: 'Offers created from supplier quotes.',
          })}
        </p>
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
                {t('sales:supplierOffers.supplier', { defaultValue: 'Supplier' })}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:supplierOffers.offerCode', { defaultValue: 'Offer Code' })}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:supplierOffers.status', { defaultValue: 'Status' })}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:supplierOffers.total', { defaultValue: 'Total' })}
              </th>
              <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-slate-400">
                {t('common.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOffers.map((offer) => (
              <tr key={offer.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-4">
                  <div className="font-bold text-slate-800">{offer.supplierName}</div>
                </td>
                <td className="px-4 py-4 font-mono text-sm font-bold text-slate-600">
                  {offer.offerCode}
                </td>
                <td className="px-4 py-4">
                  <StatusBadge
                    type={offer.status as StatusType}
                    label={
                      statusOptions.find((option) => option.id === offer.status)?.name ||
                      offer.status
                    }
                  />
                </td>
                <td className="px-4 py-4 text-sm font-bold text-slate-700">
                  {calculateTotals(offer.items, offer.discount).total.toFixed(2)} {currency}
                </td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    {onViewQuote && (
                      <button
                        onClick={() => onViewQuote(offer.linkedQuoteId)}
                        className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                        title={t('sales:supplierOffers.viewQuote', { defaultValue: 'View quote' })}
                      >
                        <i className="fa-solid fa-link"></i>
                      </button>
                    )}
                    <button
                      onClick={() => openEditModal(offer)}
                      className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                      title={t('common.edit')}
                    >
                      <i className="fa-solid fa-pen-to-square"></i>
                    </button>
                    {offer.status === 'draft' && (
                      <button
                        onClick={() => onUpdateOffer(offer.id, { status: 'sent' })}
                        className="w-10 h-10 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                        title={t('sales:supplierOffers.markSent', {
                          defaultValue: 'Mark as sent',
                        })}
                      >
                        <i className="fa-solid fa-paper-plane"></i>
                      </button>
                    )}
                    {offer.status === 'sent' && (
                      <>
                        <button
                          onClick={() => onUpdateOffer(offer.id, { status: 'accepted' })}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                          title={t('sales:supplierOffers.markAccepted', {
                            defaultValue: 'Mark as accepted',
                          })}
                        >
                          <i className="fa-solid fa-check"></i>
                        </button>
                        <button
                          onClick={() => onUpdateOffer(offer.id, { status: 'denied' })}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title={t('sales:supplierOffers.markDenied', {
                            defaultValue: 'Mark as denied',
                          })}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </>
                    )}
                    {offer.status === 'accepted' && !offer.linkedOrderId && onCreateOrder && (
                      <button
                        onClick={() => onCreateOrder(offer)}
                        className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                        title={t('sales:supplierOffers.createOrder', {
                          defaultValue: 'Create sale order',
                        })}
                      >
                        <i className="fa-solid fa-cart-plus"></i>
                      </button>
                    )}
                    {offer.status === 'draft' && (
                      <button
                        onClick={() => {
                          setOfferToDelete(offer);
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

export default SupplierOffersView;
