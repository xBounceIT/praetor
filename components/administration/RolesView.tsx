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

const MODULE_ICONS: Record<string, string> = {
  timesheets: 'fa-clock',
  crm: 'fa-handshake',
  sales: 'fa-file-invoice-dollar',
  catalog: 'fa-box-open',
  projects: 'fa-folder-tree',
  accounting: 'fa-calculator',
  finances: 'fa-coins',
  hr: 'fa-users-gear',
  configuration: 'fa-gears',
  suppliers: 'fa-truck',
  settings: 'fa-sliders',
  docs: 'fa-book',
  notifications: 'fa-bell',
};

const ALWAYS_GRANTED_MODULES = ['docs', 'settings', 'notifications'];
const ALWAYS_GRANTED_PERMISSIONS = PERMISSION_DEFINITIONS.filter((def) =>
  ALWAYS_GRANTED_MODULES.includes(def.module),
).flatMap((def) => def.actions.map((action) => buildPermission(def.id, action)));

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
      if (ALWAYS_GRANTED_MODULES.includes(definition.module)) return;
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

  const getModuleActions = (module: string): PermissionAction[] => {
    const definitions = groupedPermissions[module] || [];
    const actionsSet = new Set<PermissionAction>();
    definitions.forEach((def) => {
      def.actions.forEach((action) => actionsSet.add(action));
    });
    const canonicalOrder: PermissionAction[] = ['view', 'create', 'update', 'delete'];
    return canonicalOrder.filter((action) => actionsSet.has(action));
  };

  const isAllSelectedForDefinition = (definition: (typeof PERMISSION_DEFINITIONS)[0]) => {
    return definition.actions.every((action) =>
      selectedPermissions.includes(buildPermission(definition.id, action)),
    );
  };

  const toggleAllForDefinition = (definition: (typeof PERMISSION_DEFINITIONS)[0]) => {
    const allSelected = isAllSelectedForDefinition(definition);
    if (allSelected) {
      // Deselect all
      setSelectedPermissions((prev) =>
        prev.filter(
          (p) => !definition.actions.some((a) => buildPermission(definition.id, a) === p),
        ),
      );
    } else {
      // Select all
      const permissionsToAdd = definition.actions.map((action) =>
        buildPermission(definition.id, action),
      );
      setSelectedPermissions((prev) => {
        const newPermissions = [...prev];
        permissionsToAdd.forEach((perm) => {
          if (!newPermissions.includes(perm)) {
            newPermissions.push(perm);
          }
        });
        return newPermissions;
      });
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormErrors({});
    if (!roleName.trim()) {
      setFormErrors({ name: t('common:validation.nameRequired') });
      return;
    }
    try {
      const finalPermissions = Array.from(
        new Set([...selectedPermissions, ...ALWAYS_GRANTED_PERMISSIONS]),
      );
      await onCreateRole(roleName.trim(), finalPermissions);
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
      const finalPermissions = Array.from(
        new Set([...selectedPermissions, ...ALWAYS_GRANTED_PERMISSIONS]),
      );
      await onUpdateRolePermissions(activeRole.id, finalPermissions);
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

  const renderPermissionTabs = () => {
    const currentDefinitions = activeModuleTab ? groupedPermissions[activeModuleTab] || [] : [];
    const currentActions = activeModuleTab ? getModuleActions(activeModuleTab) : [];

    return (
      <div className="flex h-[50vh] border border-slate-200 rounded-xl overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 shrink-0 bg-slate-50 border-r border-slate-200 overflow-y-auto">
          {moduleOrder.map((module) => (
            <button
              key={module}
              type="button"
              onClick={() => setActiveModuleTab(module)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold transition-all text-left ${
                activeModuleTab === module
                  ? 'bg-white text-praetor border-l-[3px] border-l-praetor'
                  : 'text-slate-600 hover:bg-slate-100 border-l-[3px] border-l-transparent'
              }`}
            >
              <i className={`fa-solid ${MODULE_ICONS[module] || 'fa-circle'} w-5 text-center`}></i>
              {t(`layout:modules.${module}`, { defaultValue: toTitleCase(module) })}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-white">
          {activeModuleTab && currentDefinitions.length > 0 && (
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-600">
                    {t('common:labels.name')}
                  </th>
                  {currentActions.map((action) => (
                    <th
                      key={action}
                      className="px-2 py-3 text-center text-xs font-bold text-slate-600 w-16"
                    >
                      {actionLabel(action)}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 w-24">
                    {t('common:table.selectAll')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentDefinitions.map((definition) => {
                  const isAllSelected = isAllSelectedForDefinition(definition);
                  const selectedCount = definition.actions.filter((action) =>
                    selectedPermissions.includes(buildPermission(definition.id, action)),
                  ).length;
                  const hasPartial = selectedCount > 0 && !isAllSelected;

                  return (
                    <tr key={definition.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700">
                            {t(`administration:permissions.${definition.id}`, {
                              defaultValue: formatPermissionLabel(definition.id),
                            })}
                          </span>
                          {definition.isScope && (
                            <span className="px-2 py-0.5 text-xs font-bold bg-amber-100 text-amber-700 rounded-full">
                              {t('administration:roles.scope')}
                            </span>
                          )}
                        </div>
                      </td>
                      {currentActions.map((action) => {
                        const permission = buildPermission(definition.id, action);
                        const isAvailable = definition.actions.includes(action);

                        return (
                          <td key={action} className="px-2 py-3 text-center">
                            {isAvailable ? (
                              <input
                                type="checkbox"
                                checked={selectedPermissions.includes(permission)}
                                onChange={() => togglePermission(permission)}
                                className="w-4 h-4 text-praetor rounded focus:ring-praetor border-gray-300 cursor-pointer"
                              />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleAllForDefinition(definition)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-praetor focus:ring-offset-2 ${
                            isAllSelected
                              ? 'bg-praetor'
                              : hasPartial
                                ? 'bg-praetor/50'
                                : 'bg-slate-200'
                          }`}
                          title={t('common:table.selectAll')}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              isAllSelected || hasPartial ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in duration-200">
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in duration-200">
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
