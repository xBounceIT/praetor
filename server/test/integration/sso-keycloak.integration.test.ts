import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { decodeHTMLAttribute } from 'entities';
import type { ExternalIdentity } from '../../repositories/externalIdentitiesRepo.ts';
import type { SsoLoginTicket } from '../../repositories/ssoLoginTicketsRepo.ts';
import {
  DEFAULT_OIDC_FIELDS,
  DEFAULT_SAML_FIELDS,
  type SsoProvider,
} from '../../repositories/ssoProvidersRepo.ts';
import type { SsoState } from '../../repositories/ssoStatesRepo.ts';
import {
  type AuthUser,
  EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
  LDAP_PLACEHOLDER_PASSWORD_HASH,
  type LoginUser,
  type NewFullUser,
} from '../../repositories/usersRepo.ts';
import {
  ALICE_PASSWORD,
  ALICE_USERNAME,
  BOB_PASSWORD,
  BOB_USERNAME,
  KEYCLOAK_ISSUER,
  OIDC_CLIENT_ID,
  OIDC_PROVIDER_SLUG,
  REQUEST_ORIGIN,
  SAML_CLIENT_ID,
  SAML_PROVIDER_SLUG,
  SHOULD_SKIP_SSO,
} from './helpers/keycloakTestEnv.ts';

type SsoServiceModule = typeof import('../../services/sso.ts');

type StoredUser = LoginUser & {
  costPerHour: number;
  employeeType: 'app_user' | 'internal' | 'external';
  roles: string[];
};

type FormResult =
  | { type: 'redirect'; url: URL }
  | { type: 'saml-post'; fields: Record<string, string> };

class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(response: Response): void {
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(';');
      const separator = pair.indexOf('=');
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

const fetchWithCookies = async (
  jar: CookieJar,
  url: URL | string,
  init: RequestInit = {},
): Promise<Response> => {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.store(response);
  return response;
};

const redirectLocation = (response: Response, baseUrl: URL | string): URL | null => {
  const location = response.headers.get('location');
  return location ? new URL(location, baseUrl) : null;
};

const extractLoginAction = (html: string, pageUrl: URL): URL => {
  const loginForm =
    html.match(/<form\b[^>]*\bid=["']kc-form-login["'][^>]*>/i)?.[0] ??
    html.match(/<form\b[^>]*\baction=["'][^"']+["'][^>]*>/i)?.[0];
  const action = loginForm?.match(/\baction=["']([^"']+)["']/i)?.[1];
  if (!action) throw new Error(`Keycloak login form action not found at ${pageUrl.href}`);
  return new URL(decodeHTMLAttribute(action), pageUrl);
};

const extractFormFields = (html: string): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = input[0];
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    const value = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? '';
    fields[decodeHTMLAttribute(name)] = decodeHTMLAttribute(value);
  }
  return fields;
};

const resolveLoginResult = async (
  jar: CookieJar,
  response: Response,
  responseUrl: URL,
): Promise<FormResult> => {
  let currentResponse = response;
  let currentUrl = responseUrl;

  for (let i = 0; i < 10; i++) {
    if (currentResponse.status >= 300 && currentResponse.status < 400) {
      const location = redirectLocation(currentResponse, currentUrl);
      if (!location) throw new Error(`Redirect response from ${currentUrl.href} had no Location`);
      if (location.pathname.includes('/api/auth/sso/')) {
        return { type: 'redirect', url: location };
      }
      currentUrl = location;
      currentResponse = await fetchWithCookies(jar, currentUrl);
      continue;
    }

    const html = await currentResponse.text();
    if (html.includes('SAMLResponse')) {
      return {
        type: 'saml-post',
        fields: extractFormFields(html),
      };
    }
    if (html.includes('kc-form-login')) {
      throw new Error(`Keycloak login did not complete for ${currentUrl.href}`);
    }
    throw new Error(`Unexpected Keycloak response from ${currentUrl.href}: ${html.slice(0, 200)}`);
  }

  throw new Error('Keycloak login redirect chain exceeded the expected length');
};

const loginThroughKeycloak = async (
  authorizeUrl: string,
  username: string,
  password: string,
): Promise<FormResult> => {
  const jar = new CookieJar();
  const authorizeResponse = await fetchWithCookies(jar, authorizeUrl);
  const authorizePageUrl = new URL(authorizeUrl);
  const authorizeHtml = await authorizeResponse.text();
  const loginAction = extractLoginAction(authorizeHtml, authorizePageUrl);
  const body = new URLSearchParams({
    username,
    password,
    credentialId: '',
  });
  const loginResponse = await fetchWithCookies(jar, loginAction, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return resolveLoginResult(jar, loginResponse, loginAction);
};

const roleMappings = [
  { externalGroup: 'praetor-admins', role: 'admin' },
  { externalGroup: 'praetor-users', role: 'user' },
];

const oidcProvider: SsoProvider = {
  id: 'sso-keycloak-oidc',
  protocol: 'oidc',
  slug: OIDC_PROVIDER_SLUG,
  name: 'Keycloak OIDC',
  enabled: true,
  issuerUrl: KEYCLOAK_ISSUER,
  clientId: OIDC_CLIENT_ID,
  clientSecret: '',
  scopes: DEFAULT_OIDC_FIELDS.scopes,
  metadataUrl: '',
  metadataXml: '',
  entryPoint: '',
  idpIssuer: '',
  idpCert: '',
  spIssuer: '',
  privateKey: '',
  publicCert: '',
  usernameAttribute: DEFAULT_OIDC_FIELDS.usernameAttribute,
  nameAttribute: DEFAULT_OIDC_FIELDS.nameAttribute,
  emailAttribute: DEFAULT_OIDC_FIELDS.emailAttribute,
  groupsAttribute: DEFAULT_OIDC_FIELDS.groupsAttribute,
  roleMappings,
  endSessionEnabled: false,
};

const samlProvider: SsoProvider = {
  id: 'sso-keycloak-saml',
  protocol: 'saml',
  slug: SAML_PROVIDER_SLUG,
  name: 'Keycloak SAML',
  enabled: true,
  issuerUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: DEFAULT_OIDC_FIELDS.scopes,
  metadataUrl: `${KEYCLOAK_ISSUER}/protocol/saml/descriptor`,
  metadataXml: '',
  entryPoint: '',
  idpIssuer: KEYCLOAK_ISSUER,
  idpCert: '',
  spIssuer: SAML_CLIENT_ID,
  privateKey: '',
  publicCert: '',
  usernameAttribute: 'username',
  nameAttribute: DEFAULT_SAML_FIELDS.nameAttribute,
  emailAttribute: DEFAULT_SAML_FIELDS.emailAttribute,
  groupsAttribute: DEFAULT_SAML_FIELDS.groupsAttribute,
  roleMappings,
  endSessionEnabled: false,
};

const users = new Map<string, StoredUser>();
const identities = new Map<string, ExternalIdentity>();
const states = new Map<string, SsoState>();
const tickets = new Map<string, SsoLoginTicket>();

const identityKey = (
  input: Pick<ExternalIdentity, 'providerId' | 'protocol' | 'issuer' | 'subject'>,
) => `${input.providerId}\u0000${input.protocol}\u0000${input.issuer}\u0000${input.subject}`;

const toAuthUser = (user: StoredUser): AuthUser => ({
  id: user.id,
  name: user.name,
  username: user.username,
  role: user.role,
  avatarInitials: user.avatarInitials,
  isDisabled: user.isDisabled,
  sessionVersion: user.sessionVersion,
  tokenVersion: user.tokenVersion,
});

const resetStores = (): void => {
  users.clear();
  identities.clear();
  states.clear();
  tickets.clear();
  users.set('u-alice', {
    id: 'u-alice',
    name: 'Local Alice',
    username: ALICE_USERNAME,
    role: 'user',
    avatarInitials: 'LA',
    isDisabled: false,
    sessionVersion: 1,
    tokenVersion: 1,
    passwordHash: EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
    costPerHour: 0,
    employeeType: 'app_user',
    roles: ['user'],
  });
};

describe.skipIf(SHOULD_SKIP_SSO)('SSO integration: Keycloak OIDC and SAML', () => {
  let ssoService: SsoServiceModule;

  beforeAll(async () => {
    // The service now reads the public base URL from env, not request headers. The integration
    // tests need an explicit SSO_CALLBACK_BASE_URL set to the Keycloak-facing origin.
    process.env.SSO_CALLBACK_BASE_URL = REQUEST_ORIGIN;
    mock.module('../../db/drizzle.ts', () => ({
      withDbTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
      db: {},
    }));
    mock.module('../../repositories/ssoProvidersRepo.ts', () => ({
      DEFAULT_OIDC_FIELDS,
      DEFAULT_SAML_FIELDS,
      findBySlug: async (slug: string) =>
        slug === OIDC_PROVIDER_SLUG
          ? oidcProvider
          : slug === SAML_PROVIDER_SLUG
            ? samlProvider
            : null,
      listPublicEnabled: async () => [
        { protocol: oidcProvider.protocol, slug: oidcProvider.slug, name: oidcProvider.name },
        { protocol: samlProvider.protocol, slug: samlProvider.slug, name: samlProvider.name },
      ],
    }));
    mock.module('../../repositories/ssoStatesRepo.ts', () => ({
      insert: async (state: SsoState) => {
        states.set(state.state, state);
      },
      consume: async (state: string, protocol: SsoState['protocol']) => {
        const stored = states.get(state);
        if (!stored || stored.protocol !== protocol || stored.expiresAt <= new Date()) return null;
        states.delete(state);
        return stored;
      },
      get: async (state: string) => states.get(state) ?? null,
      remove: async (state: string) => {
        const stored = states.get(state);
        states.delete(state);
        return stored?.relayState ?? null;
      },
    }));
    mock.module('../../repositories/ssoLoginTicketsRepo.ts', () => ({
      insert: async (ticket: SsoLoginTicket) => {
        tickets.set(ticket.ticket, ticket);
      },
      consume: async (ticket: string) => {
        const stored = tickets.get(ticket);
        tickets.delete(ticket);
        return stored ?? null;
      },
    }));
    mock.module('../../repositories/externalIdentitiesRepo.ts', () => ({
      findByIdentity: async (
        input: Pick<ExternalIdentity, 'providerId' | 'protocol' | 'issuer' | 'subject'>,
      ) => identities.get(identityKey(input)) ?? null,
      insert: async (identity: ExternalIdentity) => {
        const key = identityKey(identity);
        if (!identities.has(key)) identities.set(key, identity);
      },
    }));
    mock.module('../../repositories/rolesRepo.ts', () => ({
      findExistingIds: async (roleIds: string[]) =>
        new Set(roleIds.filter((roleId) => ['admin', 'manager', 'user'].includes(roleId))),
      listAvailableRolesForUser: async (userId: string) =>
        (users.get(userId)?.roles ?? []).map((roleId) => ({
          id: roleId,
          name: roleId,
          isSystem: true,
          isAdmin: roleId === 'admin',
        })),
    }));
    mock.module('../../repositories/settingsRepo.ts', () => ({
      upsertForUser: async () => {},
    }));
    mock.module('../../repositories/userAssignmentsRepo.ts', () => ({
      syncTopManagerAssignmentsForUser: async () => {},
    }));
    mock.module('../../repositories/usersRepo.ts', () => ({
      EXTERNAL_PLACEHOLDER_PASSWORD_HASH,
      LDAP_PLACEHOLDER_PASSWORD_HASH,
      findAuthUserById: async (id: string) => {
        const user = users.get(id);
        return user ? toAuthUser(user) : null;
      },
      findLoginUserByNormalizedUsername: async (username: string) => {
        const normalized = username.trim().toLowerCase();
        for (const user of users.values()) {
          if (user.username.trim().toLowerCase() === normalized) return user;
        }
        return null;
      },
      insertUser: async (user: NewFullUser) => {
        users.set(user.id, {
          ...user,
          passwordHash: user.passwordHash,
          sessionVersion: 1,
          tokenVersion: 1,
          roles: [user.role],
        });
      },
      replaceUserRoles: async (userId: string, roleIds: string[]) => {
        const user = users.get(userId);
        if (user) user.roles = roleIds;
      },
      setPrimaryRole: async (userId: string, role: string) => {
        const user = users.get(userId);
        if (user) user.role = role;
      },
    }));

    ssoService = await import('../../services/sso.ts');
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    resetStores();
  });

  test('OIDC authorization code flow binds an existing local user without overriding stored roles', async () => {
    // Role mapping is bootstrap-only. The pre-existing local Alice gets bound to OIDC
    // (wasBound=true, wasCreated=false), so her Praetor role stays 'user' even though
    // Keycloak's group claim would otherwise map to admin.
    const authorizationUrl = await ssoService.startOidcLogin(OIDC_PROVIDER_SLUG);
    const loginResult = await loginThroughKeycloak(
      authorizationUrl,
      ALICE_USERNAME,
      ALICE_PASSWORD,
    );
    expect(loginResult.type).toBe('redirect');
    if (loginResult.type !== 'redirect') throw new Error('Expected OIDC redirect callback');

    const frontendUrl = await ssoService.completeOidcLogin(OIDC_PROVIDER_SLUG, loginResult.url);
    const ticket = new URL(frontendUrl, 'http://localhost').searchParams.get('sso_ticket');

    expect(ticket).toBeTruthy();
    expect(tickets.get(ticket as string)?.userId).toBe('u-alice');
    expect(users.get('u-alice')?.role).toBe('user');
    expect(users.get('u-alice')?.roles).toEqual(['user']);
    expect([...identities.values()]).toContainEqual(
      expect.objectContaining({
        providerId: oidcProvider.id,
        protocol: 'oidc',
        issuer: KEYCLOAK_ISSUER,
        userId: 'u-alice',
      }),
    );
  });

  test('SAML POST flow creates an unknown Keycloak user with mapped roles', async () => {
    const authorizationUrl = await ssoService.startSamlLogin(SAML_PROVIDER_SLUG);
    const loginResult = await loginThroughKeycloak(authorizationUrl, BOB_USERNAME, BOB_PASSWORD);
    expect(loginResult.type).toBe('saml-post');
    if (loginResult.type !== 'saml-post') throw new Error('Expected SAML POST callback');
    expect(loginResult.fields.SAMLResponse).toBeTruthy();

    const frontendUrl = await ssoService.completeSamlLogin(SAML_PROVIDER_SLUG, loginResult.fields);
    const ticket = new URL(frontendUrl, 'http://localhost').searchParams.get('sso_ticket');
    const createdBob = [...users.values()].find((user) => user.username === BOB_USERNAME);

    expect(ticket).toBeTruthy();
    expect(createdBob).toBeTruthy();
    expect(createdBob?.role).toBe('user');
    expect(createdBob?.roles).toEqual(['user']);
    expect(tickets.get(ticket as string)?.userId).toBe(createdBob?.id);
    expect([...identities.values()]).toContainEqual(
      expect.objectContaining({
        providerId: samlProvider.id,
        protocol: 'saml',
        userId: createdBob?.id,
      }),
    );
  });
});
