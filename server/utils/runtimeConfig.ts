export const INSECURE_DEFAULT_JWT_SECRET = 'praetor-secret-key-change-in-production';
export const INSECURE_DEFAULT_ENCRYPTION_KEY = 'praetor-encryption-key-change-in-production';
export const INSECURE_DEFAULT_ADMIN_PASSWORD = 'password';
export const TEST_JWT_SECRET = 'praetor-test-jwt-secret';

export const validateRequiredNonDefaultEnv = (
  name: string,
  insecureDefault: string,
): string | null => {
  const value = process.env[name]?.trim() ?? '';
  return value && value !== insecureDefault ? null : `${name} must be set to a non-default value.`;
};

export const readRequiredNonDefaultEnv = (
  name: string,
  insecureDefault: string,
  messages?: {
    missing?: string;
    defaultValue?: string;
  },
): string => {
  const value = process.env[name]?.trim() ?? '';
  if (!value) {
    throw new Error(messages?.missing ?? `${name} must be set to a non-default value.`);
  }
  if (value === insecureDefault) {
    throw new Error(messages?.defaultValue ?? `${name} must be set to a non-default value.`);
  }
  return value;
};
