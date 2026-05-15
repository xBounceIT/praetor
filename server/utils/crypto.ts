import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_FORMAT_VERSION = 'v2';
const LEGACY_IV_LENGTH = 16;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const AES_KEY_LENGTH = 32;
const ENCRYPTION_KEY_ITERATIONS = 600_000;
const DEFAULT_ENCRYPTION_KEY_SALT = Buffer.from('praetor:aes-256-gcm-encryption:default', 'utf8');
const ENCRYPTION_KEY_DIGEST = 'sha256';

export const MASKED_SECRET = '********';

// AES-256 key for encrypt/decrypt: PBKDF2-derived from ENCRYPTION_KEY and a per-ciphertext
// salt. The derivation is intentionally slower than a single SHA-256 pass to make offline
// guessing of human-chosen deployment keys more expensive. Decrypt-side keys are memoized by
// salt because stored config secrets are process-stable between edits; encrypt-side keys use
// fresh salts and skip the cache.
//
// Do NOT use this key for HMAC or other non-AES primitives — use `getHmacKey()` for
// HMAC-keyed hashing (issue #416). Reusing the same key across primitives couples
// otherwise-independent security boundaries.
const cachedEncryptionKeys = new Map<string, Buffer>();
let cachedLegacyEncryptionKey: Buffer | null = null;

const getRequiredEncryptionKey = (): string => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  return key;
};

const deriveEncryptionKey = (salt: Buffer): Buffer =>
  crypto.pbkdf2Sync(
    Buffer.from(getRequiredEncryptionKey(), 'utf8'),
    salt,
    ENCRYPTION_KEY_ITERATIONS,
    AES_KEY_LENGTH,
    ENCRYPTION_KEY_DIGEST,
  );

export function getEncryptionKey(salt: Buffer = DEFAULT_ENCRYPTION_KEY_SALT): Buffer {
  const cacheKey = salt.toString('base64');
  const cached = cachedEncryptionKeys.get(cacheKey);
  if (cached) return cached;
  const derived = deriveEncryptionKey(salt);
  cachedEncryptionKeys.set(cacheKey, derived);
  return derived;
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
  cachedEncryptionKeys.clear();
  cachedLegacyEncryptionKey = null;
};

export const __getEncryptionKeyCacheSizeForTests = () => cachedEncryptionKeys.size;

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

// Heuristic test for `encrypt()`'s output shape. Validates encoded segments decode to
// expected byte lengths, so legacy plaintext with colon separators is correctly classified
// as plaintext rather than getting routed into `decrypt()`. A true positive still has to
// pass GCM authentication — corrupted ciphertext that passes this shape check will throw.
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length === 3) {
    const [ivB64, authTagB64] = parts;
    if (!ivB64 || !authTagB64) return false;
    return (
      Buffer.from(ivB64, 'base64').length === LEGACY_IV_LENGTH &&
      Buffer.from(authTagB64, 'base64').length === AUTH_TAG_LENGTH
    );
  }
  if (parts.length !== 5 || parts[0] !== ENCRYPTION_FORMAT_VERSION) return false;
  const [, saltB64, ivB64, authTagB64] = parts;
  if (!saltB64 || !ivB64 || !authTagB64) return false;
  return (
    Buffer.from(saltB64, 'base64').length === SALT_LENGTH &&
    Buffer.from(ivB64, 'base64').length === IV_LENGTH &&
    Buffer.from(authTagB64, 'base64').length === AUTH_TAG_LENGTH
  );
}

export function encrypt(plaintext: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveEncryptionKey(salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ENCRYPTION_FORMAT_VERSION,
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

type EncryptedPayload = {
  salt: Buffer | null;
  iv: Buffer;
  authTag: Buffer;
  encrypted: Buffer;
};

const parseEncryptedPayload = (ciphertext: string): EncryptedPayload => {
  const parts = ciphertext.split(':');
  if (parts.length === 5 && parts[0] === ENCRYPTION_FORMAT_VERSION) {
    const [, saltB64, ivB64, authTagB64, encryptedB64] = parts;
    if (!saltB64 || !ivB64 || !authTagB64) {
      throw new Error('Invalid encrypted value format');
    }
    return {
      salt: Buffer.from(saltB64, 'base64'),
      iv: Buffer.from(ivB64, 'base64'),
      authTag: Buffer.from(authTagB64, 'base64'),
      encrypted: Buffer.from(encryptedB64, 'base64'),
    };
  }
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }
  const [ivB64, authTagB64, encryptedB64] = parts;
  if (!ivB64 || !authTagB64) {
    throw new Error('Invalid encrypted value format');
  }
  return {
    salt: null,
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
  const payload = parseEncryptedPayload(ciphertext);
  if (payload.salt) {
    return decryptWithKey(payload, getEncryptionKey(payload.salt));
  }
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
