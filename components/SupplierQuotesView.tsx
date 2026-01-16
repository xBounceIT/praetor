import React, { useMemo, useState } from 'react';
import { SupplierQuote, SupplierQuoteItem, Supplier, Product } from '../types';
import CustomSelect from './CustomSelect';

const PAYMENT_TERMS_OPTIONS = [
  { id: 'immediate', name: 'Immediate' },
  { id: '15gg', name: '15 days' },
  { id: '21gg', name: '21 days' },
  { id: '30gg', name: '30 days' },
  { id: '45gg', name: '45 days' }
];

const STATUS_OPTIONS = [
  { id: 'received', name: 'Received' },
  { id: 'approved', name: 'Approved' },
  { id: 'rejected', name: 'Rejected' }
];

interface SupplierQuotesViewProps {
  quotes: SupplierQuote[];
  suppliers: Supplier[];
  products: Product[];
  onAddQuote: (quoteData: Partial<SupplierQuote>) => void;
  onUpdateQuote: (id: string, updates: Partial<SupplierQuote>) => void;
  onDeleteQuote: (id: string) => void;
  currency: string;
}

const SupplierQuotesView: React.FC<SupplierQuotesViewProps> = ({
  quotes,
  suppliers,
  products,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  currency
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<SupplierQuote | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [quoteToDelete, setQuoteToDelete] = useState<SupplierQuote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_supplier_quotes_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_supplier_quotes_rowsPerPage', value.toString());
    setCurrentPage(1);
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [filterSupplierId, setFilterSupplierId] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredQuotes = useMemo(() => {
    return quotes.filter(quote => {
      const matchesSearch = searchTerm === '' ||
        quote.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.purchaseOrderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.items.some(item => item.productName.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesSupplier = filterSupplierId === 'all' || quote.supplierId === filterSupplierId;
      const matchesStatus = filterStatus === 'all' || quote.status === filterStatus;

      return matchesSearch && matchesSupplier && matchesStatus;
    });
  }, [quotes, searchTerm, filterSupplierId, filterStatus]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterSupplierId, filterStatus]);

  const [formData, setFormData] = useState<Partial<SupplierQuote>>({
    supplierId: '',
    supplierName: '',
    purchaseOrderNumber: '',
    items: [],
    paymentTerms: 'immediate',
    discount: 0,
    status: 'received',
    expirationDate: new Date().toISOString().split('T')[0],
    notes: ''
  });

  const openAddModal = () => {
    setEditingQuote(null);
    setFormData({
      supplierId: '',
      supplierName: '',
      purchaseOrderNumber: '',
      items: [],
      paymentTerms: 'immediate',
      discount: 0,
      status: 'received',
      expirationDate: new Date().toISOString().split('T')[0],
      notes: ''
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (quote: SupplierQuote) => {
    setEditingQuote(quote);
    const formattedDate = quote.expirationDate ? new Date(quote.expirationDate).toISOString().split('T')[0] : '';
    setFormData({
      supplierId: quote.supplierId,
      supplierName: quote.supplierName,
      purchaseOrderNumber: quote.purchaseOrderNumber,
      items: quote.items,
      paymentTerms: quote.paymentTerms,
      discount: quote.discount,
      status: quote.status,
      expirationDate: formattedDate,
      notes: quote.notes || ''
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!formData.supplierId) {
      newErrors.supplierId = 'Supplier is required';
    }
    if (!formData.purchaseOrderNumber?.trim()) {
      newErrors.purchaseOrderNumber = 'PO number is required';
    }
    if (!formData.items || formData.items.length === 0) {
      newErrors.items = 'At least one product is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (editingQuote) {
      onUpdateQuote(editingQuote.id, formData);
    } else {
      onAddQuote(formData);
    }
    setIsModalOpen(false);
  };

  const confirmDelete = (quote: SupplierQuote) => {
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

  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    setFormData({
      ...formData,
      supplierId,
      supplierName: supplier?.name || ''
    });
    if (errors.supplierId) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.supplierId;
        return next;
      });
    }
  };

  const addProductRow = () => {
    const newItem: Partial<SupplierQuoteItem> = {
      id: 'temp-' + Date.now(),
      productId: '',
      productName: '',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      note: ''
    };
    setFormData({
      ...formData,
      items: [...(formData.items || []), newItem as SupplierQuoteItem]
    });
    if (errors.items) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.items;
        return next;
      });
    }
  };

  const removeProductRow = (index: number) => {
    const newItems = [...(formData.items || [])];
    newItems.splice(index, 1);
    setFormData({ ...formData, items: newItems });
  };

  const updateProductRow = (index: number, field: keyof SupplierQuoteItem, value: any) => {
    const newItems = [...(formData.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'productId') {
      const product = products.find(p => p.id === value);
      if (product) {
        newItems[index].productName = product.name;
        newItems[index].unitPrice = Number(product.costo);
      }
    }

    setFormData({ ...formData, items: newItems });
  };

  const calculateTotals = (items: SupplierQuoteItem[], globalDiscount: number) => {
    let subtotal = 0;
    const taxGroups: Record<number, number> = {};

    items.forEach(item => {
      const product = products.find(p => p.id === item.productId);
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineDiscount = item.discount ? (lineSubtotal * item.discount / 100) : 0;
      const lineNet = lineSubtotal - lineDiscount;
      subtotal += lineNet;

      if (product) {
        const taxRate = product.taxRate;
        const lineNetAfterGlobal = lineNet * (1 - globalDiscount / 100);
        const taxAmount = lineNetAfterGlobal * (taxRate / 100);
        taxGroups[taxRate] = (taxGroups[taxRate] || 0) + taxAmount;
      }
    });

    const discountAmount = subtotal * (globalDiscount / 100);
    const taxableAmount = subtotal - discountAmount;
    const totalTax = Object.values(taxGroups).reduce((sum, val) => sum + val, 0);
    const total = taxableAmount + totalTax;

    return { subtotal, discountAmount, totalTax, total, taxGroups };
  };

  const activeSuppliers = suppliers.filter(s => !s.isDisabled);
  const activeProducts = products.filter(p => !p.isDisabled);

  const totalPages = Math.ceil(filteredQuotes.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedQuotes = filteredQuotes.slice(startIndex, startIndex + rowsPerPage);

  const isExpired = (expirationDate: string) => new Date(expirationDate) < new Date();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i className={`fa-solid ${editingQuote ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                </div>
                {editingQuote ? 'Edit Supplier Quote' : 'Create Supplier Quote'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  Supplier Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Supplier</label>
                    <CustomSelect
                      options={activeSuppliers.map(s => ({ id: s.id, name: s.name }))}
                      value={formData.supplierId || ''}
                      onChange={handleSupplierChange}
                      placeholder="Select a supplier..."
                      searchable={true}
                      className={errors.supplierId ? 'border-red-300' : ''}
                    />
                    {errors.supplierId && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.supplierId}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Purchase Order #</label>
                    <input
                      type="text"
                      value={formData.purchaseOrderNumber}
                      onChange={(e) => {
                        setFormData({ ...formData, purchaseOrderNumber: e.target.value });
                        if (errors.purchaseOrderNumber) setErrors({ ...errors, purchaseOrderNumber: '' });
                      }}
                      placeholder="PO-2026-001"
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.purchaseOrderNumber ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                    />
                    {errors.purchaseOrderNumber && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.purchaseOrderNumber}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                    Products / Services
                  </h4>
                  <button
                    type="button"
                    onClick={addProductRow}
                    className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1"
                  >
                    <i className="fa-solid fa-plus"></i> Add Product
                  </button>
                </div>
                {errors.items && (
                  <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
                )}

                {formData.items && formData.items.length > 0 && (
                  <div className="grid grid-cols-12 gap-2 px-3 mb-1">
                    <div className="col-span-12 md:col-span-4 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Product / Service</div>
                    <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">Qty</div>
                    <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">Unit ({currency})</div>
                    <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">Discount</div>
                    <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">Note</div>
                  </div>
                )}

                {formData.items && formData.items.length > 0 ? (
                  <div className="space-y-3">
                    {formData.items.map((item, index) => (
                      <div key={item.id} className="flex gap-2 items-start bg-slate-50 p-3 rounded-xl">
                        <div className="flex-1 grid grid-cols-12 gap-2">
                          <div className="col-span-4">
                            <CustomSelect
                              options={activeProducts.map(p => ({ id: p.id, name: p.name }))}
                              value={item.productId}
                              onChange={(val) => updateProductRow(index, 'productId', val)}
                              placeholder="Select product..."
                              searchable={true}
                              buttonClassName="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              required
                              placeholder="Qty"
                              value={item.quantity}
                              onChange={(e) => updateProductRow(index, 'quantity', parseFloat(e.target.value) || 0)}
                              className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              required
                              placeholder="Unit"
                              value={item.unitPrice}
                              onChange={(e) => updateProductRow(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                              className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none font-semibold"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              placeholder="%"
                              value={item.discount}
                              onChange={(e) => updateProductRow(index, 'discount', parseFloat(e.target.value) || 0)}
                              className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              placeholder="Note"
                              value={item.note || ''}
                              onChange={(e) => updateProductRow(index, 'note', e.target.value)}
                              className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none"
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeProductRow(index)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    No products added. Click "Add Product" to start.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  Quote Details
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Payment Terms</label>
                    <CustomSelect
                      options={PAYMENT_TERMS_OPTIONS}
                      value={formData.paymentTerms || 'immediate'}
                      onChange={(val) => setFormData({ ...formData, paymentTerms: val as any })}
                      searchable={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Global Discount (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={formData.discount}
                      onChange={(e) => setFormData({ ...formData, discount: parseFloat(e.target.value) || 0 })}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Status</label>
                    <CustomSelect
                      options={STATUS_OPTIONS}
                      value={formData.status || 'received'}
                      onChange={(val) => setFormData({ ...formData, status: val as any })}
                      searchable={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Expiration Date</label>
                    <input
                      type="date"
                      required
                      value={formData.expirationDate}
                      onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">Notes</label>
                    <textarea
                      rows={3}
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Additional notes or terms..."
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
                    />
                  </div>
                </div>
              </div>

              {formData.items && formData.items.length > 0 && (
                <div className="pt-8 border-t border-slate-100">
                  {(() => {
                    const { subtotal, discountAmount, totalTax, total, taxGroups } = calculateTotals(formData.items, formData.discount || 0);
                    return (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
                        <div className="flex flex-col justify-center space-y-3 h-full">
                          <div className="flex justify-between items-center px-2">
                            <span className="text-sm font-bold text-slate-500">Subtotal:</span>
                            <span className="text-sm font-black text-slate-800">{subtotal.toFixed(2)} {currency}</span>
                          </div>
                          {formData.discount! > 0 && (
                            <div className="flex justify-between items-center px-2">
                              <span className="text-sm font-bold text-slate-500">Discount ({formData.discount}%):</span>
                              <span className="text-sm font-black text-amber-600">-{discountAmount.toFixed(2)} {currency}</span>
                            </div>
                          )}
                          {Object.entries(taxGroups).map(([rate, amount]) => (
                            <div key={rate} className="flex justify-between items-center px-2">
                              <span className="text-sm font-bold text-slate-500">Tax ({rate}%):</span>
                              <span className="text-sm font-black text-slate-800">{amount.toFixed(2)} {currency}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-col items-center justify-center py-4 bg-slate-50/50 rounded-2xl border border-slate-100/50">
                          <span className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Total:</span>
                          <span className="text-4xl font-black text-praetor leading-none">
                            {total.toFixed(2)}
                            <span className="text-xl ml-1 opacity-60 text-slate-400">{currency}</span>
                          </span>
                        </div>
                        <div className="bg-slate-50/40 rounded-2xl p-6 flex flex-col items-center justify-center border border-slate-100/50">
                          <span className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Purchase Order</span>
                          <div className="text-center">
                            <div className="text-2xl font-black text-slate-700 leading-none mb-1">{formData.purchaseOrderNumber || '—'}</div>
                            <div className="text-xs font-black text-slate-400 opacity-60">Status: {formData.status?.toUpperCase()}</div>
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
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {editingQuote ? 'Update Quote' : 'Create Quote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">Delete Quote?</h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  Are you sure you want to delete quote <span className="font-bold text-slate-800">{quoteToDelete?.purchaseOrderNumber}</span>?
                  This action cannot be undone.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                >
                  Yes, Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">Supplier Quotes</h2>
          <p className="text-slate-500 text-sm">Track supplier quotes for purchase orders</p>
        </div>
        <button
          onClick={openAddModal}
          className="bg-praetor text-white px-6 py-3 rounded-2xl font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
        >
          <i className="fa-solid fa-plus"></i> Create Supplier Quote
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            placeholder="Search suppliers, PO, or products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
          />
        </div>
        <div>
          <CustomSelect
            options={[{ id: 'all', name: 'All Suppliers' }, ...activeSuppliers.map(s => ({ id: s.id, name: s.name }))]}
            value={filterSupplierId}
            onChange={setFilterSupplierId}
            placeholder="Filter by Supplier"
            searchable={true}
            buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
          />
        </div>
        <div>
          <CustomSelect
            options={[{ id: 'all', name: 'All Statuses' }, ...STATUS_OPTIONS]}
            value={filterStatus}
            onChange={setFilterStatus}
            placeholder="Filter by Status"
            searchable={false}
            buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm">
        <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center rounded-t-3xl">
          <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">All Supplier Quotes</h4>
          <span className="bg-slate-100 text-praetor px-3 py-1 rounded-full text-[10px] font-black">{filteredQuotes.length} TOTAL</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Supplier</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">PO #</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Expiration</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedQuotes.map(quote => {
                const { total } = calculateTotals(quote.items, quote.discount);
                const expired = isExpired(quote.expirationDate);
                return (
                  <tr
                    key={quote.id}
                    onClick={() => openEditModal(quote)}
                    className={`hover:bg-slate-50/50 transition-colors group cursor-pointer ${expired ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
                          <i className="fa-solid fa-truck"></i>
                        </div>
                        <div>
                          <div className="font-bold text-slate-800">{quote.supplierName}</div>
                          <div className="text-[10px] font-black text-slate-400 uppercase">{quote.items.length} item{quote.items.length !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-sm font-bold text-slate-700">{quote.purchaseOrderNumber}</td>
                    <td className="px-8 py-5">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black ${quote.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700'
                        : quote.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                        }`}>
                        {quote.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-sm font-bold text-slate-700">
                      {total.toFixed(2)} {currency}
                    </td>
                    <td className="px-8 py-5">
                      <div className={`text-sm ${expired ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
                        {new Date(quote.expirationDate).toLocaleDateString()}
                        {expired && <span className="ml-2 text-[10px] font-black">(EXPIRED)</span>}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(quote);
                          }}
                          className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                          title="Edit Quote"
                        >
                          <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateQuote(quote.id, { status: quote.status === 'received' ? 'approved' : 'received' });
                          }}
                          className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                          title={quote.status === 'received' ? 'Mark as Approved' : 'Mark as Received'}
                        >
                          <i className={`fa-solid ${quote.status === 'received' ? 'fa-check' : 'fa-rotate-left'}`}></i>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(quote);
                          }}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Delete Quote"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredQuotes.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                      <i className="fa-solid fa-file-invoice text-2xl"></i>
                    </div>
                    <p className="text-slate-400 text-sm font-bold">No supplier quotes found.</p>
                    <button onClick={openAddModal} className="mt-4 text-praetor text-sm font-black hover:underline">Create your first supplier quote</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-8 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4 rounded-b-3xl">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500">Rows per page:</span>
            <CustomSelect
              options={[
                { id: '5', name: '5' },
                { id: '10', name: '10' },
                { id: '20', name: '20' },
                { id: '50', name: '50' }
              ]}
              value={rowsPerPage.toString()}
              onChange={(val) => handleRowsPerPageChange(val)}
              className="w-20"
              buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
              searchable={false}
            />
            <span className="text-xs font-bold text-slate-400 ml-2">
              Showing {paginatedQuotes.length > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + rowsPerPage, filteredQuotes.length)} of {filteredQuotes.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              <i className="fa-solid fa-chevron-left text-xs"></i>
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${currentPage === page
                    ? 'bg-praetor text-white shadow-md shadow-slate-200'
                    : 'text-slate-500 hover:bg-slate-100'
                    }`}
                >
                  {page}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              <i className="fa-solid fa-chevron-right text-xs"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierQuotesView;
