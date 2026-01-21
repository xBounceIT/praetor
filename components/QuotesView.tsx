import React, { useState, useMemo } from 'react';
import { Quote, QuoteItem, Client, Product, SpecialBid } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import ValidatedNumberInput, { parseNumberInputValue } from './ValidatedNumberInput';

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
    { id: 'quoted', name: 'Quoted' },
    { id: 'confirmed', name: 'Confirmed' },
];

interface QuotesViewProps {
    quotes: Quote[];
    clients: Client[];
    products: Product[];
    specialBids: SpecialBid[];
    onAddQuote: (quoteData: Partial<Quote>) => void;
    onUpdateQuote: (id: string, updates: Partial<Quote>) => void;
    onDeleteQuote: (id: string) => void;
    onCreateSale?: (quote: Quote) => void;
    quoteFilterId?: string | null;
    quoteIdsWithSales?: Set<string>;
    currency: string;
}

const calcProductSalePrice = (costo: number, molPercentage: number) => {
    if (molPercentage >= 100) return costo;
    return costo / (1 - molPercentage / 100);
};

const QuotesView: React.FC<QuotesViewProps> = ({ quotes, clients, products, specialBids, onAddQuote, onUpdateQuote, onDeleteQuote, onCreateSale, quoteFilterId, quoteIdsWithSales, currency }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [expiredPage, setExpiredPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(() => {
        const saved = localStorage.getItem('praetor_quotes_rowsPerPage');
        return saved ? parseInt(saved, 10) : 5;
    });

    const handleRowsPerPageChange = (val: string) => {
        const value = parseInt(val, 10);
        setRowsPerPage(value);
        localStorage.setItem('praetor_quotes_rowsPerPage', value.toString());
        setCurrentPage(1); // Reset to first page
        setExpiredPage(1);
    };

    // Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [filterClientId, setFilterClientId] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterQuoteId, setFilterQuoteId] = useState('all');
    const [expirationSort, setExpirationSort] = useState<'none' | 'asc' | 'desc'>('none');

    React.useEffect(() => {
        setFilterQuoteId(quoteFilterId || 'all');
    }, [quoteFilterId]);

    const quoteIdOptions = useMemo(() => ([
        { id: 'all', name: 'All Quotes' },
        ...quotes.map(quote => ({ id: quote.id, name: `${quote.id} · ${quote.clientName}` }))
    ]), [quotes]);

    // Filter Logic
    const filteredQuotes = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        return quotes.filter(quote => {
            const matchesSearch = normalizedSearch === '' ||
                quote.id.toLowerCase().includes(normalizedSearch) ||
                quote.clientName.toLowerCase().includes(normalizedSearch) ||
                quote.items.some(item => item.productName.toLowerCase().includes(normalizedSearch));

            const matchesClient = filterClientId === 'all' || quote.clientId === filterClientId;
            const matchesStatus = filterStatus === 'all' || quote.status === filterStatus;
            const matchesQuoteId = filterQuoteId === 'all' || quote.id === filterQuoteId;

            return matchesQuoteId && (filterQuoteId === 'all' ? (matchesSearch && matchesClient && matchesStatus) : true);
        });
    }, [quotes, searchTerm, filterClientId, filterStatus, filterQuoteId]);

    // Reset page on filter change
    React.useEffect(() => {
        setCurrentPage(1);
        setExpiredPage(1);
    }, [searchTerm, filterClientId, filterStatus, filterQuoteId, expirationSort]);

    const hasActiveFilters =
        searchTerm.trim() !== '' ||
        filterClientId !== 'all' ||
        filterStatus !== 'all' ||
        filterQuoteId !== 'all';

    const handleClearFilters = () => {
        setSearchTerm('');
        setFilterClientId('all');
        setFilterStatus('all');
        setFilterQuoteId('all');
        setCurrentPage(1);
        setExpiredPage(1);
    };

    const toggleExpirationSort = () => {
        setExpirationSort(prev => (prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'));
    };

    const nextExpirationSort = expirationSort === 'none' ? 'asc' : expirationSort === 'asc' ? 'desc' : 'none';
    const expirationSortTitle = nextExpirationSort === 'asc'
        ? 'Order by expiration date (ascending)'
        : nextExpirationSort === 'desc'
            ? 'Order by expiration date (descending)'
            : 'Clear expiration date ordering';
    const expirationSortIndicator = expirationSort === 'asc' ? '↑' : expirationSort === 'desc' ? '↓' : '';

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
    const isReadOnly = Boolean(editingQuote && editingQuote.status === 'confirmed');

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
        setErrors({});
        setIsModalOpen(true);
    };

    const openEditModal = (quote: Quote) => {
        setEditingQuote(quote);
        // Ensure expirationDate is in YYYY-MM-DD format for the date input
        const formattedDate = quote.expirationDate ? new Date(quote.expirationDate).toISOString().split('T')[0] : '';
        setFormData({
            clientId: quote.clientId,
            clientName: quote.clientName,
            items: quote.items,
            paymentTerms: quote.paymentTerms,
            discount: quote.discount,
            status: quote.status,
            expirationDate: formattedDate,
            notes: quote.notes || '',
        });
        setErrors({});
        setIsModalOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (isReadOnly) {
            return;
        }

        const newErrors: Record<string, string> = {};
        const discountValue = Number.isNaN(formData.discount ?? 0) ? 0 : (formData.discount ?? 0);

        if (!formData.clientId) {
            newErrors.clientId = 'Client is required';
        }

        if (!formData.items || formData.items.length === 0) {
            newErrors.items = 'At least one product is required';
        } else {
            const invalidItem = formData.items.find(item => !item.productId);
            if (invalidItem) {
                newErrors.items = 'Please select a product for all items';
            }
            const invalidQuantity = formData.items.find(item =>
                item.quantity === undefined ||
                item.quantity === null ||
                Number.isNaN(item.quantity) ||
                item.quantity <= 0
            );
            if (!newErrors.items && invalidQuantity) {
                newErrors.items = 'All items must have quantity greater than 0.';
            }
            if (!newErrors.items) {
                const { total } = calculateTotals(formData.items, discountValue);
                if (!Number.isFinite(total) || total <= 0) {
                    newErrors.total = 'Total must be greater than 0.';
                }
            }
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
        if (isReadOnly) return;
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
        if (isReadOnly) return;
        const newItem: Partial<QuoteItem> = {
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
            items: [...(formData.items || []), newItem as QuoteItem],
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
        if (isReadOnly) return;
        const newItems = [...(formData.items || [])];
        newItems.splice(index, 1);
        setFormData({ ...formData, items: newItems });
    };

    const updateProductRow = (index: number, field: keyof QuoteItem, value: any) => {
        if (isReadOnly) return;
        const newItems = [...(formData.items || [])];
        newItems[index] = { ...newItems[index], [field]: value };

        if (field === 'productId') {
            const product = activeProducts.find(p => p.id === value);
            if (product) {
                newItems[index].productName = product.name;

                // Check for applicable special bid
                const applicableBid = activeSpecialBids.find(b =>
                    b.clientId === formData.clientId &&
                    b.productId === value
                );

                if (applicableBid) {
                    newItems[index].specialBidId = applicableBid.id;
                    // Bid price is the new COST. Calculate sale price based on this cost and margin.
                    const mol = product.molPercentage ? Number(product.molPercentage) : 0;
                    console.log(`[SpecialBid] Bid: ${applicableBid.unitPrice}, Mol: ${mol}`);
                    newItems[index].unitPrice = calcProductSalePrice(Number(applicableBid.unitPrice), mol);
                } else {
                    const mol = product.molPercentage ? Number(product.molPercentage) : 0;
                    newItems[index].unitPrice = calcProductSalePrice(Number(product.costo), mol);
                    newItems[index].specialBidId = '';
                }
            }
        }

        if (field === 'specialBidId') {
            if (!value) {
                newItems[index].specialBidId = '';
                // Revert to standard product cost
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
                    // Bid selected: Use bid price as COST
                    const mol = product.molPercentage ? Number(product.molPercentage) : 0;
                    newItems[index].unitPrice = calcProductSalePrice(Number(bid.unitPrice), mol);
                }
            }
        }

        setFormData({ ...formData, items: newItems });
    };

    // Calculate totals
    const calculateTotals = (items: QuoteItem[], globalDiscount: number) => {
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

                // Determine cost: if special bid, use bid price, else use product cost
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

    const getExpirationTimestamp = (expirationDate: string) => {
        if (!expirationDate) return 0;
        const normalizedDate = expirationDate.includes('T') ? expirationDate : `${expirationDate}T00:00:00`;
        const timestamp = new Date(normalizedDate).getTime();
        return Number.isNaN(timestamp) ? 0 : timestamp;
    };

    // Check if quote is expired
    const isExpired = (expirationDate: string) => {
        const normalizedDate = expirationDate.includes('T') ? expirationDate : `${expirationDate}T00:00:00`;
        const expiry = new Date(normalizedDate);
        expiry.setDate(expiry.getDate() + 1);
        return new Date() >= expiry;
    };

    const isQuoteExpired = (quote: Quote) => quote.status !== 'confirmed' && (quote.isExpired ?? isExpired(quote.expirationDate));
    const sortedQuotes = useMemo(() => {
        if (expirationSort === 'none') return filteredQuotes;
        const direction = expirationSort === 'asc' ? 1 : -1;
        return [...filteredQuotes].sort((a, b) => (getExpirationTimestamp(a.expirationDate) - getExpirationTimestamp(b.expirationDate)) * direction);
    }, [filteredQuotes, expirationSort]);
    const filteredActiveQuotes = sortedQuotes.filter(quote => !isQuoteExpired(quote));
    const filteredExpiredQuotes = sortedQuotes.filter(quote => isQuoteExpired(quote));

    // Pagination Logic
    const activeTotalPages = Math.ceil(filteredActiveQuotes.length / rowsPerPage);
    const activeStartIndex = (currentPage - 1) * rowsPerPage;
    const paginatedActiveQuotes = filteredActiveQuotes.slice(activeStartIndex, activeStartIndex + rowsPerPage);

    const expiredTotalPages = Math.ceil(filteredExpiredQuotes.length / rowsPerPage);
    const expiredStartIndex = (expiredPage - 1) * rowsPerPage;
    const paginatedExpiredQuotes = filteredExpiredQuotes.slice(expiredStartIndex, expiredStartIndex + rowsPerPage);

    const renderQuoteRow = (quote: Quote) => {
        const { total } = calculateTotals(quote.items, quote.discount);
        const expired = isQuoteExpired(quote);
        const isRevertLocked = quote.status === 'confirmed' && quoteIdsWithSales?.has(quote.id);
        const isConfirmDisabled = expired || isRevertLocked;
        const isDeleteDisabled = expired;
        const confirmTitle = expired
            ? 'Expired quotes cannot be confirmed or reverted'
            : isRevertLocked
                ? 'Cannot revert: linked sale order exists'
                : (quote.status === 'quoted' ? 'Mark as Confirmed' : 'Mark as Quoted');
        const deleteTitle = expired ? 'Expired quotes cannot be deleted' : 'Delete Quote';
        return (
            <tr
                key={quote.id}
                onClick={() => openEditModal(quote)}
                className={`hover:bg-slate-50/50 transition-colors group cursor-pointer ${expired ? 'bg-red-50/30' : ''}`}
            >
                <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
                            <i className="fa-solid fa-file-invoice"></i>
                        </div>
                        <div>
                            <div className="text-[10px] font-black text-slate-400 tracking-wider">ID {quote.id}</div>
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
                    {total.toFixed(2)} {currency}
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
                                if (isConfirmDisabled) return;
                                onUpdateQuote(quote.id, { status: quote.status === 'quoted' ? 'confirmed' : 'quoted' });
                            }}
                            disabled={isConfirmDisabled}
                            className={`p-2 text-slate-400 rounded-lg transition-all ${isConfirmDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-emerald-600 hover:bg-emerald-50'}`}
                            title={confirmTitle}
                        >
                            <i className={`fa-solid ${quote.status === 'quoted' ? 'fa-check' : 'fa-rotate-left'}`}></i>
                        </button>
                        {quote.status === 'confirmed' && onCreateSale && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCreateSale(quote);
                                }}
                                className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                                title="Create Sale Order"
                            >
                                <i className="fa-solid fa-cart-plus"></i>
                            </button>
                        )}
                        {quote.status !== 'confirmed' && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isDeleteDisabled) return;
                                    confirmDelete(quote);
                                }}
                                disabled={isDeleteDisabled}
                                className={`p-2 text-slate-400 rounded-lg transition-all ${isDeleteDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-red-600 hover:bg-red-50'}`}
                                title={deleteTitle}
                            >
                                <i className="fa-solid fa-trash-can"></i>
                            </button>
                        )}
                    </div>
                </td>
            </tr>
        );
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Add/Edit Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                                    <i className={`fa-solid ${editingQuote ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                                </div>
                                {isReadOnly ? 'View Quote' : (editingQuote ? 'Edit Quote' : 'Create New Quote')}
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
                                <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-xs font-bold">
                                    Confirmed quotes are read-only.
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
                                        Products / Services
                                    </h4>
                                    <button
                                        type="button"
                                        onClick={addProductRow}
                                        disabled={isReadOnly}
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

                                            // Cost is the bid price if selected, otherwise product cost
                                            const cost = selectedBid ? Number(selectedBid.unitPrice) : (selectedProduct ? Number(selectedProduct.costo) : 0);

                                            const molPercentage = selectedProduct ? Number(selectedProduct.molPercentage) : 0;
                                            const margin = Number(item.unitPrice || 0) - cost;
                                            return (
                                                <div key={item.id} className="bg-slate-50 p-3 rounded-xl space-y-2">
                                                    <div className="flex gap-3 items-center">
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
                                                                    disabled={isReadOnly}
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
                                                                        updateProductRow(index, 'quantity', value === '' || Number.isNaN(parsed) ? 0 : parsed);
                                                                    }}
                                                                    disabled={isReadOnly}
                                                                    className="w-full text-sm px-2 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                                                                />
                                                            </div>
                                                            <div className="col-span-1 flex flex-col items-center justify-center">
                                                                <span className="text-xs font-bold text-slate-600">{cost.toFixed(2)} {currency}</span>
                                                                {selectedBid && (
                                                                    <div className="text-[8px] font-black text-praetor uppercase tracking-wider">Bid</div>
                                                                )}
                                                            </div>
                                                            <div className="col-span-1 flex items-center justify-center">
                                                                <span className="text-xs font-bold text-slate-600">{molPercentage.toFixed(1)}%</span>
                                                            </div>
                                                            <div className="col-span-1 flex items-center justify-center">
                                                                <span className="text-xs font-bold text-emerald-600">{margin.toFixed(2)} {currency}</span>
                                                            </div>
                                                            <div className="col-span-2 flex items-center justify-center">
                                                                <span className={`text-sm font-semibold ${selectedBid ? 'text-praetor' : 'text-slate-800'}`}>
                                                                    {Number(item.unitPrice).toFixed(2)} {currency}
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
                                                    <div>
                                                        <input
                                                            type="text"
                                                            placeholder="Note for this item..."
                                                            value={item.note || ''}
                                                            onChange={(e) => updateProductRow(index, 'note', e.target.value)}
                                                            disabled={isReadOnly}
                                                            className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                                        />
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

                            {/* Quote Details */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                                    Quote Details
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Payment Terms</label>
                                        <CustomSelect
                                            options={PAYMENT_TERMS_OPTIONS}
                                            value={formData.paymentTerms || 'immediate'}
                                            onChange={(val) => setFormData({ ...formData, paymentTerms: val as any })}
                                            searchable={false}
                                            disabled={isReadOnly}
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Global Discount (%)</label>
                                        <ValidatedNumberInput
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            value={formData.discount}
                                            onValueChange={(value) => {
                                                const parsed = parseNumberInputValue(value);
                                                setFormData({ ...formData, discount: parsed });
                                                if (errors.total) {
                                                    setErrors(prev => {
                                                        const next = { ...prev };
                                                        delete next.total;
                                                        return next;
                                                    });
                                                }
                                            }}
                                            disabled={isReadOnly}
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Expiration Date</label>
                                        <input
                                            type="date"
                                            required
                                            value={formData.expirationDate}
                                            onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                                            disabled={isReadOnly}
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>

                                    <div className="col-span-full space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Notes</label>
                                        <textarea
                                            rows={3}
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            placeholder="Additional notes or terms..."
                                            disabled={isReadOnly}
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Totals Section */}
                            {formData.items && formData.items.length > 0 && (
                                <div className="pt-8 border-t border-slate-100">
                                    {(() => {
                                        const discountValue = Number.isNaN(formData.discount ?? 0) ? 0 : (formData.discount ?? 0);
                                        const { subtotal, discountAmount, totalTax, total, margin, marginPercentage, taxGroups } = calculateTotals(formData.items, discountValue);
                                        return (
                                            <>
                                                {errors.total && (
                                                    <p className="text-red-500 text-[10px] font-bold ml-1 mb-2">{errors.total}</p>
                                                )}
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
                                            </>
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
                                    disabled={isReadOnly}
                                    className="px-10 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isReadOnly ? 'Confirmed Quote' : (editingQuote ? 'Update Quote' : 'Create Quote')}
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
            </div>

            {/* Search and Filters */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div className="md:col-span-2 relative">
                    <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input
                        type="text"
                        placeholder="Search quotes or products..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
                    />
                </div>
                <div>
                    <CustomSelect
                        options={quoteIdOptions}
                        value={filterQuoteId}
                        onChange={setFilterQuoteId}
                        placeholder="Filter by Quote ID"
                        searchable={true}
                        buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
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
                title="Active Quotes"
                totalCount={filteredActiveQuotes.length}
                headerAction={
                    <button
                        onClick={openAddModal}
                        className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
                    >
                        <i className="fa-solid fa-plus"></i> Create New Quote
                    </button>
                }
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
                                Showing {paginatedActiveQuotes.length > 0 ? activeStartIndex + 1 : 0}-{Math.min(activeStartIndex + rowsPerPage, filteredActiveQuotes.length)} of {filteredActiveQuotes.length}
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
                                {Array.from({ length: activeTotalPages }, (_, i) => i + 1).map(page => (
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
                                onClick={() => setCurrentPage(prev => Math.min(activeTotalPages, prev + 1))}
                                disabled={currentPage === activeTotalPages || activeTotalPages === 0}
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
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Terms</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                <button
                                    type="button"
                                    onClick={toggleExpirationSort}
                                    title={expirationSortTitle}
                                    className="w-full inline-flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none hover:text-slate-600"
                                >
                                    Expiration
                                    {expirationSortIndicator && <span className="text-[10px]">{expirationSortIndicator}</span>}
                                </button>
                            </th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {paginatedActiveQuotes.map(renderQuoteRow)}
                        {filteredActiveQuotes.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-12 text-center">
                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                                        <i className="fa-solid fa-file-invoice text-2xl"></i>
                                    </div>
                                    <p className="text-slate-400 text-sm font-bold">No active quotes found.</p>
                                    <button onClick={openAddModal} className="mt-4 text-praetor text-sm font-black hover:underline">Create your first quote</button>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </StandardTable>

            <StandardTable
                title="Expired Quotes"
                totalCount={filteredExpiredQuotes.length}
                totalLabel="EXPIRED"
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
                                value={rowsPerPage.toString()}
                                onChange={(val) => handleRowsPerPageChange(val)}
                                className="w-20"
                                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                                searchable={false}
                            />
                            <span className="text-xs font-bold text-slate-400 ml-2">
                                Showing {paginatedExpiredQuotes.length > 0 ? expiredStartIndex + 1 : 0}-{Math.min(expiredStartIndex + rowsPerPage, filteredExpiredQuotes.length)} of {filteredExpiredQuotes.length}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setExpiredPage(prev => Math.max(1, prev - 1))}
                                disabled={expiredPage === 1}
                                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                            >
                                <i className="fa-solid fa-chevron-left text-xs"></i>
                            </button>
                            <div className="flex items-center gap-1">
                                {Array.from({ length: expiredTotalPages }, (_, i) => i + 1).map(page => (
                                    <button
                                        key={page}
                                        onClick={() => setExpiredPage(page)}
                                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${expiredPage === page
                                            ? 'bg-praetor text-white shadow-md shadow-slate-200'
                                            : 'text-slate-500 hover:bg-slate-100'
                                            }`}
                                    >
                                        {page}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setExpiredPage(prev => Math.min(expiredTotalPages, prev + 1))}
                                disabled={expiredPage === expiredTotalPages || expiredTotalPages === 0}
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
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Terms</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                <button
                                    type="button"
                                    onClick={toggleExpirationSort}
                                    title={expirationSortTitle}
                                    className="w-full inline-flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none hover:text-slate-600"
                                >
                                    Expiration
                                    {expirationSortIndicator && <span className="text-[10px]">{expirationSortIndicator}</span>}
                                </button>
                            </th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {paginatedExpiredQuotes.map(renderQuoteRow)}
                        {filteredExpiredQuotes.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-12 text-center">
                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                                        <i className="fa-solid fa-file-invoice text-2xl"></i>
                                    </div>
                                    <p className="text-slate-400 text-sm font-bold">No expired quotes found.</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </StandardTable>
        </div>
    );
};

export default QuotesView;
