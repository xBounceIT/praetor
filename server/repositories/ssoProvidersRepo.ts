import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { type SsoProtocol, type StoredSsoRoleMapping, ssoProviders } from '../db/schema/sso.ts';

export type SsoRoleMapping = StoredSsoRoleMapping;

export type SsoProvider = {
  id: string;
  protocol: SsoProtocol;
  slug: string;
  name: string;
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  metadataUrl: string;
  metadataXml: string;
  entryPoint: string;
  idpIssuer: string;
  idpCert: string;
  spIssuer: string;
  privateKey: string;
  publicCert: string;
  usernameAttribute: string;
  nameAttribute: string;
  emailAttribute: string;
  groupsAttribute: string;
  roleMappings: SsoRoleMapping[];
};

export type NewSsoProvider = SsoProvider;
export type SsoProviderPatch = Partial<Omit<SsoProvider, 'id'>>;

export type PublicSsoProvider = Pick<SsoProvider, 'protocol' | 'slug' | 'name'>;

export const DEFAULT_OIDC_FIELDS = {
  scopes: 'openid profile email',
  usernameAttribute: 'preferred_username',
  nameAttribute: 'name',
  emailAttribute: 'email',
  groupsAttribute: 'groups',
} as const;

export const DEFAULT_SAML_FIELDS = {
  usernameAttribute: 'nameID',
  nameAttribute: 'name',
  emailAttribute: 'email',
  groupsAttribute: 'groups',
} as const;

const PROVIDER_PROJECTION = {
  id: ssoProviders.id,
  protocol: ssoProviders.protocol,
  slug: ssoProviders.slug,
  name: ssoProviders.name,
  enabled: ssoProviders.enabled,
  issuerUrl: ssoProviders.issuerUrl,
  clientId: ssoProviders.clientId,
  clientSecret: ssoProviders.clientSecret,
  scopes: ssoProviders.scopes,
  metadataUrl: ssoProviders.metadataUrl,
  metadataXml: ssoProviders.metadataXml,
  entryPoint: ssoProviders.entryPoint,
  idpIssuer: ssoProviders.idpIssuer,
  idpCert: ssoProviders.idpCert,
  spIssuer: ssoProviders.spIssuer,
  privateKey: ssoProviders.privateKey,
  publicCert: ssoProviders.publicCert,
  usernameAttribute: ssoProviders.usernameAttribute,
  nameAttribute: ssoProviders.nameAttribute,
  emailAttribute: ssoProviders.emailAttribute,
  groupsAttribute: ssoProviders.groupsAttribute,
  roleMappings: ssoProviders.roleMappings,
} as const;

type ProviderRow = {
  id: string;
  protocol: SsoProtocol;
  slug: string;
  name: string;
  enabled: boolean | null;
  issuerUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  scopes: string | null;
  metadataUrl: string | null;
  metadataXml: string | null;
  entryPoint: string | null;
  idpIssuer: string | null;
  idpCert: string | null;
  spIssuer: string | null;
  privateKey: string | null;
  publicCert: string | null;
  usernameAttribute: string | null;
  nameAttribute: string | null;
  emailAttribute: string | null;
  groupsAttribute: string | null;
  roleMappings: SsoRoleMapping[] | null;
};

const mapRow = (row: ProviderRow): SsoProvider => {
  const defaults = row.protocol === 'saml' ? DEFAULT_SAML_FIELDS : DEFAULT_OIDC_FIELDS;
  return {
    id: row.id,
    protocol: row.protocol,
    slug: row.slug,
    name: row.name,
    enabled: row.enabled ?? false,
    issuerUrl: row.issuerUrl ?? '',
    clientId: row.clientId ?? '',
    clientSecret: row.clientSecret ?? '',
    scopes: row.scopes ?? DEFAULT_OIDC_FIELDS.scopes,
    metadataUrl: row.metadataUrl ?? '',
    metadataXml: row.metadataXml ?? '',
    entryPoint: row.entryPoint ?? '',
    idpIssuer: row.idpIssuer ?? '',
    idpCert: row.idpCert ?? '',
    spIssuer: row.spIssuer ?? '',
    privateKey: row.privateKey ?? '',
    publicCert: row.publicCert ?? '',
    usernameAttribute: row.usernameAttribute ?? defaults.usernameAttribute,
    nameAttribute: row.nameAttribute ?? defaults.nameAttribute,
    emailAttribute: row.emailAttribute ?? defaults.emailAttribute,
    groupsAttribute: row.groupsAttribute ?? defaults.groupsAttribute,
    roleMappings: row.roleMappings ?? [],
  };
};

const rowToPublic = (row: Pick<SsoProvider, 'protocol' | 'slug' | 'name'>): PublicSsoProvider => ({
  protocol: row.protocol,
  slug: row.slug,
  name: row.name,
});

export const list = async (exec: DbExecutor = db): Promise<SsoProvider[]> => {
  const rows = await exec.select(PROVIDER_PROJECTION).from(ssoProviders).orderBy(ssoProviders.name);
  return rows.map(mapRow);
};

export const listPublicEnabled = async (exec: DbExecutor = db): Promise<PublicSsoProvider[]> => {
  const rows = await exec
    .select({
      protocol: ssoProviders.protocol,
      slug: ssoProviders.slug,
      name: ssoProviders.name,
    })
    .from(ssoProviders)
    .where(eq(ssoProviders.enabled, true))
    .orderBy(ssoProviders.name);
  return rows.map(rowToPublic);
};

export const findById = async (id: string, exec: DbExecutor = db): Promise<SsoProvider | null> => {
  const rows = await exec
    .select(PROVIDER_PROJECTION)
    .from(ssoProviders)
    .where(eq(ssoProviders.id, id));
  return rows[0] ? mapRow(rows[0]) : null;
};

export const findBySlug = async (
  slug: string,
  exec: DbExecutor = db,
): Promise<SsoProvider | null> => {
  const rows = await exec
    .select(PROVIDER_PROJECTION)
    .from(ssoProviders)
    .where(eq(ssoProviders.slug, slug));
  return rows[0] ? mapRow(rows[0]) : null;
};

export const insert = async (
  provider: NewSsoProvider,
  exec: DbExecutor = db,
): Promise<SsoProvider> => {
  const rows = await exec.insert(ssoProviders).values(provider).returning(PROVIDER_PROJECTION);
  return mapRow(rows[0]);
};

export const update = async (
  id: string,
  patch: SsoProviderPatch,
  exec: DbExecutor = db,
): Promise<SsoProvider | null> => {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) set[key] = value;
  }
  if (Object.keys(set).length === 0) return findById(id, exec);

  const rows = await exec
    .update(ssoProviders)
    .set({ ...set, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(ssoProviders.id, id))
    .returning(PROVIDER_PROJECTION);
  return rows[0] ? mapRow(rows[0]) : null;
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec.delete(ssoProviders).where(eq(ssoProviders.id, id)).returning({
    id: ssoProviders.id,
  });
  return rows.length > 0;
};
