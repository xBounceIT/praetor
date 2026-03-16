import type { View } from '../types';

export type PermissionAction = 'view' | 'create' | 'update' | 'delete';
export type PermissionResource = string;
export type Permission = `${PermissionResource}.${PermissionAction}` | string;

const CRUD: PermissionAction[] = ['view', 'create', 'update', 'delete'];
const VIEW_ONLY: PermissionAction[] = ['view'];
const VIEW_UPDATE: PermissionAction[] = ['view', 'update'];
const VIEW_UPDATE_DELETE: PermissionAction[] = ['view', 'update', 'delete'];

export type PermissionDefinition = {
  id: PermissionResource;
  actions: PermissionAction[];
  isScope?: boolean;
  module: string;
};

const getModuleId = (resource: string) => resource.split('.')[0];
const ADMINISTRATION_MODULE = 'administration';
export const TOP_MANAGER_ROLE_ID = 'top_manager';

export const ALWAYS_GRANTED_MODULES: string[] = ['docs', 'settings', 'notifications'];
export const ROLE_EDITOR_EXCLUDED_MODULES = [...ALWAYS_GRANTED_MODULES, ADMINISTRATION_MODULE];

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Timesheets
  { id: 'timesheets.tracker', actions: CRUD, module: 'timesheets' },
  { id: 'timesheets.recurring', actions: CRUD, module: 'timesheets' },
  { id: 'timesheets.tracker_all', actions: VIEW_ONLY, isScope: true, module: 'timesheets' },

  // CRM
  { id: 'crm.clients', actions: CRUD, module: 'crm' },
  { id: 'crm.clients_all', actions: VIEW_ONLY, isScope: true, module: 'crm' },
  { id: 'crm.suppliers', actions: CRUD, module: 'crm' },
  { id: 'crm.suppliers_all', actions: VIEW_ONLY, isScope: true, module: 'crm' },

  // Sales
  { id: 'sales.client_quotes', actions: CRUD, module: 'sales' },
  { id: 'sales.client_offers', actions: CRUD, module: 'sales' },
  { id: 'sales.supplier_quotes', actions: CRUD, module: 'sales' },
  { id: 'sales.supplier_offers', actions: CRUD, module: 'sales' },

  // Catalog
  { id: 'catalog.internal_listing', actions: CRUD, module: 'catalog' },
  { id: 'catalog.external_listing', actions: CRUD, module: 'catalog' },
  { id: 'catalog.special_bids', actions: CRUD, module: 'catalog' },

  // Accounting
  { id: 'accounting.clients_orders', actions: CRUD, module: 'accounting' },
  { id: 'accounting.clients_invoices', actions: CRUD, module: 'accounting' },
  { id: 'accounting.supplier_orders', actions: CRUD, module: 'accounting' },
  { id: 'accounting.supplier_invoices', actions: CRUD, module: 'accounting' },

  // Projects
  { id: 'projects.manage', actions: CRUD, module: 'projects' },
  { id: 'projects.manage_all', actions: VIEW_ONLY, isScope: true, module: 'projects' },
  { id: 'projects.tasks', actions: CRUD, module: 'projects' },
  { id: 'projects.tasks_all', actions: VIEW_ONLY, isScope: true, module: 'projects' },
  { id: 'projects.assignments', actions: ['update'], module: 'projects' },

  // HR
  { id: 'hr.internal', actions: CRUD, module: 'hr' },
  { id: 'hr.external', actions: CRUD, module: 'hr' },
  { id: 'hr.costs', actions: VIEW_UPDATE, module: 'hr' },
  { id: 'hr.employee_assignments', actions: ['update'], module: 'hr' },
  { id: 'hr.work_units', actions: CRUD, module: 'hr' },
  { id: 'hr.work_units_all', actions: VIEW_ONLY, isScope: true, module: 'hr' },

  // Reports
  { id: 'reports.ai_reporting', actions: ['view', 'create'], module: 'reports' },

  // Administration
  { id: 'administration.authentication', actions: VIEW_UPDATE, module: 'administration' },
  { id: 'administration.general', actions: VIEW_UPDATE, module: 'administration' },
  { id: 'administration.user_management', actions: CRUD, module: 'administration' },
  {
    id: 'administration.user_management_all',
    actions: VIEW_ONLY,
    isScope: true,
    module: 'administration',
  },
  { id: 'administration.email', actions: VIEW_UPDATE, module: 'administration' },
  { id: 'administration.roles', actions: CRUD, module: 'administration' },
  { id: 'administration.logs', actions: VIEW_ONLY, module: 'administration' },

  // Standalone
  { id: 'settings', actions: VIEW_UPDATE, module: getModuleId('settings') },
  { id: 'docs.api', actions: VIEW_ONLY, module: getModuleId('docs.api') },
  { id: 'docs.frontend', actions: VIEW_ONLY, module: getModuleId('docs.frontend') },
  { id: 'notifications', actions: VIEW_UPDATE_DELETE, module: getModuleId('notifications') },
];

export const buildPermission = (resource: PermissionResource, action: PermissionAction) =>
  `${resource}.${action}` as Permission;

export const buildPermissions = (resource: PermissionResource, actions: PermissionAction[]) =>
  actions.map((action) => buildPermission(resource, action));

export const ALL_PERMISSIONS: Permission[] = PERMISSION_DEFINITIONS.flatMap((definition) =>
  buildPermissions(definition.id, definition.actions),
);

export const CONFIGURATION_PERMISSIONS: Permission[] = PERMISSION_DEFINITIONS.filter((def) =>
  def.id.startsWith('administration.'),
).flatMap((def) => buildPermissions(def.id, def.actions));

export const isTopManagerOnlyPermission = (permission: string) =>
  permission.startsWith('hr.work_units.') || permission.startsWith('hr.work_units_all.');

export const formatPermissionLabel = (resource: string) => {
  const parts = resource.split('.');
  const resourceName = parts.length > 1 ? parts.slice(1).join('.') : parts[0];
  if (resourceName.endsWith('_all')) {
    const base = resourceName.replace('_all', '');
    return `${toTitleCase(base)} (All)`;
  }
  return toTitleCase(resourceName).replace(/\bApi\b/, 'API');
};

const toTitleCase = (value: string) =>
  value
    .split('_')
    .map((word) => (word.length ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');

export const hasPermission = (permissions: Permission[] | undefined, permission: Permission) =>
  permissions?.includes(permission) ?? false;

export const hasAnyPermission = (permissions: Permission[] | undefined, required: Permission[]) =>
  required.some((permission) => hasPermission(permissions, permission));

export const VIEW_PERMISSION_MAP: Record<View, Permission> = {
  'timesheets/tracker': buildPermission('timesheets.tracker', 'view'),
  'timesheets/recurring': buildPermission('timesheets.recurring', 'view'),
  'administration/authentication': buildPermission('administration.authentication', 'view'),
  'administration/general': buildPermission('administration.general', 'view'),
  'administration/user-management': buildPermission('administration.user_management', 'view'),
  'administration/email': buildPermission('administration.email', 'view'),
  'administration/roles': buildPermission('administration.roles', 'view'),
  'administration/logs': buildPermission('administration.logs', 'view'),
  'crm/clients': buildPermission('crm.clients', 'view'),
  'crm/suppliers': buildPermission('crm.suppliers', 'view'),
  'sales/client-quotes': buildPermission('sales.client_quotes', 'view'),
  'sales/client-offers': buildPermission('sales.client_offers', 'view'),
  'sales/supplier-quotes': buildPermission('sales.supplier_quotes', 'view'),
  'sales/supplier-offers': buildPermission('sales.supplier_offers', 'view'),
  'catalog/internal-listing': buildPermission('catalog.internal_listing', 'view'),
  'catalog/external-listing': buildPermission('catalog.external_listing', 'view'),
  'catalog/special-bids': buildPermission('catalog.special_bids', 'view'),
  'accounting/clients-orders': buildPermission('accounting.clients_orders', 'view'),
  'accounting/clients-invoices': buildPermission('accounting.clients_invoices', 'view'),
  'accounting/supplier-orders': buildPermission('accounting.supplier_orders', 'view'),
  'accounting/supplier-invoices': buildPermission('accounting.supplier_invoices', 'view'),
  'projects/manage': buildPermission('projects.manage', 'view'),
  'projects/tasks': buildPermission('projects.tasks', 'view'),
  'hr/internal': buildPermission('hr.internal', 'view'),
  'hr/external': buildPermission('hr.external', 'view'),
  'hr/work-units': buildPermission('hr.work_units', 'view'),
  'reports/ai-reporting': buildPermission('reports.ai_reporting', 'view'),
  settings: buildPermission('settings', 'view'),
  'docs/api': buildPermission('docs.api', 'view'),
  'docs/frontend': buildPermission('docs.frontend', 'view'),
};
