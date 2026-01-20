import React, { useState, useMemo } from 'react';
import { Sale, SaleItem, Client, Product, SpecialBid } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';

const PAYMENT_TERMS_OPTIONS = [
    { id: 'immediate', name: 'Immediate' },
    { id: '15gg', name: '15 days' },
    { id: '21gg', name: '21 days' },
    { id: '30gg', name: '30 days' },
    { id: '45gg', name: '45 days' },
    { id: '60gg', name: '60 days' },
    { id: '90gg', name: '90 days' },
    { id: '120gg', name: '120 days' },
    { id: '180gg', name: '180 days' },
    { id: '240gg', name: '240 days' },
    { id: '365gg', name: '365 days' },
];

const STATUS_OPTIONS = [
    { id: 'pending', name: 'Pending' },
    { id: 'completed', name: 'Completed' },
    { id: 'cancelled', name: 'Cancelled' },
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

const SalesView: React.FC<SalesViewProps> = ({ sales, clients, products, specialBids, onAddSale, onUpdateSale, onDeleteSale, onViewQuote, currency }) => {
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
    const [disabledCurrentPage, setDisabledCurrentPage] = useState(1);
    const [disabledRowsPerPage, setDisabledRowsPerPage] = useState(() => {
        const saved = localStorage.getItem('praetor_sales_disabled_rowsPerPage');
        return saved ? parseInt(saved, 10) : 5;
    });

    const handleRowsPerPageChange = (val: string) => {
        const value = parseInt(val, 10);
        setRowsPerPage(value);
        localStorage.setItem('praetor_sales_rowsPerPage', value.toString());
        setCurrentPage(1); // Reset to first page
    };

    const handleDisabledRowsPerPageChange = (val: string) => {
        const value = parseInt(val, 10);
        setDisabledRowsPerPage(value);
        localStorage.setItem('praetor_sales_disabled_rowsPerPage', value.toString());
        setDisabledCurrentPage(1);
    };

    // Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [filterClientId, setFilterClientId] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');

    const activeSales = useMemo(() => sales.filter(sale => !sale.isDisabled), [sales]);
    const disabledSales = useMemo(() => sales.filter(sale => sale.isDisabled), [sales]);

    // Filter Logic
    const filteredSales = useMemo(() => {
        return activeSales.filter(sale => {
            const matchesSearch = searchTerm === '' ||
                sale.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                sale.items.some(item => item.productName.toLowerCase().includes(searchTerm.toLowerCase()));

            const matchesClient = filterClientId === 'all' || sale.clientId === filterClientId;
            const matchesStatus = filterStatus === 'all' || sale.status === filterStatus;

            return matchesSearch && matchesClient && matchesStatus;
        });
    }, [activeSales, searchTerm, filterClientId, filterStatus]);

    // Reset page on filter change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterClientId, filterStatus]);

    const hasActiveFilters = searchTerm.trim() !== '' || filterClientId !== 'all' || filterStatus !== 'all';

    const handleClearFilters = () => {
        setSearchTerm('');
        setFilterClientId('all');
        setFilterStatus('all');
        setCurrentPage(1);
    };

    // Form State
    const [formData, setFormData] = useState<Partial<Sale>>({
        clientId: '',
        clientName: '',
        items: [],
        paymentTerms: 'immediate',
        discount: 0,
        status: 'pending',
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
            status: 'pending',
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
            newErrors.clientId = 'Client is required';
        }

        if (!formData.items || formData.items.length === 0) {
            newErrors.items = 'At least one product is required';
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        if (editingSale) {
            onUpdateSale(editingSale.id, formData);
        } else {
            onAddSale(formData);
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
        const client = clients.find(c => c.id === clientId);
        setFormData(prev => {
            const updatedItems = (prev.items || []).map(item => {
                if (!item.productId) {
                    if (item.specialBidId) {
                        return { ...item, specialBidId: '' };
                    }
                    return item;
                }

                const product = products.find(p => p.id === item.productId);
                if (!product) {
                    return { ...item, specialBidId: '' };
                }

                const applicableBid = activeSpecialBids.find(b =>
                    b.clientId === clientId &&
                    b.productId === item.productId
                );
                const mol = product.molPercentage ? Number(product.molPercentage) : 0;
                const cost = applicableBid ? Number(applicableBid.unitPrice) : Number(product.costo);

                return {
                    ...item,
                    specialBidId: applicableBid ? applicableBid.id : '',
                    unitPrice: calcProductSalePrice(cost, mol)
                };
            });

            return {
                ...prev,
                clientId,
                clientName: client?.name || '',
                items: updatedItems
            };
        });
        if (errors.clientId) {
            setErrors(prev => {
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
            discount: 0,
        };
        setFormData({
            ...formData,
            items: [...(formData.items || []), newItem as SaleItem],
        });
        if (errors.items) {
            setErrors(prev => {
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

    const updateProductRow = (index: number, field: keyof SaleItem, value: any) => {
        const newItems = [...(formData.items || [])];
        newItems[index] = { ...newItems[index], [field]: value };

        // Auto-fill price when product is selected
        if (field === 'productId') {
            const product = activeProducts.find(p => p.id === value);
            if (product) {
                newItems[index].productName = product.name;
                const applicableBid = activeSpecialBids.find(b =>
                    b.clientId === formData.clientId &&
                    b.productId === value
                );

                const mol = product.molPercentage ? Number(product.molPercentage) : 0;

                if (applicableBid) {
                    newItems[index].specialBidId = applicableBid.id;
                    newItems[index].unitPrice = calcProductSalePrice(Number(applicableBid.unitPrice), mol);
                } else {
                    newItems[index].specialBidId = '';
                    newItems[index].unitPrice = calcProductSalePrice(Number(product.costo), mol);
                }
            }
        }

        if (field === 'specialBidId') {
            if (!value) {
                newItems[index].specialBidId = '';
                const product = products.find(p => p.id === newItems[index].productId);
                if (product) {
                    const mol = product.molPercentage ? Number(product.molPercentage) : 0;
                    newItems[index].unitPrice = calcProductSalePrice(Number(product.costo), mol);
                }
                setFormData({ ...formData, items: newItems });
                return;
            }

            const bid = specialBids.find(b => b.id === value);
            if (bid) {
                const product = products.find(p => p.id === bid.productId);
                if (product) {
                    newItems[index].productId = bid.productId;
                    newItems[index].productName = product.name;
                    const mol = product.molPercentage ? Number(product.molPercentage) : 0;
                    newItems[index].unitPrice = calcProductSalePrice(Number(bid.unitPrice), mol);
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

        items.forEach(item => {
            const product = products.find(p => p.id === item.productId);
            const lineSubtotal = item.quantity * item.unitPrice;
            const lineDiscount = item.discount ? (lineSubtotal * item.discount / 100) : 0;
            const lineNet = lineSubtotal - lineDiscount;

            subtotal += lineNet;

            if (product) {
                const taxRate = product.taxRate;
                // Applying global discount proportionally to the tax base
                const lineNetAfterGlobal = lineNet * (1 - globalDiscount / 100);
                const taxAmount = lineNetAfterGlobal * (taxRate / 100);
                taxGroups[taxRate] = (taxGroups[taxRate] || 0) + taxAmount;
                const bid = specialBids.find(b => b.id === item.specialBidId);
                const cost = bid ? Number(bid.unitPrice) : product.costo;
                totalCost += item.quantity * cost;
            }
        });

        const discountAmount = subtotal * (globalDiscount / 100);
        const taxableAmount = subtotal - discountAmount;
        const totalTax = Object.values(taxGroups).reduce((sum, val) => sum + val, 0);
        const total = taxableAmount + totalTax;
        const margin = taxableAmount - totalCost;
        const marginPercentage = taxableAmount > 0 ? (margin / taxableAmount) * 100 : 0;

        return { subtotal, taxableAmount, discountAmount, totalTax, total, margin, marginPercentage, taxGroups };
    };

    const activeClients = clients.filter(c => !c.isDisabled);
    const activeProducts = products.filter(p => !p.isDisabled);
    const activeSpecialBids = specialBids.filter(b => {
        const now = new Date();
        const startDate = b.startDate ? new Date(b.startDate) : null;
        const endDate = b.endDate ? new Date(b.endDate) : null;
        if (!startDate || !endDate) return true;
        return now >= startDate && now <= endDate;
    });
    const clientSpecialBids = formData.clientId
        ? activeSpecialBids.filter(b => b.clientId === formData.clientId)
        : activeSpecialBids;

    const getBidDisplayValue = (bidId?: string) => {
        if (!bidId) return 'No Special Bid';
        const bid = activeSpecialBids.find(b => b.id === bidId) || specialBids.find(b => b.id === bidId);
        return bid ? `${bid.clientName} · ${bid.productName}` : 'No Special Bid';
    };

    const isLinkedQuote = Boolean(formData.linkedQuoteId);

    // Pagination Logic
    const totalPages = Math.ceil(filteredSales.length / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const paginatedSales = filteredSales.slice(startIndex, startIndex + rowsPerPage);
    const disabledTotalPages = Math.ceil(disabledSales.length / disabledRowsPerPage);
    const disabledStartIndex = (disabledCurrentPage - 1) * disabledRowsPerPage;
    const disabledSalesPage = disabledSales.slice(disabledStartIndex, disabledStartIndex + disabledRowsPerPage);

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
                                {editingSale ? 'Edit Sale' : 'Create New Sale'}
                            </h3>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
                            >
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
                            {/* Linked Quote Info */}
                            {formData.linkedQuoteId && (
                                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                                            <i className="fa-solid fa-link"></i>
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-slate-900">Linked to Quote</div>
                                            <div className="text-xs text-praetor">Created from quote #{formData.linkedQuoteId}</div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">(Quote details are read-only)</div>
                                        </div>
                                    </div>
                                    {onViewQuote && (
                                        <button
                                            type="button"
                                            onClick={() => onViewQuote(formData.linkedQuoteId!)}
                                            className="text-xs font-bold text-praetor hover:text-slate-800 hover:underline"
                                        >
                                            View Quote
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Client Selection */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                                    Client Information
                                </h4>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Client</label>
                                    <CustomSelect
                                        options={activeClients.map(c => ({ id: c.id, name: c.name }))}
                                        value={formData.clientId || ''}
                                        onChange={handleClientChange}
                                        placeholder="Select a client..."
                                        searchable={true}
                                        disabled={isLinkedQuote}
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
                                        Products / Services
                                    </h4>
                                    <button
                                        type="button"
                                        onClick={addProductRow}
                                        disabled={isLinkedQuote}
                                        className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <i className="fa-solid fa-plus"></i> Add Product
                                    </button>
                                </div>
                                {errors.items && (
                                    <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>
                                )}

                                {formData.items && formData.items.length > 0 && (
                                    <div className="flex gap-3 px-3 mb-1 items-center">
                                        <div className="flex-1 grid grid-cols-12 gap-3">
                                            <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Special Bid</div>
                                            <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Product / Service</div>
                                            <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Qty</div>
                                            <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Cost</div>
                                            <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Mol %</div>
                                            <div className="col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Margin</div>
                                            <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Sale Price</div>
                                        </div>
                                        <div className="w-10 flex-shrink-0"></div>
                                    </div>
                                )}

                                {formData.items && formData.items.length > 0 ? (
                                    <div className="space-y-3">
                                        {formData.items.map((item, index) => {
                                            const selectedProduct = activeProducts.find(p => p.id === item.productId);
                                            const selectedBid = item.specialBidId ? specialBids.find(b => b.id === item.specialBidId) : undefined;
                                            const cost = selectedBid ? Number(selectedBid.unitPrice) : (selectedProduct ? Number(selectedProduct.costo) : 0);
                                            const molPercentage = selectedProduct ? Number(selectedProduct.molPercentage) : 0;
                                            const salePrice = Number(item.unitPrice || 0);
                                            const margin = salePrice - cost;

                                            return (
                                                <div key={item.id} className="bg-slate-50 p-3 rounded-xl">
                                                    <div className="flex gap-3 items-stretch">
                                                        <div className="flex-1 grid grid-cols-12 gap-3 items-center">
                                                            <div className="col-span-3">
                                                                <CustomSelect
                                                                    options={[
                                                                        { id: 'none', name: 'No Special Bid' },
                                                                        ...clientSpecialBids.map(b => ({ id: b.id, name: `${b.clientName} · ${b.productName}` }))
                                                                    ]}
                                                                    value={item.specialBidId || 'none'}
                                                                    onChange={(val) => updateProductRow(index, 'specialBidId', val === 'none' ? '' : val)}
                                                                    placeholder="Select bid..."
                                                                    displayValue={getBidDisplayValue(item.specialBidId)}
                                                                    searchable={true}
                                                                    disabled={isLinkedQuote}
                                                                    buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                                                                />
                                                            </div>
                                                            <div className="col-span-3">
                                                                <CustomSelect
                                                                    options={activeProducts.map(p => ({ id: p.id, name: p.name }))}
                                                                    value={item.productId}
                                                                    onChange={(val) => updateProductRow(index, 'productId', val)}
                                                                    placeholder="Select product..."
                                                                    searchable={true}
                                                                    disabled={isLinkedQuote}
                                                                    buttonClassName="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
                                                                />
                                                            </div>
                                                            <div className="col-span-1">
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    required
                                                                    placeholder="Qty"
                                                                    value={item.quantity}
                                                                    onChange={(e) => updateProductRow(index, 'quantity', parseFloat(e.target.value) || 0)}
                                                                    disabled={isLinkedQuote}
                                                                    className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:bg-slate-50 disabled:text-slate-400"
                                                                />
                                                            </div>
                                                            <div className="col-span-1 flex items-center justify-center self-stretch">
                                                                <div className="relative">
                                                                    <span className="text-xs font-bold text-slate-600">{cost.toFixed(2)} {currency}</span>
                                                                    {selectedBid && (
                                                                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-black text-praetor uppercase tracking-wider bg-slate-50/50 px-1 whitespace-nowrap">Bid</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="col-span-1 flex items-center justify-center self-stretch">
                                                                <span className="text-xs font-bold text-slate-600">{molPercentage.toFixed(1)}%</span>
                                                            </div>
                                                            <div className="col-span-1 flex items-center justify-center self-stretch">
                                                                <span className="text-xs font-bold text-emerald-600">{margin.toFixed(2)} {currency}</span>
                                                            </div>
                                                            <div className="col-span-2 flex items-center justify-center self-stretch">
                                                                <span className={`text-sm font-semibold ${selectedBid ? 'text-praetor' : 'text-slate-800'}`}>
                                                                    {salePrice.toFixed(2)} {currency}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeProductRow(index)}
                                                            disabled={isLinkedQuote}
                                                            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed self-center"
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
                                        No products added. Click "Add Product" to start.
                                    </div>
                                )}
                            </div>

                            {/* Sale Details */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                                    Sale Details
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Payment Terms</label>
                                        <CustomSelect
                                            options={PAYMENT_TERMS_OPTIONS}
                                            value={formData.paymentTerms || 'immediate'}
                                            onChange={(val) => setFormData({ ...formData, paymentTerms: val as any })}
                                            searchable={false}
                                            disabled={isLinkedQuote}
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Global Discount</label>
                                        <div className={`flex items-center rounded-xl focus-within:ring-2 focus-within:ring-praetor transition-all overflow-hidden bg-slate-50 border border-slate-200 ${isLinkedQuote ? 'opacity-50' : ''}`}>
                                            <div className="w-12 self-stretch flex items-center justify-center text-slate-400 text-xs font-bold border-r border-slate-200 bg-slate-100/30">
                                                %
                                            </div>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                max="100"
                                                value={formData.discount}
                                                onChange={(e) => setFormData({ ...formData, discount: parseFloat(e.target.value) || 0 })}
                                                disabled={isLinkedQuote}
                                                className="flex-1 px-4 py-2.5 bg-transparent outline-none text-sm font-semibold disabled:bg-transparent"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Status</label>
                                        <CustomSelect
                                            options={STATUS_OPTIONS}
                                            value={formData.status || 'pending'}
                                            onChange={(val) => setFormData({ ...formData, status: val as any })}
                                            searchable={false}
                                        />
                                    </div>

                                    <div className="col-span-full space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Notes</label>
                                        <textarea
                                            rows={3}
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            placeholder="Additional notes or terms..."
                                            disabled={isLinkedQuote}
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none disabled:bg-slate-50 disabled:text-slate-400"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Totals Section */}
                            {formData.items && formData.items.length > 0 && (
                                <div className="pt-8 border-t border-slate-100">
                                    {(() => {
                                        const { subtotal, discountAmount, totalTax, total, margin, marginPercentage, taxGroups } = calculateTotals(formData.items, formData.discount || 0);
                                        return (
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
                                                {/* Left Column: Detailed Breakdown */}
                                                <div className="flex flex-col justify-center space-y-3 h-full">
                                                    <div className="flex justify-between items-center px-2">
                                                        <span className="text-sm font-bold text-slate-500">Imponibile:</span>
                                                        <span className="text-sm font-black text-slate-800">{subtotal.toFixed(2)} {currency}</span>
                                                    </div>

                                                    {formData.discount! > 0 && (
                                                        <div className="flex justify-between items-center px-2">
                                                            <span className="text-sm font-bold text-slate-500">Sconto ({formData.discount}%):</span>
                                                            <span className="text-sm font-black text-amber-600">-{discountAmount.toFixed(2)} {currency}</span>
                                                        </div>
                                                    )}

                                                    {Object.entries(taxGroups).map(([rate, amount]) => (
                                                        <div key={rate} className="flex justify-between items-center px-2">
                                                            <span className="text-sm font-bold text-slate-500">IVA ({rate}%):</span>
                                                            <span className="text-sm font-black text-slate-800">{amount.toFixed(2)} {currency}</span>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Middle Column: Final Total */}
                                                <div className="flex flex-col items-center justify-center py-4 bg-slate-50/50 rounded-2xl border border-slate-100/50">
                                                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Totale:</span>
                                                    <span className="text-4xl font-black text-praetor leading-none">
                                                        {total.toFixed(2)}
                                                        <span className="text-xl ml-1 opacity-60 text-slate-400">{currency}</span>
                                                    </span>
                                                </div>

                                                {/* Right Column: Margin */}
                                                <div className="bg-emerald-50/40 rounded-2xl p-6 flex flex-col items-center justify-center border border-emerald-100/30">
                                                    <span className="text-xs font-black text-emerald-600 uppercase tracking-widest mb-2">Margine:</span>
                                                    <div className="text-center">
                                                        <div className="text-2xl font-black text-emerald-700 leading-none mb-1">{margin.toFixed(2)} {currency}</div>
                                                        <div className="text-xs font-black text-emerald-500 opacity-60">({marginPercentage.toFixed(1)}%)</div>
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
                                    {editingSale ? 'Update Sale' : 'Create Sale'}
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
                                <h3 className="text-lg font-black text-slate-800">Delete Sale?</h3>
                                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                                    Are you sure you want to delete this sale for <span className="font-bold text-slate-800">{saleToDelete?.clientName}</span>?
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
                    <h2 className="text-2xl font-black text-slate-800">Sales</h2>
                    <p className="text-slate-500 text-sm">Manage orders and completed sales</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="bg-praetor text-white px-6 py-3 rounded-2xl font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus"></i> Create New Sale
                </button>
            </div>

            {/* Search and Filters */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="md:col-span-2 relative">
                    <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input
                        type="text"
                        placeholder="Search sales or products..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
                    />
                </div>
                <div>
                    <CustomSelect
                        options={[{ id: 'all', name: 'All Clients' }, ...activeClients.map(c => ({ id: c.id, name: c.name }))]}
                        value={filterClientId}
                        onChange={setFilterClientId}
                        placeholder="Filter by Client"
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
                <div className="flex items-center justify-end">
                    <button
                        type="button"
                        onClick={handleClearFilters}
                        disabled={!hasActiveFilters}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <i className="fa-solid fa-rotate-left"></i>
                        Clear filters
                    </button>
                </div>
            </div>

            <StandardTable
                title="Active Sales"
                totalCount={filteredSales.length}
                containerClassName="overflow-visible"
                footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
                footer={
                    <>
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
                                Showing {paginatedSales.length > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + rowsPerPage, filteredSales.length)} of {filteredSales.length}
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
                        </div>
                    </>
                }
            >
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Terms</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {paginatedSales.map(sale => {
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
                                                <div className="text-[10px] font-black text-slate-400 uppercase">{sale.items.length} item{sale.items.length !== 1 ? 's' : ''}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-8 py-5">
                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black ${sale.status === 'completed'
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : sale.status === 'cancelled'
                                                ? 'bg-red-100 text-red-700'
                                                : 'bg-amber-100 text-amber-700'
                                            }`}>
                                            {sale.status.toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="px-8 py-5 text-sm font-bold text-slate-700">
                                        {total.toFixed(2)} {currency}
                                    </td>
                                    <td className="px-8 py-5 text-sm font-semibold text-slate-600">
                                        {sale.paymentTerms === 'immediate' ? 'Immediate' : sale.paymentTerms}
                                    </td>
                                    <td className="px-8 py-5">
                                        <div className="flex justify-end gap-2">
                                            {onViewQuote && sale.linkedQuoteId && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onViewQuote(sale.linkedQuoteId);
                                                    }}
                                                    className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                                                    title="View Quote"
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
                                                title="Edit Sale"
                                            >
                                                <i className="fa-solid fa-pen-to-square"></i>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onUpdateSale(sale.id, { isDisabled: true });
                                                }}
                                                className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                                                title="Disable Sale"
                                            >
                                                <i className="fa-solid fa-ban"></i>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    confirmDelete(sale);
                                                }}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                title="Delete Sale"
                                            >
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredSales.length === 0 && (
                            <tr>
                                <td colSpan={5} className="p-12 text-center">
                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                                        <i className="fa-solid fa-cart-shopping text-2xl"></i>
                                    </div>
                                    <p className="text-slate-400 text-sm font-bold">No active sales found.</p>
                                    <button onClick={openAddModal} className="mt-4 text-praetor text-sm font-black hover:underline">Create your first sale</button>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </StandardTable>

            {disabledSales.length > 0 && (
                <StandardTable
                    title="Disabled Sales"
                    totalCount={disabledSales.length}
                    totalLabel="DISABLED"
                    containerClassName="border-dashed bg-slate-50"
                    footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
                    footer={
                        <>
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-slate-500">Rows per page:</span>
                                <CustomSelect
                                    options={[
                                        { id: '5', name: '5' },
                                        { id: '10', name: '10' },
                                        { id: '20', name: '20' },
                                        { id: '50', name: '50' }
                                    ]}
                                    value={disabledRowsPerPage.toString()}
                                    onChange={(val) => handleDisabledRowsPerPageChange(val)}
                                    className="w-20"
                                    buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                                    searchable={false}
                                />
                                <span className="text-xs font-bold text-slate-400 ml-2">
                                    Showing {disabledSalesPage.length > 0 ? disabledStartIndex + 1 : 0}-{Math.min(disabledStartIndex + disabledRowsPerPage, disabledSales.length)} of {disabledSales.length}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setDisabledCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={disabledCurrentPage === 1}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                                >
                                    <i className="fa-solid fa-chevron-left text-xs"></i>
                                </button>
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: disabledTotalPages }, (_, i) => i + 1).map(page => (
                                        <button
                                            key={page}
                                            onClick={() => setDisabledCurrentPage(page)}
                                            className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${disabledCurrentPage === page
                                                ? 'bg-praetor text-white shadow-md shadow-slate-200'
                                                : 'text-slate-500 hover:bg-slate-100'
                                                }`}
                                        >
                                            {page}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setDisabledCurrentPage(prev => Math.min(disabledTotalPages, prev + 1))}
                                    disabled={disabledCurrentPage === disabledTotalPages || disabledTotalPages === 0}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                                >
                                    <i className="fa-solid fa-chevron-right text-xs"></i>
                                </button>
                            </div>
                        </>
                    }
                >
                    <div className="divide-y divide-slate-100">
                        {disabledSalesPage.map(sale => {
                            const { total } = calculateTotals(sale.items, sale.discount);
                            return (
                                <div
                                    key={sale.id}
                                    onClick={() => openEditModal(sale)}
                                    className="p-6 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 active:bg-slate-100 active:scale-[0.98] transition-all flex items-center justify-between gap-4 cursor-pointer select-none"
                                >
                                    <div className="flex gap-4 items-center">
                                        <div className="w-10 h-10 bg-slate-200 text-slate-400 rounded-xl flex items-center justify-center">
                                            <i className="fa-solid fa-cart-shopping"></i>
                                        </div>
                                        <div>
                                            <h5 className="font-bold text-slate-500 line-through">{sale.clientName}</h5>
                                            <div className="text-[10px] font-black text-slate-400 uppercase">{sale.items.length} item{sale.items.length !== 1 ? 's' : ''}</div>
                                            <span className="text-[10px] font-black text-amber-500 uppercase">Disabled</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <div className="text-sm font-bold text-slate-500">{total.toFixed(2)} {currency}</div>
                                            <div className="text-[10px] font-black text-slate-400 uppercase">{sale.status}</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onUpdateSale(sale.id, { isDisabled: false });
                                                }}
                                                className="p-2 text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                                                title="Enable Sale"
                                            >
                                                <i className="fa-solid fa-rotate-left"></i>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    confirmDelete(sale);
                                                }}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Delete Sale"
                                            >
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </StandardTable>
            )}
        </div>
    );
};

export default SalesView;
