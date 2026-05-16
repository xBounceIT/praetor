import { and, eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { ssoUserSessions } from '../db/schema/sso.ts';
import { ssoProviders } from '../db/schema/ssoProviders.ts';
import type { SsoProvider } from './ssoProvidersRepo.ts';

export type SsoUserSession = {
  userId: string;
  providerId: string;
  idToken: string;
};

const SESSION_PROJECTION = {
  userId: ssoUserSessions.userId,
  providerId: ssoUserSessions.providerId,
  idToken: ssoUserSessions.idToken,
} as const;

export const upsert = async (session: SsoUserSession, exec: DbExecutor = db): Promise<void> => {
  await exec
    .insert(ssoUserSessions)
    .values(session)
    .onConflictDoUpdate({
      target: ssoUserSessions.userId,
      set: {
        providerId: session.providerId,
        idToken: session.idToken,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
};

export const deleteByUserId = async (userId: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(ssoUserSessions).where(eq(ssoUserSessions.userId, userId));
};

/**
 * Returns the user's stored OIDC session together with its provider, but only when the
 * provider currently warrants an RP-Initiated Logout call (enabled, protocol=oidc,
 * endSessionEnabled). One round-trip instead of two sequential queries on the logout path.
 */
export const findActiveOidcByUserId = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<{ session: SsoUserSession; provider: SsoProvider } | null> => {
  const rows = await exec
    .select({
      session: SESSION_PROJECTION,
      provider: {
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
        endSessionEnabled: ssoProviders.endSessionEnabled,
      },
    })
    .from(ssoUserSessions)
    .innerJoin(ssoProviders, eq(ssoUserSessions.providerId, ssoProviders.id))
    .where(
      and(
        eq(ssoUserSessions.userId, userId),
        eq(ssoProviders.protocol, 'oidc'),
        eq(ssoProviders.enabled, true),
        eq(ssoProviders.endSessionEnabled, true),
      ),
    );
  const row = rows[0];
  if (!row) return null;
  const p = row.provider;
  return {
    session: row.session,
    provider: {
      id: p.id,
      protocol: p.protocol,
      slug: p.slug,
      name: p.name,
      enabled: p.enabled ?? false,
      issuerUrl: p.issuerUrl ?? '',
      clientId: p.clientId ?? '',
      clientSecret: p.clientSecret ?? '',
      scopes: p.scopes ?? '',
      metadataUrl: p.metadataUrl ?? '',
      metadataXml: p.metadataXml ?? '',
      entryPoint: p.entryPoint ?? '',
      idpIssuer: p.idpIssuer ?? '',
      idpCert: p.idpCert ?? '',
      spIssuer: p.spIssuer ?? '',
      privateKey: p.privateKey ?? '',
      publicCert: p.publicCert ?? '',
      usernameAttribute: p.usernameAttribute ?? '',
      nameAttribute: p.nameAttribute ?? '',
      emailAttribute: p.emailAttribute ?? '',
      groupsAttribute: p.groupsAttribute ?? '',
      roleMappings: p.roleMappings ?? [],
      endSessionEnabled: p.endSessionEnabled ?? false,
    },
  };
};
