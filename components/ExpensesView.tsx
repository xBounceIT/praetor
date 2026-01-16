import React, { useState, useMemo } from 'react';
import { Expense } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';

const EXPENSE_CATEGORY_OPTIONS = [
    { id: 'office_supplies', name: 'Office Supplies' },
    { id: 'travel', name: 'Travel' },
    { id: 'software', name: 'Software' },
    { id: 'marketing', name: 'Marketing' },
    { id: 'utilities', name: 'Utilities' },
    { id: 'other', name: 'Other' },
];

interface ExpensesViewProps {
    expenses: Expense[];
    onAddExpense: (expenseData: Partial<Expense>) => void;
    onUpdateExpense: (id: string, updates: Partial<Expense>) => void;
    onDeleteExpense: (id: string) => void;
    currency: string;
}

const ExpensesView: React.FC<ExpensesViewProps> = ({ expenses, onAddExpense, onUpdateExpense, onDeleteExpense, currency }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');

    const filteredExpenses = useMemo(() => {
        return expenses.filter(e => {
            const matchesSearch = searchTerm === '' ||
                e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                e.vendor?.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesCategory = filterCategory === 'all' || e.category === filterCategory;

            return matchesSearch && matchesCategory;
        });
    }, [expenses, searchTerm, filterCategory]);

    // Form State
    const [formData, setFormData] = useState<Partial<Expense>>({
        description: '',
        amount: 0,
        expenseDate: new Date().toISOString().split('T')[0],
        category: 'other',
        vendor: '',
        receiptReference: '',
        notes: ''
    });

    const openAddModal = () => {
        setEditingExpense(null);
        setFormData({
            description: '',
            amount: 0,
            expenseDate: new Date().toISOString().split('T')[0],
            category: 'other',
            vendor: '',
            receiptReference: '',
            notes: ''
        });
        setErrors({});
        setIsModalOpen(true);
    };

    const openEditModal = (expense: Expense) => {
        setEditingExpense(expense);
        setFormData({ ...expense });
        setErrors({});
        setIsModalOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newErrors: Record<string, string> = {};

        if (!formData.description) newErrors.description = 'Description is required';
        if (!formData.amount || formData.amount <= 0) newErrors.amount = 'Valid amount is required';
        if (!formData.expenseDate) newErrors.expenseDate = 'Date is required';

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        if (editingExpense) {
            onUpdateExpense(editingExpense.id, formData);
        } else {
            onAddExpense(formData);
        }
        setIsModalOpen(false);
    };

    const handleDelete = () => {
        if (expenseToDelete) {
            onDeleteExpense(expenseToDelete.id);
            setIsDeleteConfirmOpen(false);
            setExpenseToDelete(null);
        }
    };

    // Pagination Calculation
    const totalPages = Math.ceil(filteredExpenses.length / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const paginatedExpenses = filteredExpenses.slice(startIndex, startIndex + rowsPerPage);


    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                                    <i className={`fa-solid ${editingExpense ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                                </div>
                                {editingExpense ? 'Edit Expense' : 'Record Expense'}
                            </h3>
                            <button onClick={() => setIsModalOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-8 space-y-6">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-500 ml-1">Description</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="What was this expense for?"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold"
                                />
                                {errors.description && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.description}</p>}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Category</label>
                                    <CustomSelect
                                        options={EXPENSE_CATEGORY_OPTIONS}
                                        value={formData.category || 'other'}
                                        onChange={(val) => setFormData({ ...formData, category: val as any })}
                                        searchable={false}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Amount ({currency})</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={formData.amount}
                                        onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                                        className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold"
                                    />
                                    {errors.amount && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.amount}</p>}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Date</label>
                                    <input
                                        type="date"
                                        required
                                        value={formData.expenseDate}
                                        onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })}
                                        className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                                    />
                                    {errors.expenseDate && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.expenseDate}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-500 ml-1">Vendor (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="Samsung, Amazon, etc."
                                        value={formData.vendor || ''}
                                        onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                                        className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-500 ml-1">Receipt Reference / Link</label>
                                <input
                                    type="text"
                                    placeholder="Invoice # or URL to receipt"
                                    value={formData.receiptReference || ''}
                                    onChange={(e) => setFormData({ ...formData, receiptReference: e.target.value })}
                                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-500 ml-1">Notes</label>
                                <textarea
                                    rows={3}
                                    value={formData.notes || ''}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    placeholder="Additional details..."
                                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none resize-none"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl">Cancel</button>
                                <button type="submit" className="px-8 py-3 bg-praetor text-white font-bold rounded-xl hover:bg-slate-700 shadow-lg shadow-slate-200">Save Expense</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            {isDeleteConfirmOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center space-y-4">
                        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                            <i className="fa-solid fa-triangle-exclamation text-xl"></i>
                        </div>
                        <h3 className="text-lg font-black text-slate-800">Delete Expense?</h3>
                        <p className="text-sm text-slate-500">Are you sure you want to delete this expense record? This cannot be undone.</p>
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
                    <h2 className="text-2xl font-black text-slate-800">Expenses</h2>
                    <p className="text-slate-500 text-sm">Track company spending</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="bg-praetor text-white px-6 py-3 rounded-2xl font-black shadow-xl shadow-slate-200 hover:bg-slate-700 flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus"></i> Record Expense
                </button>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 relative">
                    <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input
                        type="text"
                        placeholder="Search expenses by description or vendor..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm"
                    />
                </div>
                <div>
                    <CustomSelect
                        options={[{ id: 'all', name: 'All Categories' }, ...EXPENSE_CATEGORY_OPTIONS]}
                        value={filterCategory}
                        onChange={setFilterCategory}
                        placeholder="Filter by Category"
                        searchable={false}
                    />
                </div>
            </div>

            {/* Table */}
            <StandardTable
                title="All Expenses"
                totalCount={filteredExpenses.length}
                containerClassName="overflow-visible"
                footer={
                    <>
                        <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-500">Rows:</span>
                            <CustomSelect
                                options={[{ id: '10', name: '10' }, { id: '20', name: '20' }, { id: '50', name: '50' }]}
                                value={rowsPerPage.toString()}
                                onChange={(val) => { setRowsPerPage(parseInt(val)); setCurrentPage(1); }}
                                className="w-20"
                                searchable={false}
                                buttonClassName="text-xs py-1"
                            />
                            <span className="text-xs font-bold text-slate-400 ml-2">
                                Showing {paginatedExpenses.length > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + rowsPerPage, filteredExpenses.length)} of {filteredExpenses.length}
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
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Vendor</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {paginatedExpenses.map(expense => (
                            <tr key={expense.id} onClick={() => openEditModal(expense)} className="hover:bg-slate-50/50 cursor-pointer transition-colors">
                                <td className="px-6 py-4 text-sm text-slate-600">{new Date(expense.expenseDate).toLocaleDateString()}</td>
                                <td className="px-6 py-4 font-bold text-slate-800">{expense.description}</td>
                                <td className="px-6 py-4">
                                    <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold capitalize">
                                        {expense.category.replace('_', ' ')}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-600">{expense.vendor || '-'}</td>
                                <td className="px-6 py-4 font-bold text-red-500">-{expense.amount.toFixed(2)} {currency}</td>
                                <td className="px-6 py-4 text-right">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openEditModal(expense); }}
                                        className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                                    >
                                        <i className="fa-solid fa-pen-to-square"></i>
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setExpenseToDelete(expense); setIsDeleteConfirmOpen(true); }}
                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                    >
                                        <i className="fa-solid fa-trash-can"></i>
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {paginatedExpenses.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-12 text-center text-slate-400 text-sm font-bold">
                                    No expenses found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </StandardTable>
        </div>
    );
};

export default ExpensesView;
