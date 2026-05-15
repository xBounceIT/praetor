import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AES_KEY_LENGTH = 32;
const ENCRYPTION_KEY_ITERATIONS = 600_000;
const ENCRYPTION_KEY_SALT = 'praetor:aes-256-gcm-encryption:v2';
const ENCRYPTION_KEY_DIGEST = 'sha256';

export const MASKED_SECRET = '********';

// AES-256 key for encrypt/decrypt: PBKDF2-derived from ENCRYPTION_KEY. The derivation is
// intentionally slower than a single SHA-256 pass to make offline guessing of human-chosen
// deployment keys more expensive. Memoized because ENCRYPTION_KEY is process-stable.
//
// Do NOT use this key for HMAC or other non-AES primitives — use `getHmacKey()` for
// HMAC-keyed hashing (issue #416). Reusing the same key across primitives couples
// otherwise-independent security boundaries.
let cachedEncryptionKey: Buffer | null = null;
let cachedLegacyEncryptionKey: Buffer | null = null;

const getRequiredEncryptionKey = (): string => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  return key;
};

export function getEncryptionKey(): Buffer {
  if (cachedEncryptionKey !== null) return cachedEncryptionKey;
  const key = getRequiredEncryptionKey();
  cachedEncryptionKey = crypto.pbkdf2Sync(
    Buffer.from(key, 'utf8'),
    ENCRYPTION_KEY_SALT,
    ENCRYPTION_KEY_ITERATIONS,
    AES_KEY_LENGTH,
    ENCRYPTION_KEY_DIGEST,
  );
  return cachedEncryptionKey;
}

const getLegacyEncryptionKey = (): Buffer => {
  if (cachedLegacyEncryptionKey !== null) return cachedLegacyEncryptionKey;
  cachedLegacyEncryptionKey = crypto
    .createHash('sha256')
    .update(getRequiredEncryptionKey())
    .digest();
  return cachedLegacyEncryptionKey;
};

export const __resetEncryptionKeyCacheForTests = () => {
  cachedEncryptionKey = null;
  cachedLegacyEncryptionKey = null;
};

// HMAC key for PAT / MCP-token hashing: HKDF-derived from ENCRYPTION_KEY with a
// domain-separation label, independent from the AES key (issue #416). Memoized because PAT/MCP
// auth runs on every authenticated request.
const HMAC_HKDF_INFO = 'praetor:hmac-token-hashing:v1';
let cachedHmacKey: Buffer | null = null;
export function getHmacKey(): Buffer {
  if (cachedHmacKey !== null) return cachedHmacKey;
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(key, 'utf8'),
    Buffer.alloc(0),
    HMAC_HKDF_INFO,
    32,
  );
  cachedHmacKey = Buffer.from(derived);
  return cachedHmacKey;
}

export const __resetHmacKeyCacheForTests = () => {
  cachedHmacKey = null;
};

// Heuristic test for `encrypt()`'s output shape. Validates the IV and auth-tag base64
// segments decode to exactly the expected byte lengths, so legacy plaintext that happens
// to contain two colons (e.g. `foo:bar:baz`) is correctly classified as plaintext rather
// than getting routed into `decrypt()`. A true positive still has to pass GCM
// authentication — corrupted ciphertext that passes this shape check will throw from
// `decrypt()`'s `decipher.final()`.
const AUTH_TAG_LENGTH = 16;
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [ivB64, authTagB64, encryptedB64] = parts;
  if (!ivB64 || !authTagB64 || !encryptedB64) return false;
  return (
    Buffer.from(ivB64, 'base64').length === IV_LENGTH &&
    Buffer.from(authTagB64, 'base64').length === AUTH_TAG_LENGTH
  );
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:encrypted (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

type EncryptedPayload = {
  iv: Buffer;
  authTag: Buffer;
  encrypted: Buffer;
};

const parseEncryptedPayload = (ciphertext: string): EncryptedPayload => {
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Invalid encrypted value format');
  }
  return {
    iv: Buffer.from(ivB64, 'base64'),
    authTag: Buffer.from(authTagB64, 'base64'),
    encrypted: Buffer.from(encryptedB64, 'base64'),
  };
};

const decryptWithKey = (payload: EncryptedPayload, key: Buffer): string => {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.encrypted), decipher.final()]).toString('utf8');
};

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return '';
  const payload = parseEncryptedPayload(ciphertext);
  try {
    return decryptWithKey(payload, getEncryptionKey());
  } catch (err) {
    try {
      return decryptWithKey(payload, getLegacyEncryptionKey());
    } catch {
      throw err;
    }
  }
}
