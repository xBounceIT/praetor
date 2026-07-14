import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const SIEM_PROTOCOLS = ['udp', 'tcp', 'tls'] as const;
export type SiemProtocol = (typeof SIEM_PROTOCOLS)[number];

export const SIEM_TCP_FRAMINGS = ['newline', 'octet-counting'] as const;
export type SiemTcpFraming = (typeof SIEM_TCP_FRAMINGS)[number];

export const SIEM_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type SiemLogLevel = (typeof SIEM_LOG_LEVELS)[number];

export type SiemCanonicalEvent = {
  eventId: string;
  occurredAt: string;
  level: SiemLogLevel;
  category: 'runtime' | 'audit';
  resource: string;
  message: string;
  attributes: Record<string, string | number | boolean>;
};

export const siemConfig = pgTable(
  'siem_config',
  {
    id: integer('id').primaryKey().default(1),
    enabled: boolean('enabled').notNull().default(false),
    host: varchar('host', { length: 255 }).notNull().default(''),
    port: integer('port').notNull().default(6514),
    protocol: varchar('protocol', { length: 8 }).notNull().default('tls'),
    tcpFraming: varchar('tcp_framing', { length: 20 }).notNull().default('newline'),
    sourceIdentifier: varchar('source_identifier', { length: 255 }).notNull().default('praetor'),
    facility: integer('facility').notNull().default(16),
    runtimeLevel: varchar('runtime_level', { length: 8 }).notNull().default('info'),
    includeRuntime: boolean('include_runtime').notNull().default(true),
    includeAudit: boolean('include_audit').notNull().default(true),
    caPem: text('ca_pem').notNull().default(''),
    serverName: varchar('server_name', { length: 255 }).notNull().default(''),
    clientCertPem: text('client_cert_pem').notNull().default(''),
    clientKey: text('client_key').notNull().default(''),
    retentionDays: integer('retention_days').notNull().default(30),
    maxEvents: integer('max_events').notNull().default(1_000_000),
    revision: integer('revision').notNull().default(1),
    testedRevision: integer('tested_revision'),
    lastTestAt: timestamp('last_test_at'),
    lastTestSuccess: boolean('last_test_success'),
    lastDeliveryAt: timestamp('last_delivery_at'),
    lastErrorAt: timestamp('last_error_at'),
    lastError: text('last_error'),
    droppedRetention: integer('dropped_retention').notNull().default(0),
    droppedCapacity: integer('dropped_capacity').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('siem_config_id_check', sql`${table.id} = 1`),
    check('siem_config_port_check', sql`${table.port} BETWEEN 1 AND 65535`),
    check('siem_config_protocol_check', sql`${table.protocol} IN ('udp', 'tcp', 'tls')`),
    check(
      'siem_config_tcp_framing_check',
      sql`${table.tcpFraming} IN ('newline', 'octet-counting')`,
    ),
    check('siem_config_facility_check', sql`${table.facility} BETWEEN 0 AND 23`),
    check(
      'siem_config_runtime_level_check',
      sql`${table.runtimeLevel} IN ('trace', 'debug', 'info', 'warn', 'error', 'fatal')`,
    ),
    check('siem_config_retention_days_check', sql`${table.retentionDays} BETWEEN 1 AND 30`),
    check('siem_config_max_events_check', sql`${table.maxEvents} BETWEEN 10000 AND 1000000`),
  ],
);

export const siemOutbox = pgTable(
  'siem_outbox',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    payload: jsonb('payload').$type<SiemCanonicalEvent>().notNull(),
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    claimToken: varchar('claim_token', { length: 100 }),
    claimedAt: timestamp('claimed_at'),
    lastError: text('last_error'),
  },
  (table) => [
    index('idx_siem_outbox_available').on(table.availableAt, table.createdAt),
    index('idx_siem_outbox_claimed_at').on(table.claimedAt),
    index('idx_siem_outbox_created_at').on(table.createdAt),
  ],
);
