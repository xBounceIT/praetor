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
});

describe('updateWebhook', () => {
  test('returns null and skips the update when the webhook is missing', async () => {
    findByIdMock.mockResolvedValue(null);
    const result = await webhooksService.updateWebhook('missing', { name: 'Y' });
    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('preserves the stored secret when the masked sentinel is sent and the type is unchanged', async () => {
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'bearer', authSecret: 'enc(old-token)' }),
    );
    await webhooksService.updateWebhook('webhook-1', {
      authType: 'bearer',
      authSecret: '********',
    });
    expect(encryptMock).not.toHaveBeenCalled();
    expect(updatedPatch().authSecret).toBe('enc(old-token)');
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

  test('discards the old secret when switching auth type even if masked', async () => {
    findByIdMock.mockResolvedValue(
      existingWebhook({ authType: 'basic', authSecret: 'enc(old-pw)', authUsername: 'u' }),
    );
    await webhooksService.updateWebhook('webhook-1', {
      authType: 'bearer',
      authSecret: '********',
    });
    expect(updatedPatch().authSecret).toBe('');
    expect(updatedPatch().authType).toBe('bearer');
    expect(updatedPatch().authUsername).toBe('');
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
});
