import { authenticator } from '@otplib/preset-v11';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { decrypt, isEncrypted } from './crypto.ts';

// TOTP (RFC 6238) two-factor authentication helpers. Built on otplib's v11-compatible
// `authenticator` preset (the v13 main package only ships the async functional API; the preset
// re-exposes the classic synchronous `generateSecret`/`keyuri`/`check` surface). Secrets are
// base32; callers encrypt them at rest with `crypto.ts` before persisting and decrypt only to
// verify a submitted code. Backup (recovery) codes are stored as bcrypt hashes — never plaintext.

// `window: 1` accepts the immediately-preceding and -following 30s steps in addition to the
// current one, tolerating modest clock skew between the server and the user's authenticator app.
authenticator.options = { window: 1 };

// Branding shown in authenticator apps and embedded in the otpauth URI's `issuer` parameter.
const TOTP_ISSUER = 'Praetor';

// Backup-code alphabet deliberately excludes visually ambiguous characters (0/o, 1/l/i) so codes
// transcribed by hand are unlikely to be misread. Codes are drawn from `crypto.randomBytes` via
// rejection sampling, never a non-cryptographic RNG.
const BACKUP_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const BACKUP_CODE_GROUP_LENGTH = 5;
const BACKUP_CODE_GROUPS = 2;
const DEFAULT_BACKUP_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 12;

/** Generate a fresh base32 TOTP secret for enrollment. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Build the `otpauth://totp/Praetor:<label>?...&issuer=Praetor` URI a user scans to enrol a TOTP
 * authenticator. `accountLabel` is typically the username or email.
 */
export function buildOtpAuthUri(secret: string, accountLabel: string): string {
  return authenticator.keyuri(accountLabel, TOTP_ISSUER, secret);
}

/** Render an otpauth URI to a `data:image/png;base64,...` data URI for display as a QR code. */
export function buildQrDataUri(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri);
}

/**
 * Decrypts a stored TOTP secret, returning `null` if it cannot be recovered. Stored values are
 * always `encrypt()` output; the `isEncrypted` guard keeps a (mis)stored plaintext secret from
 * being fed into `decrypt()` (which would throw). `decrypt()` can still throw on tampered ciphertext
 * (GCM auth-tag mismatch) or a rotated/lost `ENCRYPTION_KEY`; we swallow that and return `null` so
 * the shared verify path (`verifyTotpCode`) fails closed with the generic "invalid code" response
 * instead of letting a 500 escape — which would turn an undecryptable secret into an oracle. Shared
 * by every endpoint that verifies a code so the guard is applied uniformly.
 */
export function decryptTotpSecret(stored: string): string | null {
  try {
    return isEncrypted(stored) ? decrypt(stored) : stored;
  } catch {
    return null;
  }
}

/**
 * Verify a user-submitted TOTP code against the secret. A `null` secret (an undecryptable stored
 * value — see `decryptTotpSecret`) short-circuits to false. Whitespace is stripped (authenticator
 * apps display codes as `123 456`); an empty token short-circuits to false, and any malformed
 * token or secret that makes otplib throw is caught and treated as a rejected code. Honours the
 * `window: 1` skew tolerance configured above.
 */
export function verifyTotpCode(secret: string | null, token: string): boolean {
  if (secret === null) return false;
  const normalized = token.replace(/\s+/g, '');
  if (!normalized) return false;
  try {
    return authenticator.check(normalized, secret);
  } catch {
    // otplib throws on malformed secrets/tokens; treat any failure as a rejected code.
    return false;
  }
}

// Draw a single alphabet character with rejection sampling so every character is uniformly
// distributed (no modulo bias toward the start of the alphabet).
const randomAlphabetChar = (): string => {
  const max = Math.floor(256 / BACKUP_CODE_ALPHABET.length) * BACKUP_CODE_ALPHABET.length;
  let byte: number;
  do {
    byte = crypto.randomBytes(1)[0];
  } while (byte >= max);
  return BACKUP_CODE_ALPHABET[byte % BACKUP_CODE_ALPHABET.length];
};

const generateBackupCode = (): string =>
  Array.from({ length: BACKUP_CODE_GROUPS }, () =>
    Array.from({ length: BACKUP_CODE_GROUP_LENGTH }, randomAlphabetChar).join(''),
  ).join('-');

/**
 * Generate `count` (default 10) single-use backup codes formatted like `"abcde-fghij"`. These are
 * the plaintext codes shown to the user once; only their bcrypt hashes are persisted.
 */
export function generateBackupCodes(count: number = DEFAULT_BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, generateBackupCode);
}

// Canonicalize a backup code for hashing/comparison: lowercase, drop all non-alphanumerics, then
// regroup into `abcde-fghij`. This lets a user re-enter a code as `ABCDE-FGHIJ`, `abcde fghij`, or
// `abcdefghij` and still match. Generated codes are already canonical, so hashing is a no-op shift.
const canonicalizeBackupCode = (code: string): string => {
  const stripped = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  const expectedLength = BACKUP_CODE_GROUP_LENGTH * BACKUP_CODE_GROUPS;
  if (stripped.length !== expectedLength) return stripped;
  return `${stripped.slice(0, BACKUP_CODE_GROUP_LENGTH)}-${stripped.slice(BACKUP_CODE_GROUP_LENGTH)}`;
};

/** Hash a backup code for storage. Input is canonicalized first so verification can mirror it. */
export function hashBackupCode(code: string): Promise<string> {
  return bcrypt.hash(canonicalizeBackupCode(code), BCRYPT_ROUNDS);
}

/** Verify a user-submitted backup code against a stored bcrypt hash. */
export function verifyBackupCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(canonicalizeBackupCode(code), hash);
}
