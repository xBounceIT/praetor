import { type DbExecutor, db } from '../db/drizzle.ts';
import {
  type OvertimeNotificationSource,
  type OvertimeReason,
  overtimeNotificationEvents,
} from '../db/schema/overtimeNotificationEvents.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { numericForDb } from '../utils/parse.ts';

export type NewOvertimeNotificationEvent = {
  userId: string;
  eventDate: string;
  source: OvertimeNotificationSource;
  hours: number;
  reasons: OvertimeReason[];
  createdBy: string | null;
};

export const createIfAbsent = async (
  event: NewOvertimeNotificationEvent,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .insert(overtimeNotificationEvents)
    .values({
      id: generatePrefixedId('ot'),
      userId: event.userId,
      eventDate: event.eventDate,
      source: event.source,
      hours: numericForDb(event.hours),
      reasons: event.reasons,
      createdBy: event.createdBy,
    })
    .onConflictDoNothing({
      target: [
        overtimeNotificationEvents.userId,
        overtimeNotificationEvents.eventDate,
        overtimeNotificationEvents.source,
      ],
    })
    .returning({ id: overtimeNotificationEvents.id });
  return rows.length > 0;
};
