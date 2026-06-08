import type { WebhookAuthType } from '../types';

// Decide what to send for a webhook's `authSecret` field. Returns the value to send, or `undefined`
// to OMIT the field so the server preserves the stored ciphertext (when the auth type is unchanged)
// or clears it (when the scheme changed). Omitting on edit when the field is blank is what prevents
// a stored secret from being silently wiped by toggling the auth type back and forth, or by
// clicking "Replace" and saving without entering a new value. `none` always clears.
export const resolveSecretForPayload = (params: {
  authType: WebhookAuthType;
  isEditing: boolean;
  authSecret: string;
}): string | undefined => {
  if (params.authType === 'none') return '';
  if (!params.isEditing || params.authSecret !== '') return params.authSecret;
  return undefined;
};
