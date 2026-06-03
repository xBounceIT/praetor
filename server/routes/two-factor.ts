import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import type { TotpBackupCode } from '../db/schema/users.ts';
import { authenticateToken, generateToken, requireEnrollOrSession } from '../middleware/auth.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { standardErrorResponses } from '../schemas/common.ts';
import { redeemBackupCode } from '../services/backupCodes.ts';
import { authUserSchema, buildSessionSuccess } from '../services/sessionResponse.ts';
import { isAdminTotpMandatory } from '../services/totpEnforcement.ts';
import { logAudit } from '../utils/audit.ts';
import { encrypt } from '../utils/crypto.ts';
import { LOGIN_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  buildOtpAuthUri,
  buildQrDataUri,
  decryptTotpSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyTotpCode,
} from '../utils/totp.ts';
import { badRequest, requireNonEmptyString } from '../utils/validation.ts';

const setupResponseSchema = {
  type: 'object',
  properties: {
    secret: { type: 'string' },
    otpauthUri: { type: 'string' },
    // Long `data:image/png;base64,...` string — must be declared or Fastify strips it.
    qrDataUri: { type: 'string' },
    backupCodes: { type: 'array', items: { type: 'string' } },
  },
  required: ['secret', 'otpauthUri', 'qrDataUri', 'backupCodes'],
} as const;

// `confirm` returns `{ enabled: true }` for a session caller, and additionally `{ token, user }`
// when the caller authenticated with an enroll token (so the freshly-enabled user is logged in).
const confirmResponseSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    token: { type: 'string' },
    user: authUserSchema,
  },
  required: ['enabled'],
} as const;

const enabledFlagResponseSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
  },
  required: ['enabled'],
} as const;

const backupCodesResponseSchema = {
  type: 'object',
  properties: {
    backupCodes: { type: 'array', items: { type: 'string' } },
  },
  required: ['backupCodes'],
} as const;

const statusResponseSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    applicable: { type: 'boolean' },
  },
  required: ['enabled', 'applicable'],
} as const;

const codeBodySchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
  },
  required: ['code'],
} as const;

const disableBodySchema = {
  type: 'object',
  properties: {
    password: { type: 'string' },
    code: { type: 'string' },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // POST /setup - Begin enrollment: generate + store an (unconfirmed) secret and backup codes,
  // return the secret/otpauth URI/QR plus the one-time plaintext backup codes. Reachable both by a
  // logged-in user adding 2FA and by a user mid-enrollment holding only a `totp_enroll` token.
  fastify.post(
    '/setup',
    {
      onRequest: [fastify.rateLimit(LOGIN_RATE_LIMIT), requireEnrollOrSession],
      schema: {
        tags: ['auth'],
        summary: 'Begin TOTP enrollment',
        response: {
          200: setupResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id ?? request.enrollUserId;
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const userCore = await usersRepo.findCoreById(userId);
      if (!userCore) {
        return reply.code(401).send({ error: 'User not found' });
      }
      if (!usersRepo.isTotpApplicable(userCore.authMethod)) {
        return reply.code(403).send({
          error: 'Two-factor authentication is managed by the identity provider',
          errorCode: 'totp_not_applicable',
        });
      }

      const state = await usersRepo.getTotpState(userId);
      if (state?.totpEnabled) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Two-factor authentication is already enabled',
          action: 'user.totp_setup.conflict',
          entityType: 'user',
          entityId: userId,
          details: { secondaryLabel: 'already_enabled' },
        });
      }

      // Plaintext codes are generated exactly once: only their bcrypt hashes are persisted, and
      // the plaintext is returned to the caller here and never again.
      const plaintextCodes = generateBackupCodes();
      const secret = generateTotpSecret();
      await usersRepo.setTotpEnrollment(userId, {
        encryptedSecret: encrypt(secret),
        backupCodeHashes: await Promise.all(plaintextCodes.map(hashBackupCode)),
      });

      const otpauthUri = buildOtpAuthUri(secret, userCore.username);
      const qrDataUri = await buildQrDataUri(otpauthUri);

      await logAudit({
        request,
        action: 'user.totp_setup_started',
        entityType: 'user',
        entityId: userId,
        details: { targetLabel: userCore.name, secondaryLabel: userCore.username },
        userId,
      });

      return { secret, otpauthUri, qrDataUri, backupCodes: plaintextCodes };
    },
  );

  // POST /confirm - Prove possession of the pending secret with a live code, flipping 2FA on. When
  // the caller used an enroll token (no session yet) this also issues a full session so they land
  // logged in; a logged-in caller just gets `{ enabled: true }`.
  fastify.post(
    '/confirm',
    {
      onRequest: [fastify.rateLimit(LOGIN_RATE_LIMIT), requireEnrollOrSession],
      schema: {
        tags: ['auth'],
        summary: 'Confirm and enable TOTP',
        body: codeBodySchema,
        response: {
          200: confirmResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id ?? request.enrollUserId;
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { code } = request.body as { code?: unknown };
      const codeResult = requireNonEmptyString(code, 'code');
      if (!codeResult.ok) return badRequest(reply, codeResult.message);

      // For the enroll-token path the caller has no session yet and the token was issued by /login
      // up to 15 minutes ago — re-validate the account BEFORE mutating any TOTP state, so a user who
      // has since been disabled, had their employee type changed, or been switched to an IdP-managed
      // auth method can't flip TOTP on (and emit user.totp_enabled) before being denied.
      let enrollLoginUser: Awaited<ReturnType<typeof usersRepo.findLoginUserById>> = null;
      if (request.enrollUserId && !request.user) {
        enrollLoginUser = await usersRepo.findLoginUserById(userId);
        if (
          !enrollLoginUser ||
          enrollLoginUser.isDisabled ||
          enrollLoginUser.employeeType !== 'app_user' ||
          !usersRepo.isTotpApplicable(enrollLoginUser.authMethod) ||
          // Reject an enroll token left outstanding across a credential/session rotation — the
          // bumped sessionVersion no longer matches the value the token was signed with.
          enrollLoginUser.sessionVersion !== request.enrollSessionVersion
        ) {
          return reply.code(401).send({ error: 'User not found' });
        }
      }

      // Session caller: re-check applicability too. A local/LDAP user can be switched to an
      // IdP-managed method mid-enrollment (the auth-method update doesn't revoke their session, and
      // /setup's gate ran earlier), so don't enable app TOTP on an account that no longer supports
      // it. request.user.authMethod is loaded fresh by authenticateToken on this request.
      if (request.user && !usersRepo.isTotpApplicable(request.user.authMethod ?? 'local')) {
        return reply.code(403).send({
          error: 'Two-factor authentication is managed by the identity provider',
          errorCode: 'totp_not_applicable',
        });
      }

      const state = await usersRepo.getTotpState(userId);
      // Require a pending (stored-but-not-yet-enabled) enrollment. A missing secret or an
      // already-enabled account both fail here.
      if (!state || state.totpSecret === null || state.totpEnabled) {
        return badRequest(reply, 'No pending two-factor enrollment to confirm');
      }

      const secret = decryptTotpSecret(state.totpSecret);
      if (!verifyTotpCode(secret, codeResult.value)) {
        return replyError(request, reply, {
          statusCode: 400,
          message: 'Invalid verification code',
          errorCode: 'invalid_totp_code',
          action: 'user.totp_enable.invalid_code',
          entityType: 'user',
          entityId: userId,
          details: { secondaryLabel: 'invalid_code' },
        });
      }

      const enabled = await usersRepo.enableTotp(userId);
      if (!enabled) {
        // The secret vanished between the read above and this write (e.g. a concurrent disable).
        return badRequest(reply, 'No pending two-factor enrollment to confirm');
      }

      await logAudit({
        request,
        action: 'user.totp_enabled',
        entityType: 'user',
        entityId: userId,
        userId,
      });

      // Enroll-token path: the user had no session, so mint one now (mirroring the login no-2FA
      // success response). The account was already re-validated above, before TOTP was enabled.
      if (enrollLoginUser) {
        const session = await buildSessionSuccess(enrollLoginUser);
        // This is the user's real login — they had no session, only an enroll token. Log
        // `user.login` here so a session born from mandatory enrollment isn't missing from the
        // sign-in audit trail (mirrors the /login no-2FA path and /totp-challenge).
        await logAudit({
          request,
          action: 'user.login',
          entityType: 'user',
          entityId: enrollLoginUser.id,
          details: {
            targetLabel: enrollLoginUser.name,
            secondaryLabel: enrollLoginUser.role,
          },
          userId: enrollLoginUser.id,
        });
        return { enabled: true, ...session };
      }

      return { enabled: true };
    },
  );

  // POST /disable - Turn 2FA off. Requires re-authentication: local users must supply their
  // current password AND a valid TOTP/backup code; external (LDAP) users supply a TOTP/backup code
  // only (no LDAP bind here). On success the caller's session is rotated so any other live tokens
  // are revoked. LOGIN_RATE_LIMIT because this verifies credentials — same threat model as login.
  fastify.post(
    '/disable',
    {
      onRequest: [fastify.rateLimit(LOGIN_RATE_LIMIT), authenticateToken],
      schema: {
        tags: ['auth'],
        summary: 'Disable TOTP',
        body: disableBodySchema,
        response: {
          200: enabledFlagResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id;
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { password, code } = request.body as { password?: unknown; code?: unknown };

      const state = await usersRepo.getTotpState(userId);
      if (!state?.totpEnabled || !state.totpSecret) {
        return badRequest(reply, 'Two-factor authentication is not enabled');
      }

      const userCore = await usersRepo.findCoreById(userId);
      if (!userCore) {
        return reply.code(401).send({ error: 'User not found' });
      }

      // An administrator subject to the 2FA mandate cannot turn their second factor off — that would
      // leave an enforced admin operating without 2FA on a live session, defeating the policy. They
      // must keep it enabled; only an admin reset (which also revokes their sessions) can clear it.
      if (
        await isAdminTotpMandatory({
          id: userId,
          role: userCore.role,
          authMethod: userCore.authMethod,
        })
      ) {
        return replyError(request, reply, {
          statusCode: 403,
          message: 'Two-factor authentication is required for your administrator role',
          errorCode: 'totp_required_for_admin',
          action: 'user.totp_disable.enforced',
          entityType: 'user',
          entityId: userId,
          details: { secondaryLabel: 'enforced' },
        });
      }

      // Re-auth step 1 (local only): verify the current password before touching the second factor.
      if (userCore.authMethod === 'local') {
        const passwordResult = requireNonEmptyString(password, 'password');
        if (!passwordResult.ok) return badRequest(reply, passwordResult.message);
        const passwordHash = await usersRepo.getPasswordHash(userId);
        if (passwordHash === null || !(await bcrypt.compare(passwordResult.value, passwordHash))) {
          return badRequest(reply, 'Incorrect password');
        }
      }

      // Re-auth step 2 (all applicable users): a live TOTP code or an unused backup code.
      const codeResult = requireNonEmptyString(code, 'code');
      if (!codeResult.ok) return badRequest(reply, codeResult.message);

      const secret = decryptTotpSecret(state.totpSecret);
      const reauthOk =
        verifyTotpCode(secret, codeResult.value) ||
        (await withDbTransaction((tx) => redeemBackupCode(userId, codeResult.value, tx)));
      if (!reauthOk) {
        return replyError(request, reply, {
          statusCode: 400,
          message: 'Invalid verification code',
          errorCode: 'invalid_totp_code',
          action: 'user.totp_disable.invalid_code',
          entityType: 'user',
          entityId: userId,
          details: { secondaryLabel: 'invalid_code' },
        });
      }

      await usersRepo.disableTotp(userId);

      // Rotate the session so any stolen tokens predating the disable are revoked, then re-sign the
      // caller's x-auth-token (mirroring settings.ts PUT /password) so they aren't logged out.
      // bumpSessionVersion returns void, so re-read the bumped value to mint the replacement token;
      // authenticateToken's onRequest sliding-window already wrote a now-revoked pre-bump token.
      await usersRepo.bumpSessionVersion(userId);
      if (request.auth?.source === 'session' && request.auth.sessionStart !== undefined) {
        const refreshed = await usersRepo.findAuthUserById(userId);
        if (refreshed) {
          const refreshedToken = generateToken(
            userId,
            request.auth.sessionStart,
            request.user?.role,
            refreshed.sessionVersion,
          );
          reply.header('x-auth-token', refreshedToken);
        }
      }

      await logAudit({
        request,
        action: 'user.totp_disabled',
        entityType: 'user',
        entityId: userId,
        userId,
      });

      return { enabled: false };
    },
  );

  // POST /backup-codes/regenerate - Issue a fresh set of backup codes after verifying a live TOTP
  // code. The previous codes are overwritten. No session rotation (2FA stays enabled).
  fastify.post(
    '/backup-codes/regenerate',
    {
      onRequest: [fastify.rateLimit(LOGIN_RATE_LIMIT), authenticateToken],
      schema: {
        tags: ['auth'],
        summary: 'Regenerate TOTP backup codes',
        body: codeBodySchema,
        response: {
          200: backupCodesResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id;
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { code } = request.body as { code?: unknown };
      const codeResult = requireNonEmptyString(code, 'code');
      if (!codeResult.ok) return badRequest(reply, codeResult.message);

      const state = await usersRepo.getTotpState(userId);
      if (!state?.totpEnabled || !state.totpSecret) {
        return badRequest(reply, 'Two-factor authentication is not enabled');
      }

      const secret = decryptTotpSecret(state.totpSecret);
      if (!verifyTotpCode(secret, codeResult.value)) {
        return replyError(request, reply, {
          statusCode: 400,
          message: 'Invalid verification code',
          errorCode: 'invalid_totp_code',
          action: 'user.totp_backup_codes_regenerate.invalid_code',
          entityType: 'user',
          entityId: userId,
          details: { secondaryLabel: 'invalid_code' },
        });
      }

      const plaintextCodes = generateBackupCodes();
      const codes: TotpBackupCode[] = await Promise.all(
        plaintextCodes.map(async (plain) => ({ hash: await hashBackupCode(plain), usedAt: null })),
      );
      await usersRepo.setBackupCodes(userId, codes);

      await logAudit({
        request,
        action: 'user.totp_backup_codes_regenerated',
        entityType: 'user',
        entityId: userId,
        userId,
      });

      return { backupCodes: plaintextCodes };
    },
  );

  // GET /status - Report whether 2FA is enabled for the caller and whether it is even applicable
  // to their auth method (external/IdP-backed users cannot enroll).
  fastify.get(
    '/status',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['auth'],
        summary: 'Get current user TOTP status',
        response: {
          200: statusResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id;
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const [state, userCore] = await Promise.all([
        usersRepo.getTotpState(userId),
        usersRepo.findCoreById(userId),
      ]);
      const applicable = userCore ? usersRepo.isTotpApplicable(userCore.authMethod) : false;
      return { enabled: state?.totpEnabled ?? false, applicable };
    },
  );
}
