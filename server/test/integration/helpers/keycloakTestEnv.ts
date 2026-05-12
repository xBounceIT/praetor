export const KEYCLOAK_BASE_URL = process.env.SSO_TEST_KEYCLOAK_URL ?? 'http://localhost:18080';
export const SHOULD_SKIP_SSO = !process.env.SSO_TEST_KEYCLOAK_URL;

export const KEYCLOAK_REALM = 'praetor-sso';
export const REQUEST_ORIGIN = process.env.SSO_TEST_REQUEST_ORIGIN ?? 'http://localhost:3001';
export const KEYCLOAK_ISSUER = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}`;

export const OIDC_PROVIDER_SLUG = 'keycloak-oidc';
export const OIDC_CLIENT_ID = 'praetor-oidc';

export const SAML_PROVIDER_SLUG = 'keycloak-saml';
export const SAML_CLIENT_ID = 'praetor-saml';

export const ALICE_USERNAME = 'alice';
export const ALICE_PASSWORD = 'alicepass';
export const BOB_USERNAME = 'bob';
export const BOB_PASSWORD = 'bobpass';
