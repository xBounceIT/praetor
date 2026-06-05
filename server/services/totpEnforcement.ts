import { type DbExecutor, db } from '../db/drizzle.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import { type AuthMethod, isTotpApplicable } from '../repositories/usersRepo.ts';

// Centralizes the 2FA enforcement policy so every place a user can gain, retain, or activate an
// enforced capability (login, role change, role switch, disabling 2FA) enforces it the same way.
// Enforcing only at login leaves bypasses: a multi-role user could log in under a non-enforced role,
// an existing session could be granted an enforced role, or a user could simply turn their second
// factor off — all while the policy says they must use 2FA.
//
// The policy (org-wide, in general_settings) has four inputs:
//   - enableTotp: global feature switch. OFF = no enrollment, no login challenge even for enrolled
//     users, no enforcement (a true kill-switch). All other checks short-circuit to false.
//   - enforceTotp: master enforcement switch.
//   - enforcedRoleIds: roles whose holders must use 2FA. EMPTY = everyone (applicable users).
//   - exemptRoleIds: roles whose holders are never forced (exempt wins over enforced).
// SSO (oidc/saml) users are always exempt via `isTotpApplicable` — their IdP owns MFA.

export type TotpPolicy = {
  enableTotp: boolean;
  enforceTotp: boolean;
  enforcedRoleIds: string[];
  exemptRoleIds: string[];
};

/** Read the org 2FA policy. `enableTotp` defaults to true (feature available, matching pre-policy
 * behavior); the rest default to off/empty. `exec` lets callers read inside an open transaction. */
export const getTotpPolicy = async (exec: DbExecutor = db): Promise<TotpPolicy> => {
  const settings = await generalSettingsRepo.get(exec);
  return {
    enableTotp: settings?.enableTotp ?? true,
    enforceTotp: settings?.enforceTotp ?? false,
    enforcedRoleIds: settings?.totpEnforcedRoleIds ?? [],
    exemptRoleIds: settings?.totpExemptRoleIds ?? [],
  };
};

// Every role id the user can act under: their primary role plus any assignable (multi-)role. Used so
// enforcement considers every role a user could switch into, not just the active one — otherwise a
// multi-role user could dodge the mandate by signing in under a non-enforced role.
const collectUserRoleIds = async (
  userId: string,
  primaryRole: string,
  exec: DbExecutor = db,
): Promise<string[]> => {
  const roles = await rolesRepo.listAvailableRolesForUser(userId, exec);
  return [primaryRole, ...roles.map((role) => role.id)];
};

/**
 * Pure predicate: given the policy and the full set of role ids a user holds, is 2FA required?
 * Exempt wins (any exempt role spares the user); an empty enforced list means everyone. Assumes the
 * feature/enforcement switches and auth-method applicability have NOT yet been checked — callers gate
 * on `enableTotp`/`enforceTotp`/`isTotpApplicable` first (see `isTotpMandatory`).
 */
export const userIsEnforced = (policy: TotpPolicy, roleIds: string[]): boolean => {
  if (roleIds.some((id) => policy.exemptRoleIds.includes(id))) return false;
  if (policy.enforcedRoleIds.length === 0) return true;
  return roleIds.some((id) => policy.enforcedRoleIds.includes(id));
};

/** Whether the global 2FA feature is on. Gates login challenges, enrollment, and the /status card. */
export const isTotpFeatureEnabled = async (exec: DbExecutor = db): Promise<boolean> =>
  (await getTotpPolicy(exec)).enableTotp;

/** Whether enforcement is active at all (feature on AND enforcement on). Cheap early-exit. */
export const isTotpEnforcementActive = async (exec: DbExecutor = db): Promise<boolean> => {
  const policy = await getTotpPolicy(exec);
  return policy.enableTotp && policy.enforceTotp;
};

type PolicyUser = { id: string; role: string; authMethod: AuthMethod };

/**
 * Whether the 2FA mandate currently applies to this user: TOTP is applicable to their auth method
 * (local/ldap — SSO users are governed by their IdP), the feature + enforcement are on, and their
 * role set is enforced (and not exempt). Independent of whether they have already enrolled — use for
 * "is 2FA required for this user?" decisions such as blocking a self-service disable. The cheap
 * applicability/policy checks run first so the role lookup is skipped when nothing is enforced.
 */
export const isTotpMandatory = async (
  user: PolicyUser,
  exec: DbExecutor = db,
): Promise<boolean> => {
  if (!isTotpApplicable(user.authMethod)) return false;
  const policy = await getTotpPolicy(exec);
  if (!policy.enableTotp || !policy.enforceTotp) return false;
  const roleIds = await collectUserRoleIds(user.id, user.role, exec);
  return userIsEnforced(policy, roleIds);
};

/**
 * Whether the mandate applies AND the user has not yet enrolled — i.e. they must be routed into
 * enrollment (at login) or have their credentials revoked (when granted an enforced role) before they
 * can exercise the enforced capability. Pass `exec` (an open transaction) when the decision must be
 * made atomically with the role write that triggered it — the lookups then see the uncommitted roles.
 */
export const requiresTotpEnrollment = async (
  user: PolicyUser & { totpEnabled: boolean },
  exec: DbExecutor = db,
): Promise<boolean> => {
  if (user.totpEnabled) return false;
  return isTotpMandatory(user, exec);
};

/**
 * Whether switching INTO `targetRole` must be blocked because doing so would make an unenrolled user
 * subject to the mandate. Closes the role-switch elevation path for sessions that predate enforcement
 * (or a role grant). Exempt still wins: a user holding an exempt role is never blocked.
 */
export const totpRoleSwitchBlocked = async (
  user: { id: string; authMethod: AuthMethod; totpEnabled: boolean },
  targetRole: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  if (user.totpEnabled) return false;
  if (!isTotpApplicable(user.authMethod)) return false;
  const policy = await getTotpPolicy(exec);
  if (!policy.enableTotp || !policy.enforceTotp) return false;
  // Consider the role they are switching into alongside the roles they already hold (exempt wins).
  const roleIds = await collectUserRoleIds(user.id, targetRole, exec);
  return userIsEnforced(policy, roleIds);
};
