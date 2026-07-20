import { afterEach, describe, expect, test } from 'bun:test';
import {
  INSECURE_DEFAULT_ADMIN_PASSWORDS,
  INSECURE_DEFAULT_JWT_SECRETS,
  readRequiredNonDefaultEnv,
  validateRequiredNonDefaultEnv,
} from '../../utils/runtimeConfig.ts';

const ENV_NAME = 'PRAETOR_RUNTIME_CONFIG_TEST_VALUE';

afterEach(() => {
  delete process.env[ENV_NAME];
});

describe('runtimeConfig', () => {
  test('rejects documented placeholder values', () => {
    process.env[ENV_NAME] = 'change-me-long-random-jwt-secret';

    expect(validateRequiredNonDefaultEnv(ENV_NAME, INSECURE_DEFAULT_JWT_SECRETS)).toBe(
      `${ENV_NAME} must be set to a non-default value.`,
    );
    expect(() => readRequiredNonDefaultEnv(ENV_NAME, INSECURE_DEFAULT_JWT_SECRETS)).toThrow(
      `${ENV_NAME} must be set to a non-default value.`,
    );
  });

  test('accepts non-placeholder values', () => {
    process.env[ENV_NAME] = 'unique-secret-value';

    expect(validateRequiredNonDefaultEnv(ENV_NAME, INSECURE_DEFAULT_JWT_SECRETS)).toBeNull();
    expect(readRequiredNonDefaultEnv(ENV_NAME, INSECURE_DEFAULT_JWT_SECRETS)).toBe(
      'unique-secret-value',
    );
  });

  test('maintains the bootstrap admin password denylist with every published legacy default', () => {
    expect(INSECURE_DEFAULT_ADMIN_PASSWORDS).toEqual([
      'password',
      'change-me-strong-admin-password',
    ]);
  });
});
