import * as rolesRepo from '../repositories/rolesRepo.ts';
import { createChildLogger } from './logger.ts';

const logger = createChildLogger({ module: 'permissions' });

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

export const TOP_MANAGER_ROLE_ID = 'top_manager';
export const ADMIN_ROLE_ID = 'admin';

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Timesheets
  { id: 'timesheets.tracker', actions: CRUD },
  { id: 'timesheets.ril', actions: VIEW_ONLY },
  { id: 'timesheets.recurring', actions: CRUD },
  { id: 'timesheets.tracker_all', actions: CRUD, isScope: true },
  { id: 'timesheets.expired_projects', actions: ['create'] },

  // CRM
  { id: 'crm.clients', actions: CRUD },
  { id: 'crm.clients_all', actions: CRUD, isScope: true },
  { id: 'crm.suppliers', actions: CRUD },
  { id: 'crm.suppliers_all', actions: CRUD, isScope: true },

  // Sales
  { id: 'sales.client_quotes', actions: CRUD },
  { id: 'sales.client_offers', actions: CRUD },
  { id: 'sales.supplier_quotes', actions: CRUD },

  // Catalog
  { id: 'catalog.internal_listing', actions: CRUD },

  // Accounting
  { id: 'accounting.clients_orders', actions: CRUD },
  { id: 'accounting.clients_invoices', actions: CRUD },
  { id: 'accounting.supplier_orders', actions: CRUD },
  { id: 'accounting.supplier_invoices', actions: CRUD },

  // Projects
  { id: 'projects.manage', actions: CRUD },
  { id: 'projects.manage_all', actions: CRUD, isScope: true },
  { id: 'projects.resales', actions: CRUD },
  { id: 'projects.tasks', actions: CRUD },
  { id: 'projects.tasks_all', actions: CRUD, isScope: true },
  { id: 'projects.rules', actions: CRUD },
  // `view` lets a role load any project/activity's assignment dialog regardless of
  // per-entity membership (role-agnostic); `update` additionally permits editing.
  { id: 'projects.assignments', actions: VIEW_UPDATE },

  // HR
  { id: 'hr.internal', actions: VIEW_UPDATE },
  { id: 'hr.external', actions: CRUD },
  { id: 'hr.costs', actions: VIEW_UPDATE },
  { id: 'hr.costs_all', actions: VIEW_UPDATE, isScope: true },
  { id: 'hr.employee_assignments', actions: ['update'] },
  { id: 'hr.work_units', actions: CRUD },
  { id: 'hr.work_units_all', actions: CRUD, isScope: true },

  // Reports
  { id: 'reports.ai_reporting', actions: ['view', 'create'] },
  // `reports.cost.view` gates exposure of per-entry / aggregated *cost* numbers
  // (duration * hourly_cost) - kept separate from `hr.costs` because someone can be
  // allowed to read cost roll-ups in reports without being trusted to set per-user
  // hourly cost rates.
  { id: 'reports.cost', actions: ['view'] },

  // Administration
  { id: 'administration.authentication', actions: VIEW_UPDATE },
  { id: 'administration.general', actions: VIEW_UPDATE },
  { id: 'administration.user_management', actions: CRUD },
  { id: 'administration.user_management_all', actions: VIEW_ONLY, isScope: true },
  { id: 'administration.email', actions: VIEW_UPDATE },
  { id: 'administration.roles', actions: CRUD },
  { id: 'administration.logs', actions: VIEW_ONLY },
  { id: 'administration.webhooks', actions: CRUD },

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

export const ADMINISTRATION_PERMISSIONS: Permission[] = PERMISSION_DEFINITIONS.reduce<Permission[]>(
  (permissions, def) => {
    if (def.id.startsWith('administration.')) {
      permissions.push(...buildPermissions(def.id, def.actions));
    }
    return permissions;
  },
  [],
);

export const ADMIN_BASE_PERMISSIONS: Permission[] = [
  ...buildPermissions('settings', VIEW_UPDATE),
  ...buildPermissions('docs.api', VIEW_ONLY),
  ...buildPermissions('docs.frontend', VIEW_ONLY),
  ...buildPermissions('notifications', VIEW_UPDATE_DELETE),
];

export const ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS: Permission[] = buildPermissions(
  'notifications',
  VIEW_UPDATE_DELETE,
);

const LEGACY_PERMISSION_REWRITES: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'configuration.', to: 'administration.' },
  { from: 'suppliers.quotes.', to: 'sales.supplier_quotes.' },
];

const defaultLegacyPermissionWarner = (legacy: string, normalized: string) => {
  logger.warn(
    { legacyPermission: legacy, normalizedPermission: normalized },
    'Encountered legacy permission name; rewrote on the fly. Update stored values and callers to use the new name — silent rewrites will be removed in a future release.',
  );
};

let warnOnLegacyPermission = defaultLegacyPermissionWarner;

// Dedupe legacy-permission warnings: `normalizePermission` is on the auth hot path
// (every `hasPermission`/`getRolePermissions` call), so a single stale DB row or
// hardcoded legacy name would otherwise log on every request. Only known legacy
// permissions get recorded — otherwise `roles.ts` validation flow would let a
// privileged caller flood this set with `configuration.<random>.<random>` strings
// before the unknown-permission check rejects them.
const KNOWN_PERMISSIONS_SET = new Set<string>(ALL_PERMISSIONS);
const warnedLegacyPermissions = new Set<string>();

export const __resetLegacyPermissionWarningsForTests = () => {
  warnedLegacyPermissions.clear();
};

// Bun shares the module cache across test files, so `mock.module('logger.ts')` cannot
// reach the child logger captured at this module's load time. Injecting the warner is
// the only way to assert the warning fires in the multi-file suite.
export const __setLegacyPermissionWarnerForTests = (
  warner: ((legacy: string, normalized: string) => void) | null,
) => {
  warnOnLegacyPermission = warner ?? defaultLegacyPermissionWarner;
};

export const normalizePermission = (permission: string): Permission => {
  for (const { from, to } of LEGACY_PERMISSION_REWRITES) {
    if (!permission.startsWith(from)) continue;
    const normalized = (to + permission.slice(from.length)) as Permission;
    if (KNOWN_PERMISSIONS_SET.has(normalized) && !warnedLegacyPermissions.has(permission)) {
      warnedLegacyPermissions.add(permission);
      warnOnLegacyPermission(permission, normalized);
    }
    return normalized;
  }
  return permission as Permission;
};

export const isTopManagerOnlyPermission = (permission: string) => {
  const matchesResource = (resource: string) =>
    permission === resource || permission.startsWith(`${resource}.`);
  return matchesResource('hr.work_units') || matchesResource('hr.work_units_all');
};

export const isPermissionKnown = (permission: string) =>
  ALL_PERMISSIONS.includes(normalizePermission(permission));

export const getRolePermissions = async (roleId: string): Promise<Permission[]> => {
  // Auth hot path - parallelize the role and permissions lookups.
  const [role, rawExplicit] = await Promise.all([
    rolesRepo.findById(roleId),
    rolesRepo.listExplicitPermissions(roleId),
  ]);
  if (!role) return [];

  const explicit = rawExplicit.map((p) => normalizePermission(p) as Permission);

  const withNotifications = Array.from(
    new Set([...explicit, ...ALWAYS_GRANTED_NOTIFICATION_PERMISSIONS]),
  );

  if (role.isAdmin) {
    return Array.from(
      new Set([...ADMINISTRATION_PERMISSIONS, ...ADMIN_BASE_PERMISSIONS, ...withNotifications]),
    );
  }

  return withNotifications;
};

export const hasPermission = (permissions: string[] | undefined, permission: Permission | string) =>
  !!permissions?.includes(normalizePermission(permission));

export const scopeResourceFor = (resource: PermissionResource): PermissionResource | undefined => {
  const scoped = `${resource}_all`;
  return PERMISSION_DEFINITIONS.some((definition) => definition.id === scoped) ? scoped : undefined;
};

export const equivalentPermissionsFor = (
  resource: PermissionResource,
  action: PermissionAction,
): Permission[] => {
  const permissions = [buildPermission(resource, action)];
  const scopeResource = scopeResourceFor(resource);
  if (scopeResource) permissions.push(buildPermission(scopeResource, action));
  return permissions;
};

export const hasAnyPermission = (permissions: string[] | undefined, required: string[]) =>
  required.some((permission) => hasPermission(permissions, permission));

export const hasScopedActionPermission = (
  permissions: string[] | undefined,
  resource: PermissionResource,
  action: PermissionAction,
) => hasAnyPermission(permissions, equivalentPermissionsFor(resource, action));

export const requestHasPermission = (
  request: { user?: { permissions?: string[] } },
  permission: Permission | string,
) => hasPermission(request.user?.permissions, permission);

// Duck-typed locally so this module doesn't pull in `fastify` and create an import cycle.
type RequestWithUser = { user?: { id?: string; permissions?: string[] } };

type AssignmentCheck = (userId: string, entityId: string) => Promise<boolean>;

// Grants access either via the wide "*_all" scope permission or via a per-entity assignment
// lookup. Pass `repoFn` as a forwarding arrow (not a direct module reference) so test
// `mock.module` replacements resolve at call time, not at factory-invocation time.
export const makeAccessChecker = (
  repoFn: AssignmentCheck,
  defaultAllScopePermission: Permission | string,
) => {
  return (
    request: RequestWithUser,
    entityId: string,
    allScopePermission: Permission | string = defaultAllScopePermission,
  ): Promise<boolean> => {
    if (requestHasPermission(request, allScopePermission)) return Promise.resolve(true);
    const userId = request.user?.id;
    if (!userId) return Promise.resolve(false);
    return repoFn(userId, entityId);
  };
};
