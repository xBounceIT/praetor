import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Role } from '../../types';
import Modal from '../shared/Modal';
import Tooltip from '../shared/Tooltip';
import {
  PERMISSION_DEFINITIONS,
  PermissionAction,
  buildPermission,
  formatPermissionLabel,
  hasPermission,
} from '../../utils/permissions';

interface RolesViewProps {
  roles: Role[];
  permissions: string[];
  onCreateRole: (name: string, permissions: string[]) => Promise<void>;
  onRenameRole: (id: string, name: string) => Promise<void>;
  onUpdateRolePermissions: (id: string, permissions: string[]) => Promise<void>;
  onDeleteRole: (id: string) => Promise<void>;
}

const toTitleCase = (value: string) =>
  value
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ''))
    .join(' ');

const RolesView: React.FC<RolesViewProps> = ({
  roles,
  permissions,
  onCreateRole,
  onRenameRole,
  onUpdateRolePermissions,
  onDeleteRole,
}) => {
  const { t } = useTranslation(['common', 'layout', 'administration']);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isPermissionsOpen, setIsPermissionsOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [activeModuleTab, setActiveModuleTab] = useState<string>('');

  const { groupedPermissions, moduleOrder } = useMemo(() => {
    const grouped: Record<string, typeof PERMISSION_DEFINITIONS> = {};
    const order: string[] = [];
    PERMISSION_DEFINITIONS.forEach((definition) => {
      if (!grouped[definition.module]) {
        grouped[definition.module] = [];
        order.push(definition.module);
      }
      grouped[definition.module].push(definition);
    });
    return { groupedPermissions: grouped, moduleOrder: order };
  }, []);

  const canCreateRoles = hasPermission(
    permissions,
    buildPermission('configuration.roles', 'create'),
  );
  const canUpdateRoles = hasPermission(
    permissions,
    buildPermission('configuration.roles', 'update'),
  );
  const canDeleteRoles = hasPermission(
    permissions,
    buildPermission('configuration.roles', 'delete'),
  );

  const actionLabel = (action: PermissionAction) => {
    switch (action) {
      case 'create':
        return t('common:buttons.create');
      case 'update':
        return t('common:buttons.update');
      case 'delete':
        return t('common:buttons.delete');
      case 'view':
      default:
        return t('common:buttons.view');
    }
  };

  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => a.name.localeCompare(b.name));
  }, [roles]);

  const openCreateModal = () => {
    if (!canCreateRoles) return;
    setActiveRole(null);
    setRoleName('');
    setSelectedPermissions([]);
    setFormErrors({});
    setActiveModuleTab(moduleOrder[0] || '');
    setIsCreateOpen(true);
  };

  const openRenameModal = (role: Role) => {
    if (!canUpdateRoles || role.isAdmin || role.isSystem) return;
    setActiveRole(role);
    setRoleName(role.name);
    setFormErrors({});
    setIsRenameOpen(true);
  };

  const openPermissionsModal = (role: Role) => {
    if (!canUpdateRoles) return;
    setActiveRole(role);
    setSelectedPermissions(role.permissions || []);
    setFormErrors({});
    setActiveModuleTab(moduleOrder[0] || '');
    setIsPermissionsOpen(true);
  };

  const openDeleteModal = (role: Role) => {
    if (!canDeleteRoles || role.isAdmin || role.isSystem) return;
    setActiveRole(role);
    setFormErrors({});
    setIsDeleteConfirmOpen(true);
  };

  const togglePermission = (permission: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission],
    );
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormErrors({});
    if (!roleName.trim()) {
      setFormErrors({ name: t('common:validation.nameRequired') });
      return;
    }
    try {
      await onCreateRole(roleName.trim(), selectedPermissions);
      setIsCreateOpen(false);
    } catch (err) {
      console.error('Failed to create role', err);
      setFormErrors({ general: t('common:messages.errorOccurred') });
    }
  };

  const handleRename = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormErrors({});
    if (!activeRole) return;
    if (!roleName.trim()) {
      setFormErrors({ name: t('common:validation.nameRequired') });
      return;
    }
    try {
      await onRenameRole(activeRole.id, roleName.trim());
      setIsRenameOpen(false);
      setActiveRole(null);
    } catch (err) {
      console.error('Failed to rename role', err);
      setFormErrors({ general: t('common:messages.errorOccurred') });
    }
  };

  const handleUpdatePermissions = async () => {
    setFormErrors({});
    if (!activeRole) return;
    try {
      await onUpdateRolePermissions(activeRole.id, selectedPermissions);
      setIsPermissionsOpen(false);
      setActiveRole(null);
    } catch (err) {
      console.error('Failed to update role permissions', err);
      setFormErrors({ general: t('common:messages.errorOccurred') });
    }
  };

  const handleDelete = async () => {
    setFormErrors({});
    if (!activeRole) return;
    try {
      await onDeleteRole(activeRole.id);
      setIsDeleteConfirmOpen(false);
      setActiveRole(null);
    } catch (err) {
      console.error('Failed to delete role', err);
      setFormErrors({ general: t('common:messages.errorOccurred') });
    }
  };

  const renderPermissionTabs = () => (
    <div className="space-y-4">
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
        {moduleOrder.map((module) => (
          <button
            key={module}
            type="button"
            onClick={() => setActiveModuleTab(module)}
            className={`pb-3 px-3 text-sm font-bold transition-all relative whitespace-nowrap ${activeModuleTab === module ? 'text-praetor' : 'text-slate-400 hover:text-slate-600'}`}
          >
            {t(`layout:modules.${module}`, { defaultValue: toTitleCase(module) })}
            {activeModuleTab === module && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-praetor rounded-full"></div>
            )}
          </button>
        ))}
      </div>
      {activeModuleTab && groupedPermissions[activeModuleTab] && (
        <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2">
          {groupedPermissions[activeModuleTab].map((definition) => (
            <div key={definition.id} className="border border-slate-200 rounded-xl p-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  {formatPermissionLabel(definition.id)}
                </span>
                <div className="flex flex-wrap gap-4">
                  {definition.actions.map((action) => {
                    const permission = buildPermission(definition.id, action);
                    return (
                      <label
                        key={permission}
                        className="flex items-center gap-2 text-sm text-slate-600"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(permission)}
                          onChange={() => togglePermission(permission)}
                          className="w-4 h-4 text-praetor rounded focus:ring-praetor border-gray-300"
                        />
                        {actionLabel(action)}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">
            {t('administration:roles.title')}
          </h2>
          <p className="text-slate-500 font-medium">{t('administration:roles.subtitle')}</p>
        </div>
        {canCreateRoles && (
          <button
            onClick={openCreateModal}
            className="px-6 py-3 bg-praetor text-white font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('common:buttons.create')}
          </button>
        )}
      </div>

      {sortedRoles.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-400">
          {t('common:emptyStates.noItems')}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedRoles.map((role) => {
            const canRenameRole = canUpdateRoles && !role.isAdmin && !role.isSystem;
            const canEditPermissions = canUpdateRoles;
            const canRemoveRole = canDeleteRoles && !role.isAdmin && !role.isSystem;
            return (
              <div
                key={role.id}
                className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 text-praetor flex items-center justify-center text-xl">
                    <i className="fa-solid fa-user-shield"></i>
                  </div>
                  {(canRenameRole || canEditPermissions || canRemoveRole) && (
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {canRenameRole && (
                        <Tooltip label={t('common:buttons.edit')}>
                          {() => (
                            <button
                              onClick={() => openRenameModal(role)}
                              className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 hover:text-praetor hover:bg-slate-100 flex items-center justify-center transition-colors"
                            >
                              <i className="fa-solid fa-pen"></i>
                            </button>
                          )}
                        </Tooltip>
                      )}
                      {canEditPermissions && (
                        <Tooltip label={t('administration:roles.permissions')}>
                          {() => (
                            <button
                              onClick={() => openPermissionsModal(role)}
                              className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 hover:text-praetor hover:bg-slate-100 flex items-center justify-center transition-colors"
                            >
                              <i className="fa-solid fa-shield"></i>
                            </button>
                          )}
                        </Tooltip>
                      )}
                      {canRemoveRole && (
                        <Tooltip label={t('common:buttons.delete')}>
                          {() => (
                            <button
                              onClick={() => openDeleteModal(role)}
                              className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                            >
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          )}
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>

                <h3 className="text-lg font-bold text-slate-800 mb-2">{role.name}</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {role.isSystem && (
                    <span className="px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500">
                      {t('administration:roles.badges.system')}
                    </span>
                  )}
                  {role.isAdmin && (
                    <span className="px-2 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                      {t('administration:roles.badges.admin')}
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-500">
                  {t('administration:roles.permissionCount', {
                    count: role.permissions?.length || 0,
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in duration-200">
          <form onSubmit={handleCreate}>
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {t('administration:roles.createRole')}
                </h3>
                <p className="text-sm text-slate-500">
                  {t('administration:roles.createRoleSubtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  {t('common:labels.name')}
                </label>
                <input
                  type="text"
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                  placeholder={t('common:form.placeholderName')}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                />
                {formErrors.name && <p className="text-sm text-red-500 mt-1">{formErrors.name}</p>}
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-700">
                  {t('administration:roles.permissions')}
                </h4>
                {renderPermissionTabs()}
              </div>
              {formErrors.general && <p className="text-sm text-red-500">{formErrors.general}</p>}
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                className="px-8 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
              >
                {t('common:buttons.create')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isRenameOpen && !!activeRole} onClose={() => setIsRenameOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
          <form onSubmit={handleRename}>
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {t('administration:roles.renameRole')}
                </h3>
                <p className="text-sm text-slate-500">
                  {t('administration:roles.renameRoleSubtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRenameOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  {t('common:labels.name')}
                </label>
                <input
                  type="text"
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                  placeholder={t('common:form.placeholderName')}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                />
                {formErrors.name && <p className="text-sm text-red-500 mt-1">{formErrors.name}</p>}
              </div>
              {formErrors.general && <p className="text-sm text-red-500">{formErrors.general}</p>}
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsRenameOpen(false)}
                className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                className="px-8 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
              >
                {t('common:buttons.update')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={isPermissionsOpen && !!activeRole} onClose={() => setIsPermissionsOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('administration:roles.editPermissions')}
              </h3>
              <p className="text-sm text-slate-500">{activeRole?.name}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsPermissionsOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
          </div>
          <div className="p-6 space-y-4">
            {renderPermissionTabs()}
            {formErrors.general && <p className="text-sm text-red-500">{formErrors.general}</p>}
          </div>
          <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsPermissionsOpen(false)}
              className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              type="button"
              onClick={handleUpdatePermissions}
              className="px-8 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
            >
              {t('common:buttons.save')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isDeleteConfirmOpen && !!activeRole}
        onClose={() => setIsDeleteConfirmOpen(false)}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <i className="fa-solid fa-triangle-exclamation text-red-600 text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('administration:roles.deleteRole')}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('common:messages.deleteConfirmNamed', { name: activeRole?.name })}
              </p>
            </div>
            {formErrors.general && <p className="text-sm text-red-500">{formErrors.general}</p>}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('common:buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default RolesView;
