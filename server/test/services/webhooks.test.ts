import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realWebhooksRepo from '../../repositories/webhooksRepo.ts';
import * as realCrypto from '../../utils/crypto.ts';

// Snapshot real exports BEFORE registering mocks (mock.module inside beforeAll is not hoisted).
const cryptoSnapshot = { ...realCrypto };
const repoSnapshot = { ...realWebhooksRepo };

const encryptMock = mock((plaintext: string) => `enc(${plaintext})`);
const insertMock = mock();
const updateMock = mock();
const findByIdMock = mock();

let webhooksService: typeof import('../../services/webhooks.ts');

beforeAll(async () => {
  mock.module('../../utils/crypto.ts', () => ({
    ...cryptoSnapshot,
    encrypt: encryptMock,
    MASKED_SECRET: '********',
  }));
  mock.module('../../repositories/webhooksRepo.ts', () => ({
    ...repoSnapshot,
    insert: insertMock,
    update: updateMock,
    findById: findByIdMock,
  }));
  webhooksService = await import('../../services/webhooks.ts');
});

afterAll(() => {
  mock.module('../../utils/crypto.ts', () => cryptoSnapshot);
  mock.module('../../repositories/webhooksRepo.ts', () => repoSnapshot);
});

const existingWebhook = (
  overrides: Partial<realWebhooksRepo.Webhook> = {},
): realWebhooksRepo.Webhook => ({
  id: 'webhook-1',
  name: 'Existing',
  description: '',
  url: 'https://example.com/hook',
  httpMethod: 'POST',
  authType: 'bearer',
  authUsername: '',
  authHeaderName: '',
  authSecret: 'enc(old-token)',
  customHeaders: [],
  enabled: true,
  ...overrides,
});

const insertedArg = () => insertMock.mock.calls[0]?.[0] as realWebhooksRepo.NewWebhook;
const updatedPatch = () => updateMock.mock.calls[0]?.[1] as realWebhooksRepo.WebhookPatch;

beforeEach(() => {
  encryptMock.mockClear();
  insertMock.mockReset();
  updateMock.mockReset();
  findByIdMock.mockReset();
  insertMock.mockImplementation(async (webhook) => webhook);
  updateMock.mockImplementation(async (_id, patch) => ({ ...existingWebhook(), ...patch }));
});

describe('createWebhook', () => {
  test('encrypts the bearer secret and stores the ciphertext', async () => {
    await webhooksService.createWebhook({
      name: 'X',
      url: 'https://x.com',
      authType: 'bearer',
      authSecret: 'tok',
    });
    expect(encryptMock).toHaveBeenCalledWith('tok');
    expect(insertedArg().authSecret).toBe('enc(tok)');
    expect(insertedArg().authType).toBe('bearer');
    expect(insertedArg().id).toMatch(/^webhook-/);
  });

  test('stores a literal ******** secret on create instead of treating it as the masked sentinel', async () => {
    // Codex PR review: on create there is no stored secret to keep, so a ******** value is a real
    // eight-asterisk credential and must be encrypted, not collapsed to empty.
    await webhooksService.createWebhook({
      name: 'X',
      url: 'https://x.com',
      authType: 'bearer',
      authSecret: '********',
    });
    expect(encryptMock).toHaveBeenCalledWith('********');
    expect(insertedArg().authSecret).toBe('enc(********)');
  });

  test('authType none clears all credentials and skips encryption', async () => {
    await webhooksService.createWebhook({
      name: 'X',
      url: 'https://x.com',
      authType: 'none',
      authSecret: 'ignored',
      authUsername: 'u',
      authHeaderName: 'H',
    });
    expect(encryptMock).not.toHaveBeenCalled();
    expect(insertedArg().authSecret).toBe('');
    expect(insertedArg().authUsername).toBe('');
    expect(insertedArg().authHeaderName).toBe('');
  });

  test('basic keeps the username and clears the header name', async () => {
    await webhooksService.createWebhook({
      name: 'X',
      url: 'https://x.com',
      authType: 'basic',
      authUsername: 'user',
      authHeaderName: 'X-Ignore',
      authSecret: 'pw',
    });
    expect(insertedArg().authUsername).toBe('user');
    expect(insertedArg().authHeaderName).toBe('');
    expect(insertedArg().authSecret).toBe('enc(pw)');
  });

  test('api_key keeps the header name and clears the username', async () => {
    await webhooksService.createWebhook({
      name: 'X',
      url: 'https://x.com',
      authType: 'api_key',
      authHeaderName: 'X-API-Key',
      authUsername: 'u',
      authSecret: 'val',
    });
    expect(insertedArg().authHeaderName).toBe('X-API-Key');
    expect(insertedArg().authUsername).toBe('');
    expect(insertedArg().authSecret).toBe('enc(val)');
  });

  test('applies defaults: POST, enabled, empty headers and none auth', async () => {
    await webhooksService.createWebhook({ name: 'X', url: 'https://x.com' });
    expect(insertedArg().httpMethod).toBe('POST');
    expect(insertedArg().enabled).toBe(true);
    expect(insertedArg().customHeaders).toEqual([]);
    expect(insertedArg().authType).toBe('none');
  });

  test('rejects api_key without a header name', async () => {
    await expect(
      webhooksService.createWebhook({ name: 'X', url: 'https://x.com', authType: 'api_key' }),
    ).rejects.toThrow('authHeaderName is required');
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe('updateWebhook', () => {
  test('returns null and skips the update when the webhook is missing', async () => {
    findByIdMock.mockResolvedValue(null);
    const result = await webhooksService.updateWebhook('missing', { name: 'Y' });
    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('stores a literal ******** secret verbatim instead of treating it as a keep-stored sentinel', async () => {
    // Codex PR review: the UI keeps a stored secret by OMITTING the field, never by echoing the
    // masked value back — so an explicit ******** is a real eight-asterisk credential, not a
    // sentinel, and must be encrypted rather than collapsed back to the old ciphertext.
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'bearer', authSecret: 'enc(old-token)' }),
    );
    await webhooksService.updateWebhook('webhook-1', {
      authType: 'bearer',
      authSecret: '********',
    });
    expect(encryptMock).toHaveBeenCalledWith('********');
    expect(updatedPatch().authSecret).toBe('enc(********)');
  });

  test('preserves the stored secret when authSecret is omitted entirely', async () => {
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'bearer', authSecret: 'enc(old-token)' }),
    );
    await webhooksService.updateWebhook('webhook-1', { name: 'Renamed' });
    expect(updatedPatch().authSecret).toBe('enc(old-token)');
    expect(updatedPatch().name).toBe('Renamed');
  });

  test('encrypts a newly provided secret', async () => {
    findByIdMock.mockResolvedValue(existingWebhook({ authType: 'bearer', authSecret: 'enc(old)' }));
    await webhooksService.updateWebhook('webhook-1', {
      authType: 'bearer',
      authSecret: 'new-token',
    });
    expect(encryptMock).toHaveBeenCalledWith('new-token');
    expect(updatedPatch().authSecret).toBe('enc(new-token)');
  });

  test('discards the old secret when switching auth type and no new secret is provided', async () => {
    // Omitting authSecret means "keep stored", but a scheme switch reinterprets the credential, so the
    // stale secret is dropped rather than carried into the new scheme.
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'basic', authSecret: 'enc(old-pw)', authUsername: 'u' }),
    );
    await webhooksService.updateWebhook('webhook-1', { authType: 'bearer' });
    expect(encryptMock).not.toHaveBeenCalled();
    expect(updatedPatch().authSecret).toBe('');
    expect(updatedPatch().authType).toBe('bearer');
    expect(updatedPatch().authUsername).toBe('');
  });

  test('encrypts a new secret provided while switching auth type', async () => {
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'basic', authSecret: 'enc(old-pw)', authUsername: 'u' }),
    );
    await webhooksService.updateWebhook('webhook-1', { authType: 'bearer', authSecret: 'new-tok' });
    expect(updatedPatch().authSecret).toBe('enc(new-tok)');
    expect(updatedPatch().authType).toBe('bearer');
  });

  test('switching to none clears every auth field', async () => {
    findByIdMock.mockResolvedValue(existingWebhook({ authType: 'bearer', authSecret: 'enc(t)' }));
    await webhooksService.updateWebhook('webhook-1', { authType: 'none' });
    expect(updatedPatch().authType).toBe('none');
    expect(updatedPatch().authSecret).toBe('');
    expect(updatedPatch().authUsername).toBe('');
    expect(updatedPatch().authHeaderName).toBe('');
  });

  test('clears the secret when an empty string is sent', async () => {
    findByIdMock.mockResolvedValue(existingWebhook({ authType: 'bearer', authSecret: 'enc(old)' }));
    await webhooksService.updateWebhook('webhook-1', { authType: 'bearer', authSecret: '' });
    expect(encryptMock).not.toHaveBeenCalled();
    expect(updatedPatch().authSecret).toBe('');
  });

  test('preserves the stored api_key header when a blank header is sent without re-sending authType', async () => {
    // Regression: a PUT that omits authType (so the route's api_key header guard never fires) must
    // not be able to blank out the header and persist an undispatchable api_key target.
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'api_key', authHeaderName: 'X-API-Key', authSecret: 'enc(k)' }),
    );
    await webhooksService.updateWebhook('webhook-1', { authHeaderName: '' });
    expect(updatedPatch().authType).toBe('api_key');
    expect(updatedPatch().authHeaderName).toBe('X-API-Key');
  });

  test('updates the api_key header when a new non-empty value is sent', async () => {
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'api_key', authHeaderName: 'X-Old', authSecret: 'enc(k)' }),
    );
    await webhooksService.updateWebhook('webhook-1', { authHeaderName: 'X-New' });
    expect(updatedPatch().authHeaderName).toBe('X-New');
  });

  test('keeps the stored api_key header on a partial update that re-echoes the type', async () => {
    // Codex PR review: a partial update echoing authType:'api_key' (e.g. just toggling enabled)
    // keeps the stored header instead of failing.
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'api_key', authHeaderName: 'X-API-Key', authSecret: 'enc(k)' }),
    );
    await webhooksService.updateWebhook('webhook-1', { authType: 'api_key', enabled: false });
    expect(updatedPatch().authType).toBe('api_key');
    expect(updatedPatch().authHeaderName).toBe('X-API-Key');
    expect(updatedPatch().enabled).toBe(false);
  });

  test('rejects switching to api_key on update when no header is available', async () => {
    findByIdMock.mockResolvedValue(existingWebhook({ authType: 'none', authHeaderName: '' }));
    await expect(
      webhooksService.updateWebhook('webhook-1', { authType: 'api_key' }),
    ).rejects.toThrow('authHeaderName is required');
    expect(updateMock).not.toHaveBeenCalled();
  });
});
