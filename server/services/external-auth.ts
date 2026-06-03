import { type DbExecutor, withDbTransaction } from '../db/drizzle.ts';
import type { SsoProtocol } from '../db/schema/sso.ts';
import * as externalIdentitiesRepo from '../repositories/externalIdentitiesRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as settingsRepo from '../repositories/settingsRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { computeAvatarInitials } from '../utils/initials.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

export const DEFAULT_ROLE_ID = 'user';

// Discriminant for failure modes from `resolveExternalIdentity`. Lets callers map domain-level
// failures (missing claims, conflict, disabled) to transport-level codes (HTTP redirect / status)
// without depending on the human-readable English message text.
export type ExternalAuthErrorCode =
  | 'missing_username'
  | 'missing_subject'
  | 'user_disabled'
  | 'identity_conflict';

export class ExternalAuthError extends Error {
  readonly code: ExternalAuthErrorCode;
  constructor(message: string, code: ExternalAuthErrorCode) {
    super(message);
    this.name = 'ExternalAuthError';
    this.code = code;
  }
}

export type ExternalRoleMapping = {
  externalGroup: string;
  role: string;
};

export type ResolvedExternalUser = usersRepo.AuthUser & {
  wasCreated: boolean;
  wasBound: boolean;
};

export type ResolveExternalIdentityInput = {
  providerId: string;
  protocol: SsoProtocol;
  issuer: string;
  subject: string;
  username: string;
  name?: string;
  email?: string;
  groups: string[];
  roleMappings: ExternalRoleMapping[];
};

const IDENTITY_NOT_ALLOWED_MESSAGE = 'External identity is not allowed for this Praetor user';

const assertUserAllowsExternalProvider = (
  user: Pick<usersRepo.LoginUserWithAuth, 'employeeType' | 'authMethod' | 'authProviderId'>,
  input: ResolveExternalIdentityInput,
): void => {
  if (
    user.employeeType !== 'app_user' ||
    user.authMethod !== input.protocol ||
    user.authProviderId !== input.providerId
  ) {
    throw new ExternalAuthError(IDENTITY_NOT_ALLOWED_MESSAGE, 'identity_conflict');
  }
};

const isUsernameUniqueViolation = (err: unknown): boolean => {
  const dup = getUniqueViolation(err);
  return (
    dup?.constraint === 'users_username_unique' ||
    dup?.constraint === 'users_username_key' ||
    // Functional unique index from migration 0054; Postgres reports this constraint
    // name on case-insensitive username collisions and the `(username)` detail
    // substring isn't reliable for the `(lower(username))` expression form.
    dup?.constraint === 'idx_users_username_lower_unique' ||
    !!dup?.detail?.includes('(username)') ||
    !!dup?.detail?.includes('(lower(username))')
  );
};

export const normalizeExternalUsername = (username: string): string =>
  username.trim().toLowerCase();

const normalizeGroup = (value: string): string => value.trim().toLowerCase();

const getGroupAliases = (group: string): string[] => {
  const normalized = normalizeGroup(group);
  if (!normalized) return [];
  const aliases = new Set([normalized]);
  const firstRdn = normalized.split(',')[0]?.trim();
  if (firstRdn) aliases.add(firstRdn);
  if (firstRdn?.startsWith('cn=')) aliases.add(firstRdn.slice(3));
  return [...aliases];
};

const mappingMatchesGroup = (mappingGroup: string, userGroup: string): boolean => {
  const mapping = normalizeGroup(mappingGroup);
  if (!mapping) return false;
  const aliases = getGroupAliases(userGroup);
  if (aliases.includes(mapping)) return true;
  return aliases.some((alias) => alias.startsWith(`${mapping},`));
};

export const mapExternalGroupsToMatchedRoleIds = (
  groups: string[],
  mappings: ExternalRoleMapping[],
): string[] => {
  const roleIds: string[] = [];
  const roleIdSet = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping.externalGroup?.trim() || !mapping.role?.trim()) continue;
    if (groups.some((group) => mappingMatchesGroup(mapping.externalGroup, group))) {
      if (!roleIdSet.has(mapping.role)) {
        roleIdSet.add(mapping.role);
        roleIds.push(mapping.role);
      }
    }
  }
  return roleIds;
};

export const filterToExistingRoleIds = async (roleIds: string[]): Promise<string[]> => {
  if (roleIds.length === 0) return [];
  const existing = await rolesRepo.findExistingIds(roleIds);
  return roleIds.filter((roleId) => existing.has(roleId));
};

export const mapExternalGroupsToRoleIds = (
  groups: string[],
  mappings: ExternalRoleMapping[],
): string[] => {
  const matched = mapExternalGroupsToMatchedRoleIds(groups, mappings);
  return matched.length > 0 ? matched : [DEFAULT_ROLE_ID];
};

export const filterExistingRoleIds = async (roleIds: string[]): Promise<string[]> => {
  const filtered = await filterToExistingRoleIds(roleIds);
  return filtered.length > 0 ? filtered : [DEFAULT_ROLE_ID];
};

const writeExternalRoleIdsTx = async (
  userId: string,
  roleIds: string[],
  tx: DbExecutor,
  primaryRoleId: string = roleIds[0],
): Promise<void> => {
  await usersRepo.replaceUserRoles(userId, roleIds, tx);
  await usersRepo.setPrimaryRole(userId, primaryRoleId, tx);
  await userAssignmentsRepo.syncTopManagerAssignmentsForUser(userId, tx);
};

const writeExternalRoleIds = (userId: string, roleIds: string[]): Promise<void> =>
  withDbTransaction((tx) => writeExternalRoleIdsTx(userId, roleIds, tx));

const syncExternalProfileTx = async (
  userId: string,
  input: Pick<ResolveExternalIdentityInput, 'name' | 'email'>,
  tx: DbExecutor,
): Promise<{ name?: string; avatarInitials?: string }> => {
  const name = input.name?.trim();
  const email = input.email?.trim();
  if (!name && !email) return {};

  const avatarInitials = name ? computeAvatarInitials(name) : undefined;
  if (name) {
    await usersRepo.updateDirectoryProfile(userId, { name, avatarInitials }, tx);
  }
  await settingsRepo.upsertForUser(
    userId,
    { fullName: name || null, email: email || null, language: null },
    tx,
  );
  return name ? { name, avatarInitials } : {};
};

const applyExternalRoleIdsForUser = async (
  userId: string,
  roleIds: string[],
): Promise<string[]> => {
  const mappedRoleIds = await filterExistingRoleIds(roleIds);
  await writeExternalRoleIds(userId, mappedRoleIds);
  return mappedRoleIds;
};

export const applyExternalRolesForUser = (
  userId: string,
  groups: string[],
  mappings: ExternalRoleMapping[],
): Promise<string[]> =>
  applyExternalRoleIdsForUser(userId, mapExternalGroupsToRoleIds(groups, mappings));

// True when the user's external groups produce zero usable roles AND the admin has at
// least one role mapping configured — i.e., the admin's stated intent is "users should
// get a role from their groups" and the current config no longer satisfies it (no group
// matches, or every matched mapping points at a role that has since been deleted). When
// no role mappings are configured at all, returns false: the admin is intentionally
// relying on Praetor-side role assignment and doesn't need a per-login warning. Shared
// across the LDAP login, sync, bind, and the auth-route diagnostic so all sites emit (or
// suppress) the warning consistently for the same inputs.
export const externalGroupsYieldNoKnownRole = async (
  groups: string[],
  mappings: ExternalRoleMapping[],
): Promise<boolean> => {
  if (mappings.length === 0) return false;
  const matched = mapExternalGroupsToMatchedRoleIds(groups, mappings);
  if (matched.length === 0) return true;
  const existing = await filterToExistingRoleIds(matched);
  return existing.length === 0;
};

// IfMatched helper: only writes user_roles when the supplied groups actually map to at
// least one existing role. Returns { applied: false } when no group matched (or the
// matched roles have since been deleted), so callers can keep the user's current roles
// intact. Used at LDAP "first provisioning" bootstrap points where we want to seed roles
// from external groups but not clobber admin-assigned roles when the groups don't yield
// anything usable:
//   - server/routes/users.ts: admin-driven "Change authentication method" to LDAP.
//   - server/services/ldap.ts: LDAP create-race recovery for the losing concurrent login.
// (SSO role writes live in resolveExternalIdentity below, gated on wasCreated, and do not
// route through this helper.)
export const applyExternalRolesForUserIfMatched = async (
  userId: string,
  groups: string[],
  mappings: ExternalRoleMapping[],
): Promise<{ applied: boolean; roleIds: string[] }> => {
  const matched = await filterToExistingRoleIds(
    mapExternalGroupsToMatchedRoleIds(groups, mappings),
  );
  if (matched.length === 0) return { applied: false, roleIds: [] };
  await writeExternalRoleIds(userId, matched);
  return { applied: true, roleIds: matched };
};

export const resolveExternalIdentity = async (
  input: ResolveExternalIdentityInput,
): Promise<ResolvedExternalUser> => {
  const username = input.username.trim();
  const normalizedUsername = normalizeExternalUsername(username);
  if (!normalizedUsername) {
    throw new ExternalAuthError('External identity did not include a username', 'missing_username');
  }
  if (!input.subject.trim()) {
    throw new ExternalAuthError('External identity did not include a subject', 'missing_subject');
  }

  const resolveInTransaction = () =>
    withDbTransaction(async (tx) => {
      const existingIdentity = await externalIdentitiesRepo.findByIdentity(
        {
          providerId: input.providerId,
          protocol: input.protocol,
          issuer: input.issuer,
          subject: input.subject,
        },
        tx,
      );

      let user: usersRepo.LoginUserWithAuth | null = null;
      let wasCreated = false;
      let wasBound = false;
      // Role mapping is bootstrap-only — `matchedRoleIds` is only consulted when this
      // request is the one that creates the Praetor user. Compute lazily inside the
      // create branch so existing-user logins (the common case) skip the
      // rolesRepo.findExistingIds DB roundtrip.
      let matchedRoleIds: string[] = [];

      if (existingIdentity) {
        user = await usersRepo.findLoginUserById(existingIdentity.userId, tx);
        if (!user) {
          throw new ExternalAuthError('Bound Praetor user no longer exists', 'identity_conflict');
        }
        assertUserAllowsExternalProvider(user, input);
      } else {
        user = await usersRepo.findLoginUserByNormalizedUsername(normalizedUsername, tx);
        if (!user) {
          // Filter empty when no SSO group mapped to a known Praetor role; new users
          // still fall back to DEFAULT_ROLE_ID below so they get a baseline assignment.
          matchedRoleIds = await filterToExistingRoleIds(
            mapExternalGroupsToMatchedRoleIds(input.groups, input.roleMappings),
          );
          const name = input.name?.trim() || username;
          const avatarInitials = computeAvatarInitials(name);
          const id = generatePrefixedId('u');
          const initialRole = matchedRoleIds[0] ?? DEFAULT_ROLE_ID;
          await usersRepo.insertUser(
            {
              id,
              name,
              username,
              passwordHash: usersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
              role: initialRole,
              avatarInitials,
              costPerHour: 0,
              isDisabled: false,
              employeeType: 'app_user',
              authMethod: input.protocol,
              authProviderId: input.providerId,
            },
            tx,
          );
          await settingsRepo.upsertForUser(
            id,
            { fullName: name, email: input.email?.trim() || '', language: null },
            tx,
          );
          user = {
            id,
            name,
            username,
            role: initialRole,
            avatarInitials,
            isDisabled: false,
            sessionVersion: 1,
            tokenVersion: 1,
            passwordHash: usersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
            employeeType: 'app_user',
            authMethod: input.protocol,
            authProviderId: input.providerId,
            totpEnabled: false,
          };
          wasCreated = true;
        } else {
          assertUserAllowsExternalProvider(user, input);
          // OIDC/SAML identity is anchored to `sub`, not `preferred_username`. If the
          // username-matched Praetor user already has an identity row for this provider
          // with a *different* subject, a different IdP account is claiming the same
          // username and would silently merge two distinct IdP accounts into one Praetor
          // user (#606). Refuse the bind. Rows with the same subject under a different
          // issuer (e.g., IdP URL normalization) are not a conflict — bind a fresh row.
          const conflictingSubject = await externalIdentitiesRepo.hasOtherSubjectForUserAndProvider(
            user.id,
            input.providerId,
            input.protocol,
            input.subject,
            tx,
          );
          if (conflictingSubject) {
            throw new ExternalAuthError(IDENTITY_NOT_ALLOWED_MESSAGE, 'identity_conflict');
          }
        }

        await externalIdentitiesRepo.insert(
          {
            id: generatePrefixedId('eid'),
            providerId: input.providerId,
            protocol: input.protocol,
            issuer: input.issuer,
            subject: input.subject,
            userId: user.id,
          },
          tx,
        );
        const persistedIdentity = await externalIdentitiesRepo.findByIdentity(
          {
            providerId: input.providerId,
            protocol: input.protocol,
            issuer: input.issuer,
            subject: input.subject,
          },
          tx,
        );
        if (!persistedIdentity || persistedIdentity.userId !== user.id) {
          throw new ExternalAuthError(
            'External identity is already bound to another user',
            'identity_conflict',
          );
        }
        wasBound = true;
      }

      if (user.isDisabled) {
        throw new ExternalAuthError('User is disabled', 'user_disabled');
      }

      if (!wasCreated) {
        const syncedProfile = await syncExternalProfileTx(user.id, input, tx);
        user = {
          ...user,
          name: syncedProfile.name ?? user.name,
          avatarInitials: syncedProfile.avatarInitials ?? user.avatarInitials,
        };
      }

      // Role mapping is bootstrap-only: it seeds user_roles when this request is the one
      // that just created the Praetor user. On every subsequent SSO login (or when an
      // existing local user gets a new identity row bound — wasBound but not wasCreated),
      // the app's stored role assignments win. Admin-assigned roles survive (#596, #603)
      // and adding/removing IdP groups never overrides them.
      let effectivePrimaryRole = user.role;
      if (wasCreated) {
        const rolesToWrite = matchedRoleIds.length > 0 ? matchedRoleIds : [DEFAULT_ROLE_ID];
        const primaryRoleId = rolesToWrite[0];
        await writeExternalRoleIdsTx(user.id, rolesToWrite, tx, primaryRoleId);
        effectivePrimaryRole = primaryRoleId;
      }

      return {
        id: user.id,
        name: user.name,
        username: user.username,
        role: effectivePrimaryRole,
        avatarInitials: user.avatarInitials,
        authMethod: input.protocol,
        isDisabled: user.isDisabled,
        sessionVersion: user.sessionVersion,
        tokenVersion: user.tokenVersion,
        wasCreated,
        wasBound,
      };
    });

  try {
    return await resolveInTransaction();
  } catch (err) {
    if (!isUsernameUniqueViolation(err)) throw err;
    // A Postgres unique violation aborts the active transaction, so retry outside it.
    return resolveInTransaction();
  }
};
