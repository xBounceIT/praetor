import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { quoteCommunicationChannels } from '../db/schema/quoteCommunicationChannels.ts';
import { quotes } from '../db/schema/quotes.ts';
import { supplierQuotes } from '../db/schema/supplierQuotes.ts';
import { parseDbNumber } from '../utils/parse.ts';

export const DEFAULT_QUOTE_COMMUNICATION_CHANNEL_ID = 'qcc_email';
export const QUOTE_COMMUNICATION_CHANNEL_ICONS = [
  'comments',
  'envelope',
  'globe',
  'phone',
  'video',
  'whatsapp',
] as const;
export type QuoteCommunicationChannelIcon = (typeof QUOTE_COMMUNICATION_CHANNEL_ICONS)[number];
export const DEFAULT_CUSTOM_QUOTE_COMMUNICATION_CHANNEL_ICON: QuoteCommunicationChannelIcon =
  'comments';
export const isQuoteCommunicationChannelIcon = (
  value: unknown,
): value is QuoteCommunicationChannelIcon =>
  typeof value === 'string' &&
  (QUOTE_COMMUNICATION_CHANNEL_ICONS as readonly string[]).includes(value);

export type QuoteCommunicationChannel = {
  id: string;
  name: string;
  icon: QuoteCommunicationChannelIcon;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  clientQuoteCount: number;
  supplierQuoteCount: number;
  totalQuoteCount: number;
};

type ChannelRow = {
  id: string;
  name: string;
  icon?: string | null;
  isDefault?: boolean | null;
  createdAt?: string | number | Date | null;
  updatedAt?: string | number | Date | null;
  clientQuoteCount?: string | number | null;
  supplierQuoteCount?: string | number | null;
};

const epochMs = (value: string | number | Date | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const normalizeIcon = (icon: string | null | undefined): QuoteCommunicationChannelIcon =>
  isQuoteCommunicationChannelIcon(icon) ? icon : DEFAULT_CUSTOM_QUOTE_COMMUNICATION_CHANNEL_ICON;

const mapChannel = (row: ChannelRow): QuoteCommunicationChannel => {
  const clientQuoteCount = parseDbNumber(row.clientQuoteCount, 0);
  const supplierQuoteCount = parseDbNumber(row.supplierQuoteCount, 0);
  return {
    id: row.id,
    name: row.name,
    icon: normalizeIcon(row.icon),
    isDefault: Boolean(row.isDefault),
    createdAt: epochMs(row.createdAt),
    updatedAt: epochMs(row.updatedAt),
    clientQuoteCount,
    supplierQuoteCount,
    totalQuoteCount: clientQuoteCount + supplierQuoteCount,
  };
};

export const listAllWithCounts = async (
  exec: DbExecutor = db,
): Promise<QuoteCommunicationChannel[]> => {
  const rows = await executeRows<ChannelRow>(
    exec,
    sql`SELECT
          c.id,
          c.name,
          c.icon,
          c.is_default AS "isDefault",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",
          COALESCE(q.count, 0) AS "clientQuoteCount",
          COALESCE(sq.count, 0) AS "supplierQuoteCount"
        FROM quote_communication_channels c
        LEFT JOIN (
          SELECT communication_channel_id, COUNT(*) AS count
          FROM quotes
          GROUP BY communication_channel_id
        ) q ON c.id = q.communication_channel_id
        LEFT JOIN (
          SELECT communication_channel_id, COUNT(*) AS count
          FROM supplier_quotes
          GROUP BY communication_channel_id
        ) sq ON c.id = sq.communication_channel_id
        ORDER BY c.name ASC`,
  );
  return rows.map(mapChannel);
};

export const listCore = async (
  exec: DbExecutor = db,
): Promise<Array<{ id: string; name: string }>> =>
  await exec
    .select({ id: quoteCommunicationChannels.id, name: quoteCommunicationChannels.name })
    .from(quoteCommunicationChannels)
    .orderBy(asc(quoteCommunicationChannels.name));

export const findById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{
  id: string;
  name: string;
  icon: QuoteCommunicationChannelIcon;
  isDefault: boolean;
} | null> => {
  const rows = await exec
    .select({
      id: quoteCommunicationChannels.id,
      name: quoteCommunicationChannels.name,
      icon: quoteCommunicationChannels.icon,
      isDefault: quoteCommunicationChannels.isDefault,
    })
    .from(quoteCommunicationChannels)
    .where(eq(quoteCommunicationChannels.id, id))
    .limit(1);
  const row = rows[0];
  return row ? { ...row, icon: normalizeIcon(row.icon) } : null;
};

export const findDefault = async (
  exec: DbExecutor = db,
): Promise<{ id: string; name: string } | null> => {
  const defaultChannel = await findById(DEFAULT_QUOTE_COMMUNICATION_CHANNEL_ID, exec);
  if (defaultChannel) return defaultChannel;
  const rows = await listCore(exec);
  return rows[0] ?? null;
};

export const existsByName = async (
  name: string,
  excludeId: string | null,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const conditions = [sql`LOWER(${quoteCommunicationChannels.name}) = LOWER(${name})`];
  if (excludeId) conditions.push(ne(quoteCommunicationChannels.id, excludeId));
  const rows = await exec
    .select({ id: quoteCommunicationChannels.id })
    .from(quoteCommunicationChannels)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
};

export const create = async (
  id: string,
  name: string,
  icon: QuoteCommunicationChannelIcon,
  exec: DbExecutor = db,
): Promise<QuoteCommunicationChannel> => {
  const [row] = await exec
    .insert(quoteCommunicationChannels)
    .values({ id, name, icon, isDefault: false })
    .returning();
  return mapChannel(row);
};

export const update = async (
  id: string,
  name: string,
  icon: QuoteCommunicationChannelIcon,
  exec: DbExecutor = db,
): Promise<QuoteCommunicationChannel | null> => {
  const [row] = await exec
    .update(quoteCommunicationChannels)
    .set({ name, icon, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(eq(quoteCommunicationChannels.id, id), eq(quoteCommunicationChannels.isDefault, false)),
    )
    .returning();
  return row ? mapChannel(row) : null;
};

export const countAll = async (exec: DbExecutor = db): Promise<number> => {
  const rows = await exec.select({ value: sql<number>`COUNT(*)` }).from(quoteCommunicationChannels);
  return parseDbNumber(rows[0]?.value, 0);
};

export const countReferences = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ clientQuoteCount: number; supplierQuoteCount: number; totalQuoteCount: number }> => {
  const [clientRows, supplierRows] = await Promise.all([
    exec
      .select({ value: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(eq(quotes.communicationChannelId, id)),
    exec
      .select({ value: sql<number>`COUNT(*)` })
      .from(supplierQuotes)
      .where(eq(supplierQuotes.communicationChannelId, id)),
  ]);
  const clientQuoteCount = parseDbNumber(clientRows[0]?.value, 0);
  const supplierQuoteCount = parseDbNumber(supplierRows[0]?.value, 0);
  return {
    clientQuoteCount,
    supplierQuoteCount,
    totalQuoteCount: clientQuoteCount + supplierQuoteCount,
  };
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec
    .delete(quoteCommunicationChannels)
    .where(
      and(eq(quoteCommunicationChannels.id, id), eq(quoteCommunicationChannels.isDefault, false)),
    );
  return (result.rowCount ?? 0) > 0;
};
