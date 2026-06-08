import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// Outbound HTTP method a webhook target is invoked with. The column is a plain varchar guarded
// by a CHECK constraint; the `$type` annotation surfaces the union to TS callers. The tuple is the
// single backend source for these values — the route imports it for its AJV enums and validators
// so the union type and the runtime allow-list can never drift.
export const WEBHOOK_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type WebhookHttpMethod = (typeof WEBHOOK_HTTP_METHODS)[number];

// How Praetor authenticates to the target. `none` sends no credentials. The credential columns
// are interpreted per-type (see webhooksService): `bearer` uses auth_secret as the token; `basic`
// pairs auth_username with auth_secret (the password); `api_key` sends auth_secret under the
// header named by auth_header_name. auth_secret is always stored as ciphertext (utils/crypto.ts).
export const WEBHOOK_AUTH_TYPES = ['none', 'basic', 'bearer', 'api_key'] as const;
export type WebhookAuthType = (typeof WEBHOOK_AUTH_TYPES)[number];

// Arbitrary request headers attached to every dispatch, layered on top of (and lower priority
// than) the headers the auth type contributes. Stored as a JSON array so order is preserved.
export type StoredWebhookHeader = {
  key: string;
  value: string;
};

export const webhooks = pgTable(
  'webhooks',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').default(''),
    url: varchar('url', { length: 2000 }).notNull(),
    httpMethod: varchar('http_method', { length: 10 })
      .$type<WebhookHttpMethod>()
      .notNull()
      .default('POST'),
    authType: varchar('auth_type', { length: 20 })
      .$type<WebhookAuthType>()
      .notNull()
      .default('none'),
    // Non-secret auth metadata: the basic-auth username and the api-key header name.
    authUsername: varchar('auth_username', { length: 255 }).default(''),
    authHeaderName: varchar('auth_header_name', { length: 255 }).default(''),
    // Encrypted ciphertext when stored (bearer token / basic password / api-key value); callers
    // must `decrypt()` before dispatching. Masked with MASKED_SECRET in API responses.
    authSecret: text('auth_secret').default(''),
    customHeaders: jsonb('custom_headers').$type<StoredWebhookHeader[]>().default(sql`'[]'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    check(
      'webhooks_http_method_check',
      sql`${table.httpMethod} IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')`,
    ),
    check(
      'webhooks_auth_type_check',
      sql`${table.authType} IN ('none', 'basic', 'bearer', 'api_key')`,
    ),
    index('idx_webhooks_created_at').on(table.createdAt),
  ],
);
