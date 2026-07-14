import type { LookupAddress } from 'node:dns';
import dns from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import https, { type RequestOptions as HttpsRequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { addAbortSignal, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
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
import * as ssoUserSessionsRepo from '../repositories/ssoUserSessionsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { decrypt, encrypt, MASKED_SECRET } from '../utils/crypto.ts';
import { buildFrontendUrl, requireFrontendBaseUrl } from '../utils/frontend-url.ts';
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
const OIDC_REMOTE_FETCH_TIMEOUT_SECONDS = REMOTE_FETCH_TIMEOUT_MS / 1000;
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
  const parsedMetadata = hasMetadataXml ? parseSamlMetadata(provider.metadataXml) : null;
  const hasMetadataUrl = hasConfigValue(provider.metadataUrl);
  const hasResolvedEntryPoint =
    hasConfigValue(parsedMetadata?.entryPoint) || hasConfigValue(provider.entryPoint);
  const hasResolvedIdpCert =
    hasConfigValue(parsedMetadata?.idpCert) || hasConfigValue(provider.idpCert);
  if (!hasMetadataUrl && !(hasResolvedEntryPoint && hasResolvedIdpCert)) {
    throw new SsoProviderValidationError(
      'SAML requires metadata URL/XML or manual entryPoint and idpCert',
    );
  }
  if (!hasConfigValue(provider.usernameAttribute)) {
    throw new SsoProviderValidationError('usernameAttribute is required');
  }

  // node-saml does not enforce the authn assertion <Issuer> via idpIssuer, so Praetor performs
  // that check after signature validation. Require the expected issuer unless we can derive it
  // from inline metadata at save time; createSamlClient keeps the same guard for stale rows and
  // remote metadata that fails to resolve an issuer.
  if (!hasConfigValue(provider.idpIssuer) && !hasConfigValue(parsedMetadata?.idpIssuer)) {
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
    return ssoStatesRepo.removeForProvider(key, this.providerId, 'saml');
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

const selectIdpSsoService = (idpDescriptor: unknown): unknown | null => {
  const services = collectDescendantsByName(idpDescriptor, [
    'SingleSignOnService',
  ]).SingleSignOnService;
  return (
    services.find((node) => /HTTP-Redirect/i.test(xmlAttr(node, 'Binding'))) ?? services[0] ?? null
  );
};

const extractIdpSigningCertificate = (idpDescriptor: unknown): string => {
  const keyDescriptors = collectDescendantsByName(idpDescriptor, ['KeyDescriptor']).KeyDescriptor;
  for (const keyDescriptor of keyDescriptors) {
    const use = xmlAttr(keyDescriptor, 'use').trim().toLowerCase();
    if (use && use !== 'signing') continue;

    const certNode = collectDescendantsByName(keyDescriptor, ['X509Certificate'])
      .X509Certificate[0];
    const rawCert = certNode ? xmlText(certNode) : '';
    if (rawCert) return normalizeCertificate(rawCert);
  }
  return '';
};

type SamlMetadataConfig = {
  idpIssuer: string;
  entryPoint: string;
  idpCert: string;
};

const parseSamlMetadata = (xml: string): SamlMetadataConfig => {
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return { idpIssuer: '', entryPoint: '', idpCert: '' };
  }

  const candidates: SamlMetadataConfig[] = [];
  const entities = collectDescendantsByName(parsed, ['EntityDescriptor']).EntityDescriptor;
  for (const entity of entities) {
    const idpDescriptors = collectDescendantsByName(entity, ['IDPSSODescriptor']).IDPSSODescriptor;
    for (const idpDescriptor of idpDescriptors) {
      const redirectService = selectIdpSsoService(idpDescriptor);
      candidates.push({
        idpIssuer: xmlAttr(entity, 'entityID'),
        entryPoint: redirectService ? xmlAttr(redirectService, 'Location') : '',
        idpCert: extractIdpSigningCertificate(idpDescriptor),
      });
    }
  }

  return (
    candidates.find((candidate) =>
      [candidate.idpIssuer, candidate.entryPoint, candidate.idpCert].every(hasConfigValue),
    ) ??
    candidates.find((candidate) => hasConfigValue(candidate.idpIssuer)) ??
    candidates[0] ?? { idpIssuer: '', entryPoint: '', idpCert: '' }
  );
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
const ipv4FromMappedIpv6 = (ip: string): string | null => {
  const dotted = ip.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];

  const hex = ip.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
};

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
  const mapped = ipv4FromMappedIpv6(v6);
  if (mapped) return isPrivateIp(mapped);
  return false;
};

const remoteUrlHostname = (url: URL): string => url.hostname.replace(/^\[|\]$/g, '');

type AutoSelectingHttpsRequestOptions = HttpsRequestOptions & { autoSelectFamily: true };

/**
 * Resolves `url` once and returns the public addresses that the caller may connect to. Returning
 * the vetted addresses (instead of merely validating them) prevents DNS rebinding between the
 * check and the TCP connection.
 */
const resolveSafeRemoteAddresses = async (url: URL): Promise<LookupAddress[]> => {
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing to fetch non-HTTPS URL: ${url.protocol}//...`);
  }
  const hostname = remoteUrlHostname(url);
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host ${url.hostname}`);
  }
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Refusing to fetch URL with private/loopback host: ${url.hostname}`);
  }
  return addresses;
};

const responseFromIncoming = (incoming: IncomingMessage, request: Request): Response => {
  const responseHeaders = new Headers();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
  }
  const status = incoming.statusCode ?? 500;
  const hasBody = request.method !== 'HEAD' && ![204, 205, 304].includes(status);
  const contentEncoding = responseHeaders.get('content-encoding')?.trim().toLowerCase();
  let responseBody: Readable = incoming;
  if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
    responseBody = incoming.pipe(createGunzip());
  } else if (contentEncoding === 'deflate') {
    responseBody = incoming.pipe(createInflate());
  } else if (contentEncoding === 'br') {
    responseBody = incoming.pipe(createBrotliDecompress());
  }
  if (responseBody !== incoming) {
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseBody.once('close', () => incoming.destroy());
  }
  addAbortSignal(request.signal, responseBody);
  return new Response(
    hasBody ? (Readable.toWeb(responseBody) as ReadableStream<Uint8Array>) : null,
    {
      headers: responseHeaders,
      status,
      statusText: incoming.statusMessage,
    },
  );
};

/**
 * Performs one HTTPS request using only already-vetted IPs while retaining the original hostname
 * for the Host header, SNI, and certificate verification. The custom lookup enables connection
 * family selection without another DNS query.
 */
const fetchPinnedRemoteUrl = async (
  url: URL,
  addresses: LookupAddress[],
  options: RequestInit = {},
): Promise<Response> => {
  const request = new Request(url.href, options);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  const headers = new Headers(request.headers);
  headers.set('host', url.host);
  headers.set('accept-encoding', 'gzip, deflate, br');
  const originalHostname = remoteUrlHostname(url);

  return new Promise<Response>((resolve, reject) => {
    const requestOptions: AutoSelectingHttpsRequestOptions = {
      agent: false,
      autoSelectFamily: true,
      headers: Object.fromEntries(headers.entries()),
      hostname: originalHostname,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) {
          callback(null, addresses);
          return;
        }
        callback(null, addresses[0].address, addresses[0].family);
      },
      method: request.method,
      path: `${url.pathname}${url.search}`,
      port: url.port ? Number(url.port) : 443,
      servername: isIP(originalHostname) === 0 ? originalHostname : undefined,
      signal: request.signal,
    };
    const outbound = https.request(requestOptions, (incoming) => {
      try {
        resolve(responseFromIncoming(incoming, request));
      } catch (error) {
        incoming.destroy();
        reject(error);
      }
    });
    outbound.once('error', reject);
    outbound.end(body);
  });
};

const safeOidcFetch: oidc.CustomFetch = async (url, options) => {
  const parsed = new URL(url);
  const addresses = await resolveSafeRemoteAddresses(parsed);
  const response = await fetchPinnedRemoteUrl(parsed, addresses, options);
  return responseWithBoundedBody(response, options.method);
};

const OIDC_REMOTE_ENDPOINT_FIELDS = [
  'authorization_endpoint',
  'token_endpoint',
  'userinfo_endpoint',
  'jwks_uri',
] as const;

const assertSafeOidcServerMetadata = async (
  config: Awaited<ReturnType<typeof oidc.discovery>>,
  options: { includeEndSessionEndpoint: boolean },
): Promise<void> => {
  const metadata = config.serverMetadata() as Record<string, unknown>;
  const fields = options.includeEndSessionEndpoint
    ? [...OIDC_REMOTE_ENDPOINT_FIELDS, 'end_session_endpoint']
    : OIDC_REMOTE_ENDPOINT_FIELDS;
  await Promise.all(
    fields.flatMap((field) => {
      const value = metadata[field];
      if (typeof value !== 'string' || !value.trim()) return [];
      let endpoint: URL;
      try {
        endpoint = new URL(value);
      } catch {
        throw new Error(`OIDC discovery ${field} is not a valid URL`);
      }
      return [resolveSafeRemoteAddresses(endpoint)];
    }),
  );
};

const responseWithBoundedBody = (
  response: Response,
  method: string,
  onComplete: () => void = () => undefined,
): Response => {
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    onComplete();
  };
  const init = {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  };
  if (method.toUpperCase() === 'HEAD' || [204, 205, 304].includes(response.status)) {
    complete();
    return new Response(null, init);
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > REMOTE_FETCH_MAX_BYTES) {
    void response.body?.cancel();
    complete();
    throw new Error(`Remote response too large (${declared} bytes)`);
  }
  if (!response.body) {
    complete();
    return new Response(null, init);
  }

  let total = 0;
  const reader = response.body.getReader();
  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          complete();
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > REMOTE_FETCH_MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          complete();
          throw new Error(`Remote response exceeded ${REMOTE_FETCH_MAX_BYTES} bytes`);
        }
        controller.enqueue(value);
      } catch (error) {
        complete();
        throw error;
      }
    },
    cancel(reason) {
      complete();
      return reader.cancel(reason);
    },
  });
  return new Response(boundedBody, init);
};

/**
 * SSRF-hardened fetch for IdP-supplied SAML metadata URLs.
 *
 * Guarantees:
 *   - HTTPS only (no http:, file:, gopher:, etc).
 *   - Host resolved via DNS; rejects if any resolved address is private/loopback/link-local.
 *   - TCP connection restricted to vetted addresses while TLS verifies the original hostname.
 *   - 5-second total timeout via AbortController.
 *   - Bounded follows: each redirect target is re-validated identically.
 */
const safeFetchRemoteUrl = async (url: string): Promise<Response> => {
  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    for (let hops = 0; hops <= REMOTE_FETCH_REDIRECT_LIMIT; hops++) {
      const parsed = new URL(current);
      const addresses = await resolveSafeRemoteAddresses(parsed);
      const response = await fetchPinnedRemoteUrl(parsed, addresses, {
        signal: controller.signal,
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        if (!next) {
          throw new Error(`Redirect response without Location header from ${current}`);
        }
        await response.body?.cancel();
        current = new URL(next, current).href;
        continue;
      }
      return responseWithBoundedBody(response, 'GET', () => clearTimeout(timer));
    }
    throw new Error('Exceeded redirect limit while fetching remote URL');
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
};

const resolveSamlIdpConfig = async (provider: ssoProvidersRepo.SsoProvider) => {
  if (provider.metadataXml.trim()) {
    return { ...parseSamlMetadata(provider.metadataXml), source: 'metadataXml' };
  }
  if (provider.metadataUrl.trim()) {
    const response = await safeFetchRemoteUrl(provider.metadataUrl);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Failed to fetch SAML metadata: HTTP ${response.status}`);
    }
    return { ...parseSamlMetadata(await response.text()), source: 'metadataUrl' };
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
    // Stored encrypted at rest for later use as `id_token_hint` on RP-Initiated Logout.
    idToken?: string;
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
  // Replace any previously-tracked SSO session: OIDC records the new id_token; everything
  // else clears the row so a stale OIDC id_token can't drive an end-session redirect on
  // the next logout. The "OIDC without id_token" case (rare — some IdPs omit it on
  // re-auth) lands in the clear branch, dropping a still-valid prior token. Accepted
  // trade-off: we'd rather lose the hint than redirect with a hint that doesn't match
  // the current login.
  const recordSession =
    provider.protocol === 'oidc' && identity.idToken
      ? ssoUserSessionsRepo.upsert({
          userId: user.id,
          providerId: provider.id,
          idToken: encrypt(identity.idToken),
        })
      : ssoUserSessionsRepo.deleteByUserId(user.id);
  const [, ticket] = await Promise.all([recordSession, createLoginTicket(user.id, user.role)]);
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
  try {
    const { clientSecret } = getProviderSecrets(provider);
    if (!provider.issuerUrl || !provider.clientId) {
      throw new SsoLoginError(
        'OIDC provider is missing issuer URL or client ID',
        'provider_misconfigured',
      );
    }
    // Keep every openid-client HTTP request on the same SSRF/timeout policy as the SAML
    // metadata fetch. customFetch covers discovery, JWKS, token, UserInfo, and future OIDC calls.
    const issuerUrl = new URL(provider.issuerUrl);
    const config = await oidc.discovery(
      issuerUrl,
      provider.clientId,
      clientSecret || undefined,
      undefined,
      {
        [oidc.customFetch]: safeOidcFetch,
        timeout: OIDC_REMOTE_FETCH_TIMEOUT_SECONDS,
      },
    );
    await assertSafeOidcServerMetadata(config, {
      includeEndSessionEndpoint: provider.endSessionEnabled,
    });
    return config;
  } catch (err) {
    if (err instanceof SsoLoginError) throw err;
    const message = err instanceof Error ? err.message : 'OIDC provider discovery failed';
    throw new SsoLoginError(message || 'OIDC provider discovery failed', 'provider_misconfigured');
  }
};

type SamlClientContext = {
  saml: SAML;
  idpIssuer: string;
};

const firstNonEmptyConfigValue = (...values: string[]): string => {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
};

const createSamlClient = async (
  provider: ssoProvidersRepo.SsoProvider,
  baseUrl: string,
): Promise<SamlClientContext> => {
  const idp = await resolveSamlIdpConfig(provider);
  const { privateKey } = getProviderSecrets(provider);
  const callbackUrl = buildCallbackUrl('saml', provider.slug, baseUrl);
  const issuer = provider.spIssuer || buildSamlMetadataUrl(provider.slug, baseUrl);
  const entryPoint = firstNonEmptyConfigValue(idp.entryPoint, provider.entryPoint);
  const idpCert = normalizeCertificate(firstNonEmptyConfigValue(idp.idpCert, provider.idpCert));
  const idpIssuer = firstNonEmptyConfigValue(provider.idpIssuer, idp.idpIssuer);
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
  return {
    saml: new SAML({
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
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
      cacheProvider: new DbSamlCacheProvider(provider.id),
    }),
    idpIssuer,
  };
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
    endSessionEnabled: patch.endSessionEnabled ?? false,
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
  const serverMetadata = config.serverMetadata() as Record<string, unknown>;
  const hasUserInfoEndpoint =
    typeof serverMetadata.userinfo_endpoint === 'string' &&
    serverMetadata.userinfo_endpoint.trim().length > 0;
  if (tokens.access_token && hasUserInfoEndpoint) {
    userInfo = (await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)) as Record<
      string,
      unknown
    >;
  }
  const idTokenClaims = claims as Record<string, unknown>;
  const mergedClaims = { ...idTokenClaims, ...userInfo };
  return completeExternalLogin(provider, {
    issuer: coerceString(idTokenClaims.iss) || provider.issuerUrl,
    subject: claims.sub,
    username: readClaim(mergedClaims, provider.usernameAttribute),
    name: readClaim(mergedClaims, provider.nameAttribute),
    email: readClaim(mergedClaims, provider.emailAttribute),
    groups: readGroupsClaim(mergedClaims, provider.groupsAttribute, {
      providerId: provider.id,
      protocol: provider.protocol,
    }),
    // Persisted unconditionally: the admin may flip `endSessionEnabled` on later, and an
    // id_token captured now is the only `id_token_hint` we'll ever have for this session.
    idToken: typeof tokens.id_token === 'string' ? tokens.id_token : undefined,
  });
};

export const startSamlLogin = async (slug: string): Promise<string> => {
  const baseUrl = resolvePublicBaseUrl();
  const provider = await getEnabledProviderBySlug('saml', slug);
  const { saml } = await createSamlClient(provider, baseUrl);
  return saml.getAuthorizeUrlAsync('', undefined, {});
};

export const completeSamlLogin = async (
  slug: string,
  formBody: Record<string, string>,
): Promise<string> => {
  const baseUrl = resolvePublicBaseUrl();
  const provider = await getEnabledProviderBySlug('saml', slug);
  const { saml, idpIssuer } = await createSamlClient(provider, baseUrl);
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
  const issuer = coerceString(profile.issuer);
  if (!issuer) {
    throw new SsoLoginError('SAML response did not include an issuer', 'invalid_response');
  }
  if (issuer !== idpIssuer) {
    throw new SsoLoginError(
      'SAML response issuer did not match the configured IdP issuer',
      'invalid_response',
    );
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

/**
 * If `userId` has a stored OIDC session whose provider opted in to RP-Initiated Logout,
 * returns the IdP's `end_session_endpoint` URL with `id_token_hint` + `post_logout_redirect_uri`.
 * Returns null when there is nothing to redirect to. Transient IdP failures (network,
 * malformed discovery) throw so the row is kept for the next attempt; the caller is
 * responsible for swallowing the rejection so a broken IdP cannot block the local logout.
 */
export const endOidcSession = async (userId: string): Promise<string | null> => {
  const row = await ssoUserSessionsRepo.findActiveOidcByUserId(userId);
  if (!row) return null;

  let idToken: string;
  try {
    idToken = decrypt(row.session.idToken);
  } catch {
    // Ciphertext is unreadable (e.g. ENCRYPTION_KEY rotated). Drop the row; the next OIDC
    // login will rewrite it.
    await ssoUserSessionsRepo.deleteByUserId(userId);
    return null;
  }

  // Run discovery + URL build first; only consume the row once we know we have a real URL
  // to hand back. A transient failure here throws — the caller catches and logs.
  const config = await createOidcConfig(row.provider);
  const { end_session_endpoint } = config.serverMetadata();
  const url = end_session_endpoint
    ? oidc.buildEndSessionUrl(config, {
        id_token_hint: idToken,
        // Admins must register this URI with their IdP; most IdPs validate
        // `post_logout_redirect_uri` against a pre-registered allowlist.
        post_logout_redirect_uri: requireFrontendBaseUrl(),
        client_id: row.provider.clientId,
      })
    : null;
  // One-shot: the row is consumed even if the browser later fails to follow the redirect
  // (popup blocker, CSP, network drop). `session_version` is bumped right after, so the
  // Praetor JWT is dead regardless — the worst case is a leftover IdP cookie until its
  // natural expiry, which is the pre-existing behaviour we're already escaping.
  await ssoUserSessionsRepo.deleteByUserId(userId);
  return url ? url.href : null;
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
  const [permissions, availableRoles] = await Promise.all([
    getRolePermissions(activeRole),
    rolesRepo.listAvailableRolesForUser(user.id),
  ]);
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
