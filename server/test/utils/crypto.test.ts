import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import {
  __getEncryptionKeyCacheSizeForTests,
  __resetEncryptionKeyCacheForTests,
  __resetHmacKeyCacheForTests,
  decrypt,
  encrypt,
  getEncryptionKey,
  getHmacKey,
  isEncrypted,
  MASKED_SECRET,
} from '../../utils/crypto.ts';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const LEGACY_IV_LENGTH = 16;
const V2_IV_LENGTH = 12;
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

const deriveLegacyEncryptionKey = (key: string): Buffer =>
  crypto.createHash('sha256').update(key).digest();

const encryptWithAesGcmKey = (plaintext: string, key: Buffer): string => {
  const iv = crypto.randomBytes(LEGACY_IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decryptPayloadWithAesGcmKey = (
  ivB64: string,
  authTagB64: string,
  encryptedB64: string,
  key: Buffer,
): string => {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  return (
    decipher.update(Buffer.from(encryptedB64, 'base64'), undefined, 'utf8') + decipher.final('utf8')
  );
};

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests';
  __resetEncryptionKeyCacheForTests();
  __resetHmacKeyCacheForTests();
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  __resetEncryptionKeyCacheForTests();
  __resetHmacKeyCacheForTests();
});

describe('encrypt', () => {
  test('encrypts empty plaintext as a real ciphertext envelope', () => {
    const out = encrypt('');
    expect(out).not.toBe('');
    expect(isEncrypted(out)).toBe(true);
    expect(decrypt(out)).toBe('');
  });

  test('produces a versioned base64 string', () => {
    const out = encrypt('hello');
    const parts = out.split(':');
    expect(parts).toHaveLength(5);
    parts.forEach((p) => {
      expect(p.length).toBeGreaterThan(0);
    });
  });

  test('produces a different ciphertext on each call (random IV)', () => {
    const a = encrypt('same-plaintext');
    const b = encrypt('same-plaintext');
    expect(a).not.toBe(b);
  });

  test('produces a versioned value with random salt and AES-GCM metadata', () => {
    const out = encrypt('hello');
    const parts = out.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v2');
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(SALT_LENGTH);
    expect(Buffer.from(parts[2], 'base64')).toHaveLength(V2_IV_LENGTH);
    expect(Buffer.from(parts[3], 'base64')).toHaveLength(AUTH_TAG_LENGTH);
    expect(parts[4].length).toBeGreaterThan(0);
  });

  test('does not produce ciphertext decryptable with the legacy SHA-256-derived AES key', () => {
    const legacyKey = deriveLegacyEncryptionKey(process.env.ENCRYPTION_KEY ?? '');
    const ciphertext = encrypt('new secret');
    const [, , ivB64, authTagB64, encryptedB64] = ciphertext.split(':');
    expect(() => decryptPayloadWithAesGcmKey(ivB64, authTagB64, encryptedB64, legacyKey)).toThrow();
  });

  test('does not cache one-off keys for fresh random salts', () => {
    __resetEncryptionKeyCacheForTests();
    encrypt('first secret');
    encrypt('second secret');
    expect(__getEncryptionKeyCacheSizeForTests()).toBe(0);
  });
});

// Isolated in its own describe block so the missing-key state is set up in beforeAll
// and restored in afterAll. Keeping the deletion out of the test body removes the
// risk that a thrown assertion would leak the unset env var into later tests.
describe('encrypt without ENCRYPTION_KEY', () => {
  let savedKey: string | undefined;

  beforeAll(() => {
    savedKey = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    __resetEncryptionKeyCacheForTests();
    __resetHmacKeyCacheForTests();
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
    __resetEncryptionKeyCacheForTests();
    __resetHmacKeyCacheForTests();
  });

  test('throws when ENCRYPTION_KEY is missing', () => {
    expect(() => encrypt('whatever')).toThrow(/ENCRYPTION_KEY/);
  });

  test('getHmacKey throws when ENCRYPTION_KEY is missing', () => {
    expect(() => getHmacKey()).toThrow(/ENCRYPTION_KEY/);
  });
});

describe('getHmacKey', () => {
  test('returns a 32-byte Buffer', () => {
    const k = getHmacKey();
    expect(Buffer.isBuffer(k)).toBe(true);
    expect(k.length).toBe(32);
  });

  test('is deterministic across calls (cache hit)', () => {
    const a = getHmacKey();
    const b = getHmacKey();
    expect(a.equals(b)).toBe(true);
  });

  test('produces the same bytes after a cache reset with the same ENCRYPTION_KEY', () => {
    const before = Buffer.from(getHmacKey());
    __resetHmacKeyCacheForTests();
    const after = getHmacKey();
    expect(before.equals(after)).toBe(true);
  });

  test('differs from the AES key derived by getEncryptionKey (key separation, issue #416)', () => {
    expect(getHmacKey().equals(getEncryptionKey())).toBe(false);
  });

  test('produces different output when ENCRYPTION_KEY changes', () => {
    const original = Buffer.from(getHmacKey());
    const savedKey = process.env.ENCRYPTION_KEY;
    try {
      process.env.ENCRYPTION_KEY = `${savedKey}-rotated`;
      __resetHmacKeyCacheForTests();
      expect(getHmacKey().equals(original)).toBe(false);
    } finally {
      process.env.ENCRYPTION_KEY = savedKey;
      __resetHmacKeyCacheForTests();
    }
  });
});

describe('getEncryptionKey', () => {
  test('does not use a single SHA-256 digest for AES key derivation (issue #496)', () => {
    const legacyKey = deriveLegacyEncryptionKey(process.env.ENCRYPTION_KEY ?? '');
    const key = getEncryptionKey();
    expect(key.length).toBe(32);
    expect(key.equals(legacyKey)).toBe(false);
  });

  test('uses the salt as key-derivation input', () => {
    const first = getEncryptionKey(Buffer.alloc(SALT_LENGTH, 1));
    const second = getEncryptionKey(Buffer.alloc(SALT_LENGTH, 2));
    expect(first.equals(second)).toBe(false);
  });

  test('caches decrypt-side key derivations by salt', () => {
    __resetEncryptionKeyCacheForTests();
    const salt = Buffer.alloc(SALT_LENGTH, 3);
    const first = getEncryptionKey(salt);
    const second = getEncryptionKey(salt);
    expect(first).toBe(second);
    expect(__getEncryptionKeyCacheSizeForTests()).toBe(1);
  });
});

describe('decrypt', () => {
  test('throws for empty ciphertext input', () => {
    expect(() => decrypt('')).toThrow(/Invalid encrypted value format/);
  });

  test('round-trips ASCII plaintext', () => {
    const plaintext = 'hello world';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test('round-trips unicode plaintext', () => {
    const plaintext = 'Pàssword with émojis 🔐 - ok?';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test('round-trips strings containing colons (no false legacy detection)', () => {
    const plaintext = 'host:1234:secret';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test('decrypts legacy SHA-256-derived ciphertext for backward compatibility', () => {
    const legacyKey = deriveLegacyEncryptionKey(process.env.ENCRYPTION_KEY ?? '');
    const ciphertext = encryptWithAesGcmKey('legacy secret', legacyKey);
    expect(decrypt(ciphertext)).toBe('legacy secret');
  });

  test('throws when input does not match the iv:authTag:encrypted format', () => {
    expect(() => decrypt('plaintext-no-colons')).toThrow(/Invalid encrypted value format/);
  });

  test('throws when ciphertext parses but GCM auth tag verification fails', () => {
    const fakeCiphertext = `${Buffer.from('iv').toString('base64')}:${Buffer.from('tag').toString('base64')}:${Buffer.from('data').toString('base64')}`;
    expect(() => decrypt(fakeCiphertext)).toThrow();
  });

  test('throws when a real ciphertext has a tampered auth tag', () => {
    const real = encrypt('a real secret');
    const [version, salt, iv, tag, data] = real.split(':');
    const tagBytes = Buffer.from(tag, 'base64');
    tagBytes[0] ^= 0xff;
    const tampered = `${version}:${salt}:${iv}:${tagBytes.toString('base64')}:${data}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe('isEncrypted', () => {
  test('recognizes new versioned ciphertext', () => {
    expect(isEncrypted(encrypt('secret'))).toBe(true);
  });

  test('recognizes legacy three-part ciphertext', () => {
    const legacyKey = deriveLegacyEncryptionKey(process.env.ENCRYPTION_KEY ?? '');
    expect(isEncrypted(encryptWithAesGcmKey('legacy secret', legacyKey))).toBe(true);
  });

  test('does not treat colon-delimited plaintext as ciphertext', () => {
    expect(isEncrypted('host:1234:secret')).toBe(false);
  });
});

describe('MASKED_SECRET', () => {
  test('is a stable masking placeholder', () => {
    expect(MASKED_SECRET).toBe('********');
  });
});
