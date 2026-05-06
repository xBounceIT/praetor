import {
  type CacheItem,
  type CacheProvider,
  generateServiceProviderMetadata,
  type Profile,
  SAML,
  ValidateInResponseTo,
} from '@node-saml/node-saml';
import * as oidc from 'openid-client';
import * as rolesRepo from '../repositories/rolesRepo.ts';
import * as ssoLoginTicketsRepo from '../repositories/ssoLoginTicketsRepo.ts';
import * as ssoProvidersRepo from '../repositories/ssoProvidersRepo.ts';
import * as ssoStatesRepo from '../repositories/ssoStatesRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { decrypt, encrypt, MASKED_SECRET } from '../utils/crypto.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { getRolePermissions } from '../utils/permissions.ts';
import { resolveExternalIdentity } from './external-auth.ts';

const OIDC_STATE_TTL_MS = 10 * 60 * 1000;
const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;
const LOGIN_TICKET_TTL_MS = 2 * 60 * 1000;

export type AdminSsoProvider = ssoProvidersRepo.SsoProvider;
export type PublicSsoProvider = ssoProvidersRepo.PublicSsoProvider;
export type SsoProviderInput = Partial<Omit<ssoProvidersRepo.SsoProvider, 'id'>> & {
  id?: string;
};

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
});

const getProviderSecrets = (provider: ssoProvidersRepo.SsoProvider) => ({
  clientSecret: provider.clientSecret ? decrypt(provider.clientSecret) : '',
  privateKey: provider.privateKey ? decrypt(provider.privateKey) : '',
});

const normalizeSlug = (slug: string) => slug.trim().toLowerCase();

const coerceString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const coerceStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(coerceStringArray);
  const normalized = coerceString(value);
  return normalized ? [normalized] : [];
};

const readClaim = (claims: Record<string, unknown>, name: string): string => {
  if (name === 'nameID') return coerceString(claims.nameID);
  return coerceString(claims[name]);
};

const readClaimArray = (claims: Record<string, unknown>, name: string): string[] => {
  if (name === 'nameID') return coerceStringArray(claims.nameID);
  return coerceStringArray(claims[name]);
};

const buildPublicSsoUrl = (path: string, requestOrigin: string): string => {
  const base = process.env.SSO_CALLBACK_BASE_URL?.trim() || requestOrigin;
  return new URL(path, base).href;
};

const buildCallbackUrl = (protocol: 'oidc' | 'saml', slug: string, requestOrigin: string): string =>
  buildPublicSsoUrl(`/api/auth/sso/${protocol}/${slug}/callback`, requestOrigin);

const buildSamlMetadataUrl = (slug: string, requestOrigin: string): string =>
  buildPublicSsoUrl(`/api/auth/sso/saml/${slug}/metadata`, requestOrigin);

const buildFrontendTicketUrl = (ticket: string): string => {
  const configured = process.env.FRONTEND_URL?.trim();
  if (!configured) return `/?sso_ticket=${encodeURIComponent(ticket)}`;
  const url = new URL(configured);
  url.searchParams.set('sso_ticket', ticket);
  return url.href;
};

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

class DbSamlCacheProvider implements CacheProvider {
  constructor(private readonly providerId: string) {}

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    await ssoStatesRepo.insert({
      state: key,
      providerId: this.providerId,
      protocol: 'saml',
      codeVerifier: '',
      relayState: value,
      expiresAt: new Date(Date.now() + SAML_REQUEST_TTL_MS),
    });
    return { value, createdAt: Date.now() };
  }

  async getAsync(key: string): Promise<string | null> {
    const state = await ssoStatesRepo.get(key);
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

const getXmlAttribute = (tag: string, attribute: string): string => {
  const match = tag.match(new RegExp(`${attribute}=["']([^"']+)["']`, 'i'));
  return match?.[1] ?? '';
};

const parseSamlMetadata = (xml: string) => {
  const entityMatch = xml.match(/<[^>]*EntityDescriptor\b[^>]*entityID=["']([^"']+)["']/i);
  const ssoTags = [...xml.matchAll(/<[^>]*SingleSignOnService\b[^>]*>/gi)].map((m) => m[0]);
  const redirectTag =
    ssoTags.find((tag) => /HTTP-Redirect/i.test(getXmlAttribute(tag, 'Binding'))) ?? ssoTags[0];
  const certMatch = xml.match(/<[^>]*X509Certificate[^>]*>([\s\S]*?)<\/[^>]*X509Certificate>/i);
  return {
    idpIssuer: entityMatch?.[1] ?? '',
    entryPoint: redirectTag ? getXmlAttribute(redirectTag, 'Location') : '',
    idpCert: certMatch?.[1] ? normalizeCertificate(certMatch[1]) : '',
  };
};

const resolveSamlIdpConfig = async (provider: ssoProvidersRepo.SsoProvider) => {
  if (provider.metadataXml.trim()) {
    return { ...parseSamlMetadata(provider.metadataXml), source: 'metadataXml' };
  }
  if (provider.metadataUrl.trim()) {
    const response = await fetch(provider.metadataUrl);
    if (!response.ok) throw new Error(`Failed to fetch SAML metadata: HTTP ${response.status}`);
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
  const user = await resolveExternalIdentity({
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
  const ticket = await createLoginTicket(user.id, user.role);
  return buildFrontendTicketUrl(ticket);
};

const getEnabledProviderBySlug = async (
  protocol: 'oidc' | 'saml',
  slug: string,
): Promise<ssoProvidersRepo.SsoProvider> => {
  const provider = await ssoProvidersRepo.findBySlug(slug);
  if (!provider || provider.protocol !== protocol || !provider.enabled) {
    throw new Error('SSO provider is not enabled');
  }
  return provider;
};

const getProviderBySlug = async (
  protocol: 'oidc' | 'saml',
  slug: string,
): Promise<ssoProvidersRepo.SsoProvider> => {
  const provider = await ssoProvidersRepo.findBySlug(slug);
  if (!provider || provider.protocol !== protocol) {
    throw new Error('SSO provider not found');
  }
  return provider;
};

const createOidcConfig = async (provider: ssoProvidersRepo.SsoProvider) => {
  const { clientSecret } = getProviderSecrets(provider);
  if (!provider.issuerUrl || !provider.clientId) {
    throw new Error('OIDC provider is missing issuer URL or client ID');
  }
  return oidc.discovery(new URL(provider.issuerUrl), provider.clientId, clientSecret || undefined);
};

const createSamlClient = async (
  provider: ssoProvidersRepo.SsoProvider,
  requestOrigin: string,
): Promise<SAML> => {
  const idp = await resolveSamlIdpConfig(provider);
  const { privateKey } = getProviderSecrets(provider);
  const callbackUrl = buildCallbackUrl('saml', provider.slug, requestOrigin);
  const issuer = provider.spIssuer || buildSamlMetadataUrl(provider.slug, requestOrigin);
  const entryPoint = idp.entryPoint || provider.entryPoint;
  const idpCert = normalizeCertificate(idp.idpCert || provider.idpCert);
  if (!entryPoint || !idpCert) {
    throw new Error('SAML provider is missing entry point or IdP certificate');
  }
  return new SAML({
    callbackUrl,
    issuer,
    audience: issuer,
    entryPoint,
    idpCert,
    idpIssuer: idp.idpIssuer || provider.idpIssuer || undefined,
    privateKey: privateKey || undefined,
    publicCert: provider.publicCert || undefined,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    cacheProvider: new DbSamlCacheProvider(provider.id),
  });
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
  const created = await ssoProvidersRepo.insert({
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
  });
  return maskProvider(created);
};

export const updateProvider = async (
  id: string,
  input: SsoProviderInput,
): Promise<AdminSsoProvider | null> => {
  const existing = await ssoProvidersRepo.findById(id);
  if (!existing) return null;
  const patch = prepareProviderValues(input, existing);
  const updated = await ssoProvidersRepo.update(id, patch);
  return updated ? maskProvider(updated) : null;
};

export const deleteProvider = async (id: string): Promise<boolean> =>
  ssoProvidersRepo.deleteById(id);

export const startOidcLogin = async (slug: string, requestOrigin: string): Promise<string> => {
  const provider = await getEnabledProviderBySlug('oidc', slug);
  const config = await createOidcConfig(provider);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  await ssoStatesRepo.insert({
    state,
    providerId: provider.id,
    protocol: 'oidc',
    codeVerifier,
    relayState: '',
    expiresAt: new Date(Date.now() + OIDC_STATE_TTL_MS),
  });
  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: buildCallbackUrl('oidc', provider.slug, requestOrigin),
    scope: provider.scopes || ssoProvidersRepo.DEFAULT_OIDC_FIELDS.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  }).href;
};

export const completeOidcLogin = async (
  slug: string,
  callbackUrl: URL,
  requestOrigin: string,
): Promise<string> => {
  const provider = await getEnabledProviderBySlug('oidc', slug);
  const stateValue = callbackUrl.searchParams.get('state') || '';
  const state = await ssoStatesRepo.consume(stateValue, 'oidc');
  if (!state || state.providerId !== provider.id) throw new Error('Invalid or expired SSO state');
  const config = await createOidcConfig(provider);
  const publicCallbackUrl = new URL(buildCallbackUrl('oidc', provider.slug, requestOrigin));
  publicCallbackUrl.search = callbackUrl.search;
  publicCallbackUrl.hash = callbackUrl.hash;
  const tokens = await oidc.authorizationCodeGrant(config, publicCallbackUrl, {
    expectedState: state.state,
    pkceCodeVerifier: state.codeVerifier,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error('OIDC response did not include a subject');
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
    groups: readClaimArray(mergedClaims, provider.groupsAttribute),
  });
};

export const startSamlLogin = async (slug: string, requestOrigin: string): Promise<string> => {
  const provider = await getEnabledProviderBySlug('saml', slug);
  const saml = await createSamlClient(provider, requestOrigin);
  return saml.getAuthorizeUrlAsync('', undefined, {});
};

export const completeSamlLogin = async (
  slug: string,
  formBody: Record<string, string>,
  requestOrigin: string,
): Promise<string> => {
  const provider = await getEnabledProviderBySlug('saml', slug);
  const saml = await createSamlClient(provider, requestOrigin);
  const result = await saml.validatePostResponseAsync(formBody);
  if (!result.profile || result.loggedOut) throw new Error('SAML response did not include a login');
  const profile = result.profile as Profile & Record<string, unknown>;
  const claims = profile as Record<string, unknown>;
  const subject = coerceString(profile.nameID);
  if (!subject) throw new Error('SAML response did not include a subject');
  return completeExternalLogin(provider, {
    issuer: coerceString(profile.issuer) || provider.idpIssuer || provider.spIssuer,
    subject,
    username: readClaim(claims, provider.usernameAttribute),
    name: readClaim(claims, provider.nameAttribute),
    email: readClaim(claims, provider.emailAttribute),
    groups: readClaimArray(claims, provider.groupsAttribute),
  });
};

export const getSamlMetadata = async (slug: string, requestOrigin: string): Promise<string> => {
  const provider = await getProviderBySlug('saml', slug);
  const { privateKey } = getProviderSecrets(provider);
  const issuer = provider.spIssuer || buildSamlMetadataUrl(provider.slug, requestOrigin);
  return generateServiceProviderMetadata({
    issuer,
    callbackUrl: buildCallbackUrl('saml', provider.slug, requestOrigin),
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
