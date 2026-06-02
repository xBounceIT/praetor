import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { authenticator } from '@otplib/preset-v11';
import {
  buildOtpAuthUri,
  buildQrDataUri,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyBackupCode,
  verifyTotpCode,
} from '../../utils/totp.ts';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const BACKUP_CODE_PATTERN = /^[a-z2-9]{5}-[a-z2-9]{5}$/;

beforeAll(() => {
  // The TOTP/backup helpers under test rely on otplib + bcrypt directly and do not read
  // ENCRYPTION_KEY, but we set it defensively so importing sibling modules can't throw and to
  // mirror the documented backend test convention.
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!!';
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe('generateTotpSecret', () => {
  test('returns a non-empty base32 string', () => {
    const secret = generateTotpSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(0);
    // RFC 4648 base32 alphabet (otplib emits uppercase, unpadded).
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  test('produces a different secret on each call', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe('buildOtpAuthUri', () => {
  test('builds an otpauth URI scoped to the Praetor issuer and account label', () => {
    const secret = generateTotpSecret();
    const uri = buildOtpAuthUri(secret, 'alice');
    expect(uri.startsWith('otpauth://totp/Praetor:alice')).toBe(true);
    expect(uri).toContain('issuer=Praetor');
    expect(uri).toContain(`secret=${secret}`);
  });
});

describe('buildQrDataUri', () => {
  test('renders an otpauth URI to a PNG data URI string', async () => {
    const secret = generateTotpSecret();
    const uri = buildOtpAuthUri(secret, 'alice');
    const dataUri = await buildQrDataUri(uri);
    expect(typeof dataUri).toBe('string');
    expect(dataUri.startsWith('data:image/png')).toBe(true);
  });
});

describe('verifyTotpCode', () => {
  test('accepts a freshly generated code for the secret', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  test('accepts a code with surrounding and embedded whitespace', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    const spaced = `  ${code.slice(0, 3)} ${code.slice(3)}  `;
    expect(verifyTotpCode(secret, spaced)).toBe(true);
  });

  test('rejects a wrong numeric code', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    // Flip the last digit to guarantee a different 6-digit code.
    const lastDigit = Number(code.slice(-1));
    const wrong = `${code.slice(0, -1)}${(lastDigit + 1) % 10}`;
    expect(verifyTotpCode(secret, wrong)).toBe(false);
  });

  test('rejects an empty / whitespace-only token without reaching otplib', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '')).toBe(false);
    expect(verifyTotpCode(secret, '   ')).toBe(false);
  });

  test('rejects a non-numeric token', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, 'abcdef')).toBe(false);
  });

  test('never throws on a malformed secret, returning false instead', () => {
    const code = authenticator.generate(generateTotpSecret());
    expect(() => verifyTotpCode('not-a-valid-base32-secret!!', code)).not.toThrow();
    expect(verifyTotpCode('not-a-valid-base32-secret!!', code)).toBe(false);
    expect(verifyTotpCode('', code)).toBe(false);
  });
});

describe('generateBackupCodes', () => {
  test('returns 10 codes by default, all matching the canonical format', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(BACKUP_CODE_PATTERN);
    }
  });

  test('honours an explicit count', () => {
    expect(generateBackupCodes(3)).toHaveLength(3);
    expect(generateBackupCodes(25)).toHaveLength(25);
  });

  test('produces no duplicate codes', () => {
    const codes = generateBackupCodes(50);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('hashBackupCode / verifyBackupCode', () => {
  test('round-trips a generated code', async () => {
    const [code] = generateBackupCodes(1);
    const hash = await hashBackupCode(code);
    expect(await verifyBackupCode(code, hash)).toBe(true);
  });

  test('produces a hash distinct from the plaintext code', async () => {
    const [code] = generateBackupCodes(1);
    const hash = await hashBackupCode(code);
    expect(hash).not.toBe(code);
    expect(hash.startsWith('$2')).toBe(true); // bcrypt hash prefix
  });

  test('rejects a different code', async () => {
    const [code, other] = generateBackupCodes(2);
    const hash = await hashBackupCode(code);
    expect(await verifyBackupCode(other, hash)).toBe(false);
  });

  test('canonicalizes input: uppercased, spaced, and dash-less variants all verify', async () => {
    const [code] = generateBackupCodes(1); // e.g. "abcde-fghij"
    const hash = await hashBackupCode(code);
    const compact = code.replace('-', '');

    expect(await verifyBackupCode(code.toUpperCase(), hash)).toBe(true);
    expect(await verifyBackupCode(`${compact.slice(0, 5)} ${compact.slice(5)}`, hash)).toBe(true);
    expect(await verifyBackupCode(compact, hash)).toBe(true);
    expect(await verifyBackupCode(`  ${code.toUpperCase()}  `, hash)).toBe(true);
  });
});
