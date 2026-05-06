import { withDbTransaction } from '../db/drizzle.ts';
import type { SsoProtocol } from '../db/schema/sso.ts';
import * as externalIdentitiesRepo from '../repositories/externalIdentitiesRepo.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as settingsRepo from '../repositories/settingsRepo.ts';
import * as userAssignmentsRepo from '../repositories/userAssignmentsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { computeAvatarInitials } from '../utils/initials.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

const DEFAULT_ROLE_ID = 'user';

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

export const mapExternalGroupsToRoleIds = (
  groups: string[],
  mappings: ExternalRoleMapping[],
): string[] => {
  const roleIds: string[] = [];
  for (const mapping of mappings) {
    if (!mapping.externalGroup?.trim() || !mapping.role?.trim()) continue;
    if (groups.some((group) => mappingMatchesGroup(mapping.externalGroup, group))) {
      if (!roleIds.includes(mapping.role)) roleIds.push(mapping.role);
    }
  }
  return roleIds.length > 0 ? roleIds : [DEFAULT_ROLE_ID];
};

const filterExistingRoleIds = async (roleIds: string[]): Promise<string[]> => {
  const existing = await rolesRepo.findExistingIds(roleIds);
  const filtered = roleIds.filter((roleId) => existing.has(roleId));
  return filtered.length > 0 ? filtered : [DEFAULT_ROLE_ID];
};

export const applyExternalRolesForUser = async (
  userId: string,
  groups: string[],
  mappings: ExternalRoleMapping[],
): Promise<string[]> => {
  const mappedRoleIds = await filterExistingRoleIds(mapExternalGroupsToRoleIds(groups, mappings));
  await applyExternalRoleIdsForUser(userId, mappedRoleIds);
  return mappedRoleIds;
};

export const applyExternalRoleIdsForUser = async (
  userId: string,
  roleIds: string[],
): Promise<string[]> => {
  const mappedRoleIds = await filterExistingRoleIds(roleIds);
  await withDbTransaction(async (tx) => {
    await usersRepo.replaceUserRoles(userId, mappedRoleIds, tx);
    await usersRepo.setPrimaryRole(userId, mappedRoleIds[0], tx);
    await userAssignmentsRepo.syncTopManagerAssignmentsForUser(userId, tx);
  });
  return mappedRoleIds;
};

export const resolveExternalIdentity = async (
  input: ResolveExternalIdentityInput,
): Promise<ResolvedExternalUser> => {
  const normalizedUsername = normalizeExternalUsername(input.username);
  if (!normalizedUsername) {
    throw new Error('External identity did not include a username');
  }
  if (!input.subject.trim()) {
    throw new Error('External identity did not include a subject');
  }

  const mappedRoleIds = await filterExistingRoleIds(
    mapExternalGroupsToRoleIds(input.groups, input.roleMappings),
  );
  const primaryRole = mappedRoleIds[0];

  return withDbTransaction(async (tx) => {
    const existingIdentity = await externalIdentitiesRepo.findByIdentity(
      {
        providerId: input.providerId,
        protocol: input.protocol,
        issuer: input.issuer,
        subject: input.subject,
      },
      tx,
    );

    let user: usersRepo.LoginUser | null = null;
    let wasCreated = false;
    let wasBound = false;

    if (existingIdentity) {
      const authUser = await usersRepo.findAuthUserById(existingIdentity.userId, tx);
      if (!authUser) throw new Error('Bound Praetor user no longer exists');
      user = { ...authUser, passwordHash: null };
    } else {
      user = await usersRepo.findLoginUserByNormalizedUsername(normalizedUsername, tx);
      if (!user) {
        const name = input.name?.trim() || input.username.trim();
        const id = generatePrefixedId('u');
        await usersRepo.insertUser(
          {
            id,
            name,
            username: input.username.trim(),
            passwordHash: usersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
            role: primaryRole,
            avatarInitials: computeAvatarInitials(name),
            costPerHour: 0,
            isDisabled: false,
            employeeType: 'app_user',
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
          username: input.username.trim(),
          role: primaryRole,
          avatarInitials: computeAvatarInitials(name),
          isDisabled: false,
          passwordHash: usersRepo.EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
        };
        wasCreated = true;
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
        throw new Error('External identity is already bound to another user');
      }
      wasBound = true;
    }

    if (user.isDisabled) {
      throw new Error('User is disabled');
    }

    await usersRepo.replaceUserRoles(user.id, mappedRoleIds, tx);
    await usersRepo.setPrimaryRole(user.id, primaryRole, tx);
    await userAssignmentsRepo.syncTopManagerAssignmentsForUser(user.id, tx);

    return {
      id: user.id,
      name: user.name,
      username: user.username,
      role: primaryRole,
      avatarInitials: user.avatarInitials,
      isDisabled: user.isDisabled,
      wasCreated,
      wasBound,
    };
  });
};
