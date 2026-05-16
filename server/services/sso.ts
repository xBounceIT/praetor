import dns from 'node:dns/promises';
import {
  type CacheItem,
  type CacheProvider,
  generateServiceProviderMetadata,
  type Profile,
  SAML,
  ValidateInResponseTo,
} from '@node-saml/node-saml';
import { XMLParser } from 'fast-xml-parser';
import * as oidc from 'openid-client';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as ssoLoginTicketsRepo from '../repositories/ssoLoginTicketsRepo.ts';
import * as ssoProvidersRepo from '../repositories/ssoProvidersRepo.ts';
import * as ssoStatesRepo from '../repositories/ssoStatesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { decrypt, encrypt, MASKED_SECRET } from '../utils/crypto.ts';
import { buildFrontendUrl } from '../utils/frontend-url.ts';
import { NotFoundError } from '../utils/http-errors.ts';
import { createChildLogger } from '../utils/logger.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { ExternalAuthError, resolveExternalIdentity } from './external-auth.ts';

const logger = createChildLogger({ module: 'sso' });

const OIDC_STATE_TTL_MS = 10 * 60 * 1000;
const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;
const LOGIN_TICKET_TTL_MS = 2 * 60 * 1000;
const REMOTE_FETCH_TIMEOUT_MS = 5_000;
const REMOTE_FETCH_REDIRECT_LIMIT = 3;
// SAML metadata documents are typically a few KB. 1 MiB is well above any legitimate payload
// and keeps a hostile IdP from sending multi-GB junk that would OOM the backend.
const REMOTE_FETCH_MAX_BYTES = 1 * 1024 * 1024;

export type AdminSsoProvider = ssoProvidersRepo.SsoProvider;
export type PublicSsoProvider = ssoProvidersRepo.PublicSsoProvider;
export type SsoProviderInput = Partial<Omit<ssoProvidersRepo.SsoProvider, 'id'>> & {
  id?: string;
};

export class SsoProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoProviderValidationError';
  }
}

// Stable codes redirected to the frontend as `?sso_error=<code>`. The frontend keeps an aligned
// list in `types.ts` (`SSO_LOGIN_ERROR_CODES`) — the server's tsconfig rootDir prevents importing
// it directly. The i18n catalog under `auth.admin.sso.loginErrors.*` must cover every code here.
// Raw `err.message` (often library wording) must never reach the URL. See issue #604.
export const SSO_LOGIN_ERROR_CODES = [
  'invalid_state',
  'invalid_response',
  'provider_disabled',
  'provider_misconfigured',
  'account_disabled',
  'identity_conflict',
  'generic',
] as const;

export type SsoLoginErrorCode = (typeof SSO_LOGIN_ERROR_CODES)[number];

export class SsoLoginError extends Error {
  readonly code: SsoLoginErrorCode;
  constructor(message: string, code: SsoLoginErrorCode) {
    super(message);
    this.name = 'SsoLoginError';
    this.code = code;
  }
}

export type SsoLoginResponseUser = usersRepo.AuthUser & {
  permissions: string[];
  availableRoles: rolesRepo.Role[];
};

export type ConsumedSsoLogin = {
  tokenUser: usersRepo.AuthUser;
  activeRole: string;
};

const maskProvider = (provider: ssoProvidersRepo.SsoProvider): AdminSsoProvider => ({
  ...provider,
  clientSecret: provider.clientSecret ? MASKED_SECRET : '',
  privateKey: provider.privateKey ? MASKED_SECRET : '',
  // metadataXml and idpCert can embed signing/certificate material; mask the same way.
  metadataXml: provider.metadataXml ? MASKED_SECRET : '',
  idpCert: provider.idpCert ? MASKED_SECRET : '',
});

const getProviderSecrets = (provider: ssoProvidersRepo.SsoProvider) => ({
  clientSecret: provider.clientSecret ? decrypt(provider.clientSecret) : '',
  privateKey: provider.privateKey ? decrypt(provider.privateKey) : '',
});

const hasConfigValue = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const assertEnabledProviderConfig = (provider: ssoProvidersRepo.SsoProvider): void => {
  if (!provider.enabled) return;

  if (provider.protocol === 'oidc') {
    for (const field of ['issuerUrl', 'clientId', 'usernameAttribute'] as const) {
      if (!hasConfigValue(provider[field])) {
        throw new SsoProviderValidationError(`${field} is required`);
      }
    }
    return;
  }

  const hasMetadataXml = hasConfigValue(provider.metadataXml);
  const hasMetadata = hasConfigValue(provider.metadataUrl) || hasMetadataXml;
  const hasManual = hasConfigValue(provider.entryPoint) && hasConfigValue(provider.idpCert);
  if (!hasMetadata && !hasManual) {
    throw new SsoProviderValidationError(
      'SAML requires metadata URL/XML or manual entryPoint and idpCert',
    );
  }
  if (!hasConfigValue(provider.usernameAttribute)) {
    throw new SsoProviderValidationError('usernameAttribute is required');
  }

  // node-saml silently skips <Issuer> validation when idpIssuer is empty, so the SP would accept
  // an assertion from any IdP whose signing cert chains correctly. Require provider.idpIssuer
  // unless we can derive it from inline metadata at save time. metadataUrl mode is caught by
  // the runtime guard in createSamlClient instead.
  if (
    !hasConfigValue(provider.idpIssuer) &&
    !(hasMetadataXml && parseSamlMetadata(provider.metadataXml).idpIssuer)
  ) {
    throw new SsoProviderValidationError(
      'SAML requires idpIssuer when it cannot be derived from inline metadata',
    );
  }
};

const applyDefinedProviderPatch = (
  provider: ssoProvidersRepo.SsoProvider,
  patch: ssoProvidersRepo.SsoProviderPatch,
): ssoProvidersRepo.SsoProvider => {
  const next = { ...provider };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
};

const normalizeSlug = (slug: string) => slug.trim().toLowerCase();

const coerceString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Identifier-like fields (subject, username, issuer, nameID) reach this helper. A nested
  // claim value here is almost always an IdP misconfiguration — serializing it to JSON
  // would persist a stringified blob as the user identifier. Fall back to '' so the caller
  // can detect the missing value and surface a clear error.
  return '';
};

const readClaim = (claims: Record<string, unknown>, name: string): string => {
  if (name === 'nameID') return coerceString(claims.nameID);
  return coerceString(claims[name]);
};

// Unlike coerceString — which intentionally collapses objects to '' so identifier-like
// fields (subject, username, issuer, nameID) cannot absorb a structured claim — the groups
// path must accept structured group objects. Auth0 / Okta sometimes ship custom claims as
// `groups: [{id, name: 'admins'}, ...]`, and some Keycloak role mappers emit `[{name}, ...]`.
// Without this carveout, every object entry falls through to '' and the user logs in with
// zero recognised groups, silently landing on DEFAULT_ROLE_ID. See issue #609.
const GROUP_VALUE_KEYS = ['name', 'displayName', 'cn', 'groupName'] as const;

const coerceGroupValue = (value: unknown): string => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of GROUP_VALUE_KEYS) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
    return '';
  }
  return coerceString(value);
};

const coerceGroupArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(coerceGroupArray);
  const normalized = coerceGroupValue(value);
  return normalized ? [normalized] : [];
};

const isNonEmptyClaimValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

const readGroupsClaim = (
  claims: Record<string, unknown>,
  attribute: string,
  context: { providerId: string; protocol: 'oidc' | 'saml' },
): string[] => {
  const raw = claims[attribute];
  const groups = coerceGroupArray(raw);
  if (groups.length === 0 && isNonEmptyClaimValue(raw)) {
    // A present-but-empty-after-coercion claim almost always means the IdP shipped group
    // objects under a key we don't recognise (or a deeply nested shape). Surface it so the
    // failure mode isn't a silent "user always lands on DEFAULT_ROLE_ID with no warning".
    logger.warn(
      {
        providerId: context.providerId,
        protocol: context.protocol,
        attribute,
        rawType: typeof raw,
        isArray: Array.isArray(raw),
        arrayLength: Array.isArray(raw) ? raw.length : undefined,
      },
      'SSO groups claim was present but resolved to zero recognised groups — role mapping skipped',
    );
  }
  return groups;
};

const isLocalLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

/**
 * Resolves the public base URL used to build callback / metadata / redirect URLs.
 *
 * We refuse to read `Host` / `x-forwarded-host` headers — those are attacker-controlled and
 * have caused host header injection vulnerabilities in similar flows. Instead, the base URL
 * MUST come from configuration: `SSO_CALLBACK_BASE_URL` (preferred) or `FRONTEND_URL`.
 *
 * The configured URL must parse and use https://, except for loopback hosts where http:// is
 * allowed for local development. An http:// base URL on a public host would put the SSO ticket
 * (transported via redirect to the configured FRONTEND_URL) at risk of network interception.
 */
export const resolvePublicBaseUrl = (): string => {
  const explicit = process.env.SSO_CALLBACK_BASE_URL?.trim();
  const raw = explicit || process.env.FRONTEND_URL?.trim();
  if (!raw) {
    throw new Error('SSO_CALLBACK_BASE_URL or FRONTEND_URL must be configured for SSO');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('SSO public base URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`SSO public base URL must use http(s) (got ${parsed.protocol})`);
  }
  if (parsed.protocol === 'http:' && !isLocalLoopbackHostname(parsed.hostname)) {
    throw new Error('SSO public base URL must use https:// for non-loopback hosts');
  }
  return raw;
};

const buildPublicSsoUrl = (path: string, baseUrl: string): string => new URL(path, baseUrl).href;

const buildCallbackUrl = (protocol: 'oidc' | 'saml', slug: string, baseUrl: string): string =>
  buildPublicSsoUrl(`/api/auth/sso/${protocol}/${slug}/callback`, baseUrl);

const buildSamlMetadataUrl = (slug: string, baseUrl: string): string =>
  buildPublicSsoUrl(`/api/auth/sso/saml/${slug}/metadata`, baseUrl);

const buildFrontendTicketUrl = (ticket: string): string => buildFrontendUrl('sso_ticket', ticket);

const prepareProviderValues = (
  input: SsoProviderInput,
  existing?: ssoProvidersRepo.SsoProvider | null,
): ssoProvidersRepo.SsoProviderPatch => {
  const { id: _id, ...values } = input;
  const patch: ssoProvidersRepo.SsoProviderPatch = { ...values };
  if (input.slug !== undefined) patch.slug = normalizeSlug(input.slug);
  if (input.clientSecret === undefined || input.clientSecret === MASKED_SECRET) {
    delete patch.clientSecret;
  } else {
    patch.clientSecret = input.clientSecret ? encrypt(input.clientSecret) : '';
  }
  if (input.privateKey === undefined || input.privateKey === MASKED_SECRET) {
    delete patch.privateKey;
  } else {
    patch.privateKey = input.privateKey ? encrypt(input.privateKey) : '';
  }
  // Treat metadataXml / idpCert the same way as secrets: a '***' echo on PUT should preserve
  // the stored value rather than overwriting it with the mask.
  if (input.metadataXml === MASKED_SECRET) delete patch.metadataXml;
  if (input.idpCert === MASKED_SECRET) delete patch.idpCert;
  if (!existing && patch.protocol === 'saml') {
    patch.scopes = patch.scopes || ssoProvidersRepo.DEFAULT_OIDC_FIELDS.scopes;
    patch.usernameAttribute =
      patch.usernameAttribute || ssoProvidersRepo.DEFAULT_SAML_FIELDS.usernameAttribute;
    patch.nameAttribute = patch.nameAttribute || ssoProvidersRepo.DEFAULT_SAML_FIELDS.nameAttribute;
    patch.emailAttribute =
      patch.emailAttribute || ssoProvidersRepo.DEFAULT_SAML_FIELDS.emailAttribute;
    patch.groupsAttribute =
      patch.groupsAttribute || ssoProvidersRepo.DEFAULT_SAML_FIELDS.groupsAttribute;
  }
  if (!existing && patch.protocol === 'oidc') {
    patch.scopes = patch.scopes || ssoProvidersRepo.DEFAULT_OIDC_FIELDS.scopes;
    patch.usernameAttribute =
      patch.usernameAttribute || ssoProvidersRepo.DEFAULT_OIDC_FIELDS.usernameAttribute;
    patch.nameAttribute = patch.nameAttribute || ssoProvidersRepo.DEFAULT_OIDC_FIELDS.nameAttribute;
    patch.emailAttribute =
      patch.emailAttribute || ssoProvidersRepo.DEFAULT_OIDC_FIELDS.emailAttribute;
    patch.groupsAttribute =
      patch.groupsAttribute || ssoProvidersRepo.DEFAULT_OIDC_FIELDS.groupsAttribute;
  }
  return patch;
};

export class DbSamlCacheProvider implements CacheProvider {
  constructor(private readonly providerId: string) {}

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    await ssoStatesRepo.insert({
      state: key,
      providerId: this.providerId,
      protocol: 'saml',
      codeVerifier: '',
      nonce: '',
      relayState: value,
      expiresAt: new Date(Date.now() + SAML_REQUEST_TTL_MS),
    });
    return { value, createdAt: Date.now() };
  }

  async getAsync(key: string): Promise<string | null> {
    const state = await ssoStatesRepo.getForProvider(key, this.providerId);
    if (!state || state.protocol !== 'saml' || state.expiresAt <= new Date()) return null;
    return state.relayState;
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    return ssoStatesRepo.remove(key);
  }
}

const normalizeCertificate = (certificate: string): string => {
  const trimmed = certificate.trim();
  if (!trimmed) return '';
  if (trimmed.includes('-----BEGIN CERTIFICATE-----')) return trimmed;
  const compact = trimmed.replace(/\s+/g, '');
  return `-----BEGIN CERTIFICATE-----\n${compact}\n-----END CERTIFICATE-----`;
};

// SAML metadata parser. Uses fast-xml-parser instead of ad-hoc regexes so we correctly
// handle namespaces, nested CDATA, and attribute quoting variants. The traversal is
// schema-aware about which structural elements we're looking for, but tolerant about
// where they appear (any descendant of the document root).
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  removeNSPrefix: true,
  trimValues: true,
  cdataPropName: '#cdata',
});

const isXmlObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const xmlAttr = (node: unknown, name: string): string => {
  if (!isXmlObject(node)) return '';
  const value = node[`@_${name}`];
  return typeof value === 'string' ? value : '';
};

const xmlText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(xmlText).join('');
  if (!isXmlObject(node)) return '';
  const direct = node['#text'];
  if (typeof direct === 'string' && direct.trim()) return direct;
  const cdata = node['#cdata'];
  if (typeof cdata === 'string' && cdata.trim()) return cdata;
  if (Array.isArray(cdata)) return cdata.map(xmlText).join('');
  return '';
};

// Single-pass DFS collecting every named element we care about for SAML metadata. One walk
// over the parsed tree is enough — `parseSamlMetadata` previously traversed three times.
const collectDescendantsByName = (
  root: unknown,
  names: readonly string[],
): Record<string, unknown[]> => {
  const result: Record<string, unknown[]> = Object.fromEntries(names.map((n) => [n, []]));
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isXmlObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key in result) {
        if (Array.isArray(value)) result[key].push(...value);
        else result[key].push(value);
      }
      if (key.startsWith('@_') || key === '#text' || key === '#cdata') continue;
      walk(value);
    }
  };
  walk(root);
  return result;
};

const parseSamlMetadata = (xml: string) => {
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return { idpIssuer: '', entryPoint: '', idpCert: '' };
  }

  const found = collectDescendantsByName(parsed, [
    'EntityDescriptor',
    'SingleSignOnService',
    'X509Certificate',
  ]);

  const idpIssuer = xmlAttr(found.EntityDescriptor[0], 'entityID');

  const redirectService =
    found.SingleSignOnService.find((node) => /HTTP-Redirect/i.test(xmlAttr(node, 'Binding'))) ??
    found.SingleSignOnService[0];
  const entryPoint = redirectService ? xmlAttr(redirectService, 'Location') : '';

  const rawCert = found.X509Certificate.length > 0 ? xmlText(found.X509Certificate[0]) : '';
  const idpCert = rawCert ? normalizeCertificate(rawCert) : '';

  return { idpIssuer, entryPoint, idpCert };
};

/**
 * Returns true when `ip` is in an IPv4 / IPv6 private, loopback, or link-local range that a
 * server-side fetch should NEVER target. Blocks the standard SSRF egress targets:
 *   - 127.0.0.0/8 (loopback)
 *   - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC1918 private)
 *   - 169.254.0.0/16 (link-local incl. cloud metadata 169.254.169.254)
 *   - 100.64.0.0/10 (carrier-grade NAT — non-routable on the public internet)
 *   - 0.0.0.0/8
 *   - ::1 (IPv6 loopback)
 *   - fc00::/7 (IPv6 unique-local)
 *   - fe80::/10 (IPv6 link-local)
 */
export const isPrivateIp = (ip: string): boolean => {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  // IPv6 — normalise to lower-case, strip zone id.
  const v6 = ip.toLowerCase().split('%')[0];
  if (v6 === '::1') return true;
  if (v6 === '::') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // fc00::/7
  if (v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb'))
    return true; // fe80::/10
  // IPv4-mapped IPv6 — recursively check the embedded v4.
  const mapped = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
};

/**
 * Throws if `url` is non-HTTPS or its hostname resolves to a private / loopback / link-local
 * address. Shared by the SSRF-fetch loop and the OIDC issuer pre-flight so the two cannot drift.
 */
const assertSafeRemoteUrl = async (url: URL): Promise<void> => {
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing to fetch non-HTTPS URL: ${url.protocol}//...`);
  }
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host ${url.hostname}`);
  }
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Refusing to fetch URL with private/loopback host: ${url.hostname}`);
  }
};

/**
 * Reads a response body as text, refusing to buffer more than REMOTE_FETCH_MAX_BYTES. Guards
 * against a hostile IdP that returns a huge metadata document hoping to OOM the backend.
 */
const readBoundedText = async (response: Response): Promise<string> => {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > REMOTE_FETCH_MAX_BYTES) {
    throw new Error(`Remote response too large (${declared} bytes)`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > REMOTE_FETCH_MAX_BYTES) {
      await reader.cancel();
      throw new Error(`Remote response exceeded ${REMOTE_FETCH_MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString('utf-8');
};

/**
 * SSRF-hardened fetch for IdP-supplied URLs (SAML metadata, OIDC discovery).
 *
 * Guarantees:
 *   - HTTPS only (no http:, file:, gopher:, etc).
 *   - Host resolved via DNS; rejects if any resolved address is private/loopback/link-local.
 *   - 5-second total timeout via AbortController.
 *   - Bounded follows: each redirect target is re-validated identically.
 */
const safeFetchRemoteUrl = async (url: string): Promise<Response> => {
  let current = url;
  for (let hops = 0; hops <= REMOTE_FETCH_REDIRECT_LIMIT; hops++) {
    await assertSafeRemoteUrl(new URL(current));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(current, { signal: controller.signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        if (!next) {
          throw new Error(`Redirect response without Location header from ${current}`);
        }
        current = new URL(next, current).href;
        continue;
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Exceeded redirect limit while fetching remote URL');
};

const resolveSamlIdpConfig = async (provider: ssoProvidersRepo.SsoProvider) => {
  if (provider.metadataXml.trim()) {
    return { ...parseSamlMetadata(provider.metadataXml), source: 'metadataXml' };
  }
  if (provider.metadataUrl.trim()) {
    const response = await safeFetchRemoteUrl(provider.metadataUrl);
    if (!response.ok) throw new Error(`Failed to fetch SAML metadata: HTTP ${response.status}`);
    return { ...parseSamlMetadata(await readBoundedText(response)), source: 'metadataUrl' };
  }
  return {
    idpIssuer: provider.idpIssuer,
    entryPoint: provider.entryPoint,
    idpCert: provider.idpCert,
    source: 'manual',
  };
};

const createLoginTicket = async (userId: string, activeRole: string): Promise<string> => {
  const ticket = generatePrefixedId('sso_ticket');
  await ssoLoginTicketsRepo.insert({
    ticket,
    userId,
    activeRole,
    expiresAt: new Date(Date.now() + LOGIN_TICKET_TTL_MS),
  });
  return ticket;
};

// `resolveExternalIdentity` throws domain-typed `ExternalAuthError`s (kept decoupled from HTTP
// concerns and shared with the LDAP path). Translate each discriminant to its SSO login code at
// the service-to-route boundary so the frontend never sees raw library wording.
const EXTERNAL_AUTH_CODE_TO_SSO: Record<ExternalAuthError['code'], SsoLoginErrorCode> = {
  missing_username: 'invalid_response',
  missing_subject: 'invalid_response',
  user_disabled: 'account_disabled',
  identity_conflict: 'identity_conflict',
};

const mapResolveExternalError = (err: unknown): SsoLoginError => {
  if (err instanceof SsoLoginError) return err;
  if (err instanceof ExternalAuthError) {
    return new SsoLoginError(err.message, EXTERNAL_AUTH_CODE_TO_SSO[err.code]);
  }
  const message = err instanceof Error ? err.message : '';
  return new SsoLoginError(message || 'SSO login failed', 'generic');
};

const completeExternalLogin = async (
  provider: ssoProvidersRepo.SsoProvider,
  identity: {
    issuer: string;
    subject: string;
    username: string;
    name?: string;
    email?: string;
    groups: string[];
  },
): Promise<string> => {
  let user: Awaited<ReturnType<typeof resolveExternalIdentity>>;
  try {
    user = await resolveExternalIdentity({
      providerId: provider.id,
      protocol: provider.protocol,
      issuer: identity.issuer,
      subject: identity.subject,
      username: identity.username,
      name: identity.name,
      email: identity.email,
      groups: identity.groups,
      roleMappings: provider.roleMappings,
    });
  } catch (err) {
    throw mapResolveExternalError(err);
  }
  const ticket = await createLoginTicket(user.id, user.role);
  return buildFrontendTicketUrl(ticket);
};

// Disabled/missing/wrong-protocol providers throw `NotFoundError` so the metadata + start GET
// routes propagate to the global error handler and return 404 (see #600, #635). The login
// callback routes catch this error in `handleSsoCallbackError` and map it to the stable
// `provider_disabled` redirect code.
const getEnabledProviderBySlug = async (
  protocol: 'oidc' | 'saml',
  slug: string,
): Promise<ssoProvidersRepo.SsoProvider> => {
  const provider = await ssoProvidersRepo.findBySlug(slug);
  if (!provider || provider.protocol !== protocol || !provider.enabled) {
    throw new NotFoundError('SSO provider');
  }
  return provider;
};

const getEnabledProviderById = async (
  protocol: 'oidc' | 'saml',
  id: string,
): Promise<ssoProvidersRepo.SsoProvider> => {
  const provider = await ssoProvidersRepo.findById(id);
  if (!provider || provider.protocol !== protocol || !provider.enabled) {
    throw new NotFoundError('SSO provider');
  }
  return provider;
};

const createOidcConfig = async (provider: ssoProvidersRepo.SsoProvider) => {
  const { clientSecret } = getProviderSecrets(provider);
  if (!provider.issuerUrl || !provider.clientId) {
    throw new SsoLoginError(
      'OIDC provider is missing issuer URL or client ID',
      'provider_misconfigured',
    );
  }
  // Reuse the same SSRF pre-flight as the SAML metadata fetch. openid-client.discovery does its
  // own HTTPS fetch internally, but our pre-flight catches the obvious cases (http://, private
  // IP) before we hand control to the library.
  const issuerUrl = new URL(provider.issuerUrl);
  await assertSafeRemoteUrl(issuerUrl);
  return oidc.discovery(issuerUrl, provider.clientId, clientSecret || undefined);
};

const createSamlClient = async (
  provider: ssoProvidersRepo.SsoProvider,
  baseUrl: string,
): Promise<SAML> => {
  const idp = await resolveSamlIdpConfig(provider);
  const { privateKey } = getProviderSecrets(provider);
  const callbackUrl = buildCallbackUrl('saml', provider.slug, baseUrl);
  const issuer = provider.spIssuer || buildSamlMetadataUrl(provider.slug, baseUrl);
  const entryPoint = idp.entryPoint || provider.entryPoint;
  const idpCert = normalizeCertificate(idp.idpCert || provider.idpCert);
  const idpIssuer = idp.idpIssuer || provider.idpIssuer;
  const missing = [
    !entryPoint && 'entry point',
    !idpCert && 'IdP certificate',
    !idpIssuer && 'IdP issuer',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new SsoLoginError(
      `SAML provider is missing ${missing.join(', ')}`,
      'provider_misconfigured',
    );
  }
  return new SAML({
    callbackUrl,
    issuer,
    audience: issuer,
    entryPoint,
    idpCert,
    idpIssuer,
    privateKey: privateKey || undefined,
    publicCert: provider.publicCert || undefined,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    cacheProvider: new DbSamlCacheProvider(provider.id),
  });
};

// Routed through buildCallbackUrl so the admin preview can't drift from the URL the SAML
// library validates against. The slug is substituted via a URL-safe sentinel because new URL()
// would percent-encode the `{}` in a literal `{slug}` placeholder. We splice the sentinel out
// at its LAST occurrence — the one we just injected into the path — so a sentinel substring
// in baseUrl's host can't be rewritten by accident.
const SAML_SLUG_SENTINEL = 'praetor-slug-placeholder';

export const getSamlAcsUrlInfo = (): { acsUrlTemplate: string } => {
  const baseUrl = resolvePublicBaseUrl();
  const built = buildCallbackUrl('saml', SAML_SLUG_SENTINEL, baseUrl);
  const idx = built.lastIndexOf(SAML_SLUG_SENTINEL);
  return {
    acsUrlTemplate: built.slice(0, idx) + '{slug}' + built.slice(idx + SAML_SLUG_SENTINEL.length),
  };
};

export const listAdminProviders = async (): Promise<AdminSsoProvider[]> =>
  (await ssoProvidersRepo.list()).map(maskProvider);

export const listPublicProviders = async (): Promise<PublicSsoProvider[]> =>
  ssoProvidersRepo.listPublicEnabled();

export const createProvider = async (input: SsoProviderInput): Promise<AdminSsoProvider> => {
  if (!input.protocol) throw new Error('protocol is required');
  if (!input.slug) throw new Error('slug is required');
  if (!input.name) throw new Error('name is required');
  const patch = prepareProviderValues(input);
  const provider: ssoProvidersRepo.SsoProvider = {
    id: generatePrefixedId('sso'),
    protocol: input.protocol,
    slug: normalizeSlug(input.slug),
    name: input.name.trim(),
    enabled: patch.enabled ?? false,
    issuerUrl: patch.issuerUrl ?? '',
    clientId: patch.clientId ?? '',
    clientSecret: patch.clientSecret ?? '',
    scopes: patch.scopes ?? ssoProvidersRepo.DEFAULT_OIDC_FIELDS.scopes,
    metadataUrl: patch.metadataUrl ?? '',
    metadataXml: patch.metadataXml ?? '',
    entryPoint: patch.entryPoint ?? '',
    idpIssuer: patch.idpIssuer ?? '',
    idpCert: patch.idpCert ?? '',
    spIssuer: patch.spIssuer ?? '',
    privateKey: patch.privateKey ?? '',
    publicCert: patch.publicCert ?? '',
    usernameAttribute:
      patch.usernameAttribute ??
      (input.protocol === 'saml'
        ? ssoProvidersRepo.DEFAULT_SAML_FIELDS.usernameAttribute
        : ssoProvidersRepo.DEFAULT_OIDC_FIELDS.usernameAttribute),
    nameAttribute:
      patch.nameAttribute ??
      (input.protocol === 'saml'
        ? ssoProvidersRepo.DEFAULT_SAML_FIELDS.nameAttribute
        : ssoProvidersRepo.DEFAULT_OIDC_FIELDS.nameAttribute),
    emailAttribute:
      patch.emailAttribute ??
      (input.protocol === 'saml'
        ? ssoProvidersRepo.DEFAULT_SAML_FIELDS.emailAttribute
        : ssoProvidersRepo.DEFAULT_OIDC_FIELDS.emailAttribute),
    groupsAttribute:
      patch.groupsAttribute ??
      (input.protocol === 'saml'
        ? ssoProvidersRepo.DEFAULT_SAML_FIELDS.groupsAttribute
        : ssoProvidersRepo.DEFAULT_OIDC_FIELDS.groupsAttribute),
    roleMappings: patch.roleMappings ?? [],
  };
  assertEnabledProviderConfig(provider);
  const created = await ssoProvidersRepo.insert(provider);
  return maskProvider(created);
};

export const updateProvider = async (
  id: string,
  input: SsoProviderInput,
): Promise<AdminSsoProvider | null> => {
  const existing = await ssoProvidersRepo.findById(id);
  if (!existing) return null;
  const patch = prepareProviderValues(input, existing);
  assertEnabledProviderConfig(applyDefinedProviderPatch(existing, patch));
  const updated = await ssoProvidersRepo.update(id, patch);
  return updated ? maskProvider(updated) : null;
};

export const deleteProvider = async (id: string): Promise<boolean> =>
  ssoProvidersRepo.deleteById(id);

export const startOidcLogin = async (slug: string): Promise<string> => {
  const baseUrl = resolvePublicBaseUrl();
  const provider = await getEnabledProviderBySlug('oidc', slug);
  const config = await createOidcConfig(provider);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  // Per OIDC Core 1.0 § 3.1.2.1, nonce binds the ID token to this browser session — defence
  // in depth against ID-token replay if a token leaks downstream of the IdP.
  const nonce = oidc.randomNonce();
  await ssoStatesRepo.insert({
    state,
    providerId: provider.id,
    protocol: 'oidc',
    codeVerifier,
    nonce,
    relayState: '',
    expiresAt: new Date(Date.now() + OIDC_STATE_TTL_MS),
  });
  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: buildCallbackUrl('oidc', provider.slug, baseUrl),
    scope: provider.scopes || ssoProvidersRepo.DEFAULT_OIDC_FIELDS.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  }).href;
};

export const completeOidcLogin = async (slug: string, callbackUrl: URL): Promise<string> => {
  const baseUrl = resolvePublicBaseUrl();
  // Consume the state first, then resolve the provider FROM state.providerId — never from the
  // URL slug. This blocks a slug-mismatch attack where the caller hits /oidc/<other>/callback
  // with a code+state bound to a different provider, hoping to trade it for the wrong
  // provider's tokens. The slug is only used as a defence-in-depth cross-check below.
  const stateValue = callbackUrl.searchParams.get('state') || '';
  const state = await ssoStatesRepo.consume(stateValue, 'oidc');
  if (!state) throw new SsoLoginError('Invalid or expired SSO state', 'invalid_state');
  const provider = await getEnabledProviderById('oidc', state.providerId);
  if (provider.slug !== normalizeSlug(slug)) {
    throw new SsoLoginError('Invalid or expired SSO state', 'invalid_state');
  }
  const config = await createOidcConfig(provider);
  const publicCallbackUrl = new URL(buildCallbackUrl('oidc', provider.slug, baseUrl));
  publicCallbackUrl.search = callbackUrl.search;
  publicCallbackUrl.hash = callbackUrl.hash;
  const tokens = await oidc.authorizationCodeGrant(config, publicCallbackUrl, {
    expectedState: state.state,
    pkceCodeVerifier: state.codeVerifier,
    expectedNonce: state.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) {
    throw new SsoLoginError('OIDC response did not include a subject', 'invalid_response');
  }
  let userInfo: Record<string, unknown> = {};
  if (tokens.access_token) {
    userInfo = (await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)) as Record<
      string,
      unknown
    >;
  }
  const mergedClaims = { ...(claims as Record<string, unknown>), ...userInfo };
  return completeExternalLogin(provider, {
    issuer: coerceString(mergedClaims.iss) || provider.issuerUrl,
    subject: claims.sub,
    username: readClaim(mergedClaims, provider.usernameAttribute),
    name: readClaim(mergedClaims, provider.nameAttribute),
    email: readClaim(mergedClaims, provider.emailAttribute),
    groups: readGroupsClaim(mergedClaims, provider.groupsAttribute, {
      providerId: provider.id,
      protocol: provider.protocol,
    }),
  });
};

export const startSamlLogin = async (slug: string): Promise<string> => {
  const baseUrl = resolvePublicBaseUrl();
  const provider = await getEnabledProviderBySlug('saml', slug);
  const saml = await createSamlClient(provider, baseUrl);
  return saml.getAuthorizeUrlAsync('', undefined, {});
};

export const completeSamlLogin = async (
  slug: string,
  formBody: Record<string, string>,
): Promise<string> => {
  const baseUrl = resolvePublicBaseUrl();
  const provider = await getEnabledProviderBySlug('saml', slug);
  const saml = await createSamlClient(provider, baseUrl);
  const result = await saml.validatePostResponseAsync(formBody);
  if (!result.profile || result.loggedOut) {
    throw new SsoLoginError('SAML response did not include a login', 'invalid_response');
  }
  const profile = result.profile as Profile & Record<string, unknown>;
  const claims = profile as Record<string, unknown>;
  const subject = coerceString(profile.nameID);
  if (!subject) {
    throw new SsoLoginError('SAML response did not include a subject', 'invalid_response');
  }
  const issuer = coerceString(profile.issuer) || provider.idpIssuer;
  if (!issuer) {
    throw new SsoLoginError('SAML response did not include an issuer', 'invalid_response');
  }
  return completeExternalLogin(provider, {
    issuer,
    subject,
    username: readClaim(claims, provider.usernameAttribute),
    name: readClaim(claims, provider.nameAttribute),
    email: readClaim(claims, provider.emailAttribute),
    groups: readGroupsClaim(claims, provider.groupsAttribute, {
      providerId: provider.id,
      protocol: provider.protocol,
    }),
  });
};

export const getSamlMetadata = async (slug: string): Promise<string> => {
  const baseUrl = resolvePublicBaseUrl();
  const provider = await getEnabledProviderBySlug('saml', slug);
  const { privateKey } = getProviderSecrets(provider);
  const issuer = provider.spIssuer || buildSamlMetadataUrl(provider.slug, baseUrl);
  return generateServiceProviderMetadata({
    issuer,
    callbackUrl: buildCallbackUrl('saml', provider.slug, baseUrl),
    privateKey: privateKey || undefined,
    publicCerts: provider.publicCert || undefined,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
  });
};

export const consumeLoginTicket = async (ticket: string): Promise<ConsumedSsoLogin | null> => {
  const consumed = await ssoLoginTicketsRepo.consume(ticket);
  if (!consumed) return null;
  const user = await usersRepo.findAuthUserById(consumed.userId);
  if (!user || user.isDisabled) return null;
  return { tokenUser: user, activeRole: consumed.activeRole };
};

export const buildAuthUserResponse = async (
  user: usersRepo.AuthUser,
  activeRole: string,
): Promise<SsoLoginResponseUser> => {
  const permissions = await getRolePermissions(activeRole);
  const availableRoles = await rolesRepo.listAvailableRolesForUser(user.id);
  return {
    ...user,
    role: activeRole,
    permissions,
    availableRoles:
      availableRoles.length > 0
        ? availableRoles
        : [{ id: activeRole, name: activeRole, isSystem: false, isAdmin: activeRole === 'admin' }],
  };
};
