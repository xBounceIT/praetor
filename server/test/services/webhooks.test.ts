import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LookupAddress } from 'node:dns';
import * as realWebhooksRepo from '../../repositories/webhooksRepo.ts';
import * as realCrypto from '../../utils/crypto.ts';
import * as realSafeRemoteFetch from '../../utils/safe-remote-fetch.ts';

// Snapshot real exports BEFORE registering mocks (mock.module inside beforeAll is not hoisted).
const cryptoSnapshot = { ...realCrypto };
const repoSnapshot = { ...realWebhooksRepo };
const safeRemoteFetchSnapshot = { ...realSafeRemoteFetch };

const encryptMock = mock((plaintext: string) => `enc(${plaintext})`);
const decryptMock = mock((ciphertext: string) => `dec(${ciphertext})`);
const insertMock = mock();
const updateMock = mock();
const findByIdMock = mock();
const listBatchAfterIdMock = mock();
const replaceCustomHeadersIfUnchangedMock = mock();
const resolveSafeRemoteAddressesMock = mock();
const fetchPinnedRemoteUrlMock = mock();

let webhooksService: typeof import('../../services/webhooks.ts');
let webhookHeadersService: typeof import('../../services/webhookHeaders.ts');

beforeAll(async () => {
  mock.module('../../utils/crypto.ts', () => ({
    ...cryptoSnapshot,
    encrypt: encryptMock,
    decrypt: decryptMock,
    MASKED_SECRET: '********',
  }));
  mock.module('../../repositories/webhooksRepo.ts', () => ({
    ...repoSnapshot,
    insert: insertMock,
    update: updateMock,
    findById: findByIdMock,
    listBatchAfterId: listBatchAfterIdMock,
    replaceCustomHeadersIfUnchanged: replaceCustomHeadersIfUnchangedMock,
  }));
  mock.module('../../utils/safe-remote-fetch.ts', () => ({
    ...safeRemoteFetchSnapshot,
    resolveSafeRemoteAddresses: resolveSafeRemoteAddressesMock,
    fetchPinnedRemoteUrl: fetchPinnedRemoteUrlMock,
  }));
  webhooksService = await import('../../services/webhooks.ts');
  webhookHeadersService = await import('../../services/webhookHeaders.ts');
});

afterAll(() => {
  mock.module('../../utils/crypto.ts', () => cryptoSnapshot);
  mock.module('../../repositories/webhooksRepo.ts', () => repoSnapshot);
  mock.module('../../utils/safe-remote-fetch.ts', () => safeRemoteFetchSnapshot);
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

const PUBLIC_ADDRESSES: LookupAddress[] = [{ address: '8.8.8.8', family: 4 }];

const insertedArg = () => insertMock.mock.calls[0]?.[0] as realWebhooksRepo.NewWebhook;
const updatedPatch = () => updateMock.mock.calls[0]?.[1] as realWebhooksRepo.WebhookPatch;

beforeEach(() => {
  encryptMock.mockClear();
  decryptMock.mockClear();
  insertMock.mockReset();
  updateMock.mockReset();
  findByIdMock.mockReset();
  listBatchAfterIdMock.mockReset();
  replaceCustomHeadersIfUnchangedMock.mockReset();
  resolveSafeRemoteAddressesMock.mockReset();
  fetchPinnedRemoteUrlMock.mockReset();
  insertMock.mockImplementation(async (webhook) => webhook);
  updateMock.mockImplementation(async (_id, patch) => ({ ...existingWebhook(), ...patch }));
  listBatchAfterIdMock.mockResolvedValue([]);
  replaceCustomHeadersIfUnchangedMock.mockResolvedValue(true);
  resolveSafeRemoteAddressesMock.mockResolvedValue(PUBLIC_ADDRESSES);
  fetchPinnedRemoteUrlMock.mockImplementation(async () => new Response(null, { status: 204 }));
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

  test('encrypts non-empty custom header values before storing them', async () => {
    await webhooksService.createWebhook({
      name: 'X',
      url: 'https://x.com',
      customHeaders: [
        { key: 'X-API-Key', value: 'header-secret' },
        { key: 'X-Empty', value: '' },
      ],
    });

    expect(encryptMock).toHaveBeenCalledWith('header-secret');
    expect(insertedArg().customHeaders).toEqual([
      { key: 'X-API-Key', value: 'enc(header-secret)', encrypted: true },
      { key: 'X-Empty', value: '', encrypted: true },
    ]);
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

  test('preserves an encrypted custom header when its value is omitted', async () => {
    findByIdMock.mockResolvedValue(
      existingWebhook({
        customHeaders: [{ key: 'X-API-Key', value: 'enc(existing)', encrypted: true }],
      }),
    );

    await webhooksService.updateWebhook('webhook-1', {
      customHeaders: [{ key: 'x-api-key' }],
    });

    expect(updatedPatch().customHeaders).toEqual([
      { key: 'x-api-key', value: 'enc(existing)', encrypted: true },
    ]);
    expect(encryptMock).not.toHaveBeenCalledWith('enc(existing)');
  });

  test('encrypts a replaced custom header value', async () => {
    findByIdMock.mockResolvedValue(
      existingWebhook({
        customHeaders: [{ key: 'X-API-Key', value: 'enc(existing)', encrypted: true }],
      }),
    );

    await webhooksService.updateWebhook('webhook-1', {
      customHeaders: [{ key: 'X-API-Key', value: 'replacement' }],
    });

    expect(updatedPatch().customHeaders).toEqual([
      { key: 'X-API-Key', value: 'enc(replacement)', encrypted: true },
    ]);
  });

  test('rejects an omitted value for a new custom header', async () => {
    findByIdMock.mockResolvedValue(existingWebhook({ customHeaders: [] }));

    await expect(
      webhooksService.updateWebhook('webhook-1', {
        customHeaders: [{ key: 'X-New' }],
      }),
    ).rejects.toThrow('value is required for a new header');
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('migrateLegacyWebhookHeaders', () => {
  test('encrypts legacy plaintext values with a compare-and-swap update', async () => {
    const legacy = existingWebhook({
      customHeaders: [
        { key: 'X-Legacy', value: 'plaintext-secret' },
        { key: 'X-Shaped', value: 'enc(shaped-plaintext)' },
        { key: 'X-Current', value: 'enc(current)', encrypted: true },
        { key: 'X-Empty', value: '' },
      ],
    });
    listBatchAfterIdMock.mockResolvedValueOnce([legacy]);

    await expect(webhookHeadersService.migrateLegacyWebhookHeaders()).resolves.toBe(1);

    expect(replaceCustomHeadersIfUnchangedMock).toHaveBeenCalledWith(
      legacy.id,
      legacy.customHeaders,
      [
        { key: 'X-Legacy', value: 'enc(plaintext-secret)', encrypted: true },
        { key: 'X-Shaped', value: 'enc(enc(shaped-plaintext))', encrypted: true },
        { key: 'X-Current', value: 'enc(current)', encrypted: true },
        { key: 'X-Empty', value: '', encrypted: true },
      ],
    );
    expect(encryptMock).toHaveBeenCalledWith('plaintext-secret');
    expect(encryptMock).toHaveBeenCalledWith('enc(shaped-plaintext)');
    expect(encryptMock).not.toHaveBeenCalledWith('enc(current)');
  });

  test('keeps legacy plaintext dispatch-compatible until startup migration completes', () => {
    expect(
      webhookHeadersService.decryptHeaderValue({ key: 'X-Legacy', value: 'legacy-plaintext' }),
    ).toBe('legacy-plaintext');
    expect(decryptMock).not.toHaveBeenCalled();
  });

  test('fails closed when a concurrent write leaves a plaintext value behind', async () => {
    const legacy = existingWebhook({
      customHeaders: [{ key: 'X-Legacy', value: 'do-not-log-this' }],
    });
    listBatchAfterIdMock.mockResolvedValueOnce([legacy]);
    replaceCustomHeadersIfUnchangedMock.mockResolvedValueOnce(false);
    findByIdMock.mockResolvedValueOnce(legacy);

    const migration = webhookHeadersService.migrateLegacyWebhookHeaders();
    await expect(migration).rejects.toThrow('Failed to encrypt legacy webhook header values');
    await expect(migration).rejects.not.toThrow('do-not-log-this');
  });
});

describe('dispatchWebhook', () => {
  test('rejects loopback targets before issuing the webhook request', async () => {
    resolveSafeRemoteAddressesMock.mockRejectedValue(
      new Error('Refusing to fetch URL with private/loopback/reserved host'),
    );

    await expect(
      webhooksService.dispatchWebhook(
        existingWebhook({ url: 'https://127.0.0.1/latest/meta-data' }),
        {},
      ),
    ).rejects.toThrow(/private|loopback/i);
    expect(fetchPinnedRemoteUrlMock).not.toHaveBeenCalled();
    expect(decryptMock).not.toHaveBeenCalled();
  });

  test('decrypts custom headers before sending a JSON body with bearer auth', async () => {
    const webhook = existingWebhook({
      authType: 'bearer',
      authSecret: 'enc(tok)',
      customHeaders: [{ key: 'X-Custom', value: 'enc(header-value)', encrypted: true }],
    });

    const result = await webhooksService.dispatchWebhook(webhook, {
      eventType: 'project_rule_triggered',
    });

    expect(result).toEqual({ delivered: true, skipped: false, status: 204 });
    expect(decryptMock).toHaveBeenCalledWith('enc(tok)');
    expect(decryptMock).toHaveBeenCalledWith('enc(header-value)');
    expect(fetchPinnedRemoteUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://example.com/hook' }),
      PUBLIC_ADDRESSES,
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        body: JSON.stringify({ eventType: 'project_rule_triggered' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom': 'dec(enc(header-value))',
          Authorization: 'Bearer dec(enc(tok))',
        }),
      }),
    );
  });

  test('sends api key auth under the configured header', async () => {
    const webhook = existingWebhook({
      authType: 'api_key',
      authHeaderName: 'X-API-Key',
      authSecret: 'enc(key)',
    });

    await webhooksService.dispatchWebhook(webhook, { ok: true });

    expect(fetchPinnedRemoteUrlMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'dec(enc(key))' }),
      }),
    );
  });

  test('does not send a body for GET webhooks', async () => {
    const webhook = existingWebhook({ httpMethod: 'GET', authType: 'none', authSecret: '' });

    await webhooksService.dispatchWebhook(webhook, { ignored: true });

    expect(fetchPinnedRemoteUrlMock.mock.calls[0][2]).not.toHaveProperty('body');
    expect(fetchPinnedRemoteUrlMock.mock.calls[0][2]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  test('throws when the remote endpoint returns a non-2xx response', async () => {
    fetchPinnedRemoteUrlMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(webhooksService.dispatchWebhook(existingWebhook(), {})).rejects.toThrow(
      'HTTP 500',
    );
  });

  test('does not follow redirects from a webhook target', async () => {
    fetchPinnedRemoteUrlMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://internal.example/latest/meta-data' },
      }),
    );

    await expect(webhooksService.dispatchWebhook(existingWebhook(), {})).rejects.toThrow(
      'HTTP 302',
    );
    expect(fetchPinnedRemoteUrlMock).toHaveBeenCalledTimes(1);
  });

  test('aborts the fetch when the timeout elapses', async () => {
    fetchPinnedRemoteUrlMock.mockImplementation(
      (_url: URL, _addresses: LookupAddress[], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(
      webhooksService.dispatchWebhook(existingWebhook(), {}, { timeoutMs: 1 }),
    ).rejects.toThrow('aborted');
  });

  test('aborts DNS resolution when the timeout elapses', async () => {
    resolveSafeRemoteAddressesMock.mockImplementation((_url: URL, signal?: AbortSignal) => {
      if (!signal) return Promise.reject(new Error('missing DNS abort signal'));
      return new Promise<LookupAddress[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted DNS resolution')), {
          once: true,
        });
      });
    });

    await expect(
      webhooksService.dispatchWebhook(existingWebhook(), {}, { timeoutMs: 1 }),
    ).rejects.toThrow('aborted DNS resolution');
    expect(fetchPinnedRemoteUrlMock).not.toHaveBeenCalled();
    expect(decryptMock).not.toHaveBeenCalled();
  });
});

describe('dispatchWebhookById', () => {
  test('skips missing and disabled webhook targets', async () => {
    findByIdMock.mockResolvedValueOnce(null);
    await expect(webhooksService.dispatchWebhookById('missing', {})).resolves.toEqual({
      delivered: false,
      skipped: true,
      reason: 'missing',
    });

    findByIdMock.mockResolvedValueOnce(existingWebhook({ enabled: false }));
    await expect(webhooksService.dispatchWebhookById('webhook-1', {})).resolves.toEqual({
      delivered: false,
      skipped: true,
      reason: 'disabled',
    });
  });
});
