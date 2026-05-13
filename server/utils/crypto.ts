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
