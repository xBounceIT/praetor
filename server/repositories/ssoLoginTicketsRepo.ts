import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { ssoLoginTickets } from '../db/schema/sso.ts';

export type SsoLoginTicket = {
  ticket: string;
  userId: string;
  activeRole: string;
  expiresAt: Date;
};

const TICKET_PROJECTION = {
  ticket: ssoLoginTickets.ticket,
  userId: ssoLoginTickets.userId,
  activeRole: ssoLoginTickets.activeRole,
  expiresAt: ssoLoginTickets.expiresAt,
} as const;

export const insert = async (ticket: SsoLoginTicket, exec: DbExecutor = db): Promise<void> => {
  await exec.insert(ssoLoginTickets).values(ticket);
};

export const consume = async (
  ticket: string,
  exec: DbExecutor = db,
): Promise<SsoLoginTicket | null> => {
  const rows = await exec
    .update(ssoLoginTickets)
    .set({ consumedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(ssoLoginTickets.ticket, ticket),
        isNull(ssoLoginTickets.consumedAt),
        gt(ssoLoginTickets.expiresAt, new Date()),
      ),
    )
    .returning(TICKET_PROJECTION);
  return rows[0] ?? null;
};
