import { describe, expect, test } from 'bun:test';
import { DEFAULT_SIEM_CONFIG } from '../../repositories/siemRepo.ts';
import {
  buildSiemConfigPatch,
  calculateRetryDelay,
  persistSiemConfigUpdate,
  validateSiemConfigInput,
} from '../../services/siem.ts';

describe('SIEM configuration invariants', () => {
  test('keeps a masked client key without re-encrypting it', () => {
    const encryptCalls: string[] = [];
    const result = buildSiemConfigPatch(
      { clientKey: '********', includeAudit: false },
      { ...DEFAULT_SIEM_CONFIG, clientKey: 'ciphertext', enabled: true },
      (value) => {
        encryptCalls.push(value);
        return `encrypted:${value}`;
      },
    );

    expect(result.criticalChanged).toBe(false);
    expect(result.patch.clientKeyCiphertext).toBeUndefined();
    expect(result.patch.includeAudit).toBe(false);
    expect(encryptCalls).toEqual([]);
  });

  test('encrypts a replacement key and invalidates activation for the new revision', () => {
    const result = buildSiemConfigPatch(
      { clientKey: 'new-private-key' },
      { ...DEFAULT_SIEM_CONFIG, clientKey: 'old-ciphertext', enabled: true, revision: 7 },
      (value) => `encrypted:${value}`,
    );

    expect(result.criticalChanged).toBe(true);
    expect(result.patch).toEqual(
      expect.objectContaining({
        clientKeyCiphertext: 'encrypted:new-private-key',
        enabled: false,
        revision: 8,
        testedRevision: null,
        lastTestSuccess: null,
      }),
    );
  });

  test('destination changes disable streaming while filter-only changes do not', () => {
    const current = {
      ...DEFAULT_SIEM_CONFIG,
      enabled: true,
      revision: 2,
      testedRevision: 2,
      lastTestSuccess: true,
    };
    expect(buildSiemConfigPatch({ host: 'new.example.test' }, current).patch.enabled).toBe(false);
    const filterPatch = buildSiemConfigPatch({ runtimeLevel: 'error' }, current).patch;
    expect(filterPatch.enabled).toBeUndefined();
    expect(filterPatch.revision).toBe(3);
    expect(filterPatch.testedRevision).toBe(3);
  });

  test('retry starts at one second, includes jitter, and caps around five minutes', () => {
    expect(calculateRetryDelay(1, () => 0)).toBe(1000);
    expect(calculateRetryDelay(1, () => 1)).toBe(1250);
    expect(calculateRetryDelay(20, () => 0)).toBe(240_000);
    expect(calculateRetryDelay(20, () => 1)).toBe(300_000);
  });

  test('requires the mTLS certificate and private key as a pair', () => {
    expect(() =>
      validateSiemConfigInput(
        { protocol: 'tls', clientCertPem: 'certificate', clientKey: '' },
        DEFAULT_SIEM_CONFIG,
      ),
    ).toThrow('SIEM_MTLS_CERT_KEY_REQUIRED');
    expect(() =>
      validateSiemConfigInput(
        { protocol: 'tls', clientCertPem: 'certificate', clientKey: '********' },
        { ...DEFAULT_SIEM_CONFIG, clientKey: 'ciphertext' },
      ),
    ).not.toThrow();
  });

  test('rejects blank destination identity fields', () => {
    expect(() => validateSiemConfigInput({ host: '   ' }, DEFAULT_SIEM_CONFIG)).toThrow(
      'SIEM_HOST_REQUIRED',
    );
    expect(() => validateSiemConfigInput({ sourceIdentifier: '\t' }, DEFAULT_SIEM_CONFIG)).toThrow(
      'SIEM_SOURCE_IDENTIFIER_REQUIRED',
    );
  });

  test('retries optimistic configuration updates with a fresh revision', async () => {
    const configs = [
      { ...DEFAULT_SIEM_CONFIG, host: 'first.example.test', revision: 1 },
      { ...DEFAULT_SIEM_CONFIG, host: 'concurrent.example.test', revision: 2 },
    ];
    let readIndex = 0;
    const expectedRevisions: number[] = [];
    const result = await persistSiemConfigUpdate(
      { host: 'requested.example.test' },
      async () => configs[readIndex++] ?? configs[1],
      async (_patch, expectedRevision) => {
        expectedRevisions.push(expectedRevision);
        if (expectedRevisions.length === 1) return null;
        return { ...configs[1], host: 'requested.example.test', revision: 3 };
      },
    );
    expect(expectedRevisions).toEqual([1, 2]);
    expect(result.config.host).toBe('requested.example.test');
    expect(result.criticalChanged).toBe(true);
  });
});
