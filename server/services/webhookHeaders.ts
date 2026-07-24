import type { StoredWebhookHeader } from '../db/schema/webhooks.ts';
import * as webhooksRepo from '../repositories/webhooksRepo.ts';
import { decrypt, encrypt, MASKED_SECRET } from '../utils/crypto.ts';

export type WebhookHeaderInput = {
  key: string;
  value?: string;
};

const badRequest = (message: string): Error => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
};

const normalizeKey = (key: string): string => key.trim().toLowerCase();

const encryptHeader = (key: string, value: string): StoredWebhookHeader => ({
  key,
  value: value === '' ? '' : encrypt(value),
  encrypted: true,
});

const ensureEncrypted = (header: StoredWebhookHeader): StoredWebhookHeader =>
  header.encrypted ? header : encryptHeader(header.key, header.value);

export const encryptNewHeaders = (headers: WebhookHeaderInput[]): StoredWebhookHeader[] =>
  headers.map((header, index) => {
    if (header.value === undefined) {
      throw badRequest(`customHeaders[${index}].value is required`);
    }
    return encryptHeader(header.key, header.value);
  });

export const mergeEncryptedHeaders = (
  headers: WebhookHeaderInput[],
  existing: StoredWebhookHeader[],
): StoredWebhookHeader[] => {
  const existingByKey = new Map<string, StoredWebhookHeader[]>();
  for (const header of existing) {
    const key = normalizeKey(header.key);
    existingByKey.set(key, [...(existingByKey.get(key) ?? []), header]);
  }

  return headers.map((header, index) => {
    if (header.value !== undefined) {
      return encryptHeader(header.key, header.value);
    }
    const matches = existingByKey.get(normalizeKey(header.key));
    const stored = matches?.shift();
    if (!stored) {
      throw badRequest(`customHeaders[${index}].value is required for a new header`);
    }
    return { ...ensureEncrypted(stored), key: header.key };
  });
};

export const decryptHeaderValue = (header: StoredWebhookHeader): string => {
  if (header.value === '' || !header.encrypted) return header.value;
  return decrypt(header.value);
};

export const maskHeaders = (headers: StoredWebhookHeader[]): StoredWebhookHeader[] =>
  headers.map((header) => ({
    key: header.key,
    value: header.value === '' ? '' : MASKED_SECRET,
  }));

const encryptLegacyValues = (
  headers: StoredWebhookHeader[],
): { headers: StoredWebhookHeader[]; changed: boolean } => {
  let changed = false;
  const encrypted = headers.map((header) => {
    if (header.encrypted) return header;
    changed = true;
    return encryptHeader(header.key, header.value);
  });
  return { headers: encrypted, changed };
};

const MIGRATION_BATCH_SIZE = 100;
const hasLegacyValues = (headers: StoredWebhookHeader[]): boolean =>
  headers.some((header) => !header.encrypted);

// Existing installations stored custom header values as plaintext JSON. Migrate them before the
// server accepts traffic, in bounded batches and with a compare-and-swap update so concurrent
// startup or an administrator edit cannot overwrite a newer value.
export const migrateLegacyWebhookHeaders = async (): Promise<number> => {
  let afterId: string | undefined;
  let migrated = 0;

  while (true) {
    const batch = await webhooksRepo.listBatchAfterId(afterId, MIGRATION_BATCH_SIZE);
    for (const webhook of batch) {
      const result = encryptLegacyValues(webhook.customHeaders);
      if (!result.changed) continue;
      const replaced = await webhooksRepo.replaceCustomHeadersIfUnchanged(
        webhook.id,
        webhook.customHeaders,
        result.headers,
      );
      if (replaced) {
        migrated += 1;
        continue;
      }
      const latest = await webhooksRepo.findById(webhook.id);
      if (latest && hasLegacyValues(latest.customHeaders)) {
        throw new Error('Failed to encrypt legacy webhook header values during startup');
      }
    }
    if (batch.length < MIGRATION_BATCH_SIZE) return migrated;
    afterId = batch.at(-1)?.id;
  }
};
