import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { decrypt, encrypt, MASKED_SECRET } from '../../utils/crypto.ts';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests';
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe('encrypt', () => {
  test('returns empty string for empty input', () => {
    expect(encrypt('')).toBe('');
  });

  test('produces a three-part base64 string (iv:authTag:ciphertext)', () => {
    const out = encrypt('hello');
    const parts = out.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
  });

  test('produces a different ciphertext on each call (random IV)', () => {
    const a = encrypt('same-plaintext');
    const b = encrypt('same-plaintext');
    expect(a).not.toBe(b);
  });

  test('throws when ENCRYPTION_KEY is missing', () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(() => encrypt('whatever')).toThrow(/ENCRYPTION_KEY/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
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
    const plaintext = 'Pàssword with émojis 🔐 — ok?';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test('round-trips strings containing colons (no false legacy detection)', () => {
    const plaintext = 'host:1234:secret';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test('returns input unchanged when it does not look like encrypted format (legacy plaintext)', () => {
    expect(decrypt('legacy-plaintext-no-colons')).toBe('legacy-plaintext-no-colons');
  });

  test('returns ciphertext unchanged when iv/authTag/encrypted decode but auth tag fails (treats as legacy)', () => {
    // Three colon-separated base64 parts that aren't a valid GCM ciphertext should
    // hit the catch branch and be returned as-is rather than throwing.
    const fakeCiphertext = `${Buffer.from('iv').toString('base64')}:${Buffer.from('tag').toString('base64')}:${Buffer.from('data').toString('base64')}`;
    expect(decrypt(fakeCiphertext)).toBe(fakeCiphertext);
  });
});

describe('MASKED_SECRET', () => {
  test('is a stable masking placeholder', () => {
    expect(MASKED_SECRET).toBe('********');
  });
});
