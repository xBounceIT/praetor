import type {
  StoredWebhookHeader,
  WebhookAuthType,
  WebhookHttpMethod,
} from '../db/schema/webhooks.ts';
import * as webhooksRepo from '../repositories/webhooksRepo.ts';
import { encrypt, MASKED_SECRET } from '../utils/crypto.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

// Plaintext input from the route. `authSecret` carries the raw credential the admin typed, or the
// MASKED_SECRET sentinel (or `undefined`) to mean "keep the stored value". Everything is already
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

// Resolve the ciphertext to persist for the secret credential. Preserving the stored value only
// makes sense when the auth type is unchanged — switching schemes (e.g. basic -> bearer)
// reinterprets what the secret means, so a masked/absent value clears it rather than carrying a
// stale credential into the new scheme.
const resolveSecretCiphertext = (
  provided: string | undefined,
  existingCiphertext: string,
  sameAuthType: boolean,
): string => {
  if (provided === undefined || provided === MASKED_SECRET) {
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
        authHeaderName: input.authHeaderName ?? existing.authHeaderName,
        authSecret,
      };
    default:
      return EMPTY_AUTH;
  }
};

export const createWebhook = async (input: WebhookInput): Promise<webhooksRepo.Webhook> => {
  const authType = input.authType ?? 'none';
  const auth = normalizeAuth(authType, input, EMPTY_AUTH, false);
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
