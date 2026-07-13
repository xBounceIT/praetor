import { generateTokenWithCurrentIdleTimeout } from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import type { LoginUserWithAuth } from '../repositories/usersRepo.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { recordFirstInteractiveLogin } from './firstLogin.ts';

// Fastify response schema for the canonical authenticated user. Shared by the login,
// totp-challenge, confirm-via-enroll, /me, and switch-role responses so a field added here is
// never silently stripped from one of them.
export const authUserSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    username: { type: 'string' },
    role: { type: 'string' },
    avatarInitials: { type: 'string' },
    authMethod: { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
    availableRoles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          isSystem: { type: 'boolean' },
          isAdmin: { type: 'boolean' },
        },
        required: ['id', 'name', 'isSystem', 'isAdmin'],
      },
    },
  },
  required: ['id', 'name', 'username', 'role', 'avatarInitials', 'permissions', 'availableRoles'],
} as const;

// A successful session response — issued by the no-2FA login path, the totp-challenge endpoint,
// and the confirm-via-enroll path. Kept identical across all three (see buildSessionSuccess).
export const sessionSuccessResponseSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    user: authUserSchema,
  },
  required: ['token', 'user'],
} as const;

// Builds the canonical "session issued" response shared by the no-2FA login path, the
// totp-challenge endpoint, and the confirm-via-enroll path: a fresh configured idle-window
// token anchored at the current time, the role's effective permissions, and the user's
// available roles (falling back to a single synthetic role when none are explicitly assigned).
// The independent reads run in parallel since none depends on the others. Once permissions are
// known, the helper atomically records the first issued session and creates the RIL onboarding tip
// for eligible users. Callers remain responsible for logging `user.login` themselves.
export const buildSessionSuccess = async (user: LoginUserWithAuth) => {
  const [token, permissions, availableRoles] = await Promise.all([
    generateTokenWithCurrentIdleTimeout(user.id, Date.now(), user.role, user.sessionVersion),
    getRolePermissions(user.role),
    rolesRepo.listAvailableRolesForUser(user.id),
  ]);
  const effectiveAvailableRoles =
    availableRoles.length > 0
      ? availableRoles
      : [{ id: user.role, name: user.role, isSystem: false, isAdmin: user.role === 'admin' }];

  await recordFirstInteractiveLogin(user.id, {
    createRilPreferencesTip: permissions.includes('timesheets.ril.view'),
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      avatarInitials: user.avatarInitials,
      authMethod: user.authMethod,
      permissions,
      availableRoles: effectiveAvailableRoles,
    },
  };
};
