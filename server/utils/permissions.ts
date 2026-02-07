import { query } from '../db/index.ts';

export type PermissionAction = 'view' | 'create' | 'update' | 'delete';
export type PermissionResource = string;
export type Permission = `${PermissionResource}.${PermissionAction}`;

const CRUD: PermissionAction[] = ['view', 'create', 'update', 'delete'];
const VIEW_ONLY: PermissionAction[] = ['view'];
const VIEW_UPDATE: PermissionAction[] = ['view', 'update'];
const VIEW_UPDATE_DELETE: PermissionAction[] = ['view', 'update', 'delete'];

export type PermissionDefinition = {
  id: PermissionResource;
  actions: PermissionAction[];
  isScope?: boolean;
};

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Timesheets
  { id: 'timesheets.tracker', actions: CRUD },
  { id: 'timesheets.recurring', actions: CRUD },
  { id: 'timesheets.tracker_all', actions: VIEW_ONLY, isScope: true },

  // CRM
  { id: 'crm.clients', actions: CRUD },
  { id: 'crm.clients_all', actions: VIEW_ONLY, isScope: true },
  { id: 'crm.suppliers', actions: CRUD },
  { id: 'crm.suppliers_all', actions: VIEW_ONLY, isScope: true },

  // Sales
  { id: 'sales.client_quotes', actions: CRUD },

  // Catalog
  { id: 'catalog.internal_listing', actions: CRUD },
  { id: 'catalog.external_listing', actions: CRUD },
  { id: 'catalog.special_bids', actions: CRUD },

  // Accounting
  { id: 'accounting.clients_orders', actions: CRUD },
  { id: 'accounting.clients_invoices', actions: CRUD },

  // Finances
  { id: 'finances.payments', actions: CRUD },
  { id: 'finances.expenses', actions: CRUD },

  // Projects
  { id: 'projects.manage', actions: CRUD },
  { id: 'projects.manage_all', actions: VIEW_ONLY, isScope: true },
  { id: 'projects.tasks', actions: CRUD },
  { id: 'projects.tasks_all', actions: VIEW_ONLY, isScope: true },

  // Suppliers
  { id: 'suppliers.quotes', actions: CRUD },

  // HR
  { id: 'hr.internal', actions: CRUD },
  { id: 'hr.external', actions: CRUD },

  // Configuration
  { id: 'configuration.authentication', actions: VIEW_UPDATE },
  { id: 'configuration.general', actions: VIEW_UPDATE },
  { id: 'configuration.user_management', actions: CRUD },
  { id: 'configuration.user_management_all', actions: VIEW_ONLY, isScope: true },
  { id: 'configuration.work_units', actions: CRUD },
  { id: 'configuration.work_units_all', actions: VIEW_ONLY, isScope: true },
  { id: 'configuration.email', actions: VIEW_UPDATE },
  { id: 'configuration.roles', actions: CRUD },

  // Standalone
  { id: 'settings', actions: VIEW_UPDATE },
  { id: 'docs.api', actions: VIEW_ONLY },
  { id: 'docs.frontend', actions: VIEW_ONLY },
  { id: 'notifications', actions: VIEW_UPDATE_DELETE },
];

export const buildPermission = (resource: PermissionResource, action: PermissionAction) =>
  `${resource}.${action}` as Permission;

export const buildPermissions = (resource: PermissionResource, actions: PermissionAction[]) =>
  actions.map((action) => buildPermission(resource, action));

export const ALL_PERMISSIONS: Permission[] = PERMISSION_DEFINITIONS.flatMap((definition) =>
  buildPermissions(definition.id, definition.actions),
);

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  manager: [
    ...buildPermissions('timesheets.tracker', CRUD),
    ...buildPermissions('timesheets.recurring', CRUD),
    ...buildPermissions('crm.clients', CRUD),
    buildPermission('crm.clients_all', 'view'),
    ...buildPermissions('crm.suppliers', CRUD),
    buildPermission('crm.suppliers_all', 'view'),
    ...buildPermissions('sales.client_quotes', CRUD),
    ...buildPermissions('catalog.internal_listing', CRUD),
    ...buildPermissions('catalog.external_listing', CRUD),
    ...buildPermissions('catalog.special_bids', CRUD),
    ...buildPermissions('accounting.clients_orders', CRUD),
    ...buildPermissions('accounting.clients_invoices', CRUD),
    ...buildPermissions('finances.payments', CRUD),
    ...buildPermissions('finances.expenses', CRUD),
    ...buildPermissions('projects.manage', CRUD),
    buildPermission('projects.manage_all', 'view'),
    ...buildPermissions('projects.tasks', CRUD),
    buildPermission('projects.tasks_all', 'view'),
    ...buildPermissions('suppliers.quotes', CRUD),
    ...buildPermissions('hr.internal', CRUD),
    ...buildPermissions('hr.external', CRUD),
    buildPermission('configuration.user_management', 'view'),
    buildPermission('configuration.user_management', 'update'),
    buildPermission('configuration.work_units', 'view'),
    buildPermission('settings', 'view'),
    buildPermission('settings', 'update'),
    buildPermission('docs.api', 'view'),
    buildPermission('docs.frontend', 'view'),
    buildPermission('notifications', 'view'),
    buildPermission('notifications', 'update'),
    buildPermission('notifications', 'delete'),
  ],
  user: [
    ...buildPermissions('timesheets.tracker', CRUD),
    ...buildPermissions('timesheets.recurring', CRUD),
    buildPermission('projects.manage', 'view'),
    buildPermission('projects.tasks', 'view'),
    buildPermission('settings', 'view'),
    buildPermission('settings', 'update'),
    buildPermission('docs.api', 'view'),
    buildPermission('docs.frontend', 'view'),
  ],
  admin: ALL_PERMISSIONS,
};

export const isPermissionKnown = (permission: string) =>
  ALL_PERMISSIONS.includes(permission as Permission);

export const getRolePermissions = async (roleId: string): Promise<Permission[]> => {
  const roleResult = await query('SELECT id, is_admin FROM roles WHERE id = $1', [roleId]);
  if (roleResult.rows.length === 0) return [];

  if (roleResult.rows[0].is_admin) return ALL_PERMISSIONS;

  const permResult = await query('SELECT permission FROM role_permissions WHERE role_id = $1', [
    roleId,
  ]);
  return permResult.rows.map((row) => row.permission) as Permission[];
};

export const hasPermission = (permissions: string[] | undefined, permission: Permission) =>
  !!permissions?.includes(permission);
