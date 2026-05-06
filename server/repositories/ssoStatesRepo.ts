import { and, eq, gt } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { type SsoProtocol, ssoStates } from '../db/schema/sso.ts';

export type SsoState = {
  state: string;
  providerId: string;
  protocol: SsoProtocol;
  codeVerifier: string;
  relayState: string;
  expiresAt: Date;
};

const STATE_PROJECTION = {
  state: ssoStates.state,
  providerId: ssoStates.providerId,
  protocol: ssoStates.protocol,
  codeVerifier: ssoStates.codeVerifier,
  relayState: ssoStates.relayState,
  expiresAt: ssoStates.expiresAt,
} as const;

const mapRow = (row: {
  state: string;
  providerId: string;
  protocol: SsoProtocol;
  codeVerifier: string | null;
  relayState: string | null;
  expiresAt: Date;
}): SsoState => ({
  state: row.state,
  providerId: row.providerId,
  protocol: row.protocol,
  codeVerifier: row.codeVerifier ?? '',
  relayState: row.relayState ?? '',
  expiresAt: row.expiresAt,
});

export const insert = async (state: SsoState, exec: DbExecutor = db): Promise<void> => {
  await exec.insert(ssoStates).values(state);
};

export const consume = async (
  state: string,
  protocol: SsoProtocol,
  exec: DbExecutor = db,
): Promise<SsoState | null> => {
  const rows = await exec
    .delete(ssoStates)
    .where(
      and(
        eq(ssoStates.state, state),
        eq(ssoStates.protocol, protocol),
        gt(ssoStates.expiresAt, new Date()),
      ),
    )
    .returning(STATE_PROJECTION);
  return rows[0] ? mapRow(rows[0]) : null;
};

export const get = async (state: string, exec: DbExecutor = db): Promise<SsoState | null> => {
  const rows = await exec
    .select(STATE_PROJECTION)
    .from(ssoStates)
    .where(eq(ssoStates.state, state));
  return rows[0] ? mapRow(rows[0]) : null;
};

export const remove = async (state: string, exec: DbExecutor = db): Promise<string | null> => {
  const rows = await exec
    .delete(ssoStates)
    .where(eq(ssoStates.state, state))
    .returning({ relayState: ssoStates.relayState });
  return rows[0]?.relayState ?? null;
};
