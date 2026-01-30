import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '../types';
import Modal from './Modal';

interface InternalEmployeesViewProps {
  users: User[];
  onAddEmployee: (
    name: string,
    costPerHour?: number,
  ) => Promise<{ success: boolean; error?: string }>;
  onUpdateEmployee: (id: string, updates: Partial<User>) => void;
  onDeleteEmployee: (id: string) => void;
  currency: string;
}

const InternalEmployeesView: React.FC<InternalEmployeesViewProps> = ({
  users,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  currency,
}) => {
  const { t } = useTranslation(['hr', 'common']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<User | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<User | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');

  // Filter users into app users and internal employees
  const appUsers = useMemo(() => {
    return users.filter(
      (u) =>
        (u.employeeType === 'app_user' || !u.employeeType) &&
        !u.isDisabled &&
        (searchTerm === '' || u.name.toLowerCase().includes(searchTerm.toLowerCase())),
    );
  }, [users, searchTerm]);

  const internalEmployees = useMemo(() => {
    return users.filter(
      (u) =>
        u.employeeType === 'internal' &&
        !u.isDisabled &&
        (searchTerm === '' || u.name.toLowerCase().includes(searchTerm.toLowerCase())),
    );
  }, [users, searchTerm]);

  const [formData, setFormData] = useState<{ name: string; costPerHour: string }>({
    name: '',
    costPerHour: '',
  });

  const openAddModal = () => {
    setEditingEmployee(null);
    setFormData({
      name: '',
      costPerHour: '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (employee: User) => {
    setEditingEmployee(employee);
    setFormData({
      name: employee.name || '',
      costPerHour: employee.costPerHour?.toString() || '',
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!formData.name?.trim()) {
      newErrors.name = t('common:validation.required');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      if (editingEmployee) {
        onUpdateEmployee(editingEmployee.id, {
          name: formData.name.trim(),
          costPerHour: formData.costPerHour ? parseFloat(formData.costPerHour) : 0,
        });
        setIsModalOpen(false);
      } else {
        const result = await onAddEmployee(
          formData.name.trim(),
          formData.costPerHour ? parseFloat(formData.costPerHour) : undefined,
        );
        if (result.success) {
          setIsModalOpen(false);
        } else {
          setErrors({ submit: result.error || 'Failed to create employee' });
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = (employee: User) => {
    setEmployeeToDelete(employee);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (employeeToDelete) {
      onDeleteEmployee(employeeToDelete.id);
      setIsDeleteConfirmOpen(false);
      setEmployeeToDelete(null);
    }
  };

  const renderEmployeeRow = (employee: User, isAppUser: boolean) => (
    <tr
      key={employee.id}
      className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
    >
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-praetor/10 text-praetor flex items-center justify-center font-bold text-xs">
            {employee.avatarInitials}
          </div>
          <span className="font-semibold text-slate-800">{employee.name}</span>
        </div>
      </td>
      <td className="px-6 py-4">
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-bold ${
            isAppUser ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {isAppUser ? t('internalEmployees.appUserBadge') : t('internalEmployees.internalBadge')}
        </span>
      </td>
      <td className="px-6 py-4 font-medium text-slate-600">
        {currency}
        {(employee.costPerHour || 0).toFixed(2)}
      </td>
      <td className="px-6 py-4">
        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
          {t('internalEmployees.active')}
        </span>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => openEditModal(employee)}
            className="p-2 text-slate-400 hover:text-praetor hover:bg-praetor/5 rounded-lg transition-colors"
            title={t('internalEmployees.editEmployee')}
          >
            <i className="fa-solid fa-pen-to-square"></i>
          </button>
          {!isAppUser && (
            <button
              onClick={() => confirmDelete(employee)}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title={t('common:delete')}
            >
              <i className="fa-solid fa-trash"></i>
            </button>
          )}
          {isAppUser && (
            <span
              className="p-2 text-slate-300 cursor-not-allowed"
              title={t('internalEmployees.cannotDeleteAppUser')}
            >
              <i className="fa-solid fa-lock"></i>
            </span>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingEmployee ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingEmployee
                ? t('internalEmployees.editEmployee')
                : t('internalEmployees.addEmployee')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
            {errors.submit && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errors.submit}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('internalEmployees.name')} *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={`w-full px-4 py-3 border ${
                  errors.name ? 'border-red-300' : 'border-slate-200'
                } rounded-xl focus:ring-2 focus:ring-praetor/20 focus:border-praetor transition-all bg-slate-50/50`}
                placeholder={t('internalEmployees.name')}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1 ml-1">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('internalEmployees.costPerHour')}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium">
                  {currency}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.costPerHour}
                  onChange={(e) => setFormData({ ...formData, costPerHour: e.target.value })}
                  className="w-full pl-8 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor/20 focus:border-praetor transition-all bg-slate-50/50"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-slate-600 font-bold hover:bg-slate-50 transition-colors"
              >
                {t('common:cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-3 bg-praetor text-white rounded-xl font-bold hover:bg-praetor/90 transition-colors disabled:opacity-50"
              >
                {isSubmitting ? (
                  <i className="fa-solid fa-spinner fa-spin"></i>
                ) : (
                  t('internalEmployees.saveChanges')
                )}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fa-solid fa-trash text-2xl text-red-600"></i>
            </div>
            <h3 className="text-xl font-black text-slate-800 mb-2">
              {t('internalEmployees.deleteEmployee')}
            </h3>
            <p className="text-slate-500">
              {t('internalEmployees.deleteConfirmMessage', { name: employeeToDelete?.name })}
            </p>
          </div>
          <div className="flex border-t border-slate-100">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 px-6 py-4 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="flex-1 px-6 py-4 bg-red-600 text-white font-bold hover:bg-red-700 transition-colors"
            >
              {t('internalEmployees.yesDelete')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('internalEmployees.title')}</h2>
          <p className="text-slate-500">{t('internalEmployees.subtitle')}</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-5 py-3 bg-praetor text-white rounded-xl font-bold hover:bg-praetor/90 transition-colors shadow-lg shadow-praetor/20"
        >
          <i className="fa-solid fa-plus"></i>
          {t('internalEmployees.addEmployee')}
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="relative">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('internalEmployees.searchEmployees')}
            className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor/20 focus:border-praetor transition-all"
          />
        </div>
      </div>

      {/* App Users Section */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <i className="fa-solid fa-user text-praetor"></i>
            {t('internalEmployees.appUsers')}
            <span className="ml-2 px-2 py-0.5 bg-slate-200 rounded-full text-xs font-bold text-slate-600">
              {appUsers.length}
            </span>
          </h3>
        </div>
        {appUsers.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <i className="fa-solid fa-users text-4xl mb-3 opacity-50"></i>
            <p>{t('internalEmployees.noAppUsers')}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.name')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.type')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.costPerHour')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.status')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.actions')}
                </th>
              </tr>
            </thead>
            <tbody>{appUsers.map((user) => renderEmployeeRow(user, true))}</tbody>
          </table>
        )}
      </div>

      {/* Internal Staff Section */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <i className="fa-solid fa-user-tie text-emerald-600"></i>
            {t('internalEmployees.internalStaff')}
            <span className="ml-2 px-2 py-0.5 bg-slate-200 rounded-full text-xs font-bold text-slate-600">
              {internalEmployees.length}
            </span>
          </h3>
        </div>
        {internalEmployees.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <i className="fa-solid fa-user-plus text-4xl mb-3 opacity-50"></i>
            <p>{t('internalEmployees.noInternalStaff')}</p>
            <p className="text-sm mt-1">{t('internalEmployees.createFirst')}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.name')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.type')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.costPerHour')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.status')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('internalEmployees.actions')}
                </th>
              </tr>
            </thead>
            <tbody>{internalEmployees.map((employee) => renderEmployeeRow(employee, false))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default InternalEmployeesView;
