import type {
  StoredWebhookHeader,
  WebhookAuthType,
  WebhookHttpMethod,
} from '../db/schema/webhooks.ts';
import * as webhooksRepo from '../repositories/webhooksRepo.ts';
import { encrypt } from '../utils/crypto.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

// Plaintext input from the route. `authSecret` carries the raw credential the admin typed, or
// `undefined` (the field omitted) to mean "keep the stored value". The UI signals "unchanged" by
// omitting the field, never by echoing the masked value back — so any present string, including the
// literal MASKED_SECRET text, is a real credential and is stored verbatim. Everything is already
// validated/trimmed by the route before it reaches the service.
export type WebhookInput = {
  name?: string;
  description?: string;
  url?: string;
  httpMethod?: WebhookHttpMethod;
  authType?: WebhookAuthType;
  authUsername?: string;
  authHeaderName?: string;
  authSecret?: string;
  customHeaders?: StoredWebhookHeader[];
  enabled?: boolean;
};

type NormalizedAuth = { authUsername: string; authHeaderName: string; authSecret: string };

const EMPTY_AUTH: NormalizedAuth = { authUsername: '', authHeaderName: '', authSecret: '' };

// Resolve the ciphertext to persist for the secret credential. An omitted secret (`undefined`) means
// "keep the stored value", but only when the auth type is unchanged — switching schemes (e.g.
// basic -> bearer) reinterprets what the secret means, so an absent value clears it rather than
// carrying a stale credential into the new scheme. A present string is always a real credential: ''
// clears it and anything else is encrypted as-is (a literal `********` is a valid secret, not a
// sentinel — the UI never round-trips the masked value, it omits the field instead).
const resolveSecretCiphertext = (
  provided: string | undefined,
  existingCiphertext: string,
  sameAuthType: boolean,
): string => {
  if (provided === undefined) {
    return sameAuthType ? existingCiphertext : '';
  }
  if (provided === '') return '';
  return encrypt(provided);
};

// Persist only the auth fields meaningful for `authType` so credentials from a previous scheme
// never linger in the row. `existing` carries the prior username/header/ciphertext so an unchanged
// edit round-trips without forcing the admin to re-enter secrets.
const normalizeAuth = (
  authType: WebhookAuthType,
  input: WebhookInput,
  existing: NormalizedAuth,
  sameAuthType: boolean,
): NormalizedAuth => {
  // No credentials for `none` — and crucially, don't run encryption on a secret we'd discard.
  if (authType === 'none') return EMPTY_AUTH;
  const authSecret = resolveSecretCiphertext(input.authSecret, existing.authSecret, sameAuthType);
  switch (authType) {
    case 'bearer':
      return { authUsername: '', authHeaderName: '', authSecret };
    case 'basic':
      return {
        authUsername: input.authUsername ?? existing.authUsername,
        authHeaderName: '',
        authSecret,
      };
    case 'api_key':
      return {
        authUsername: '',
        // Treat an empty/absent header as "keep the stored one". A PUT that omits authType (so the
        // route's api_key header-required guard never fires) must not be able to blank out the
        // header and persist an undispatchable api_key target. Any api_key row already passed the
        // create/switch guard, so existing.authHeaderName is non-empty.
        authHeaderName: input.authHeaderName || existing.authHeaderName,
        authSecret,
      };
  }
};

// An api_key target must carry the header to send the key under. The route enforces this on create;
// the service enforces it post-merge (after normalizeAuth has folded in any preserved header) so a
// switch to api_key on update can't leave the header empty — the route can't see the stored value
// to make that call. Thrown with a 4xx statusCode so the app error handler returns a clean 400.
const assertApiKeyHeader = (authType: WebhookAuthType, authHeaderName: string): void => {
  if (authType === 'api_key' && authHeaderName.length === 0) {
    const error = new Error('authHeaderName is required when authType is api_key') as Error & {
      statusCode: number;
    };
    error.statusCode = 400;
    throw error;
  }
};

export const createWebhook = async (input: WebhookInput): Promise<webhooksRepo.Webhook> => {
  const authType = input.authType ?? 'none';
  const auth = normalizeAuth(authType, input, EMPTY_AUTH, false);
  assertApiKeyHeader(authType, auth.authHeaderName);
  return webhooksRepo.insert({
    id: generatePrefixedId('webhook'),
    name: input.name ?? '',
    description: input.description ?? '',
    url: input.url ?? '',
    httpMethod: input.httpMethod ?? 'POST',
    authType,
    authUsername: auth.authUsername,
    authHeaderName: auth.authHeaderName,
    authSecret: auth.authSecret,
    customHeaders: input.customHeaders ?? [],
    enabled: input.enabled ?? true,
  });
};

export const updateWebhook = async (
  id: string,
  input: WebhookInput,
): Promise<webhooksRepo.Webhook | null> => {
  const existing = await webhooksRepo.findById(id);
  if (!existing) return null;

  const authType = input.authType ?? existing.authType;
  const auth = normalizeAuth(authType, input, existing, authType === existing.authType);
  assertApiKeyHeader(authType, auth.authHeaderName);

  const patch: webhooksRepo.WebhookPatch = {
    authType,
    authUsername: auth.authUsername,
    authHeaderName: auth.authHeaderName,
    authSecret: auth.authSecret,
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.url !== undefined) patch.url = input.url;
  if (input.httpMethod !== undefined) patch.httpMethod = input.httpMethod;
  if (input.customHeaders !== undefined) patch.customHeaders = input.customHeaders;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  return webhooksRepo.update(id, patch);
};
