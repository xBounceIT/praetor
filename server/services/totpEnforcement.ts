import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { type AuthMethod, isTotpApplicable } from '../repositories/usersRepo.ts';
import { ADMIN_ROLE_ID, TOP_MANAGER_ROLE_ID } from '../utils/permissions.ts';

// Centralizes the "require 2FA for administrators" policy so every place a user can gain, retain,
// or activate admin capability (login, role change, role switch, disabling 2FA) enforces it the
// same way. Enforcing only at login leaves bypasses: a multi-role admin could log in under a
// non-admin role, an existing session could be granted an admin role, or an admin could simply
// turn their second factor off — all while the policy says administrators must use 2FA.

// Built-in admin/top-manager role ids are always admin; any custom role via its `is_admin` flag.
const isAdminRoleId = async (roleId: string): Promise<boolean> => {
  if (roleId === ADMIN_ROLE_ID || roleId === TOP_MANAGER_ROLE_ID) return true;
  const role = await rolesRepo.findById(roleId);
  return role?.isAdmin ?? false;
};

// Whether the user can act as an admin through ANY of their roles — their primary role or any role
// they could switch into. Enforcement must consider every assignable admin role, not just the
// active one, or a multi-role admin could dodge the mandate by signing in under a non-admin role.
const userHasAnyAdminRole = async (userId: string, primaryRole: string): Promise<boolean> => {
  if (await isAdminRoleId(primaryRole)) return true;
  const roles = await rolesRepo.listAvailableRolesForUser(userId);
  // Mirror isAdminRoleId for assigned roles too: the built-in admin/top-manager roles are always
  // admin even though the seeded top_manager row carries is_admin = false, so short-circuit their
  // ids here — otherwise an assignable top_manager role would slip past enforcement.
  return roles.some(
    (role) => role.id === ADMIN_ROLE_ID || role.id === TOP_MANAGER_ROLE_ID || role.isAdmin,
  );
};

/** Whether the admin-2FA enforcement policy is currently switched on. */
export const isTotpEnforcedForAdmins = async (): Promise<boolean> => {
  const settings = await generalSettingsRepo.get();
  return settings?.enforceTotpForAdmins ?? false;
};

type AdminUser = { id: string; role: string; authMethod: AuthMethod };

/**
 * Whether the admin-2FA mandate currently applies to this user: TOTP is applicable to their auth
 * method (local/ldap — SSO users are governed by their IdP), enforcement is on, and they hold an
 * admin role (primary or assignable). Independent of whether they have already enrolled — use for
 * "is 2FA required for this admin?" decisions such as blocking a self-service disable. The cheap
 * applicability/enforcement checks run first so the role lookups are skipped when the policy is off.
 */
export const isAdminTotpMandatory = async (user: AdminUser): Promise<boolean> => {
  if (!isTotpApplicable(user.authMethod)) return false;
  if (!(await isTotpEnforcedForAdmins())) return false;
  return userHasAnyAdminRole(user.id, user.role);
};

/**
 * Whether the mandate applies AND the user has not yet enrolled — i.e. they must be routed into
 * enrollment (at login) or have their session revoked (when granted an admin role) before they can
 * exercise admin privileges.
 */
export const requiresAdminTotpEnrollment = async (
  user: AdminUser & { totpEnabled: boolean },
): Promise<boolean> => {
  if (user.totpEnabled) return false;
  return isAdminTotpMandatory(user);
};

/**
 * Whether switching INTO `targetRole` must be blocked because it is an admin role and the caller is
 * an enforced-but-unenrolled user. Closes the role-switch elevation path for sessions that predate
 * enforcement (or a role grant).
 */
export const adminRoleSwitchBlocked = async (
  user: { authMethod: AuthMethod; totpEnabled: boolean },
  targetRole: string,
): Promise<boolean> => {
  if (user.totpEnabled) return false;
  if (!isTotpApplicable(user.authMethod)) return false;
  if (!(await isTotpEnforcedForAdmins())) return false;
  return isAdminRoleId(targetRole);
};
