import React, { useState, useMemo } from 'react';
import { Invoice, InvoiceItem, Client, Product, Sale } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';

const INVOICE_STATUS_OPTIONS = [
    { id: 'draft', name: 'Draft' },
    { id: 'sent', name: 'Sent' },
    { id: 'paid', name: 'Paid' },
    { id: 'overdue', name: 'Overdue' },
    { id: 'cancelled', name: 'Cancelled' },
];

interface InvoicesViewProps {
    invoices: Invoice[];
    clients: Client[];
    products: Product[];
    sales: Sale[];
    onAddInvoice: (invoiceData: Partial<Invoice>) => void;
    onUpdateInvoice: (id: string, updates: Partial<Invoice>) => void;
    onDeleteInvoice: (id: string) => void;
    currency: string;
}

const calcProductSalePrice = (costo: number, molPercentage: number) => {
    if (molPercentage >= 100) return costo;
    return costo / (1 - molPercentage / 100);
};

const InvoicesView: React.FC<InvoicesViewProps> = ({ invoices, clients, products, sales, onAddInvoice, onUpdateInvoice, onDeleteInvoice, currency }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(() => {
        const saved = localStorage.getItem('praetor_invoices_rowsPerPage');
        return saved ? parseInt(saved, 10) : 10;
    });

    const handleRowsPerPageChange = (val: string) => {
        const value = parseInt(val, 10);
        setRowsPerPage(value);
        localStorage.setItem('praetor_invoices_rowsPerPage', value.toString());
        setCurrentPage(1);
    };

    // Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [filterClientId, setFilterClientId] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');

    // Filter Logic
    const filteredInvoices = useMemo(() => {
        return invoices.filter(invoice => {
            const matchesSearch = searchTerm === '' ||
                invoice.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                invoice.items.some(item => item.description.toLowerCase().includes(searchTerm.toLowerCase()));

            const matchesClient = filterClientId === 'all' || invoice.clientId === filterClientId;
            const matchesStatus = filterStatus === 'all' || invoice.status === filterStatus;

            return matchesSearch && matchesClient && matchesStatus;
        });
    }, [invoices, searchTerm, filterClientId, filterStatus]);

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
    const [formData, setFormData] = useState<Partial<Invoice>>({
        clientId: '',
        clientName: '',
        invoiceNumber: '',
        items: [],
        issueDate: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: 'draft',
        notes: '',
        amountPaid: 0,
        subtotal: 0,
        taxAmount: 0,
        total: 0
    });

    const generateInvoiceNumber = () => {
        const year = new Date().getFullYear();
        const count = invoices.length + 1;
        return `INV-${year}-${count.toString().padStart(4, '0')}`;
    };

    const openAddModal = () => {
        setEditingInvoice(null);
        setFormData({
            clientId: '',
            clientName: '',
            invoiceNumber: generateInvoiceNumber(),
            items: [],
            issueDate: new Date().toISOString().split('T')[0],
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: 'draft',
            notes: '',
            amountPaid: 0,
            subtotal: 0,
            taxAmount: 0,
            total: 0
        });
        setErrors({});
        setIsModalOpen(true);
    };

    const openEditModal = (invoice: Invoice) => {
        setEditingInvoice(invoice);
        setFormData({
            ...invoice
        });
        setErrors({});
        setIsModalOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const newErrors: Record<string, string> = {};

        if (!formData.clientId) newErrors.clientId = 'Client is required';
        if (!formData.invoiceNumber) newErrors.invoiceNumber = 'Invoice number is required';
        if (!formData.issueDate) newErrors.issueDate = 'Issue date is required';
        if (!formData.dueDate) newErrors.dueDate = 'Due date is required';
        if (!formData.items || formData.items.length === 0) newErrors.items = 'At least one item is required';

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        // Recalculate totals before submit to be safe
        const { subtotal, totalTax, total } = calculateTotals(formData.items || []);
        const finalData = {
            ...formData,
            subtotal,
            taxAmount: totalTax,
            total
        };

        if (editingInvoice) {
            onUpdateInvoice(editingInvoice.id, finalData);
        } else {
            onAddInvoice(finalData);
        }
        setIsModalOpen(false);
    };

    const confirmDelete = (invoice: Invoice) => {
        setInvoiceToDelete(invoice);
        setIsDeleteConfirmOpen(true);
    };

    const handleDelete = () => {
        if (invoiceToDelete) {
            onDeleteInvoice(invoiceToDelete.id);
            setIsDeleteConfirmOpen(false);
            setInvoiceToDelete(null);
        }
    };

    const handleClientChange = (clientId: string) => {
        const client = clients.find(c => c.id === clientId);
        setFormData({
            ...formData,
            clientId,
            clientName: client?.name || '',
        });
        if (errors.clientId) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors.clientId;
                return newErrors;
            });
        }
    };

    const addItemRow = () => {
        const newItem: Partial<InvoiceItem> = {
            id: 'temp-' + Date.now(),
            productId: undefined,
            description: '',
            quantity: 1,
            unitPrice: 0,
            taxRate: 22, // Default tax rate
            discount: 0,
        };
        setFormData({
            ...formData,
            items: [...(formData.items || []), newItem as InvoiceItem],
        });
        if (errors.items) {
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors.items;
                return newErrors;
            });
        }
    };

    const removeItemRow = (index: number) => {
        const newItems = [...(formData.items || [])];
        newItems.splice(index, 1);
        setFormData({ ...formData, items: newItems });
    };

    const updateItemRow = (index: number, field: keyof InvoiceItem, value: any) => {
        const newItems = [...(formData.items || [])];
        newItems[index] = { ...newItems[index], [field]: value };

        // Auto-fill from product
        if (field === 'productId') {
            const product = products.find(p => p.id === value);
            if (product) {
                newItems[index].description = product.name;
                newItems[index].unitPrice = calcProductSalePrice(product.costo, product.molPercentage);
                newItems[index].taxRate = product.taxRate;
            }
        }

        setFormData({ ...formData, items: newItems });
    };

    const calculateTotals = (items: InvoiceItem[]) => {
        let subtotal = 0;
        const taxGroups: Record<number, number> = {};

        items.forEach(item => {
            const lineSubtotal = item.quantity * item.unitPrice;
            const lineDiscount = item.discount ? (lineSubtotal * item.discount / 100) : 0;
            const lineNet = lineSubtotal - lineDiscount;

            subtotal += lineNet;

            const taxRate = item.taxRate || 0;
            const taxAmount = lineNet * (taxRate / 100);
            taxGroups[taxRate] = (taxGroups[taxRate] || 0) + taxAmount;
        });

        const totalTax = Object.values(taxGroups).reduce((sum, val) => sum + val, 0);
        const total = subtotal + totalTax;

        return { subtotal, totalTax, total, taxGroups };
    };

    const activeClients = clients.filter(c => !c.isDisabled);
    const activeProducts = products.filter(p => !p.isDisabled);

    // Form Calculation for display
    const { subtotal, totalTax, total, taxGroups } = calculateTotals(formData.items || []);

    // Pagination
    const totalPages = Math.ceil(filteredInvoices.length / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const paginatedInvoices = filteredInvoices.slice(startIndex, startIndex + rowsPerPage);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                                    <i className={`fa-solid ${editingInvoice ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                                </div>
                                {editingInvoice ? 'Edit Invoice' : 'Create New Invoice'}
                            </h3>
                            <button onClick={() => setIsModalOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8 flex-1">
                            {/* Header Info */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Invoice Number</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.invoiceNumber}
                                        onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                                        className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-bold"
                                        placeholder="INV-YYYY-XXXX"
                                    />
                                    {errors.invoiceNumber && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.invoiceNumber}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Issue Date</label>
                                    <input
                                        type="date"
                                        required
                                        value={formData.issueDate}
                                        onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                                        className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Due Date</label>
                                    <input
                                        type="date"
                                        required
                                        value={formData.dueDate}
                                        onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                                        className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Client</label>
                                    <CustomSelect
                                        options={activeClients.map(c => ({ id: c.id, name: c.name }))}
                                        value={formData.clientId || ''}
                                        onChange={handleClientChange}
                                        placeholder="Select a client..."
                                        searchable={true}
                                        className={errors.clientId ? 'border-red-300' : ''}
                                    />
                                    {errors.clientId && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Status</label>
                                    <CustomSelect
                                        options={INVOICE_STATUS_OPTIONS}
                                        value={formData.status || 'draft'}
                                        onChange={(val) => setFormData({ ...formData, status: val as any })}
                                        searchable={false}
                                    />
                                </div>
                            </div>

                            {/* Line Items */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                                        Items
                                    </h4>
                                    <button type="button" onClick={addItemRow} className="text-xs font-bold text-praetor hover:text-slate-700 flex items-center gap-1">
                                        <i className="fa-solid fa-plus"></i> Add Line
                                    </button>
                                </div>
                                {errors.items && <p className="text-red-500 text-[10px] font-bold ml-1 -mt-2">{errors.items}</p>}

                                {formData.items && formData.items.length > 0 && (
                                    <div className="grid grid-cols-12 gap-2 px-3 mb-1">
                                        <div className="col-span-12 md:col-span-4 text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Description / Product</div>
                                        <div className="hidden md:block md:col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">Qty</div>
                                        <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">Price</div>
                                        <div className="hidden md:block md:col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">Tax%</div>
                                        <div className="hidden md:block md:col-span-1 text-[10px] font-black text-slate-400 uppercase tracking-wider">Disc%</div>
                                        <div className="hidden md:block md:col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right pr-2">Total</div>
                                        <div className="hidden md:block md:col-span-1"></div>
                                    </div>
                                )}

                                <div className="space-y-3">
                                    {formData.items?.map((item, index) => (
                                        <div key={item.id} className="flex gap-2 items-start bg-slate-50 p-3 rounded-xl border border-slate-100">
                                            <div className="flex-1 grid grid-cols-12 gap-2">
                                                <div className="col-span-4 space-y-2">
                                                    <CustomSelect
                                                        options={[{ id: '', name: 'Custom Item' }, ...activeProducts.map(p => ({ id: p.id, name: p.name }))]}
                                                        value={item.productId || ''}
                                                        onChange={(val) => updateItemRow(index, 'productId', val)}
                                                        placeholder="Select product (optional)..."
                                                        searchable={true}
                                                        buttonClassName="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                                                    />
                                                    <input
                                                        type="text"
                                                        required
                                                        placeholder="Description"
                                                        value={item.description}
                                                        onChange={(e) => updateItemRow(index, 'description', e.target.value)}
                                                        className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                                                    />
                                                </div>
                                                <div className="col-span-1">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        required
                                                        value={item.quantity}
                                                        onChange={(e) => updateItemRow(index, 'quantity', parseFloat(e.target.value) || 0)}
                                                        className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                                                    />
                                                </div>
                                                <div className="col-span-2">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        required
                                                        value={item.unitPrice}
                                                        onChange={(e) => updateItemRow(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                                                        className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                                                    />
                                                </div>
                                                <div className="col-span-1">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="100"
                                                        value={item.taxRate}
                                                        onChange={(e) => updateItemRow(index, 'taxRate', parseFloat(e.target.value) || 0)}
                                                        className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                                                    />
                                                </div>
                                                <div className="col-span-1">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="100"
                                                        value={item.discount || 0}
                                                        onChange={(e) => updateItemRow(index, 'discount', parseFloat(e.target.value) || 0)}
                                                        className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-none"
                                                    />
                                                </div>
                                                <div className="col-span-2 flex items-center justify-end font-bold text-slate-600 text-sm">
                                                    {((item.quantity * item.unitPrice) * (1 - (item.discount || 0) / 100)).toFixed(2)}
                                                </div>
                                            </div>
                                            <button type="button" onClick={() => removeItemRow(index)} className="col-span-1 p-2 text-slate-400 hover:text-red-600 rounded-lg">
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!formData.items || formData.items.length === 0) && (
                                        <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                                            No items yet. Add a line to start.
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Totals */}
                            <div className="flex flex-col md:flex-row gap-8 justify-end border-t border-slate-100 pt-6">
                                <div className="w-full md:w-1/3 space-y-3">
                                    <div className="flex justify-between">
                                        <span className="text-sm font-bold text-slate-500">Subtotal</span>
                                        <span className="text-sm font-bold text-slate-700">{subtotal.toFixed(2)} {currency}</span>
                                    </div>
                                    {Object.entries(taxGroups).map(([rate, amount]) => (
                                        <div key={rate} className="flex justify-between text-xs">
                                            <span className="font-semibold text-slate-500">VAT {rate}%</span>
                                            <span className="font-semibold text-slate-700">{amount.toFixed(2)} {currency}</span>
                                        </div>
                                    ))}
                                    <div className="flex justify-between pt-3 border-t border-slate-200">
                                        <span className="text-lg font-black text-slate-800">Total</span>
                                        <span className="text-lg font-black text-praetor">{total.toFixed(2)} {currency}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="font-bold text-slate-500">Amount Paid</span>
                                        <span className="font-bold text-emerald-600">{formData.amountPaid?.toFixed(2)} {currency}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="font-bold text-slate-500">Balance Due</span>
                                        <span className="font-bold text-red-500">{(total - (formData.amountPaid || 0)).toFixed(2)} {currency}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-6">
                                <label className="text-xs font-bold text-slate-500 ml-1">Notes</label>
                                <textarea
                                    rows={2}
                                    value={formData.notes || ''}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    className="w-full text-sm px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none"
                                    placeholder="Payment instructions, thank you note, etc..."
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-4">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl">Cancel</button>
                                <button type="submit" className="px-8 py-3 bg-praetor text-white font-bold rounded-xl hover:bg-slate-700 shadow-lg shadow-slate-200">Save Invoice</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isDeleteConfirmOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center space-y-4">
                        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
                        </div>
                        <h3 className="text-lg font-black text-slate-800">Delete Invoice?</h3>
                        <p className="text-sm text-slate-500">Are you sure you want to delete invoice <b>{invoiceToDelete?.invoiceNumber}</b>? This cannot be undone.</p>
                        <div className="flex gap-3 pt-2">
                            <button onClick={() => setIsDeleteConfirmOpen(false)} className="flex-1 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl">Cancel</button>
                            <button onClick={handleDelete} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700">Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">Invoices</h2>
                    <p className="text-slate-500 text-sm">Manage and track customer invoices</p>
                </div>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="md:col-span-2 relative">
                    <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input
                        type="text"
                        placeholder="Search invoices..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm"
                    />
                </div>
                <div>
                    <CustomSelect
                        options={[{ id: 'all', name: 'All Clients' }, ...activeClients.map(c => ({ id: c.id, name: c.name }))]}
                        value={filterClientId}
                        onChange={setFilterClientId}
                        placeholder="Filter by Client"
                        searchable={true}
                    />
                </div>
                <div>
                    <CustomSelect
                        options={[{ id: 'all', name: 'All Statuses' }, ...INVOICE_STATUS_OPTIONS]}
                        value={filterStatus}
                        onChange={setFilterStatus}
                        placeholder="Filter by Status"
                        searchable={false}
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

            {/* Table */}
            <StandardTable
                title="All Invoices"
                totalCount={filteredInvoices.length}
                containerClassName="overflow-visible"
                headerAction={
                    <button
                        onClick={openAddModal}
                        className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 hover:bg-slate-700 flex items-center gap-2"
                    >
                        <i className="fa-solid fa-plus"></i> Create Invoice
                    </button>
                }
                footer={
                    <>
                        <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-500">Rows:</span>
                            <CustomSelect
                                options={[{ id: '10', name: '10' }, { id: '20', name: '20' }, { id: '50', name: '50' }]}
                                value={rowsPerPage.toString()}
                                onChange={handleRowsPerPageChange}
                                className="w-20"
                                searchable={false}
                                buttonClassName="text-xs py-1"
                            />
                            <span className="text-xs font-bold text-slate-400 ml-2">
                                Showing {paginatedInvoices.length > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + rowsPerPage, filteredInvoices.length)} of {filteredInvoices.length}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                                <button
                                    key={page}
                                    onClick={() => setCurrentPage(page)}
                                    className={`w-8 h-8 rounded-lg text-xs font-bold ${currentPage === page ? 'bg-praetor text-white' : 'hover:bg-slate-100 text-slate-500'}`}
                                >
                                    {page}
                                </button>
                            ))}
                        </div>
                    </>
                }
            >
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Number</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Due Date</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Balance</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {paginatedInvoices.map(invoice => {
                            const balance = invoice.total - invoice.amountPaid;
                            return (
                                <tr key={invoice.id} onClick={() => openEditModal(invoice)} className="hover:bg-slate-50/50 cursor-pointer transition-colors">
                                    <td className="px-6 py-4 font-bold text-slate-700">{invoice.invoiceNumber}</td>
                                    <td className="px-6 py-4 font-bold text-slate-800">{invoice.clientName}</td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{new Date(invoice.issueDate).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{new Date(invoice.dueDate).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 font-bold text-slate-700">{(invoice.total ?? 0).toFixed(2)} {currency}</td>
                                    <td className={`px-6 py-4 font-bold ${balance > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                        {balance.toFixed(2)} {currency}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${invoice.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                                            invoice.status === 'overdue' ? 'bg-red-100 text-red-700' :
                                                invoice.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                                                    invoice.status === 'cancelled' ? 'bg-slate-100 text-slate-500' :
                                                        'bg-amber-100 text-amber-700'
                                            }`}>
                                            {invoice.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); openEditModal(invoice); }}
                                            className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                                        >
                                            <i className="fa-solid fa-pen-to-square"></i>
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); confirmDelete(invoice); }}
                                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                        >
                                            <i className="fa-solid fa-trash-can"></i>
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {paginatedInvoices.length === 0 && (
                            <tr>
                                <td colSpan={8} className="p-12 text-center text-slate-400 text-sm font-bold">
                                    No invoices found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </StandardTable>
        </div>
    );
};

export default InvoicesView;
