import jwt from 'jsonwebtoken';

const TEST_JWT_SECRET = process.env.JWT_SECRET || 'praetor-test-jwt-secret';

const SESSION_MAX_DURATION_MS = 8 * 60 * 60 * 1000;

export type SignTokenInput = {
  userId: string;
  // Pass null to omit the claim entirely (simulates pre-feature / forged tokens).
  sessionStart?: number | null;
  activeRole?: string;
  // Pass null to omit the claim entirely (simulates pre-feature tokens).
  sessionVersion?: number | null;
  expiresIn?: jwt.SignOptions['expiresIn'];
  issuedAtSeconds?: number;
  secret?: string;
};

export const signToken = ({
  userId,
  sessionStart = Date.now(),
  activeRole,
  sessionVersion = 1,
  expiresIn = '30m',
  issuedAtSeconds,
  secret = TEST_JWT_SECRET,
}: SignTokenInput): string => {
  const payload: Record<string, unknown> = { userId, activeRole };
  if (sessionStart !== null) payload.sessionStart = sessionStart;
  if (sessionVersion !== null) payload.sessionVersion = sessionVersion;
  if (issuedAtSeconds !== undefined) payload.iat = issuedAtSeconds;
  return jwt.sign(payload, secret, { expiresIn });
};

export const signExpiredToken = (userId: string): string => signToken({ userId, expiresIn: '-1s' });

export const signOverMaxSessionToken = (userId: string): string =>
  signToken({ userId, sessionStart: Date.now() - SESSION_MAX_DURATION_MS - 60_000 });

export const decodeForAssertion = (token: string): jwt.JwtPayload =>
  jwt.verify(token, TEST_JWT_SECRET) as jwt.JwtPayload;
