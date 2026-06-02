// Focused coverage for the single-purpose 2FA token helpers and the authenticateToken
// hardening that refuses any token carrying a `purpose` claim. These tokens are signed with
// the same JWT secret/algorithm as session tokens but deliberately omit
// sessionStart/sessionVersion, so the round-trip and rejection behaviours below are the only
// thing standing between a narrow enroll/challenge step and a full session.
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import jwt from 'jsonwebtoken';
import {
  authenticateToken,
  requireEnrollOrSession,
  signPurposeToken,
  verifyPurposeToken,
} from '../../middleware/auth.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';
import * as realUsersRepo from '../../repositories/usersRepo.ts';
import * as realPermissions from '../../utils/permissions.ts';

// Snapshot the real exports BEFORE mock.module fires so afterAll can restore them. We only
// mock the repos to PROVE authenticateToken rejects a purpose token before any repo access —
// the purpose check sits ahead of findAuthUserById in the middleware.
const usersRepoSnapshot = { ...realUsersRepo };
const rolesRepoSnapshot = { ...realRolesRepo };
const permissionsSnapshot = { ...realPermissions };

const findAuthUserByIdMock = mock();
const userHasRoleMock = mock();
const getRolePermissionsMock = mock();

beforeAll(() => {
  mock.module('../../repositories/usersRepo.ts', () => ({
    ...usersRepoSnapshot,
    findAuthUserById: findAuthUserByIdMock,
  }));
  mock.module('../../repositories/rolesRepo.ts', () => ({
    ...rolesRepoSnapshot,
    userHasRole: userHasRoleMock,
  }));
  mock.module('../../utils/permissions.ts', () => ({
    ...permissionsSnapshot,
    getRolePermissions: getRolePermissionsMock,
  }));
});

afterAll(() => {
  mock.module('../../repositories/usersRepo.ts', () => usersRepoSnapshot);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnapshot);
  mock.module('../../utils/permissions.ts', () => permissionsSnapshot);
});

type FakeReply = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sentCount: number;
  code(c: number): FakeReply;
  send(body: unknown): FakeReply;
  header(name: string, value: string): FakeReply;
};

const buildFakeReply = (): FakeReply => {
  const reply: FakeReply = {
    statusCode: 0,
    body: undefined,
    headers: {},
    sentCount: 0,
    code(c: number) {
      reply.statusCode = c;
      return reply;
    },
    send(body: unknown) {
      reply.sentCount += 1;
      reply.body = body;
      return reply;
    },
    header(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return reply;
    },
  };
  return reply;
};

type FakeRequest = {
  headers: Record<string, string | undefined>;
  user?: unknown;
  enrollUserId?: string;
};

const buildFakeRequest = (token?: string): FakeRequest => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

beforeEach(() => {
  findAuthUserByIdMock.mockReset();
  userHasRoleMock.mockReset();
  getRolePermissionsMock.mockReset();
  // Make every repo call succeed if (incorrectly) reached, so a passing assertion that the
  // repo was NOT called reflects the guard ordering rather than a downstream failure.
  findAuthUserByIdMock.mockResolvedValue(null);
  userHasRoleMock.mockResolvedValue(true);
  getRolePermissionsMock.mockResolvedValue([]);
});

describe('signPurposeToken + verifyPurposeToken round-trip', () => {
  test('a totp_challenge token verifies back to its userId', () => {
    const token = signPurposeToken({ userId: 'u1', purpose: 'totp_challenge' }, '5m');
    expect(verifyPurposeToken(token, 'totp_challenge')).toEqual({ userId: 'u1' });
  });

  test('a totp_enroll token verifies back to its userId', () => {
    const token = signPurposeToken({ userId: 'enrollee-7', purpose: 'totp_enroll' }, '10m');
    expect(verifyPurposeToken(token, 'totp_enroll')).toEqual({ userId: 'enrollee-7' });
  });

  test('the signed token carries no sessionStart/sessionVersion claims', () => {
    const token = signPurposeToken({ userId: 'u1', purpose: 'totp_challenge' }, '5m');
    const decoded = jwt.decode(token) as jwt.JwtPayload & {
      purpose?: string;
      sessionStart?: unknown;
      sessionVersion?: unknown;
    };
    expect(decoded.purpose).toBe('totp_challenge');
    expect(decoded.userId).toBe('u1');
    expect(decoded.sessionStart).toBeUndefined();
    expect(decoded.sessionVersion).toBeUndefined();
  });
});

describe('verifyPurposeToken rejection paths', () => {
  test('throws when the purpose does not match the expected purpose', () => {
    // Signed as enroll, verified as challenge: a token must only unlock the step it names.
    const token = signPurposeToken({ userId: 'u1', purpose: 'totp_enroll' }, '5m');
    expect(() => verifyPurposeToken(token, 'totp_challenge')).toThrow();
  });

  test('throws on a tampered token (broken signature)', () => {
    const token = signPurposeToken({ userId: 'u1', purpose: 'totp_challenge' }, '5m');
    // Flip the final character of the signature segment to invalidate the HMAC.
    const lastChar = token.slice(-1);
    const tampered = `${token.slice(0, -1)}${lastChar === 'a' ? 'b' : 'a'}`;
    expect(tampered).not.toBe(token);
    expect(() => verifyPurposeToken(tampered, 'totp_challenge')).toThrow();
  });

  test('throws on an expired token', () => {
    const expired = signPurposeToken({ userId: 'u1', purpose: 'totp_challenge' }, '-1s');
    expect(() => verifyPurposeToken(expired, 'totp_challenge')).toThrow();
  });
});

describe('authenticateToken rejects purpose tokens', () => {
  test('401 invalid_token_purpose for a totp_challenge token, before any repo access', async () => {
    const token = signPurposeToken({ userId: 'u1', purpose: 'totp_challenge' }, '5m');
    const request = buildFakeRequest(token);
    const reply = buildFakeReply();

    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({
      error: 'Invalid or expired token',
      errorCode: 'invalid_token_purpose',
    });
    // The purpose guard sits ahead of the sessionStart/sessionVersion checks and the user load.
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
    expect(reply.headers['x-auth-token']).toBeUndefined();
  });

  test('401 invalid_token_purpose for a totp_enroll token as well', async () => {
    const token = signPurposeToken({ userId: 'u1', purpose: 'totp_enroll' }, '5m');
    const request = buildFakeRequest(token);
    const reply = buildFakeReply();

    await authenticateToken(request as never, reply as never);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({
      error: 'Invalid or expired token',
      errorCode: 'invalid_token_purpose',
    });
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
  });
});

describe('requireEnrollOrSession', () => {
  test('a valid totp_enroll token sets request.enrollUserId and not request.user', async () => {
    const token = signPurposeToken({ userId: 'enrollee-9', purpose: 'totp_enroll' }, '10m');
    const request = buildFakeRequest(token);
    const reply = buildFakeReply();

    await requireEnrollOrSession(request as never, reply as never);

    expect(request.enrollUserId).toBe('enrollee-9');
    expect(request.user).toBeUndefined();
    // It short-circuits on the enroll token; the session path (and its repo reads) never runs.
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
    expect(findAuthUserByIdMock).not.toHaveBeenCalled();
  });

  test('401 Access token required when the Authorization header is missing', async () => {
    const request = buildFakeRequest();
    const reply = buildFakeReply();

    await requireEnrollOrSession(request as never, reply as never);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: 'Access token required' });
    expect(request.enrollUserId).toBeUndefined();
    expect(request.user).toBeUndefined();
  });
});
