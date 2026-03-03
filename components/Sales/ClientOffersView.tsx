import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, ClientOffer, ClientOfferItem, Product, SpecialBid } from '../../types';
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

const calcProductSalePrice = (cost: number, molPercentage: number) => {
  if (molPercentage >= 100) return cost;
  return cost / (1 - molPercentage / 100);
};

const calculateTotals = (items: ClientOfferItem[], globalDiscount: number) => {
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

  return { subtotal, discountAmount, totalTax, total };
};

export interface ClientOffersViewProps {
  offers: ClientOffer[];
  clients: Client[];
  products: Product[];
  specialBids: SpecialBid[];
  onAddOffer?: (offerData: Partial<ClientOffer>) => void | Promise<void>;
  onUpdateOffer: (id: string, updates: Partial<ClientOffer>) => void | Promise<void>;
  onDeleteOffer: (id: string) => void | Promise<void>;
  onCreateClientsOrder?: (offer: ClientOffer) => void | Promise<void>;
  onViewQuote?: (quoteId: string) => void;
  currency: string;
}

const ClientOffersView: React.FC<ClientOffersViewProps> = ({
  offers,
  clients,
  products,
  specialBids,
  onAddOffer,
  onUpdateOffer,
  onDeleteOffer,
  onCreateClientsOrder,
  onViewQuote,
  currency,
}) => {
  const { t } = useTranslation(['sales', 'crm', 'common']);
  const paymentTermsOptions = useMemo(() => getPaymentTermsOptions(t), [t]);
  const statusOptions = useMemo(
    () => [
      { id: 'draft', name: t('sales:clientOffers.statusDraft', { defaultValue: 'Draft' }) },
      { id: 'sent', name: t('sales:clientOffers.statusSent', { defaultValue: 'Sent' }) },
      {
        id: 'accepted',
        name: t('sales:clientOffers.statusAccepted', { defaultValue: 'Accepted' }),
      },
      { id: 'denied', name: t('sales:clientOffers.statusDenied', { defaultValue: 'Denied' }) },
    ],
    [t],
  );

  const activeClients = useMemo(() => clients.filter((client) => !client.isDisabled), [clients]);
  const activeProducts = useMemo(
    () => products.filter((product) => !product.isDisabled),
    [products],
  );
  const activeSpecialBids = useMemo(() => {
    const now = new Date();
    return specialBids.filter((bid) => {
      const start = new Date(bid.startDate);
      const end = new Date(bid.endDate);
      return start <= now && end >= now;
    });
  }, [specialBids]);

  const [editingOffer, setEditingOffer] = useState<ClientOffer | null>(null);
  const [offerToDelete, setOfferToDelete] = useState<ClientOffer | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<ClientOffer>>({
    offerCode: '',
    linkedQuoteId: '',
    clientId: '',
    clientName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'draft',
    expirationDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const isReadOnly = Boolean(editingOffer && editingOffer.status !== 'draft');

  const filteredOffers = useMemo(() => {
    return offers.filter((offer) => {
      const matchesSearch =
        searchTerm.trim() === '' ||
        offer.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        offer.offerCode.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || offer.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [offers, searchTerm, filterStatus]);

  const openEditModal = (offer: ClientOffer) => {
    setEditingOffer(offer);
    setFormData({
      ...offer,
      expirationDate: offer.expirationDate?.split('T')[0] || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openAddModal = () => {
    setEditingOffer(null);
    setFormData({
      offerCode: '',
      linkedQuoteId: '',
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

  const handleClientChange = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      clientName: client?.name || '',
    }));
  };

  const addItem = () => {
    if (isReadOnly) return;
    const nextItem: ClientOfferItem = {
      id: `tmp-${Date.now()}`,
      offerId: editingOffer?.id || '',
      productId: '',
      productName: '',
      specialBidId: '',
      quantity: 1,
      unitPrice: 0,
      productCost: 0,
      productTaxRate: 0,
      productMolPercentage: null,
      specialBidUnitPrice: null,
      specialBidMolPercentage: null,
      discount: 0,
      note: '',
    };
    setFormData((prev) => ({
      ...prev,
      items: [...(prev.items || []), nextItem],
    }));
  };

  const removeItem = (index: number) => {
    if (isReadOnly) return;
    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const updateItem = (index: number, field: keyof ClientOfferItem, value: string | number) => {
    if (isReadOnly) return;
    setFormData((prev) => {
      const items = [...(prev.items || [])];
      const current = { ...items[index], [field]: value };

      if (field === 'productId') {
        const product = products.find((item) => item.id === value);
        if (product) {
          const matchingBid = activeSpecialBids.find(
            (bid) => bid.clientId === prev.clientId && bid.productId === value,
          );
          const molSource = matchingBid?.molPercentage ?? product.molPercentage;
          const mol = molSource ? Number(molSource) : 0;
          const cost = matchingBid ? Number(matchingBid.unitPrice) : Number(product.costo);
          current.productName = product.name;
          current.specialBidId = matchingBid?.id || '';
          current.unitPrice = calcProductSalePrice(cost, mol);
          current.productCost = Number(product.costo);
          current.productTaxRate = Number(product.taxRate ?? 0);
          current.productMolPercentage = product.molPercentage;
          current.specialBidUnitPrice = matchingBid ? Number(matchingBid.unitPrice) : null;
          current.specialBidMolPercentage = matchingBid?.molPercentage ?? null;
        }
      }

      items[index] = current;
      return { ...prev, items };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (!formData.clientId) nextErrors.clientId = t('crm:quotes.errors.clientRequired');
    if (!formData.offerCode?.trim()) {
      nextErrors.offerCode = t('sales:clientOffers.offerCodeRequired', {
        defaultValue: 'Offer code is required',
      });
    }
    if (!formData.items || formData.items.length === 0) {
      nextErrors.items = t('crm:quotes.errors.itemsRequired');
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const payload: Partial<ClientOffer> = {
      ...formData,
      discount: roundToTwoDecimals(Number(formData.discount ?? 0)),
      items: (formData.items || []).map((item) => ({
        ...item,
        unitPrice: roundToTwoDecimals(Number(item.unitPrice ?? 0)),
        productCost: roundToTwoDecimals(Number(item.productCost ?? 0)),
        productTaxRate: roundToTwoDecimals(Number(item.productTaxRate ?? 0)),
        discount: roundToTwoDecimals(Number(item.discount ?? 0)),
      })),
    };

    if (editingOffer) {
      await onUpdateOffer(editingOffer.id, payload);
    } else if (onAddOffer) {
      await onAddOffer(payload);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800">
              {editingOffer
                ? t('sales:clientOffers.editOffer', { defaultValue: 'Edit offer' })
                : t('sales:clientOffers.newOffer', { defaultValue: 'New offer' })}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 rounded-xl text-slate-400 hover:bg-slate-100"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[85vh] overflow-y-auto">
            {editingOffer?.linkedQuoteId && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex items-center justify-between gap-3">
                <span>
                  {t('sales:clientOffers.sourceQuote', {
                    defaultValue: 'Source quote: {{quoteId}}',
                    quoteId: editingOffer.linkedQuoteId,
                  })}
                </span>
                {onViewQuote && (
                  <button
                    type="button"
                    onClick={() => onViewQuote(editingOffer.linkedQuoteId)}
                    className="text-praetor font-bold hover:text-slate-700"
                  >
                    {t('sales:clientOffers.viewQuote', { defaultValue: 'View quote' })}
                  </button>
                )}
              </div>
            )}

            {isReadOnly && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                {t('sales:clientOffers.readOnlyStatus', {
                  defaultValue:
                    'Non-draft offers are read-only. Change status from the list actions.',
                })}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:clientOffers.client', { defaultValue: 'Client' })}
                </label>
                <CustomSelect
                  options={activeClients.map((client) => ({ id: client.id, name: client.name }))}
                  value={formData.clientId || ''}
                  onChange={(value) => handleClientChange(value as string)}
                  searchable={true}
                  disabled={isReadOnly}
                />
                {errors.clientId && <p className="text-red-500 text-xs mt-1">{errors.clientId}</p>}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:clientOffers.offerCode', { defaultValue: 'Offer code' })}
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
                  {t('sales:clientOffers.paymentTerms', { defaultValue: 'Payment terms' })}
                </label>
                <CustomSelect
                  options={paymentTermsOptions}
                  value={formData.paymentTerms || 'immediate'}
                  onChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      paymentTerms: value as ClientOffer['paymentTerms'],
                    }))
                  }
                  searchable={false}
                  disabled={isReadOnly}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:clientOffers.expirationDate', { defaultValue: 'Expiration date' })}
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
                  {t('sales:clientOffers.items', { defaultValue: 'Items' })}
                </h4>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={addItem}
                    className="text-sm font-bold text-praetor hover:text-slate-700"
                  >
                    <i className="fa-solid fa-plus mr-1"></i>
                    {t('sales:clientOffers.addItem', { defaultValue: 'Add item' })}
                  </button>
                )}
              </div>

              {errors.items && <p className="text-red-500 text-xs">{errors.items}</p>}

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
                    <div className="col-span-5 md:col-span-1">
                      <ValidatedNumberInput
                        value={item.productTaxRate || 0}
                        onValueChange={(value) =>
                          updateItem(index, 'productTaxRate', value === '' ? 0 : Number(value))
                        }
                        className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div className="col-span-7 md:col-span-1 flex justify-end">
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      )}
                    </div>
                    <div className="col-span-12">
                      <input
                        type="text"
                        value={item.note || ''}
                        disabled={isReadOnly}
                        placeholder={t('sales:clientOffers.note', { defaultValue: 'Note' })}
                        onChange={(event) => updateItem(index, 'note', event.target.value)}
                        className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('sales:clientOffers.discount', { defaultValue: 'Discount %' })}
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
                  {t('sales:clientOffers.status', { defaultValue: 'Status' })}
                </label>
                <CustomSelect
                  options={statusOptions}
                  value={formData.status || 'draft'}
                  onChange={(value) =>
                    setFormData((prev) => ({ ...prev, status: value as ClientOffer['status'] }))
                  }
                  searchable={false}
                  disabled={isReadOnly}
                />
              </div>
              <div className="flex items-end justify-end">
                {(() => {
                  const totals = calculateTotals(
                    formData.items || [],
                    Number(formData.discount || 0),
                  );
                  return (
                    <div className="text-right">
                      <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                        {t('sales:clientOffers.total', { defaultValue: 'Total' })}
                      </div>
                      <div className="text-2xl font-black text-praetor">
                        {totals.total.toFixed(2)} {currency}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('sales:clientOffers.notes', { defaultValue: 'Notes' })}
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

            <div className="flex justify-between items-center border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                {t('common.cancel')}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-praetor text-white text-sm font-bold hover:bg-slate-700"
                >
                  {editingOffer ? t('common.update') : t('common.save')}
                </button>
              )}
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden p-6 space-y-4">
          <h3 className="text-lg font-black text-slate-800">
            {t('sales:clientOffers.deleteTitle', { defaultValue: 'Delete offer?' })}
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

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">
            {t('sales:clientOffers.title', { defaultValue: 'Client Offers' })}
          </h2>
          <p className="text-sm text-slate-500">
            {t('sales:clientOffers.subtitle', {
              defaultValue: 'Offers created from customer quotes.',
            })}
          </p>
        </div>
        {onAddOffer && (
          <button
            onClick={openAddModal}
            className="px-4 py-2.5 rounded-xl bg-praetor text-white text-sm font-bold"
          >
            <i className="fa-solid fa-plus mr-2"></i>
            {t('sales:clientOffers.addOffer', { defaultValue: 'Add offer' })}
          </button>
        )}
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
                {t('sales:clientOffers.client', { defaultValue: 'Client' })}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:clientOffers.offerCode', { defaultValue: 'Offer code' })}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:clientOffers.status', { defaultValue: 'Status' })}
              </th>
              <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-slate-400">
                {t('sales:clientOffers.total', { defaultValue: 'Total' })}
              </th>
              <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-slate-400">
                {t('common.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOffers.map((offer) => {
              const totals = calculateTotals(offer.items, offer.discount);
              return (
                <tr key={offer.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-4">
                    <div className="font-bold text-slate-800">{offer.clientName}</div>
                    <div className="text-xs text-slate-400">{offer.linkedQuoteId}</div>
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
                    {totals.total.toFixed(2)} {currency}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      {onViewQuote && (
                        <button
                          onClick={() => onViewQuote(offer.linkedQuoteId)}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                          title={t('sales:clientOffers.viewQuote', { defaultValue: 'View quote' })}
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
                          title={t('sales:clientOffers.markSent', { defaultValue: 'Mark as sent' })}
                        >
                          <i className="fa-solid fa-paper-plane"></i>
                        </button>
                      )}
                      {offer.status === 'sent' && (
                        <>
                          <button
                            onClick={() => onUpdateOffer(offer.id, { status: 'accepted' })}
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                            title={t('sales:clientOffers.markAccepted', {
                              defaultValue: 'Mark as accepted',
                            })}
                          >
                            <i className="fa-solid fa-check"></i>
                          </button>
                          <button
                            onClick={() => onUpdateOffer(offer.id, { status: 'denied' })}
                            className="w-10 h-10 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                            title={t('sales:clientOffers.markDenied', {
                              defaultValue: 'Mark as denied',
                            })}
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </>
                      )}
                      {offer.status === 'accepted' && onCreateClientsOrder && (
                        <button
                          onClick={() => onCreateClientsOrder(offer)}
                          className="w-10 h-10 rounded-xl text-slate-400 hover:text-praetor hover:bg-slate-100"
                          title={t('sales:clientOffers.createOrder', {
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ClientOffersView;
