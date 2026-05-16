// Mirror of server/utils/crypto.ts MASKED_SECRET. The server returns this exact string in
// place of stored secrets (LDAP bind password, SMTP password, OIDC client secret, SAML
// metadata/cert/private key, ...) and treats the same sentinel as "preserve the stored value"
// on PUT. The frontend uses it to detect Stored mode and guard against silently overwriting
// the real value with mask + typed characters (issue #601).
export const MASKED_SECRET = '********';

export const isStoredSecret = (value: string | undefined | null): boolean =>
  value === MASKED_SECRET;
