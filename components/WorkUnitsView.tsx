import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { workUnitsApi } from '../services/api/workUnits';
import type { User, WorkUnit } from '../types';
import { hasScopedActionPermission } from '../utils/permissions';
import Checkbox from './shared/Checkbox';
import HeaderAddButton from './shared/HeaderAddButton';
import Modal from './shared/Modal';
import SelectControl from './shared/SelectControl';

export interface WorkUnitPayload {
  name: string;
  managerIds: string[];
  description: string;
}

export interface WorkUnitsViewProps {
  workUnits: WorkUnit[];
  users: User[];
  permissions: string[];
  onAddWorkUnit: (data: WorkUnitPayload) => Promise<void>;
  onUpdateWorkUnit: (id: string, updates: WorkUnitPayload) => Promise<void>;
  onDeleteWorkUnit: (id: string) => Promise<void>;
  refreshWorkUnits: () => Promise<void>;
}

const WorkUnitsView: React.FC<WorkUnitsViewProps> = ({
  workUnits,
  users,
  permissions,
  onAddWorkUnit,
  onUpdateWorkUnit,
  onDeleteWorkUnit,
  refreshWorkUnits,
}) => {
  const { t } = useTranslation(['hr', 'common', 'form']);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const [editingUnit, setEditingUnit] = useState<WorkUnit | null>(null);
  const [targetUnit, setTargetUnit] = useState<WorkUnit | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Assignment state
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);

  const openCreateModal = () => {
    setName('');
    setSelectedManagerIds([]);
    setDescription('');
    setErrors({});
    setIsCreateModalOpen(true);
  };

  const openEditModal = (unit: WorkUnit) => {
    setEditingUnit(unit);
    setName(unit.name);
    // Map existing managers to IDs
    setSelectedManagerIds(unit.managers ? unit.managers.map((m) => m.id) : []);
    setDescription(unit.description || '');
    setErrors({});
    setIsEditModalOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrors({});

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('common:validation.unitNameRequired');
    if (selectedManagerIds.length === 0)
      newErrors.managers = t('common:validation.managersRequired');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await onAddWorkUnit({ name, managerIds: selectedManagerIds, description });
      setIsCreateModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrors({});

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('common:validation.unitNameRequired');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!editingUnit || !name) return;
    setIsSubmitting(true);
    try {
      await onUpdateWorkUnit(editingUnit.id, { name, managerIds: selectedManagerIds, description });
      setIsEditModalOpen(false);
      setEditingUnit(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = (unit: WorkUnit) => {
    setTargetUnit(unit);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!targetUnit) return;
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteWorkUnit(targetUnit.id);
      setIsDeleteConfirmOpen(false);
      setTargetUnit(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const openAssignments = async (unit: WorkUnit) => {
    setTargetUnit(unit);
    setIsAssignmentModalOpen(true);
    setIsLoadingAssignments(true);
    try {
      const userIds = await workUnitsApi.getUsers(unit.id);
      setAssignedUserIds(userIds);
    } catch (err) {
      console.error('Failed to load unit users', err);
    } finally {
      setIsLoadingAssignments(false);
    }
  };

  const saveAssignments = async () => {
    if (!targetUnit) return;
    if (isSavingAssignments) return;
    setIsSavingAssignments(true);
    try {
      await workUnitsApi.updateUsers(targetUnit.id, assignedUserIds);
      await refreshWorkUnits(); // Update counts
      setIsAssignmentModalOpen(false);
      setTargetUnit(null);
    } catch (err) {
      console.error('Failed to save assignments', err);
      alert(t('hr:workUnits.failedToSaveAssignments'));
    } finally {
      setIsSavingAssignments(false);
    }
  };

  const requestCloseCreateModal = () => {
    if (isSubmitting) return;
    setIsCreateModalOpen(false);
  };

  const requestCloseEditModal = () => {
    if (isSubmitting) return;
    setIsEditModalOpen(false);
  };

  const requestCloseAssignmentModal = () => {
    if (isSavingAssignments) return;
    setIsAssignmentModalOpen(false);
  };

  const requestCloseDeleteConfirm = () => {
    if (isDeleting) return;
    setIsDeleteConfirmOpen(false);
  };

  const toggleUserAssignment = (userId: string) => {
    setAssignedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  /*
  const toggleManagerSelection = (userId: string) => {
    setSelectedManagerIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };
  */

  const filteredUsersForAssignment = useMemo(() => {
    if (!assignmentSearch) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(assignmentSearch.toLowerCase()) ||
        u.username.toLowerCase().includes(assignmentSearch.toLowerCase()),
    );
  }, [users, assignmentSearch]);

  const managerOptions = users.map((u) => ({ id: u.id, name: u.name }));

  const canCreateWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'create');
  const canUpdateWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'update');
  const canDeleteWorkUnits = hasScopedActionPermission(permissions, 'hr.work_units', 'delete');
  const canManageMembers = canUpdateWorkUnits;

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-800 tracking-tight">
            {t('hr:workUnits.title')}
          </h2>
          <p className="text-zinc-500 font-medium">{t('hr:workUnits.subtitle')}</p>
        </div>
        {canCreateWorkUnits && (
          <HeaderAddButton actionSize="wide" onClick={openCreateModal}>
            {t('hr:workUnits.newWorkUnit')}
          </HeaderAddButton>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {workUnits.map((unit) => (
          <div
            key={unit.id}
            className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm hover:shadow-md transition-shadow group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="size-12 rounded-xl bg-zinc-100 text-praetor flex items-center justify-center text-xl">
                <i className="fa-solid fa-sitemap"></i>
              </div>
              {(canUpdateWorkUnits || canDeleteWorkUnits) && (
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canUpdateWorkUnits && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <button
                            onClick={() => openEditModal(unit)}
                            className="size-8 rounded-lg bg-zinc-50 text-zinc-400 hover:text-praetor hover:bg-zinc-100 flex items-center justify-center transition-colors"
                          >
                            <i className="fa-solid fa-pen"></i>
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Edit</TooltipContent>
                    </Tooltip>
                  )}
                  {canDeleteWorkUnits && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <button
                            onClick={() => confirmDelete(unit)}
                            className="size-8 rounded-lg bg-zinc-50 text-red-600 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>

            <h3 className="text-lg font-semibold text-zinc-800 mb-1">{unit.name}</h3>
            {unit.description && (
              <p className="text-sm text-zinc-500 mb-4 line-clamp-2">{unit.description}</p>
            )}

            <div className="space-y-3 pt-4 border-t border-zinc-100">
              <div className="flex items-start gap-3">
                <div className="size-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 text-xs font-bold shrink-0">
                  <i className="fa-solid fa-user-tie"></i>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                    {t('hr:workUnits.managers')}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {unit.managers && unit.managers.length > 0 ? (
                      unit.managers.map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-praetor"
                        >
                          {m.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-zinc-400 italic">
                        {t('hr:workUnits.noManagersAssigned')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 text-xs font-bold">
                    <i className="fa-solid fa-users"></i>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                      {t('hr:workUnits.members')}
                    </p>
                    <p className="text-sm font-bold text-zinc-700">
                      {unit.userCount || 0} {t('hr:workUnits.users')}
                    </p>
                  </div>
                </div>
                {canManageMembers && (
                  <button
                    onClick={() => openAssignments(unit)}
                    className="text-xs font-bold text-praetor hover:text-zinc-700 bg-zinc-100 hover:bg-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {t('hr:workUnits.manageMembers')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {workUnits.length === 0 && (
          <div className="col-span-full py-20 bg-white rounded-2xl border-2 border-dashed border-zinc-200 flex flex-col items-center justify-center text-center px-6">
            <div className="size-16 bg-zinc-50 rounded-full flex items-center justify-center text-zinc-300 text-2xl mb-4">
              <i className="fa-solid fa-sitemap"></i>
            </div>
            {canCreateWorkUnits ? (
              <>
                <h3 className="text-lg font-semibold text-zinc-800">
                  {t('hr:workUnits.noWorkUnitsCreated')}
                </h3>
                <p className="text-zinc-500 max-w-sm mt-1">
                  {t('hr:workUnits.noWorkUnitsCreatedDescription')}
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-zinc-800">
                  {t('hr:workUnits.noWorkUnitsAssigned')}
                </h3>
                <p className="text-zinc-500 max-w-md mt-1">
                  {t('hr:workUnits.noWorkUnitsAssignedDescription')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={requestCloseCreateModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-zinc-800">{t('hr:workUnits.newWorkUnit')}</h3>
            <button
              type="button"
              onClick={requestCloseCreateModal}
              disabled={isSubmitting}
              className="text-zinc-400 hover:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
          </div>
          <form onSubmit={handleCreate} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                {t('hr:workUnits.unitName')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                className={`w-full px-4 py-2 bg-zinc-50 border rounded-lg focus:ring-2 outline-none font-semibold text-zinc-700 ${errors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-zinc-200 focus:ring-praetor'}`}
                required
              />
              {errors.name && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.name}</p>
              )}
            </div>
            <div>
              <SelectControl
                label={t('hr:workUnits.managers')}
                options={managerOptions}
                value={selectedManagerIds}
                onChange={(val) => {
                  setSelectedManagerIds(val as string[]);
                  if (errors.managers) setErrors((prev) => ({ ...prev, managers: '' }));
                }}
                isMulti={true}
                searchable={true}
                placeholder={t('hr:workUnits.selectManagers')}
                className={errors.managers ? 'border-red-300' : ''}
              />
              {errors.managers && (
                <p className="text-red-500 text-[10px] font-bold mt-1 ml-1">{errors.managers}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                {t('hr:workUnits.description')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none font-medium text-zinc-600 min-h-25"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={requestCloseCreateModal}
                disabled={isSubmitting}
                className="flex-1 py-3 text-sm font-bold text-zinc-500 hover:bg-zinc-50 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                disabled={selectedManagerIds.length === 0 || isSubmitting}
                className="flex-1 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-zinc-200 hover:bg-zinc-700 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {isSubmitting ? t('common:buttons.saving') : t('hr:workUnits.createUnit')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditModalOpen} onClose={requestCloseEditModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-zinc-800">
              {t('hr:workUnits.editWorkUnit')}
            </h3>
            <button
              type="button"
              onClick={requestCloseEditModal}
              disabled={isSubmitting}
              className="text-zinc-400 hover:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
          </div>
          <form onSubmit={handleUpdate} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                {t('hr:workUnits.unitName')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                className={`w-full px-4 py-2 bg-zinc-50 border rounded-lg focus:ring-2 outline-none font-semibold text-zinc-700 ${errors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-zinc-200 focus:ring-praetor'}`}
                required
              />
              {errors.name && (
                <p className="text-red-500 text-[10px] font-bold mt-1">{errors.name}</p>
              )}
            </div>
            <div>
              <SelectControl
                label={t('hr:workUnits.managers')}
                options={managerOptions}
                value={selectedManagerIds}
                onChange={(val) => {
                  setSelectedManagerIds(val as string[]);
                  if (errors.managers) setErrors((prev) => ({ ...prev, managers: '' }));
                }}
                isMulti={true}
                searchable={true}
                placeholder={t('hr:workUnits.selectManagers')}
                className={errors.managers ? 'border-red-300' : ''}
              />
              {errors.managers && (
                <p className="text-red-500 text-[10px] font-bold mt-1 ml-1">{errors.managers}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                {t('hr:workUnits.description')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none font-medium text-zinc-600 min-h-25"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={requestCloseEditModal}
                disabled={isSubmitting}
                className="flex-1 py-3 text-sm font-bold text-zinc-500 hover:bg-zinc-50 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-zinc-200 hover:bg-zinc-700 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {isSubmitting ? t('common:buttons.saving') : t('hr:workUnits.saveChanges')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Assignment Modal */}
      <Modal isOpen={isAssignmentModalOpen && !!targetUnit} onClose={requestCloseAssignmentModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center shrink-0">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">
                {t('hr:workUnits.manageMembers')}
              </h3>
              <p className="text-sm text-zinc-500 font-medium">
                {t('hr:workUnits.addRemoveUsers', { name: targetUnit?.name })}
              </p>
            </div>
            <button
              type="button"
              onClick={requestCloseAssignmentModal}
              disabled={isSavingAssignments}
              className="text-zinc-400 hover:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
          </div>

          <div className="p-4 border-b border-zinc-100 shrink-0">
            <input
              type="text"
              placeholder={t('hr:workUnits.searchUsers')}
              value={assignmentSearch}
              onChange={(e) => setAssignmentSearch(e.target.value)}
              className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {isLoadingAssignments ? (
              <div className="flex justify-center py-12">
                <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredUsersForAssignment.map((user) => (
                  <label
                    key={user.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      assignedUserIds.includes(user.id)
                        ? 'bg-zinc-50 border-zinc-300 shadow-sm'
                        : 'bg-white border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    <Checkbox
                      checked={assignedUserIds.includes(user.id)}
                      onChange={() => toggleUserAssignment(user.id)}
                    />
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-full bg-zinc-100 text-praetor flex items-center justify-center text-xs font-bold">
                        {user.avatarInitials}
                      </div>
                      <div>
                        <p
                          className={`text-sm font-bold ${assignedUserIds.includes(user.id) ? 'text-praetor' : 'text-zinc-700'}`}
                        >
                          {user.name}
                        </p>
                        <p className="text-xs text-zinc-500">{user.role}</p>
                      </div>
                    </div>
                  </label>
                ))}
                {filteredUsersForAssignment.length === 0 && (
                  <p className="col-span-full text-center text-zinc-400 py-8">
                    {t('hr:workUnits.noUsersFound')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="p-6 border-t border-zinc-100 bg-zinc-50/50 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={requestCloseAssignmentModal}
              disabled={isSavingAssignments}
              className="px-6 py-2.5 text-sm font-bold text-zinc-500 hover:bg-zinc-200 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              type="button"
              onClick={saveAssignments}
              disabled={isLoadingAssignments || isSavingAssignments}
              className="px-8 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-zinc-200 hover:bg-zinc-700 transition-all active:scale-95 disabled:opacity-50"
            >
              {isSavingAssignments ? t('common:buttons.saving') : t('hr:workUnits.saveAssignments')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal isOpen={isDeleteConfirmOpen && !!targetUnit} onClose={requestCloseDeleteConfirm}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="size-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <i className="fa-solid fa-triangle-exclamation text-red-600 text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">
                {t('hr:workUnits.deleteWorkUnit')}
              </h3>
              <p className="text-sm text-zinc-500 mt-2 leading-relaxed">
                {t('hr:workUnits.deleteConfirmMessage', { name: targetUnit?.name })}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={requestCloseDeleteConfirm}
                disabled={isDeleting}
                className="flex-1 py-3 text-sm font-bold text-zinc-500 hover:bg-zinc-50 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95 disabled:opacity-50"
              >
                {isDeleting ? t('common:buttons.saving') : t('hr:workUnits.yesDelete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default WorkUnitsView;
