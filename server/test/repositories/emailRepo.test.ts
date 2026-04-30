import { beforeEach, describe, expect, test } from 'bun:test';
import * as emailRepo from '../../repositories/emailRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const baseRow = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpEncryption: 'tls',
  smtpRejectUnauthorized: true,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: 'Praetor',
};

describe('get', () => {
  test('throws the seed-missing guard when SELECT returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    await expect(emailRepo.get(exec)).rejects.toThrow(/email_config row \(id=1\) not found/);
  });

  test('returns the row verbatim when present', async () => {
    exec.enqueue({
      rows: [
        {
          ...baseRow,
          enabled: true,
          smtpHost: 'smtp.example.com',
          smtpPort: 465,
          smtpEncryption: 'ssl',
          smtpUser: 'noreply@example.com',
          smtpPassword: 'enc:ciphertext',
          fromEmail: 'noreply@example.com',
          fromName: 'Acme',
        },
      ],
    });
    const result = await emailRepo.get(exec);
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
});

describe('update', () => {
  test('throws the seed-missing guard when UPDATE returns 0 rows', async () => {
    exec.enqueue({ rows: [] });
    await expect(emailRepo.update({}, exec)).rejects.toThrow(/email_config row \(id=1\) not found/);
  });

  test('passes patch values in declared column order', async () => {
    exec.enqueue({ rows: [baseRow] });
    await emailRepo.update(
      {
        enabled: true,
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpEncryption: 'ssl',
        smtpRejectUnauthorized: false,
        smtpUser: 'noreply@example.com',
        smtpPassword: 'enc:ciphertext',
        fromEmail: 'noreply@example.com',
        fromName: 'Acme',
      },
      exec,
    );
    expect(exec.calls[0].params).toEqual([
      true,
      'smtp.example.com',
      465,
      'ssl',
      false,
      'noreply@example.com',
      'enc:ciphertext',
      'noreply@example.com',
      'Acme',
    ]);
  });

  test('passes undefined for omitted patch fields', async () => {
    exec.enqueue({ rows: [baseRow] });
    await emailRepo.update({ fromName: 'Acme' }, exec);
    const params = exec.calls[0].params;
    expect(params).toHaveLength(9);
    expect(params[8]).toBe('Acme');
    expect(params[0]).toBeUndefined();
    expect(params[6]).toBeUndefined();
  });

  test('passes the encrypted string for smtpPassword when set', async () => {
    exec.enqueue({ rows: [baseRow] });
    await emailRepo.update({ smtpPassword: 'enc:ciphertext' }, exec);
    expect(exec.calls[0].params[6]).toBe('enc:ciphertext');
  });

  test('returns the row from RETURNING', async () => {
    exec.enqueue({ rows: [{ ...baseRow, fromName: 'Acme' }] });
    const result = await emailRepo.update({ fromName: 'Acme' }, exec);
    expect(result.fromName).toBe('Acme');
  });
});
