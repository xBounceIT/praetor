const UUID_BYTE_LENGTH = 16;

const toHex = (value: number) => value.toString(16).padStart(2, '0');

const formatUuid = (bytes: Uint8Array) => {
  const normalized = new Uint8Array(bytes);
  normalized[6] = (normalized[6] & 0x0f) | 0x40;
  normalized[8] = (normalized[8] & 0x3f) | 0x80;

  const hex = Array.from(normalized, toHex).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const createUuidFallback = () => {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(16).slice(2);
  return `${timestamp}-${random}`.slice(0, 36);
};

const createUuid = () => {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(UUID_BYTE_LENGTH);
    cryptoApi.getRandomValues(bytes);
    return formatUuid(bytes);
  }

  return createUuidFallback();
};

export const createPrefixedId = (prefix: string) => `${prefix}-${createUuid()}`;
