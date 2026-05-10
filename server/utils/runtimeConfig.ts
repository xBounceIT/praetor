export const INSECURE_DEFAULT_JWT_SECRETS = [
  'praetor-secret-key-change-in-production',
  'tempo-secret-key-change-in-production',
  'change-me-long-random-jwt-secret',
] as const;
export const INSECURE_DEFAULT_ENCRYPTION_KEYS = [
  'praetor-encryption-key-change-in-production',
  'change-me-long-random-encryption-key',
] as const;
export const TEST_JWT_SECRET = 'praetor-test-jwt-secret';

type InsecureDefaults = string | readonly string[];

export const isInsecureEnvValue = (value: string, insecureDefaults: InsecureDefaults): boolean =>
  typeof insecureDefaults === 'string'
    ? value === insecureDefaults
    : insecureDefaults.includes(value);

export const validateRequiredNonDefaultEnv = (
  name: string,
  insecureDefaults: InsecureDefaults,
): string | null => {
  const value = process.env[name]?.trim() ?? '';
  return value && !isInsecureEnvValue(value, insecureDefaults)
    ? null
    : `${name} must be set to a non-default value.`;
};

export const readRequiredNonDefaultEnv = (
  name: string,
  insecureDefaults: InsecureDefaults,
  messages?: {
    missing?: string;
    defaultValue?: string;
  },
): string => {
  const value = process.env[name]?.trim() ?? '';
  if (!value) {
    throw new Error(messages?.missing ?? `${name} must be set to a non-default value.`);
  }
  if (isInsecureEnvValue(value, insecureDefaults)) {
    throw new Error(messages?.defaultValue ?? `${name} must be set to a non-default value.`);
  }
  return value;
};
