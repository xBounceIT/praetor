import type { WebhookAuthType } from '../types';

// Decide what to send for a webhook's `authSecret` field. Returns the value to send, or `undefined`
// to OMIT the field (so the server keeps the stored ciphertext). The goal is to make an *explicit*
// clear reachable while never *silently* wiping a credential the admin didn't touch:
//   - none: always send '' — the scheme carries no credential.
//   - creating, or an explicit "Replace" (the admin revealed the input on purpose): send the field
//     verbatim, INCLUDING '' which clears the stored secret. Abandoning a replace is done via the
//     SecretField cancel / "keep stored" action (isReplacingSecret flips back off), not by blanking.
//   - editing an untouched stored field, or after an auth-type switch with nothing typed: omit, so
//     the server preserves the ciphertext (unchanged scheme) or clears it (scheme changed) — instead
//     of silently wiping a credential when the admin only toggled the auth type back and forth.
export const resolveSecretForPayload = (params: {
  authType: WebhookAuthType;
  isEditing: boolean;
  isReplacingSecret: boolean;
  authSecret: string;
}): string | undefined => {
  if (params.authType === 'none') return '';
  if (!params.isEditing || params.isReplacingSecret) return params.authSecret;
  return params.authSecret !== '' ? params.authSecret : undefined;
};
