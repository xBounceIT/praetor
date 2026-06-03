import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import {
  authenticateToken,
  generateToken,
  getSessionAuth,
  requireSessionAuth,
  signPurposeToken,
  verifyPurposeToken,
} from '../middleware/auth.ts';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as settingsRepo from '../repositories/settingsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { redeemBackupCode } from '../services/backupCodes.ts';
import {
  type ExternalRoleMapping,
  externalGroupsYieldNoKnownRole,
} from '../services/external-auth.ts';
import {
  authUserSchema,
  buildSessionSuccess,
  sessionSuccessResponseSchema,
} from '../services/sessionResponse.ts';
import * as ssoService from '../services/sso.ts';
import {
  adminRoleSwitchBlocked,
  isTotpEnforcedForAdmins,
  requiresAdminTotpEnrollment,
} from '../services/totpEnforcement.ts';
import { logAudit } from '../utils/audit.ts';
import { computeAvatarInitials } from '../utils/initials.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { LOGIN_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import { decryptTotpSecret, verifyTotpCode } from '../utils/totp.ts';
import {
  badRequest,
  requireNonEmptyString,
  requireNonEmptyStringRaw,
} from '../utils/validation.ts';

const loginBodySchema = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['username', 'password'],
} as const;

const switchRoleBodySchema = {
  type: 'object',
  properties: {
    roleId: { type: 'string' },
  },
  required: ['roleId'],
} as const;

const totpChallengeBodySchema = {
  type: 'object',
  properties: {
    challengeToken: { type: 'string' },
    code: { type: 'string' },
  },
  required: ['challengeToken', 'code'],
} as const;

// POST /login may resolve three different ways: a full session (token + user), a TOTP challenge
// for a 2FA-enabled user (totpRequired + challengeToken), or a mandatory-enrollment redirect for
// an admin without 2FA (totpEnrollmentRequired + enrollToken). Fastify strips any response field
// absent from this schema, so every possible field is enumerated here and `token`/`user` are no
// longer required.
const loginResponseSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    user: authUserSchema,
    totpRequired: { type: 'boolean' },
    challengeToken: { type: 'string' },
    totpEnrollmentRequired: { type: 'boolean' },
    enrollToken: { type: 'string' },
  },
} as const;

const LDAP_UNAVAILABLE_BODY = {
  error: 'Authentication service temporarily unavailable',
  errorCode: 'ldap_unavailable',
} as const;

const syncLdapLoginProfile = async (
  userId: string,
  profile: { name?: string; email?: string },
): Promise<{ name?: string; avatarInitials?: string }> => {
  const name = profile.name?.trim();
  const email = profile.email?.trim();
  if (!name && !email) return {};

  const avatarInitials = name ? computeAvatarInitials(name) : undefined;
  await withDbTransaction(async (tx) => {
    if (name) {
      await usersRepo.updateDirectoryProfile(userId, { name, avatarInitials }, tx);
    }
    await settingsRepo.upsertForUser(
      userId,
      { fullName: name || null, email: email || null, language: null },
      tx,
    );
  });

  return name ? { name, avatarInitials } : {};
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // POST /login
  fastify.post(
    '/login',
    {
      onRequest: fastify.rateLimit(LOGIN_RATE_LIMIT),
      schema: {
        tags: ['auth'],
        summary: 'Login',
        body: loginBodySchema,
        security: [],
        response: {
          200: loginResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { username, password } = request.body as { username: unknown; password: unknown };

      const usernameResult = requireNonEmptyString(username, 'username');
      if (!usernameResult.ok) {
        return badRequest(reply, usernameResult.message);
      }

      const passwordResult = requireNonEmptyStringRaw(password, 'password');
      if (!passwordResult.ok) {
        return badRequest(reply, passwordResult.message);
      }

      let user = await usersRepo.findLoginUserByNormalizedUsername(usernameResult.value);
      let ldapAutoProvisionSuccess = false;
      let ldapAutoProvisioned = false;

      if (!user) {
        try {
          const ldapService = (await import('../services/ldap.ts')).default;
          const provision = await ldapService.authenticateAndProvision(
            usernameResult.value,
            passwordResult.value,
          );
          if (provision.authenticated && provision.userId) {
            user = await usersRepo.findLoginUserById(provision.userId);
            ldapAutoProvisionSuccess = !!user;
            ldapAutoProvisioned = !!provision.created;
          }
        } catch (err) {
          fastify.log.error(
            { err, username: usernameResult.value },
            'LDAP auto-provision attempt failed',
          );
          return reply.code(503).send(LDAP_UNAVAILABLE_BODY);
        }
        if (!user) {
          return reply.code(401).send({ error: 'Invalid username or password' });
        }
      }

      if (user.isDisabled || user.employeeType !== 'app_user') {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      const { authMethod } = user;

      // LDAP Authentication
      let ldapAuthSuccess = ldapAutoProvisionSuccess;
      let ldapGroups: string[] = [];
      let ldapRoleMappings: ExternalRoleMapping[] = [];
      if (!ldapAuthSuccess && authMethod === 'ldap') {
        try {
          const ldapService = (await import('../services/ldap.ts')).default;
          const ldapAuthResult = await ldapService.authenticateWithProfile(
            usernameResult.value,
            passwordResult.value,
          );
          ldapAuthSuccess = ldapAuthResult.authenticated;
          ldapGroups = ldapAuthResult.groups;
          ldapRoleMappings = ldapAuthResult.roleMappings;
          if (ldapAuthSuccess) {
            const syncedProfile = await syncLdapLoginProfile(user.id, {
              name: ldapAuthResult.displayName,
              email: ldapAuthResult.email,
            });
            user = {
              ...user,
              name: syncedProfile.name ?? user.name,
              avatarInitials: syncedProfile.avatarInitials ?? user.avatarInitials,
            };
          }
        } catch (err) {
          fastify.log.error({ err, username: usernameResult.value }, 'LDAP auth attempt failed');
          return reply.code(503).send(LDAP_UNAVAILABLE_BODY);
        }
      }

      let validPassword = false;
      if (ldapAuthSuccess) {
        validPassword = true;
      } else if (authMethod === 'local' && user.passwordHash) {
        validPassword = await bcrypt.compare(passwordResult.value.trim(), user.passwordHash);
      }

      if (!validPassword) {
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      if (
        ldapAuthSuccess &&
        !ldapAutoProvisionSuccess &&
        (await externalGroupsYieldNoKnownRole(ldapGroups, ldapRoleMappings))
      ) {
        // Role mapping is bootstrap-only: existing users keep their app-assigned roles
        // on every login. Log a diagnostic when LDAP groups yield no known role (either
        // no group matched, or every matched mapping points at a role that has since
        // been deleted) so admins can spot stale config; the helper short-circuits when
        // no role mappings are configured at all, so we never overwrite user_roles or
        // user.role and never warn for an admin who deliberately doesn't use mappings.
        fastify.log.warn(
          {
            userId: user.id,
            username: user.username,
            groups: ldapGroups,
            currentRole: user.role,
          },
          'LDAP login: LDAP groups did not resolve to any known role mapping — preserving existing role',
        );
      }

      if (ldapAutoProvisioned) {
        await logAudit({
          request,
          action: 'user.created',
          entityType: 'user',
          entityId: user.id,
          details: {
            targetLabel: user.name,
            secondaryLabel: user.username,
          },
          userId: user.id,
        });
      }

      // 2FA gate. Password is now confirmed and the account is enabled. Before issuing a session
      // we branch: (a) a user with 2FA already enabled must clear a TOTP challenge; (b) an admin
      // for whom enrollment is mandated but not yet completed is redirected into enrollment;
      // (c) otherwise the legacy session is issued. `user.login` is logged ONLY when an actual
      // session is granted (path c here, or the totp-challenge endpoint) — never on a 2FA detour.
      const totpApplies = usersRepo.isTotpApplicable(authMethod);

      // (a) TOTP challenge — the user has confirmed 2FA and must present a code to finish login.
      if (user.totpEnabled && totpApplies) {
        await logAudit({
          request,
          action: 'user.totp_challenge_issued',
          entityType: 'user',
          entityId: user.id,
          details: {
            targetLabel: user.name,
            secondaryLabel: user.role,
          },
          userId: user.id,
        });
        return {
          totpRequired: true,
          challengeToken: signPurposeToken({ userId: user.id, purpose: 'totp_challenge' }, '5m'),
        };
      }

      // (b) Mandatory enrollment — an admin-capable user (via any assignable admin role) who has
      // not set up TOTP is routed into enrollment instead of receiving a session when the policy is
      // on. Considering every assignable admin role stops a multi-role admin from logging in under
      // a non-admin role and then switching into admin without a second factor.
      if (
        await requiresAdminTotpEnrollment({
          id: user.id,
          role: user.role,
          authMethod,
          totpEnabled: user.totpEnabled,
        })
      ) {
        await logAudit({
          request,
          action: 'user.totp_enrollment_required',
          entityType: 'user',
          entityId: user.id,
          details: {
            targetLabel: user.name,
            secondaryLabel: user.role,
          },
          userId: user.id,
        });
        return {
          totpEnrollmentRequired: true,
          enrollToken: signPurposeToken({ userId: user.id, purpose: 'totp_enroll' }, '15m'),
        };
      }

      // (c) No 2FA in play — issue the session exactly as the legacy flow did, logging user.login.
      await logAudit({
        request,
        action: 'user.login',
        entityType: 'user',
        entityId: user.id,
        details: {
          targetLabel: user.name,
          secondaryLabel: user.role,
        },
        userId: user.id,
      });

      return buildSessionSuccess(user);
    },
  );

  // POST /totp-challenge - second factor for a 2FA-enabled user mid-login. Exchanges the
  // short-lived challenge token (issued by /login) plus a TOTP or backup code for a session.
  fastify.post(
    '/totp-challenge',
    {
      onRequest: fastify.rateLimit(LOGIN_RATE_LIMIT),
      schema: {
        tags: ['auth'],
        summary: 'Complete TOTP two-factor challenge',
        body: totpChallengeBodySchema,
        security: [],
        response: {
          200: sessionSuccessResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { challengeToken, code } = request.body as {
        challengeToken: unknown;
        code: unknown;
      };

      const challengeTokenResult = requireNonEmptyString(challengeToken, 'challengeToken');
      if (!challengeTokenResult.ok) return badRequest(reply, challengeTokenResult.message);
      const codeResult = requireNonEmptyStringRaw(code, 'code');
      if (!codeResult.ok) return badRequest(reply, codeResult.message);

      // Expired or tampered challenge tokens are reported distinctly so the client can prompt the
      // user to log in again rather than re-enter a code against a dead token.
      let userId: string;
      try {
        ({ userId } = verifyPurposeToken(challengeTokenResult.value, 'totp_challenge'));
      } catch {
        return reply
          .code(401)
          .send({ error: 'Two-factor challenge expired', errorCode: 'totp_challenge_expired' });
      }

      // Every other failure below — unknown/disabled user, 2FA turned off since the token was
      // issued, missing secret, or a code that matches neither the TOTP nor any unused backup
      // code — collapses to the SAME generic 400 so the response never reveals which condition
      // failed (no account enumeration, no oracle on code validity vs. account state).
      const invalidCode = () =>
        reply.code(400).send({ error: 'Invalid code', errorCode: 'invalid_totp_code' });

      const user = await usersRepo.findLoginUserById(userId);
      if (
        !user ||
        user.isDisabled ||
        !user.totpEnabled ||
        user.employeeType !== 'app_user' ||
        // The auth method can change between /login (which issued this challenge token) and now; an
        // account switched to OIDC/SAML in that window must not complete a local TOTP challenge.
        !usersRepo.isTotpApplicable(user.authMethod)
      ) {
        return invalidCode();
      }

      // Read the secret + backup codes and (on a backup-code hit) burn that code inside a single
      // transaction, so two concurrent submissions of the same backup code cannot both succeed.
      const verified = await withDbTransaction(async (tx) => {
        const state = await usersRepo.getTotpState(userId, tx);
        if (!state?.totpEnabled || !state.totpSecret) return false;

        const secret = decryptTotpSecret(state.totpSecret);
        if (verifyTotpCode(secret, codeResult.value)) return true;

        return redeemBackupCode(userId, codeResult.value, tx);
      });

      if (!verified) return invalidCode();

      await logAudit({
        request,
        action: 'user.login',
        entityType: 'user',
        entityId: user.id,
        details: {
          targetLabel: user.name,
          secondaryLabel: user.role,
        },
        userId: user.id,
      });

      return buildSessionSuccess(user);
    },
  );

  // GET /me - Get current user
  fastify.get(
    '/me',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['auth'],
        summary: 'Get current user',
        response: {
          200: authUserSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const availableRoles = request.user?.id
        ? await rolesRepo.listAvailableRolesForUser(request.user.id)
        : [];
      const effectiveAvailableRoles =
        availableRoles.length > 0
          ? availableRoles
          : [
              {
                id: request.user?.role as string,
                name: request.user?.role as string,
                isSystem: false,
                isAdmin: request.user?.role === 'admin',
              },
            ];
      return {
        id: request.user?.id,
        name: request.user?.name,
        username: request.user?.username,
        role: request.user?.role,
        avatarInitials: request.user?.avatarInitials,
        authMethod: request.user?.authMethod,
        permissions: request.user?.permissions || [],
        availableRoles: effectiveAvailableRoles,
      };
    },
  );

  // POST /switch-role - Switch the active role for this session
  fastify.post(
    '/switch-role',
    {
      onRequest: [authenticateToken, requireSessionAuth],
      schema: {
        tags: ['auth'],
        summary: 'Switch active role (session-only)',
        body: switchRoleBodySchema,
        response: {
          200: loginResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { roleId } = request.body as { roleId: unknown };
      const roleIdResult = requireNonEmptyString(roleId, 'roleId');
      if (!roleIdResult.ok) return badRequest(reply, roleIdResult.message);

      const session = getSessionAuth(request);

      const hasRole = await rolesRepo.userHasRole(session.userId, roleIdResult.value, {
        requireEnabledUser: true,
        expectedSessionVersion: session.sessionVersion,
      });
      if (!hasRole) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Insufficient permissions',
          action: 'auth.role_switch.denied',
          entityType: 'role',
          entityId: roleIdResult.value,
          details: { targetLabel: roleIdResult.value, secondaryLabel: 'role_switch' },
        });
      }

      // Block elevating into an admin role without 2FA when the policy requires it. The login gate
      // can't catch sessions that predate enforcement or a later admin-role grant, so re-check here.
      // Enforce-first so a non-admin switch or a disabled policy skips the extra reads.
      if (await isTotpEnforcedForAdmins()) {
        const switchUser = await usersRepo.findLoginUserById(session.userId);
        if (switchUser && (await adminRoleSwitchBlocked(switchUser, roleIdResult.value))) {
          return replyError(request, reply, {
            statusCode: 403,
            message: 'Two-factor authentication is required to use an administrator role',
            errorCode: 'totp_enrollment_required',
            action: 'auth.role_switch.totp_required',
            entityType: 'role',
            entityId: roleIdResult.value,
            details: { targetLabel: roleIdResult.value, secondaryLabel: 'totp_required' },
          });
        }
      }

      const [permissions, availableRoles] = await Promise.all([
        getRolePermissions(roleIdResult.value),
        rolesRepo.listAvailableRolesForUser(session.userId),
      ]);
      const effectiveAvailableRoles =
        availableRoles.length > 0
          ? availableRoles
          : [
              {
                id: roleIdResult.value,
                name: roleIdResult.value,
                isSystem: false,
                isAdmin: roleIdResult.value === 'admin',
              },
            ];
      const token = generateToken(
        session.userId,
        session.sessionStart,
        roleIdResult.value,
        session.sessionVersion,
      );
      reply.header('x-auth-token', token);

      await logAudit({
        request,
        action: 'user.role_switched',
        entityType: 'user',
        entityId: session.userId,
        details: {
          targetLabel: request.user?.name,
          secondaryLabel: request.user?.username,
          fromValue: request.user?.role,
          toValue: roleIdResult.value,
        },
      });

      return {
        token,
        user: {
          id: session.userId,
          name: request.user?.name,
          username: request.user?.username,
          role: roleIdResult.value,
          avatarInitials: request.user?.avatarInitials,
          authMethod: request.user?.authMethod,
          permissions,
          availableRoles: effectiveAvailableRoles,
        },
      };
    },
  );

  // Bumping session_version invalidates the caller's token (and any other live tokens
  // for the same user) on the next authenticated request. For OIDC users on a provider
  // with `endSessionEnabled`, the response also carries `endSessionUrl` so the frontend
  // can redirect to the IdP's RP-Initiated Logout endpoint — otherwise the IdP cookie
  // outlives the Praetor session and a fresh SSO attempt silently re-enters as the
  // previous user.
  fastify.post(
    '/logout',
    {
      onRequest: [authenticateToken, requireSessionAuth],
      schema: {
        tags: ['auth'],
        summary: 'Logout (revoke all sessions for this user)',
        response: {
          200: {
            type: 'object',
            properties: {
              endSessionUrl: { type: ['string', 'null'] },
            },
            required: ['endSessionUrl'],
          },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = getSessionAuth(request);

      // The local revocation MUST NOT wait on `endOidcSession` — that path performs OIDC
      // discovery against the IdP, and a slow / unreachable IdP would otherwise keep the
      // user's JWT live for the duration of the failed network attempt. Fire all three in
      // parallel and tolerate the end-session arm rejecting; the response still includes a
      // null `endSessionUrl` and the JWT is dead the moment `bumpSessionVersion` commits.
      const [endSessionResult] = await Promise.all([
        ssoService.endOidcSession(session.userId).catch((err: unknown) => {
          request.log.warn({ err, userId: session.userId }, 'OIDC end-session URL build failed');
          return null;
        }),
        usersRepo.bumpSessionVersion(session.userId),
        logAudit({
          request,
          action: 'user.logout',
          entityType: 'user',
          entityId: session.userId,
          details: {
            targetLabel: request.user?.name,
            secondaryLabel: request.user?.username,
          },
        }),
      ]);

      // The sliding-window refresh in authenticateToken already wrote a rotated token
      // to x-auth-token. After the bump above, that token is revoked — strip it so the
      // client doesn't persist a doomed token into localStorage.
      reply.removeHeader('x-auth-token');
      return { endSessionUrl: endSessionResult };
    },
  );
}
