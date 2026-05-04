import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import nodemailerReal from 'nodemailer';
import * as realEmailRepo from '../../repositories/emailRepo.ts';
import emailService from '../../services/email.ts';
import * as realCrypto from '../../utils/crypto.ts';

// Snapshot real exports BEFORE registering mocks (mock.module inside beforeAll is not hoisted).
const emailRepoSnapshot = { ...realEmailRepo };
const cryptoSnapshot = { ...realCrypto };

const encryptMock = mock((plaintext: string) => `enc(${plaintext})`);
const decryptMock = mock((ciphertext: string) =>
  ciphertext.startsWith('enc(') && ciphertext.endsWith(')') ? ciphertext.slice(4, -1) : ciphertext,
);

const emailRepoGetMock = mock();
const emailRepoUpdateMock = mock();

const transporterStub = {
  verify: mock(),
  sendMail: mock(),
};
const createTransportMock = mock((_opts: unknown) => transporterStub);

const DEFAULT_REPO_CONFIG = realEmailRepo.DEFAULT_CONFIG;

beforeAll(() => {
  mock.module('nodemailer', () => ({
    default: { createTransport: createTransportMock },
  }));
  mock.module('../../utils/crypto.ts', () => ({
    ...cryptoSnapshot,
    encrypt: encryptMock,
    decrypt: decryptMock,
    MASKED_SECRET: '********',
  }));
  mock.module('../../repositories/emailRepo.ts', () => ({
    ...emailRepoSnapshot,
    get: emailRepoGetMock,
    update: emailRepoUpdateMock,
    DEFAULT_CONFIG: DEFAULT_REPO_CONFIG,
  }));
});

afterAll(() => {
  mock.module('nodemailer', () => ({ default: nodemailerReal }));
  mock.module('../../utils/crypto.ts', () => cryptoSnapshot);
  mock.module('../../repositories/emailRepo.ts', () => emailRepoSnapshot);
});

const buildEnabledConfig = (overrides: Partial<typeof DEFAULT_REPO_CONFIG> = {}) => ({
  ...DEFAULT_REPO_CONFIG,
  enabled: true,
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpUser: 'mailer@example.com',
  smtpPassword: 'enc(plaintext-pw)',
  fromEmail: 'no-reply@example.com',
  fromName: 'Praetor',
  ...overrides,
});

const resetSingleton = () => {
  (emailService as unknown as { config: unknown }).config = null;
};

beforeEach(() => {
  resetSingleton();
  encryptMock.mockClear();
  decryptMock.mockClear();
  emailRepoGetMock.mockReset();
  emailRepoUpdateMock.mockReset();
  createTransportMock.mockClear();
  transporterStub.verify.mockReset();
  transporterStub.sendMail.mockReset();

  emailRepoGetMock.mockResolvedValue(buildEnabledConfig());
  emailRepoUpdateMock.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...buildEnabledConfig(),
    ...patch,
  }));
  transporterStub.verify.mockResolvedValue(true);
  transporterStub.sendMail.mockResolvedValue({ messageId: '<msg-id@example.com>' });
});

describe('saveConfig', () => {
  test('encrypts smtpPassword via encrypt() and passes ciphertext to the repo', async () => {
    await emailService.saveConfig({ smtpPassword: 'plaintext-pw', enabled: true });

    expect(encryptMock).toHaveBeenCalledWith('plaintext-pw');
    expect(emailRepoUpdateMock).toHaveBeenCalledTimes(1);
    const patch = emailRepoUpdateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.smtpPasswordCiphertext).toBe('enc(plaintext-pw)');
    expect('smtpPassword' in patch).toBe(false);
  });

  test('skips encryption when smtpPassword equals MASKED_SECRET', async () => {
    await emailService.saveConfig({ smtpPassword: '********', enabled: true });

    expect(encryptMock).not.toHaveBeenCalled();
    const patch = emailRepoUpdateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.smtpPasswordCiphertext).toBeUndefined();
  });

  test('omits smtpPasswordCiphertext when smtpPassword is undefined', async () => {
    await emailService.saveConfig({ enabled: true });

    expect(encryptMock).not.toHaveBeenCalled();
    const patch = emailRepoUpdateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.smtpPasswordCiphertext).toBeUndefined();
  });

  test('caches the returned config: a subsequent testConnection does not re-call emailRepo.get', async () => {
    await emailService.saveConfig({ enabled: true, smtpHost: 'smtp.cached.com' });
    emailRepoGetMock.mockClear();
    await emailService.testConnection();
    expect(emailRepoGetMock).not.toHaveBeenCalled();
  });
});

describe('ensureReady (via testConnection)', () => {
  test('returns EMAIL_NOT_ENABLED when config.enabled is false', async () => {
    emailRepoGetMock.mockResolvedValue({ ...DEFAULT_REPO_CONFIG, enabled: false });
    const result = await emailService.testConnection();
    expect(result).toEqual({ success: false, code: 'EMAIL_NOT_ENABLED' });
  });

  test('returns SMTP_NOT_CONFIGURED when smtpHost is blank', async () => {
    emailRepoGetMock.mockResolvedValue({ ...DEFAULT_REPO_CONFIG, enabled: true, smtpHost: '' });
    const result = await emailService.testConnection();
    expect(result).toEqual({ success: false, code: 'SMTP_NOT_CONFIGURED' });
  });

  test('falls back to DEFAULT_CONFIG when emailRepo.get returns null', async () => {
    emailRepoGetMock.mockResolvedValue(null);
    const result = await emailService.testConnection();
    // DEFAULT is enabled:false, so we expect the disabled branch.
    expect(result).toEqual({ success: false, code: 'EMAIL_NOT_ENABLED' });
  });

  test('loads config exactly once across two consecutive testConnection calls', async () => {
    await emailService.testConnection();
    await emailService.testConnection();
    expect(emailRepoGetMock).toHaveBeenCalledTimes(1);
  });
});

describe('createTransporter (observed via createTransport spy)', () => {
  const lastOpts = () =>
    (createTransportMock.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;

  test('smtpEncryption: ssl → secure:true, no ignoreTLS', async () => {
    emailRepoGetMock.mockResolvedValue(buildEnabledConfig({ smtpEncryption: 'ssl' }));
    await emailService.testConnection();
    expect(lastOpts().secure).toBe(true);
    expect('ignoreTLS' in lastOpts()).toBe(false);
  });

  test('smtpEncryption: insecure → secure:false, ignoreTLS:true', async () => {
    emailRepoGetMock.mockResolvedValue(buildEnabledConfig({ smtpEncryption: 'insecure' }));
    await emailService.testConnection();
    expect(lastOpts().secure).toBe(false);
    expect(lastOpts().ignoreTLS).toBe(true);
  });

  test('smtpEncryption: tls (default) → secure:false, no ignoreTLS', async () => {
    emailRepoGetMock.mockResolvedValue(buildEnabledConfig({ smtpEncryption: 'tls' }));
    await emailService.testConnection();
    expect(lastOpts().secure).toBe(false);
    expect('ignoreTLS' in lastOpts()).toBe(false);
  });

  test('decrypted password reaches transportOptions.auth.pass', async () => {
    emailRepoGetMock.mockResolvedValue(
      buildEnabledConfig({
        smtpUser: 'user@x.com',
        smtpPassword: 'enc(real-secret)',
      }),
    );
    await emailService.testConnection();
    expect(decryptMock).toHaveBeenCalledWith('enc(real-secret)');
    expect((lastOpts() as { auth?: { user: string; pass: string } }).auth).toEqual({
      user: 'user@x.com',
      pass: 'real-secret',
    });
  });

  test('omits auth when smtpUser is empty', async () => {
    emailRepoGetMock.mockResolvedValue(buildEnabledConfig({ smtpUser: '' }));
    await emailService.testConnection();
    expect('auth' in lastOpts()).toBe(false);
  });

  test('smtpRejectUnauthorized:false → tls.rejectUnauthorized:false', async () => {
    emailRepoGetMock.mockResolvedValue(buildEnabledConfig({ smtpRejectUnauthorized: false }));
    await emailService.testConnection();
    expect((lastOpts() as { tls?: { rejectUnauthorized: boolean } }).tls).toEqual({
      rejectUnauthorized: false,
    });
  });
});

describe('testConnection (success/failure)', () => {
  test('returns CONNECTION_SUCCESS when transporter.verify resolves', async () => {
    const result = await emailService.testConnection();
    expect(result).toEqual({ success: true, code: 'CONNECTION_SUCCESS' });
    expect(transporterStub.verify).toHaveBeenCalledTimes(1);
  });

  test('returns SMTP_ERROR with err.message in params when verify rejects', async () => {
    transporterStub.verify.mockRejectedValue(new Error('connect refused'));
    const result = await emailService.testConnection();
    expect(result.success).toBe(false);
    expect(result.code).toBe('SMTP_ERROR');
    expect(result.params).toEqual({ error: 'connect refused' });
  });
});

describe('sendEmail', () => {
  test('returns EMAIL_SENT_SUCCESS with messageId on transporter success', async () => {
    transporterStub.sendMail.mockResolvedValue({ messageId: '<abc@x>' });
    const result = await emailService.sendEmail('to@x.com', 'subj', '<p>html</p>');
    expect(result).toEqual({
      success: true,
      code: 'EMAIL_SENT_SUCCESS',
      messageId: '<abc@x>',
    });
  });

  test('returns SMTP_ERROR with err.message in params on transporter throw', async () => {
    transporterStub.sendMail.mockRejectedValue(new Error('relay denied'));
    const result = await emailService.sendEmail('to@x.com', 'subj', '<p>html</p>');
    expect(result.success).toBe(false);
    expect(result.code).toBe('SMTP_ERROR');
    expect(result.params).toEqual({ error: 'relay denied' });
  });

  test('formats from-address as "Name" <email> when fromName is present', async () => {
    emailRepoGetMock.mockResolvedValue(
      buildEnabledConfig({ fromName: 'Praetor Bot', fromEmail: 'bot@example.com' }),
    );
    await emailService.sendEmail('to@x.com', 'subj', '<p>html</p>');
    const call = transporterStub.sendMail.mock.calls[0]?.[0] as { from: string };
    expect(call.from).toBe('"Praetor Bot" <bot@example.com>');
  });

  test('uses bare email when fromName is empty', async () => {
    emailRepoGetMock.mockResolvedValue(
      buildEnabledConfig({ fromName: '', fromEmail: 'bare@example.com' }),
    );
    await emailService.sendEmail('to@x.com', 'subj', '<p>html</p>');
    const call = transporterStub.sendMail.mock.calls[0]?.[0] as { from: string };
    expect(call.from).toBe('bare@example.com');
  });

  test('falls back to default text when text arg is undefined', async () => {
    await emailService.sendEmail('to@x.com', 'subj', '<p>html</p>');
    const call = transporterStub.sendMail.mock.calls[0]?.[0] as { text: string };
    expect(call.text).toContain('HTML-capable email client');
  });

  test('passes through provided text when supplied', async () => {
    await emailService.sendEmail('to@x.com', 'subj', '<p>html</p>', 'plain version');
    const call = transporterStub.sendMail.mock.calls[0]?.[0] as { text: string };
    expect(call.text).toBe('plain version');
  });
});

describe('sendTestEmail', () => {
  test('delegates to sendEmail with the recipient and a test subject', async () => {
    await emailService.sendTestEmail('hello@x.com');
    expect(transporterStub.sendMail).toHaveBeenCalledTimes(1);
    const call = transporterStub.sendMail.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(call.to).toBe('hello@x.com');
    expect(call.subject).toBe('Praetor Email Configuration Test');
    expect(call.html).toContain('Email Configuration Test');
    expect(call.text).toContain('Praetor Email Configuration Test');
  });
});
