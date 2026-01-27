import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sale, SaleItem, Client, Product, SpecialBid } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import ValidatedNumberInput from './ValidatedNumberInput';
import StatusBadge, { StatusType } from './StatusBadge';
import { parseNumberInputValue, roundToTwoDecimals } from '../utils/numbers';

const getPaymentTermsOptions = (t: (key: string) => string) => [
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

const getStatusOptions = (t: (key: string) => string) => [
  { id: 'draft', name: t('crm:sales.statusDraft') },
  { id: 'sent', name: t('crm:sales.statusSent') },
  { id: 'confirmed', name: t('crm:sales.statusConfirmed') },
  { id: 'denied', name: t('crm:sales.statusDenied') },
];

interface SalesViewProps {
  sales: Sale[];
  clients: Client[];
  products: Product[];
  specialBids: SpecialBid[];
  onAddSale: (saleData: Partial<Sale>) => void;
  onUpdateSale: (id: string, updates: Partial<Sale>) => void;
  onDeleteSale: (id: string) => void;
  onViewQuote?: (quoteId: string) => void;
  currency: string;
}

const calcProductSalePrice = (costo: number, molPercentage: number) => {
  if (molPercentage >= 100) return costo;
  return costo / (1 - molPercentage / 100);
};

const getSaleStatusLabel = (status: Sale['status'], t: (key: string) => string) => {
  if (status === 'sent') return t('crm:sales.statusSent');
  if (status === 'confirmed') return t('crm:sales.statusConfirmed');
  if (status === 'denied') return t('crm:sales.statusDenied');
  return t('crm:sales.statusDraft');
};

const SalesView: React.FC<SalesViewProps> = ({
  sales,
  clients,
  products,
  specialBids,
  onAddSale,
  onUpdateSale,
  onDeleteSale,
  onViewQuote,
  currency,
}) => {
  const { t } = useTranslation(['crm', 'common']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_sales_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });
  const [historyCurrentPage, setHistoryCurrentPage] = useState(1);
  const [historyRowsPerPage, setHistoryRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_sales_history_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_sales_rowsPerPage', value.toString());
    setCurrentPage(1); // Reset to first page
  };

  const handleHistoryRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setHistoryRowsPerPage(value);
    localStorage.setItem('praetor_sales_history_rowsPerPage', value.toString());
    setHistoryCurrentPage(1);
  };

  // Filter State
  /* Filters removed */
  const filteredSales = sales;

  const activeSales = useMemo(
    () => filteredSales.filter((sale) => sale.status === 'draft' || sale.status === 'sent'),
    [filteredSales],
  );
  const historySales = useMemo(
    () => filteredSales.filter((sale) => sale.status === 'confirmed' || sale.status === 'denied'),
    [filteredSales],
  );

  // Form State
  const [formData, setFormData] = useState<Partial<Sale>>({
    clientId: '',
    clientName: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'draft',
    notes: '',
  });

  const openAddModal = () => {
    setEditingSale(null);
    setFormData({
      clientId: '',
      clientName: '',
      items: [],
      paymentTerms: 'immediate',
      discount: 0,
      status: 'draft',
      notes: '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (sale: Sale) => {
    setEditingSale(sale);
    setFormData({
      linkedQuoteId: sale.linkedQuoteId,
      clientId: sale.clientId,
      clientName: sale.clientName,
      items: sale.items,
      paymentTerms: sale.paymentTerms,
      discount: sale.discount,
      status: sale.status,
      notes: sale.notes || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};

    if (!formData.clientId) {
      newErrors.clientId = t('crm:quotes.errors.clientRequired');
    }

    if (!formData.items || formData.items.length === 0) {
      newErrors.items = t('crm:quotes.errors.itemsRequired');
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

    if (editingSale) {
      onUpdateSale(editingSale.id, payload);
    } else {
      onAddSale(payload);
    }
    setIsModalOpen(false);
  };

  const confirmDelete = (sale: Sale) => {
    setSaleToDelete(sale);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (saleToDelete) {
      onDeleteSale(saleToDelete.id);
      setIsDeleteConfirmOpen(false);
      setSaleToDelete(null);
    }
  };

  const handleClientChange = (clientId: string) => {
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
    const newItem: Partial<SaleItem> = {
      id: 'temp-' + Date.now(),
      productId: '',
      productName: '',
      specialBidId: '',
      quantity: 1,
      unitPrice: 0,
      productCost: 0,
      productMolPercentage: null,
      specialBidUnitPrice: null,
      specialBidMolPercentage: null,
      discount: 0,
    };
    setFormData({
      ...formData,
      items: [...(formData.items || []), newItem as SaleItem],
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
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData({ ...formData, items: newItems });
  };

  const updateProductRow = (index: number, field: keyof SaleItem, value: string | number) => {
    const newItems = [...(formData.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };

    // Auto-fill price when product is selected
    if (field === 'productId') {
      const product = activeProducts.find((p) => p.id === value);
      if (product) {
        newItems[index].productName = product.name;
        const applicableBid = activeSpecialBids.find(
          (b) => b.clientId === formData.clientId && b.productId === value,
        );

        if (applicableBid) {
          const molSource = applicableBid.molPercentage ?? product.molPercentage;
          const mol = molSource ? Number(molSource) : 0;
          newItems[index].specialBidId = applicableBid.id;
          newItems[index].unitPrice = calcProductSalePrice(Number(applicableBid.unitPrice), mol);
          newItems[index].productCost = Number(product.costo);
          newItems[index].productMolPercentage = product.molPercentage;
          newItems[index].specialBidUnitPrice = Number(applicableBid.unitPrice);
          newItems[index].specialBidMolPercentage = applicableBid.molPercentage ?? null;
        } else {
          const mol = product.molPercentage ? Number(product.molPercentage) : 0;
          newItems[index].specialBidId = '';
          newItems[index].unitPrice = calcProductSalePrice(Number(product.costo), mol);
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
  const calculateTotals = (items: SaleItem[], globalDiscount: number) => {
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
        // Use stored snapshot values to avoid retroactive changes
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

  const isLinkedQuote = Boolean(formData.linkedQuoteId);
  const isReadOnly = Boolean(isLinkedQuote || (editingSale && editingSale.status !== 'draft'));

  // Pagination Logic
  const totalPages = Math.ceil(activeSales.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedSales = activeSales.slice(startIndex, startIndex + rowsPerPage);
  const historyTotalPages = Math.ceil(historySales.length / historyRowsPerPage);
  const historyStartIndex = (historyCurrentPage - 1) * historyRowsPerPage;
  const historySalesPage = historySales.slice(
    historyStartIndex,
    historyStartIndex + historyRowsPerPage,
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i className={`fa-solid ${editingSale ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                </div>
                {editingSale ? t('crm:sales.editSale') : t('crm:sales.addSale')}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
              {editingSale && editingSale.status !== 'draft' && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                  <span className="text-amber-700 text-xs font-bold">
                    {t('crm:quotes.readOnlyStatus', {
                      status: getSaleStatusLabel(editingSale.status, t),
                    })}
                  </span>
                </div>
              )}
              {/* Linked Quote Info */}
              {formData.linkedQuoteId && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                      <i className="fa-solid fa-link"></i>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {t('crm:sales.linkedQuote')}
                      </div>
                      <div className="text-xs text-praetor">
                        {t('crm:sales.linkedQuoteInfo', { number: formData.linkedQuoteId })}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {t('crm:sales.quoteDetailsReadOnly')}
                      </div>
                    </div>
                  </div>
                  {onViewQuote && (
                    <button
                      type="button"
                      onClick={() => onViewQuote(formData.linkedQuoteId!)}
                      className="text-xs font-bold text-praetor hover:text-slate-800 hover:underline"
                    >
                      {t('crm:quotes.viewQuote')}
                    </button>
                  )}
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
                    {t('crm:sales.client')}
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
                        {t('crm:sales.specialBidLabel')}
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
                        {t('crm:products.molPercentage')}
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

                      // Use stored snapshot values to avoid retroactive changes
                      const cost = item.specialBidId
                        ? (item.specialBidUnitPrice ?? selectedBid?.unitPrice ?? 0)
                        : (item.productCost ?? selectedProduct?.costo ?? 0);

                      const molSource = item.specialBidId
                        ? (item.specialBidMolPercentage ?? selectedBid?.molPercentage)
                        : (item.productMolPercentage ?? selectedProduct?.molPercentage);
                      const molPercentage = molSource ? Number(molSource) : 0;
                      const salePrice = Number(item.unitPrice || 0);
                      const margin = salePrice - cost;

                      return (
                        <div key={item.id} className="bg-slate-50 p-3 rounded-xl">
                          <div className="flex gap-3 items-center">
                            <div className="flex-1 grid grid-cols-12 gap-3 items-center">
                              <div className="col-span-3">
                                <CustomSelect
                                  options={[
                                    { id: 'none', name: t('crm:quotes.noSpecialBid') },
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
                                  placeholder="Qty"
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
                                  className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:bg-slate-50 disabled:text-slate-400"
                                />
                              </div>
                              <div className="col-span-1 flex flex-col items-center justify-center">
                                <span className="text-xs font-bold text-slate-600">
                                  {cost.toFixed(2)} {currency}
                                </span>
                                {selectedBid && (
                                  <div className="text-[8px] font-black text-praetor uppercase tracking-wider">
                                    Bid
                                  </div>
                                )}
                              </div>
                              <div className="col-span-1 flex items-center justify-center">
                                <span className="text-xs font-bold text-slate-600">
                                  {molPercentage.toFixed(1)}%
                                </span>
                              </div>
                              <div className="col-span-1 flex items-center justify-center">
                                <span className="text-xs font-bold text-emerald-600">
                                  {margin.toFixed(2)} {currency}
                                </span>
                              </div>
                              <div className="col-span-2 flex items-center justify-center">
                                <span
                                  className={`text-sm font-semibold ${selectedBid ? 'text-praetor' : 'text-slate-800'}`}
                                >
                                  {salePrice.toFixed(2)} {currency}
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

              {/* Sale Details */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('crm:sales.saleDetails')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:sales.paymentTerms')}
                    </label>
                    <CustomSelect
                      options={getPaymentTermsOptions(t)}
                      value={formData.paymentTerms || 'immediate'}
                      onChange={(val) =>
                        setFormData({ ...formData, paymentTerms: val as Sale['paymentTerms'] })
                      }
                      searchable={false}
                      disabled={isReadOnly}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:quotes.globalDiscount')}
                    </label>
                    <div
                      className={`flex items-center rounded-xl focus-within:ring-2 focus-within:ring-praetor transition-all overflow-hidden bg-slate-50 border border-slate-200 ${isLinkedQuote ? 'opacity-50' : ''}`}
                    >
                      <div className="w-12 self-stretch flex items-center justify-center text-slate-400 text-xs font-bold border-r border-slate-200 bg-slate-100/30">
                        %
                      </div>
                      <ValidatedNumberInput
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.discount}
                        onValueChange={(value) => {
                          const parsed = parseNumberInputValue(value);
                          setFormData({ ...formData, discount: parsed });
                        }}
                        disabled={isReadOnly}
                        className="flex-1 px-4 py-2.5 bg-transparent outline-none text-sm font-semibold disabled:bg-transparent"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:sales.status')}
                    </label>
                    <CustomSelect
                      options={getStatusOptions(t)}
                      value={formData.status || 'pending'}
                      onChange={(val) =>
                        setFormData({ ...formData, status: val as Sale['status'] })
                      }
                      searchable={false}
                    />
                  </div>

                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:sales.notes')}
                    </label>
                    <textarea
                      rows={3}
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder={t('crm:quotes.additionalNotesPlaceholder')}
                      disabled={isReadOnly}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                </div>
              </div>

              {/* Totals Section */}
              {formData.items && formData.items.length > 0 && (
                <div className="pt-8 border-t border-slate-100">
                  {(() => {
                    const {
                      subtotal,
                      discountAmount,

                      total,
                      margin,
                      marginPercentage,
                      taxGroups,
                    } = calculateTotals(formData.items, formData.discount || 0);
                    return (
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
                  {t('crm:products.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {editingSale ? t('crm:sales.updateSale') : t('crm:sales.addSale')}
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
                  {t('crm:sales.deleteSaleTitle')}
                </h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t('crm:sales.deleteSaleConfirm', { clientName: saleToDelete?.clientName })}
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  {t('crm:products.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                >
                  {t('crm:specialBids.yesDelete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('crm:sales.title')}</h2>
          <p className="text-slate-500 text-sm">{t('crm:sales.subtitle')}</p>
        </div>
      </div>

      {/* Search and Filters */}

      <StandardTable
        title={t('crm:sales.activeSales')}
        totalCount={activeSales.length}
        containerClassName="overflow-visible"
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('crm:sales.createNewSale')}
          </button>
        }
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('crm:products.rowsPerPage')}
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
                {t('crm:products.showing')} {paginatedSales.length > 0 ? startIndex + 1 : 0}-
                {Math.min(startIndex + rowsPerPage, activeSales.length)} {t('crm:products.of')}{' '}
                {activeSales.length}
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
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
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
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                {t('crm:quotes.actionsColumn')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedSales.map((sale) => {
              const { total } = calculateTotals(sale.items, sale.discount);
              return (
                <tr
                  key={sale.id}
                  onClick={() => openEditModal(sale)}
                  className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                >
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
                        <i className="fa-solid fa-cart-shopping"></i>
                      </div>
                      <div>
                        <div className="font-bold text-slate-800">{sale.clientName}</div>
                        <div className="text-[10px] font-black text-slate-400 uppercase">
                          {sale.items.length} item{sale.items.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <StatusBadge
                      type={sale.status as StatusType}
                      label={getSaleStatusLabel(sale.status, t)}
                    />
                  </td>
                  <td className="px-8 py-5 text-sm font-bold text-slate-700">
                    {total.toFixed(2)} {currency}
                  </td>
                  <td className="px-8 py-5 text-sm font-semibold text-slate-600">
                    {sale.paymentTerms === 'immediate'
                      ? t('crm:paymentTerms.immediate')
                      : sale.paymentTerms}
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex justify-end gap-2">
                      {onViewQuote && sale.linkedQuoteId && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewQuote(sale.linkedQuoteId!);
                          }}
                          className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                          title={t('crm:quotes.viewQuote')}
                        >
                          <i className="fa-solid fa-link"></i>
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(sale);
                        }}
                        className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                        title={
                          sale.status === 'draft'
                            ? t('crm:sales.editSale')
                            : t('crm:quotes.viewQuote')
                        }
                      >
                        <i
                          className={`fa-solid ${sale.status === 'draft' ? 'fa-pen-to-square' : 'fa-eye'}`}
                        ></i>
                      </button>
                      {sale.status === 'draft' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateSale(sale.id, { status: 'sent' });
                          }}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          title={t('crm:sales.markAsSent')}
                        >
                          <i className="fa-solid fa-paper-plane"></i>
                        </button>
                      )}
                      {sale.status === 'sent' && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateSale(sale.id, { status: 'confirmed' });
                            }}
                            className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                            title={t('crm:sales.markAsConfirmed')}
                          >
                            <i className="fa-solid fa-check"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateSale(sale.id, { status: 'denied' });
                            }}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title={t('crm:sales.markAsDenied')}
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateSale(sale.id, { status: 'draft' });
                            }}
                            className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                            title={t('crm:sales.revertToDraft')}
                          >
                            <i className="fa-solid fa-rotate-left"></i>
                          </button>
                        </>
                      )}
                      {sale.status === 'draft' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(sale);
                          }}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title={t('crm:sales.deleteSale')}
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {activeSales.length === 0 && (
              <tr>
                <td colSpan={5} className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                    <i className="fa-solid fa-cart-shopping text-2xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-bold">{t('crm:sales.noActiveSales')}</p>
                  <button
                    onClick={openAddModal}
                    className="mt-4 text-praetor text-sm font-black hover:underline"
                  >
                    {t('crm:sales.createFirst')}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StandardTable>

      {historySales.length > 0 && (
        <StandardTable
          title={t('crm:sales.history')}
          totalCount={historySales.length}
          totalLabel={t('common:labels.total').toUpperCase()}
          containerClassName="border-dashed bg-slate-50"
          footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
          footer={
            <>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500">
                  {t('crm:products.rowsPerPage')}
                </span>
                <CustomSelect
                  options={[
                    { id: '5', name: '5' },
                    { id: '10', name: '10' },
                    { id: '20', name: '20' },
                    { id: '50', name: '50' },
                  ]}
                  value={historyRowsPerPage.toString()}
                  onChange={(val) => handleHistoryRowsPerPageChange(val as string)}
                  className="w-20"
                  buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                  searchable={false}
                />
                <span className="text-xs font-bold text-slate-400 ml-2">
                  {t('crm:products.showing')}{' '}
                  {historySalesPage.length > 0 ? historyStartIndex + 1 : 0}-
                  {Math.min(historyStartIndex + historyRowsPerPage, historySales.length)}{' '}
                  {t('crm:products.of')} {historySales.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHistoryCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={historyCurrentPage === 1}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  <i className="fa-solid fa-chevron-left text-xs"></i>
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: historyTotalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setHistoryCurrentPage(page)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                        historyCurrentPage === page
                          ? 'bg-praetor text-white shadow-md shadow-slate-200'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() =>
                    setHistoryCurrentPage((prev) => Math.min(historyTotalPages, prev + 1))
                  }
                  disabled={historyCurrentPage === historyTotalPages || historyTotalPages === 0}
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
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                  {t('crm:quotes.actionsColumn')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historySalesPage.map((sale) => {
                const { total } = calculateTotals(sale.items, sale.discount);
                return (
                  <tr
                    key={sale.id}
                    onClick={() => openEditModal(sale)}
                    className="transition-colors group cursor-pointer bg-slate-50 text-slate-400"
                  >
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
                          <i className="fa-solid fa-cart-shopping"></i>
                        </div>
                        <div>
                          <div className="font-bold text-slate-400">{sale.clientName}</div>
                          <div className="text-[10px] font-black text-slate-400 uppercase">
                            {sale.items.length} item{sale.items.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="opacity-60">
                        <StatusBadge
                          type={sale.status as StatusType}
                          label={getSaleStatusLabel(sale.status, t)}
                        />
                      </div>
                    </td>
                    <td className="px-8 py-5 text-sm font-bold text-slate-400">
                      {total.toFixed(2)} {currency}
                    </td>
                    <td className="px-8 py-5 text-sm font-semibold text-slate-400">
                      {sale.paymentTerms === 'immediate'
                        ? t('crm:paymentTerms.immediate')
                        : sale.paymentTerms}
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex justify-end gap-2">
                        {onViewQuote && sale.linkedQuoteId && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (sale.linkedQuoteId) onViewQuote(sale.linkedQuoteId);
                            }}
                            className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                            title={t('crm:quotes.viewQuote')}
                          >
                            <i className="fa-solid fa-link"></i>
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(sale);
                          }}
                          className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                          title={t('crm:quotes.viewQuote')}
                        >
                          <i className="fa-solid fa-eye"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StandardTable>
      )}
    </div>
  );
};

export default SalesView;
