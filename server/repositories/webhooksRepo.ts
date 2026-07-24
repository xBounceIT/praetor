import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import {
  type StoredWebhookHeader,
  type WebhookAuthType,
  type WebhookHttpMethod,
  webhooks,
} from '../db/schema/webhooks.ts';

export type WebhookHeader = StoredWebhookHeader;

// Domain shape returned to routes. Secret fields are ciphertext as stored; the route masks them
// before serializing and the dispatcher decrypts them. Timestamps are intentionally omitted from
// the public shape (mirrors ssoProvidersRepo).
export type Webhook = {
  id: string;
  name: string;
  description: string;
  url: string;
  httpMethod: WebhookHttpMethod;
  authType: WebhookAuthType;
  authUsername: string;
  authHeaderName: string;
  authSecret: string;
  customHeaders: WebhookHeader[];
  enabled: boolean;
};

// `authSecret` here is ciphertext: the service encrypts before calling insert/update, so the repo
// stays a pure storage boundary (same contract as ssoProvidersRepo.clientSecret).
export type NewWebhook = Webhook;
export type WebhookPatch = Partial<Omit<Webhook, 'id'>>;

const WEBHOOK_PROJECTION = {
  id: webhooks.id,
  name: webhooks.name,
  description: webhooks.description,
  url: webhooks.url,
  httpMethod: webhooks.httpMethod,
  authType: webhooks.authType,
  authUsername: webhooks.authUsername,
  authHeaderName: webhooks.authHeaderName,
  authSecret: webhooks.authSecret,
  customHeaders: webhooks.customHeaders,
  enabled: webhooks.enabled,
} as const;

type WebhookRow = {
  id: string;
  name: string;
  description: string | null;
  url: string;
  httpMethod: WebhookHttpMethod;
  authType: WebhookAuthType;
  authUsername: string | null;
  authHeaderName: string | null;
  authSecret: string | null;
  customHeaders: WebhookHeader[] | null;
  enabled: boolean | null;
};

const mapRow = (row: WebhookRow): Webhook => ({
  id: row.id,
  name: row.name,
  description: row.description ?? '',
  url: row.url,
  httpMethod: row.httpMethod,
  authType: row.authType,
  authUsername: row.authUsername ?? '',
  authHeaderName: row.authHeaderName ?? '',
  authSecret: row.authSecret ?? '',
  customHeaders: row.customHeaders ?? [],
  enabled: row.enabled ?? true,
});

export const list = async (exec: DbExecutor = db): Promise<Webhook[]> => {
  const rows = await exec
    .select(WEBHOOK_PROJECTION)
    .from(webhooks)
    .orderBy(desc(webhooks.createdAt));
  return rows.map(mapRow);
};

export const listBatchAfterId = async (
  afterId: string | undefined,
  limit: number,
  exec: DbExecutor = db,
): Promise<Webhook[]> => {
  const rows = afterId
    ? await exec
        .select(WEBHOOK_PROJECTION)
        .from(webhooks)
        .where(gt(webhooks.id, afterId))
        .orderBy(asc(webhooks.id))
        .limit(limit)
    : await exec.select(WEBHOOK_PROJECTION).from(webhooks).orderBy(asc(webhooks.id)).limit(limit);
  return rows.map(mapRow);
};

export const findById = async (id: string, exec: DbExecutor = db): Promise<Webhook | null> => {
  const rows = await exec.select(WEBHOOK_PROJECTION).from(webhooks).where(eq(webhooks.id, id));
  return rows[0] ? mapRow(rows[0]) : null;
};

export const insert = async (webhook: NewWebhook, exec: DbExecutor = db): Promise<Webhook> => {
  const rows = await exec.insert(webhooks).values(webhook).returning(WEBHOOK_PROJECTION);
  const row = rows[0];
  if (!row) throw new Error('Webhook insert returned no row');
  return mapRow(row);
};

export const update = async (
  id: string,
  patch: WebhookPatch,
  exec: DbExecutor = db,
): Promise<Webhook | null> => {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) set[key] = value;
  }
  if (Object.keys(set).length === 0) return findById(id, exec);

  const rows = await exec
    .update(webhooks)
    .set({ ...set, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(webhooks.id, id))
    .returning(WEBHOOK_PROJECTION);
  return rows[0] ? mapRow(rows[0]) : null;
};

export const replaceCustomHeadersIfUnchanged = async (
  id: string,
  expected: StoredWebhookHeader[],
  replacement: StoredWebhookHeader[],
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .update(webhooks)
    .set({ customHeaders: replacement, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(webhooks.id, id), eq(webhooks.customHeaders, expected)))
    .returning({ id: webhooks.id });
  return rows.length > 0;
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec
    .delete(webhooks)
    .where(eq(webhooks.id, id))
    .returning({ id: webhooks.id });
  return rows.length > 0;
};
