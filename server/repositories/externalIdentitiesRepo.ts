import { and, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { externalIdentities, type SsoProtocol } from '../db/schema/sso.ts';

export type ExternalIdentity = {
  id: string;
  providerId: string;
  protocol: SsoProtocol;
  issuer: string;
  subject: string;
  userId: string;
};

const IDENTITY_PROJECTION = {
  id: externalIdentities.id,
  providerId: externalIdentities.providerId,
  protocol: externalIdentities.protocol,
  issuer: externalIdentities.issuer,
  subject: externalIdentities.subject,
  userId: externalIdentities.userId,
} as const;

export const findByIdentity = async (
  input: Pick<ExternalIdentity, 'providerId' | 'protocol' | 'issuer' | 'subject'>,
  exec: DbExecutor = db,
): Promise<ExternalIdentity | null> => {
  const rows = await exec
    .select(IDENTITY_PROJECTION)
    .from(externalIdentities)
    .where(
      and(
        eq(externalIdentities.providerId, input.providerId),
        eq(externalIdentities.protocol, input.protocol),
        eq(externalIdentities.issuer, input.issuer),
        eq(externalIdentities.subject, input.subject),
      ),
    );
  return rows[0] ?? null;
};

export const insert = async (identity: ExternalIdentity, exec: DbExecutor = db): Promise<void> => {
  await exec.insert(externalIdentities).values(identity).onConflictDoNothing();
};
