import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Expense } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import ValidatedNumberInput from './ValidatedNumberInput';

interface ExpensesViewProps {
  expenses: Expense[];
  onAddExpense: (expenseData: Partial<Expense>) => void;
  onUpdateExpense: (id: string, updates: Partial<Expense>) => void;
  onDeleteExpense: (id: string) => void;
  currency: string;
}

const ExpensesView: React.FC<ExpensesViewProps> = ({
  expenses,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
  currency,
}) => {
  const { t } = useTranslation('finances');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const categoryOptions = useMemo(
    () => [
      { id: 'office_supplies', name: t('expenses.categories.officeSupplies') },
      { id: 'travel', name: t('expenses.categories.travel') },
      { id: 'software', name: t('expenses.categories.software') },
      { id: 'marketing', name: t('expenses.categories.marketing') },
      { id: 'utilities', name: t('expenses.categories.utilities') },
      { id: 'other', name: t('expenses.categories.other') },
    ],
    [t],
  );

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const matchesSearch =
        searchTerm === '' ||
        e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.vendor?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory = filterCategory === 'all' || e.category === filterCategory;

      return matchesSearch && matchesCategory;
    });
  }, [expenses, searchTerm, filterCategory]);

  const hasActiveFilters = searchTerm.trim() !== '' || filterCategory !== 'all';

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterCategory('all');
    setCurrentPage(1);
  };

  // Form State
  const [formData, setFormData] = useState<Partial<Expense>>({
    description: '',
    amount: 0,
    expenseDate: new Date().toISOString().split('T')[0],
    category: 'other',
    vendor: '',
    receiptReference: '',
    notes: '',
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
      notes: '',
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

    if (!formData.description) newErrors.description = t('expenses.description') + ' is required';
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
                {editingExpense ? t('expenses.editExpense') : t('expenses.recordExpense')}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('expenses.description')}
                </label>
                <input
                  type="text"
                  required
                  placeholder={t('expenses.descriptionPlaceholder')}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold"
                />
                {errors.description && (
                  <p className="text-red-500 text-[10px] font-bold ml-1">{errors.description}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('expenses.category')}
                  </label>
                  <CustomSelect
                    options={categoryOptions}
                    value={formData.category || 'other'}
                    onChange={(val) => setFormData({ ...formData, category: val as any })}
                    searchable={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('expenses.amount')} ({currency})
                  </label>
                  <ValidatedNumberInput
                    step="0.01"
                    required
                    value={formData.amount}
                    onValueChange={(value) => {
                      const parsed = parseFloat(value);
                      setFormData({
                        ...formData,
                        amount: value === '' || Number.isNaN(parsed) ? 0 : parsed,
                      });
                    }}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none font-semibold"
                  />
                  {errors.amount && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.amount}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('expenses.expenseDate')}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.expenseDate}
                    onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                  />
                  {errors.expenseDate && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.expenseDate}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('expenses.vendor')} ({t('common.optional')})
                  </label>
                  <input
                    type="text"
                    placeholder={t('expenses.vendorPlaceholder')}
                    value={formData.vendor || ''}
                    onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('expenses.receiptReference')}
                </label>
                <input
                  type="text"
                  placeholder={t('expenses.receiptPlaceholder')}
                  value={formData.receiptReference || ''}
                  onChange={(e) => setFormData({ ...formData, receiptReference: e.target.value })}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('expenses.notes')}
                </label>
                <textarea
                  rows={3}
                  value={formData.notes || ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder={t('expenses.notesPlaceholder')}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
                >
                  {t('common.buttons.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-8 py-3 bg-praetor text-white font-bold rounded-xl hover:bg-slate-700 shadow-lg shadow-slate-200"
                >
                  {t('common.buttons.save')}
                </button>
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
            <h3 className="text-lg font-black text-slate-800">{t('expenses.expenseDeleted')}?</h3>
            <p className="text-sm text-slate-500">{t('expenses.deleteConfirm')}</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 py-3 font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
              >
                {t('common.buttons.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700"
              >
                {t('common.buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('expenses.title')}</h2>
          <p className="text-slate-500 text-sm">{t('expenses.subtitle')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            placeholder={t('expenses.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm"
          />
        </div>
        <div>
          <CustomSelect
            options={[{ id: 'all', name: t('expenses.allCategories') }, ...categoryOptions]}
            value={filterCategory}
            onChange={setFilterCategory}
            placeholder={t('expenses.filterCategory')}
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
            {t('common.labels.clearFilters')}
          </button>
        </div>
      </div>

      {/* Table */}
      <StandardTable
        title={t('expenses.title')}
        totalCount={filteredExpenses.length}
        containerClassName="overflow-visible"
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 hover:bg-slate-700 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('expenses.recordExpense')}
          </button>
        }
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('common.labels.rowsPerPage')}:
              </span>
              <CustomSelect
                options={[
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={rowsPerPage.toString()}
                onChange={(val) => {
                  setRowsPerPage(parseInt(val));
                  setCurrentPage(1);
                }}
                className="w-20"
                searchable={false}
                buttonClassName="text-xs py-1"
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('common:pagination.showing', {
                  start: paginatedExpenses.length > 0 ? startIndex + 1 : 0,
                  end: Math.min(startIndex + rowsPerPage, filteredExpenses.length),
                  total: filteredExpenses.length,
                })}
              </span>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
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
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('expenses.expenseDate')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('expenses.description')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('expenses.category')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('expenses.vendor')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('expenses.amount')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                {t('common.more')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedExpenses.map((expense) => (
              <tr
                key={expense.id}
                onClick={() => openEditModal(expense)}
                className="hover:bg-slate-50/50 cursor-pointer transition-colors"
              >
                <td className="px-6 py-4 text-sm text-slate-600">
                  {new Date(expense.expenseDate).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 font-bold text-slate-800">{expense.description}</td>
                <td className="px-6 py-4">
                  <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold capitalize">
                    {categoryOptions.find((opt) => opt.id === expense.category)?.name ||
                      expense.category}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">{expense.vendor || '-'}</td>
                <td className="px-6 py-4 font-bold text-red-500">
                  -{expense.amount.toFixed(2)} {currency}
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(expense);
                    }}
                    className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpenseToDelete(expense);
                      setIsDeleteConfirmOpen(true);
                    }}
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
                  {t('expenses.noExpenses')}
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
