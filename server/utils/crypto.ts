import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

export const MASKED_SECRET = '********';

// SHA-256 of ENCRYPTION_KEY: a stable 32-byte buffer used as the AES-256 key for
// encrypt/decrypt and as the HMAC key for PAT / MCP-token hashing. Memoized because PAT auth
// runs on every authenticated request; ENCRYPTION_KEY is process-stable so this is safe.
let cachedEncryptionKey: Buffer | null = null;
export function getEncryptionKey(): Buffer {
  if (cachedEncryptionKey !== null) return cachedEncryptionKey;
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  cachedEncryptionKey = crypto.createHash('sha256').update(key).digest();
  return cachedEncryptionKey;
}

export const __resetEncryptionKeyCacheForTests = () => {
  cachedEncryptionKey = null;
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

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return '';
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Invalid encrypted value format');
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
