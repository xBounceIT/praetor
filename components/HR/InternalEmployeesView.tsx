import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../types';
import { buildPermission, hasPermission } from '../../utils/permissions';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';

export interface InternalEmployeesViewProps {
  users: User[];
  onAddEmployee: (
    name: string,
    costPerHour?: number,
  ) => Promise<{ success: boolean; error?: string }>;
  onUpdateEmployee: (id: string, updates: Partial<User>) => void;
  onDeleteEmployee: (id: string) => void;
  currency: string;
  permissions: string[];
}

const getSurname = (name: string): string => {
  const parts = name.trim().split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : name;
};

const InternalEmployeesView: React.FC<InternalEmployeesViewProps> = ({
  users,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  currency,
  permissions,
}) => {
  const { t } = useTranslation(['hr', 'common']);
  const canViewCosts = hasPermission(permissions, buildPermission('hr.costs', 'view'));
  const canUpdateCosts = hasPermission(permissions, buildPermission('hr.costs', 'update'));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<User | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<User | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Combine and sort all employees by surname ascending
  const allEmployees = useMemo(() => {
    const filtered = users.filter(
      (u) =>
        !u.isDisabled &&
        (u.employeeType === 'internal' || u.employeeType === 'app_user' || !u.employeeType),
    );

    return filtered.sort((a, b) => {
      const surnameA = getSurname(a.name).toLowerCase();
      const surnameB = getSurname(b.name).toLowerCase();
      return surnameA.localeCompare(surnameB);
    });
  }, [users]);

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

  // Define columns for StandardTable
  const columns: Column<User>[] = [
    {
      header: t('internalEmployees.name'),
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-praetor/10 text-praetor flex items-center justify-center font-bold text-xs">
            {row.avatarInitials}
          </div>
          <span className="font-semibold text-slate-800">{row.name}</span>
        </div>
      ),
    },
    {
      header: t('internalEmployees.type'),
      accessorKey: 'employeeType',
      filterFormat: (value) =>
        value === 'internal'
          ? t('internalEmployees.internalBadge')
          : t('internalEmployees.appUserBadge'),
      cell: ({ row }) => (
        <StatusBadge
          type={row.employeeType === 'internal' ? 'internal' : 'app_user'}
          label={
            row.employeeType === 'internal'
              ? t('internalEmployees.internalBadge')
              : t('internalEmployees.appUserBadge')
          }
        />
      ),
    },
    ...(canViewCosts
      ? [
          {
            header: t('internalEmployees.costPerHour'),
            accessorKey: 'costPerHour' as keyof User,
            align: 'right' as const,
            cell: ({ value }: { value: unknown }) => (
              <span className="font-medium text-slate-600">
                {currency}
                {Number(value ?? 0).toFixed(2)}
              </span>
            ),
          },
        ]
      : []),
    {
      header: t('internalEmployees.status'),
      accessorFn: () => 'active',
      cell: () => <StatusBadge type="active" label={t('internalEmployees.active')} />,
      disableSorting: true,
    },
    {
      header: t('internalEmployees.actions'),
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Tooltip label={t('internalEmployees.editEmployee')}>
            {() => (
              <button
                onClick={() => openEditModal(row)}
                className="p-2 text-slate-400 hover:text-praetor hover:bg-praetor/5 rounded-lg transition-colors"
              >
                <i className="fa-solid fa-pen-to-square"></i>
              </button>
            )}
          </Tooltip>
          {row.employeeType === 'internal' ? (
            <Tooltip label={t('common:delete')}>
              {() => (
                <button
                  onClick={() => confirmDelete(row)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <i className="fa-solid fa-trash"></i>
                </button>
              )}
            </Tooltip>
          ) : (
            <Tooltip label={t('internalEmployees.cannotDeleteAppUser')}>
              {() => (
                <span className="p-2 text-slate-300 cursor-not-allowed">
                  <i className="fa-solid fa-lock"></i>
                </span>
              )}
            </Tooltip>
          )}
        </div>
      ),
      disableSorting: true,
      disableFiltering: true,
    },
  ];

  // Custom empty state component
  const EmptyState = () => (
    <div className="p-8 text-center">
      <i className="fa-solid fa-users text-4xl mb-3 text-slate-300"></i>
      <p className="text-slate-500 font-medium">{t('internalEmployees.noEmployees')}</p>
      <p className="text-sm text-slate-400 mt-1">{t('internalEmployees.createFirst')}</p>
    </div>
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

            {canViewCosts && (
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
                    disabled={!canUpdateCosts}
                  />
                </div>
              </div>
            )}

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

      {/* Employees Table */}
      <StandardTable<User>
        title={t('internalEmployees.allEmployees')}
        data={allEmployees}
        columns={columns}
        emptyState={<EmptyState />}
      />
    </div>
  );
};

export default InternalEmployeesView;
