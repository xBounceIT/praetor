import React, { useState, useMemo } from 'react';
import { Quote, QuoteItem, Client, Product } from '../types';

interface QuotesViewProps {
    quotes: Quote[];
    clients: Client[];
    products: Product[];
    onAddQuote: (quoteData: Partial<Quote>) => void;
    onUpdateQuote: (id: string, updates: Partial<Quote>) => void;
    onDeleteQuote: (id: string) => void;
}

const QuotesView: React.FC<QuotesViewProps> = ({ quotes, clients, products, onAddQuote, onUpdateQuote, onDeleteQuote }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<Quote>>({
        clientId: '',
        clientName: '',
        items: [],
        paymentTerms: 'immediate',
        discount: 0,
        status: 'quoted',
        expirationDate: new Date().toISOString().split('T')[0],
        notes: '',
    });

    const openAddModal = () => {
        setEditingQuote(null);
        setFormData({
            clientId: '',
            clientName: '',
            items: [],
            paymentTerms: 'immediate',
            discount: 0,
            status: 'quoted',
            expirationDate: new Date().toISOString().split('T')[0],
            notes: '',
        });
        setIsModalOpen(true);
    };

    const openEditModal = (quote: Quote) => {
        setEditingQuote(quote);
        setFormData({
            clientId: quote.clientId,
            clientName: quote.clientName,
            items: quote.items,
            paymentTerms: quote.paymentTerms,
            discount: quote.discount,
            status: quote.status,
            expirationDate: quote.expirationDate,
            notes: quote.notes || '',
        });
        setIsModalOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.clientId && formData.items && formData.items.length > 0) {
            if (editingQuote) {
                onUpdateQuote(editingQuote.id, formData);
            } else {
                onAddQuote(formData);
            }
            setIsModalOpen(false);
        }
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
        const client = clients.find(c => c.id === clientId);
        setFormData({
            ...formData,
            clientId,
            clientName: client?.name || '',
        });
    };

    const addProductRow = () => {
        const newItem: Partial<QuoteItem> = {
            id: 'temp-' + Date.now(),
            productId: '',
            productName: '',
            quantity: 1,
            unitPrice: 0,
            discount: 0,
        };
        setFormData({
            ...formData,
            items: [...(formData.items || []), newItem as QuoteItem],
        });
    };

    const removeProductRow = (index: number) => {
        const newItems = [...(formData.items || [])];
        newItems.splice(index, 1);
        setFormData({ ...formData, items: newItems });
    };

    const updateProductRow = (index: number, field: keyof QuoteItem, value: any) => {
        const newItems = [...(formData.items || [])];
        newItems[index] = { ...newItems[index], [field]: value };

        // Auto-fill price when product is selected
        if (field === 'productId') {
            const product = products.find(p => p.id === value);
            if (product) {
                newItems[index].productName = product.name;
                newItems[index].unitPrice = product.salePrice;
            }
        }

        setFormData({ ...formData, items: newItems });
    };

    // Calculate totals
    const calculateTotals = (items: QuoteItem[], globalDiscount: number) => {
        let subtotal = 0;
        let totalTax = 0;
        let totalCost = 0;

        items.forEach(item => {
            const product = products.find(p => p.id === item.productId);
            const lineSubtotal = item.quantity * item.unitPrice;
            const lineDiscount = item.discount ? (lineSubtotal * item.discount / 100) : 0;
            const lineNet = lineSubtotal - lineDiscount;

            subtotal += lineNet;

            if (product) {
                totalTax += lineNet * (product.taxRate / 100);
                totalCost += item.quantity * product.cost;
            }
        });

        const discountAmount = subtotal * (globalDiscount / 100);
        const taxableAmount = subtotal - discountAmount;
        // Adjust tax proportional to global discount
        const finalTax = totalTax * (1 - globalDiscount / 100);
        const total = taxableAmount + finalTax;
        const margin = taxableAmount - totalCost;
        const marginPercentage = taxableAmount > 0 ? (margin / taxableAmount) * 100 : 0;

        return { subtotal, taxableAmount, discountAmount, totalTax: finalTax, total, margin, marginPercentage };
    };

    const activeClients = clients.filter(c => !c.isDisabled);
    const activeProducts = products.filter(p => !p.isDisabled);

    // Check if quote is expired
    const isExpired = (expirationDate: string) => {
        return new Date(expirationDate) < new Date();
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Add/Edit Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                                    <i className={`fa-solid ${editingQuote ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                                </div>
                                {editingQuote ? 'Edit Quote' : 'Create New Quote'}
                            </h3>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
                            >
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
                            {/* Client Selection */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                    Client Information
                                </h4>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Client</label>
                                    <select
                                        required
                                        value={formData.clientId}
                                        onChange={(e) => handleClientChange(e.target.value)}
                                        className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                    >
                                        <option value="">Select a client...</option>
                                        {activeClients.map(client => (
                                            <option key={client.id} value={client.id}>{client.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Products */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h4 className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                        Products / Services
                                    </h4>
                                    <button
                                        type="button"
                                        onClick={addProductRow}
                                        className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                                    >
                                        <i className="fa-solid fa-plus"></i> Add Product
                                    </button>
                                </div>

                                {formData.items && formData.items.length > 0 && (
                                    <div className="grid grid-cols-12 gap-2 px-3 mb-1">
                                        <div className="col-span-12 md:col-span-5 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Product / Service</div>
                                        <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">Qty</div>
                                        <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">Unit Price</div>
                                        <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">Disc %</div>
                                        <div className="hidden md:block md:col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right pr-2">Subtotal</div>
                                    </div>
                                )}

                                {formData.items && formData.items.length > 0 ? (
                                    <div className="space-y-3">
                                        {formData.items.map((item, index) => (
                                            <div key={item.id} className="flex gap-2 items-start bg-slate-50 p-3 rounded-xl">
                                                <div className="flex-1 grid grid-cols-12 gap-2">
                                                    <div className="col-span-5">
                                                        <select
                                                            required
                                                            value={item.productId}
                                                            onChange={(e) => updateProductRow(index, 'productId', e.target.value)}
                                                            className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        >
                                                            <option value="">Select product...</option>
                                                            {activeProducts.map(product => (
                                                                <option key={product.id} value={product.id}>{product.name}</option>
                                                            ))}
                                                        </select>
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
                                                            className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            required
                                                            placeholder="Price"
                                                            value={item.unitPrice}
                                                            onChange={(e) => updateProductRow(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                                                            className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            placeholder="Disc %"
                                                            value={item.discount || 0}
                                                            onChange={(e) => updateProductRow(index, 'discount', parseFloat(e.target.value) || 0)}
                                                            className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        />
                                                    </div>
                                                    <div className="col-span-1 flex items-center justify-center">
                                                        <span className="text-xs font-bold text-slate-600">
                                                            {((item.quantity * item.unitPrice) * (1 - (item.discount || 0) / 100)).toFixed(2)}
                                                        </span>
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

                                {/* Totals */}
                                {formData.items && formData.items.length > 0 && (
                                    <div className="flex flex-col items-end pt-4 space-y-3">
                                        {(() => {
                                            const { subtotal, taxableAmount, discountAmount, totalTax, total, margin, marginPercentage } = calculateTotals(formData.items, formData.discount || 0);
                                            return (
                                                <div className="w-full max-w-md space-y-2">
                                                    <div className="flex justify-between items-center py-1">
                                                        <span className="text-sm font-bold text-slate-500">Imponibile:</span>
                                                        <span className="text-sm font-black text-slate-800">{subtotal.toFixed(2)} €</span>
                                                    </div>

                                                    {formData.discount! > 0 && (
                                                        <div className="flex justify-between items-center py-1">
                                                            <span className="text-sm font-bold text-slate-500">Sconto ({formData.discount}%):</span>
                                                            <span className="text-sm font-black text-amber-600">-{discountAmount.toFixed(2)} €</span>
                                                        </div>
                                                    )}

                                                    <div className="flex justify-between items-center py-1">
                                                        <span className="text-sm font-bold text-slate-500">IVA:</span>
                                                        <span className="text-sm font-black text-slate-800">{totalTax.toFixed(2)} €</span>
                                                    </div>

                                                    <div className="h-px bg-slate-200 my-2"></div>

                                                    <div className="flex justify-between items-center pb-4">
                                                        <span className="text-lg font-black text-slate-800">Totale:</span>
                                                        <span className="text-2xl font-black text-indigo-600">{total.toFixed(2)} €</span>
                                                    </div>

                                                    <div className="bg-emerald-50/50 rounded-xl p-4 flex justify-between items-center border border-emerald-100/50">
                                                        <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Margine:</span>
                                                        <div className="text-right">
                                                            <div className="text-sm font-black text-emerald-700">{margin.toFixed(2)} €</div>
                                                            <div className="text-[10px] font-bold text-emerald-600 opacity-80">({marginPercentage.toFixed(1)}%)</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}
                            </div>

                            {/* Quote Details */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                    Quote Details
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Payment Terms</label>
                                        <select
                                            value={formData.paymentTerms}
                                            onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value as any })}
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                        >
                                            <option value="immediate">Immediate</option>
                                            <option value="15gg">15 days</option>
                                            <option value="21gg">21 days</option>
                                            <option value="30gg">30 days</option>
                                            <option value="45gg">45 days</option>
                                        </select>
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
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Status</label>
                                        <select
                                            value={formData.status}
                                            onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                        >
                                            <option value="quoted">Quoted</option>
                                            <option value="confirmed">Confirmed</option>
                                        </select>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Expiration Date</label>
                                        <input
                                            type="date"
                                            required
                                            value={formData.expirationDate}
                                            onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div className="col-span-full space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Notes</label>
                                        <textarea
                                            rows={3}
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            placeholder="Additional notes or terms..."
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-4 pt-4 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-[2] py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95"
                                >
                                    {editingQuote ? 'Update Quote' : 'Create Quote'}
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
                                <h3 className="text-lg font-black text-slate-800">Delete Quote?</h3>
                                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                                    Are you sure you want to delete this quote for <span className="font-bold text-slate-800">{quoteToDelete?.clientName}</span>?
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
                    <h2 className="text-2xl font-black text-slate-800">Quotes</h2>
                    <p className="text-slate-500 text-sm">Manage client quotes and proposals</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black shadow-xl shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-95 flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus"></i> Create New Quote
                </button>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">All Quotes</h4>
                    <span className="bg-indigo-100 text-indigo-600 px-3 py-1 rounded-full text-[10px] font-black">{quotes.length} TOTAL</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Terms</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Expiration</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {quotes.map(quote => {
                                const { total } = calculateTotals(quote.items, quote.discount);
                                const expired = isExpired(quote.expirationDate);
                                return (
                                    <tr key={quote.id} className={`hover:bg-slate-50/50 transition-colors group ${expired ? 'bg-red-50/30' : ''}`}>
                                        <td className="px-8 py-5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center text-sm">
                                                    <i className="fa-solid fa-file-invoice"></i>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-800">{quote.clientName}</div>
                                                    <div className="text-[10px] font-black text-slate-400 uppercase">{quote.items.length} item{quote.items.length !== 1 ? 's' : ''}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5">
                                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${quote.status === 'confirmed'
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                {quote.status.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-8 py-5 text-sm font-bold text-slate-700">
                                            {total.toFixed(2)}
                                        </td>
                                        <td className="px-8 py-5 text-sm font-semibold text-slate-600">
                                            {quote.paymentTerms === 'immediate' ? 'Immediate' : quote.paymentTerms}
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
                                                    onClick={() => openEditModal(quote)}
                                                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                                    title="Edit Quote"
                                                >
                                                    <i className="fa-solid fa-pen-to-square"></i>
                                                </button>
                                                <button
                                                    onClick={() => onUpdateQuote(quote.id, { status: quote.status === 'quoted' ? 'confirmed' : 'quoted' })}
                                                    className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                                    title={quote.status === 'quoted' ? 'Mark as Confirmed' : 'Mark as Quoted'}
                                                >
                                                    <i className={`fa-solid ${quote.status === 'quoted' ? 'fa-check' : 'fa-rotate-left'}`}></i>
                                                </button>
                                                <button
                                                    onClick={() => confirmDelete(quote)}
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
                            {quotes.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="p-12 text-center">
                                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                                            <i className="fa-solid fa-file-invoice text-2xl"></i>
                                        </div>
                                        <p className="text-slate-400 text-sm font-bold">No quotes found.</p>
                                        <button onClick={openAddModal} className="mt-4 text-indigo-600 text-sm font-black hover:underline">Create your first quote</button>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default QuotesView;
