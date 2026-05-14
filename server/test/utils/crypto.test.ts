import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  __resetEncryptionKeyCacheForTests,
  __resetHmacKeyCacheForTests,
  decrypt,
  encrypt,
  getEncryptionKey,
  getHmacKey,
  MASKED_SECRET,
} from '../../utils/crypto.ts';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

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
  test('returns empty string for empty input', () => {
    expect(encrypt('')).toBe('');
  });

  test('produces a three-part base64 string (iv:authTag:ciphertext)', () => {
    const out = encrypt('hello');
    const parts = out.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach((p) => {
      expect(p.length).toBeGreaterThan(0);
    });
  });

  test('produces a different ciphertext on each call (random IV)', () => {
    const a = encrypt('same-plaintext');
    const b = encrypt('same-plaintext');
    expect(a).not.toBe(b);
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

describe('decrypt', () => {
  test('returns empty string for empty input', () => {
    expect(decrypt('')).toBe('');
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

  test('throws when input does not match the iv:authTag:encrypted format', () => {
    expect(() => decrypt('plaintext-no-colons')).toThrow(/Invalid encrypted value format/);
  });

  test('throws when ciphertext parses but GCM auth tag verification fails', () => {
    const fakeCiphertext = `${Buffer.from('iv').toString('base64')}:${Buffer.from('tag').toString('base64')}:${Buffer.from('data').toString('base64')}`;
    expect(() => decrypt(fakeCiphertext)).toThrow();
  });

  test('throws when a real ciphertext has a tampered auth tag', () => {
    const real = encrypt('a real secret');
    const [iv, tag, data] = real.split(':');
    const tagBytes = Buffer.from(tag, 'base64');
    tagBytes[0] ^= 0xff;
    const tampered = `${iv}:${tagBytes.toString('base64')}:${data}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe('MASKED_SECRET', () => {
  test('is a stable masking placeholder', () => {
    expect(MASKED_SECRET).toBe('********');
  });
});
