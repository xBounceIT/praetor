import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as emailRepo from '../../repositories/emailRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// drizzle-orm/node-postgres uses rowMode: 'array' for select queries; rows are positional
// in the projection-declaration order from `EMAIL_PROJECTION` in emailRepo.ts:
// [enabled, smtpHost, smtpPort, smtpEncryption, smtpRejectUnauthorized,
//  smtpUser, smtpPassword, fromEmail, fromName]
const baseRow: unknown[] = [false, '', 587, 'tls', true, '', '', '', 'Praetor'];

describe('get', () => {
  test('returns null when SELECT returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    const result = await emailRepo.get(testDb);
    expect(result).toBeNull();
  });

  test('returns the row mapped to EmailConfig when present', async () => {
    exec.enqueue({
      rows: [
        [
          true,
          'smtp.example.com',
          465,
          'ssl',
          true,
          'noreply@example.com',
          'enc:ciphertext',
          'noreply@example.com',
          'Acme',
        ],
      ],
    });
    const result = await emailRepo.get(testDb);
    expect(result).toEqual({
      enabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpEncryption: 'ssl',
      smtpRejectUnauthorized: true,
      smtpUser: 'noreply@example.com',
      smtpPassword: 'enc:ciphertext',
      fromEmail: 'noreply@example.com',
      fromName: 'Acme',
    });
  });

  test('normalizes a legacy smtpEncryption value to tls', async () => {
    const row = baseRow.slice();
    row[3] = 'starttls';
    exec.enqueue({ rows: [row] });
    const result = await emailRepo.get(testDb);
    expect(result?.smtpEncryption).toBe('tls');
  });

  test('targets the singleton row via WHERE id = 1', async () => {
    exec.enqueue({ rows: [] });
    await emailRepo.get(testDb);
    expect(exec.calls[0].sql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(exec.calls[0].params).toContain(1);
  });
});

describe('update', () => {
  test('throws the seed-missing guard when UPDATE returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    await expect(emailRepo.update({}, testDb)).rejects.toThrow(
      /email_config row \(id=1\) not found/,
    );
  });

  test('passes patch values as bound parameters', async () => {
    exec.enqueue({ rows: [baseRow] });
    await emailRepo.update(
      {
        enabled: true,
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpEncryption: 'ssl',
        smtpRejectUnauthorized: false,
        smtpUser: 'noreply@example.com',
        smtpPasswordCiphertext: 'enc:ciphertext',
        fromEmail: 'noreply@example.com',
        fromName: 'Acme',
      },
      testDb,
    );
    const params = exec.calls[0].params;
    expect(params).toContain(true);
    expect(params).toContain('smtp.example.com');
    expect(params).toContain(465);
    expect(params).toContain('ssl');
    expect(params).toContain(false);
    expect(params).toContain('noreply@example.com');
    expect(params).toContain('enc:ciphertext');
    expect(params).toContain('Acme');
  });

  test('binds null for omitted patch fields (COALESCE preserves the existing column)', async () => {
    exec.enqueue({ rows: [baseRow] });
    await emailRepo.update({ fromName: 'Acme' }, testDb);
    const params = exec.calls[0].params;
    // The COALESCE pattern binds NULL for every undefined patch field, plus the explicit
    // value for the field that's set. Exact null-count is implementation detail; what matters
    // is that the explicit value is bound and the SET clause covers every column.
    expect(params).toContain('Acme');
    expect(params.filter((p) => p === null).length).toBeGreaterThan(0);
  });

  test('binds the ciphertext (not the patch.smtpPassword field) when set', async () => {
    exec.enqueue({ rows: [baseRow] });
    await emailRepo.update({ smtpPasswordCiphertext: 'enc:ciphertext' }, testDb);
    expect(exec.calls[0].params).toContain('enc:ciphertext');
    // The patch type renames the password field; this test locks in that the renamed field
    // is what reaches `email_config.smtp_password`.
    expect(exec.calls[0].sql).toContain('"smtp_password"');
  });

  test('returns the row from RETURNING', async () => {
    const returned = baseRow.slice();
    returned[8] = 'Acme';
    exec.enqueue({ rows: [returned] });
    const result = await emailRepo.update({ fromName: 'Acme' }, testDb);
    expect(result.fromName).toBe('Acme');
  });

  test('normalizes a legacy smtpEncryption from RETURNING to tls', async () => {
    const returned = baseRow.slice();
    returned[3] = 'starttls';
    exec.enqueue({ rows: [returned] });
    const result = await emailRepo.update({ fromName: 'Acme' }, testDb);
    expect(result.smtpEncryption).toBe('tls');
  });

  test('targets the singleton row via WHERE id = 1', async () => {
    exec.enqueue({ rows: [baseRow] });
    await emailRepo.update({ fromName: 'Acme' }, testDb);
    expect(exec.calls[0].sql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(exec.calls[0].params).toContain(1);
  });
});

describe('DEFAULT_CONFIG', () => {
  test('matches the schema-default shape used as a fallback when seed is absent', () => {
    expect(emailRepo.DEFAULT_CONFIG).toEqual({
      enabled: false,
      smtpHost: '',
      smtpPort: 587,
      smtpEncryption: 'tls',
      smtpRejectUnauthorized: true,
      smtpUser: '',
      smtpPassword: '',
      fromEmail: '',
      fromName: 'Praetor',
    });
  });
});
