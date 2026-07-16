import { and, eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows, runAtomically } from '../db/drizzle.ts';
import {
  type SiemCanonicalEvent,
  type SiemLogLevel,
  type SiemProtocol,
  type SiemTcpFraming,
  siemConfig,
  siemOutbox,
} from '../db/schema/siem.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

export type SiemConfig = {
  enabled: boolean;
  host: string;
  port: number;
  protocol: SiemProtocol;
  tcpFraming: SiemTcpFraming;
  sourceIdentifier: string;
  facility: number;
  runtimeLevel: SiemLogLevel;
  includeRuntime: boolean;
  includeAudit: boolean;
  caPem: string;
  serverName: string;
  clientCertPem: string;
  clientKey: string;
  retentionDays: number;
  maxEvents: number;
  revision: number;
  testedRevision: number | null;
  lastTestAt: Date | null;
  lastTestSuccess: boolean | null;
  lastDeliveryAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  droppedRetention: number;
  droppedCapacity: number;
  updatedAt: Date;
};

export type SiemConfigPatch = Partial<Omit<SiemConfig, 'clientKey'>> & {
  clientKeyCiphertext?: string;
};

export type SiemOutboxItem = {
  id: string;
  payload: SiemCanonicalEvent;
  attempts: number;
};

export type SiemStatus = Pick<
  SiemConfig,
  | 'enabled'
  | 'revision'
  | 'testedRevision'
  | 'lastTestAt'
  | 'lastTestSuccess'
  | 'lastDeliveryAt'
  | 'lastErrorAt'
  | 'lastError'
  | 'droppedRetention'
  | 'droppedCapacity'
> & {
  pendingCount: number;
  oldestPendingAt: Date | null;
};

export const DEFAULT_SIEM_CONFIG: SiemConfig = {
  enabled: false,
  host: '',
  port: 6514,
  protocol: 'tls',
  tcpFraming: 'newline',
  sourceIdentifier: 'praetor',
  facility: 16,
  runtimeLevel: 'info',
  includeRuntime: true,
  includeAudit: true,
  caPem: '',
  serverName: '',
  clientCertPem: '',
  clientKey: '',
  retentionDays: 30,
  maxEvents: 1_000_000,
  revision: 1,
  testedRevision: null,
  lastTestAt: null,
  lastTestSuccess: null,
  lastDeliveryAt: null,
  lastErrorAt: null,
  lastError: null,
  droppedRetention: 0,
  droppedCapacity: 0,
  updatedAt: new Date(0),
};

const CONFIG_PROJECTION = {
  enabled: siemConfig.enabled,
  host: siemConfig.host,
  port: siemConfig.port,
  protocol: siemConfig.protocol,
  tcpFraming: siemConfig.tcpFraming,
  sourceIdentifier: siemConfig.sourceIdentifier,
  facility: siemConfig.facility,
  runtimeLevel: siemConfig.runtimeLevel,
  includeRuntime: siemConfig.includeRuntime,
  includeAudit: siemConfig.includeAudit,
  caPem: siemConfig.caPem,
  serverName: siemConfig.serverName,
  clientCertPem: siemConfig.clientCertPem,
  clientKey: siemConfig.clientKey,
  retentionDays: siemConfig.retentionDays,
  maxEvents: siemConfig.maxEvents,
  revision: siemConfig.revision,
  testedRevision: siemConfig.testedRevision,
  lastTestAt: siemConfig.lastTestAt,
  lastTestSuccess: siemConfig.lastTestSuccess,
  lastDeliveryAt: siemConfig.lastDeliveryAt,
  lastErrorAt: siemConfig.lastErrorAt,
  lastError: siemConfig.lastError,
  droppedRetention: siemConfig.droppedRetention,
  droppedCapacity: siemConfig.droppedCapacity,
  updatedAt: siemConfig.updatedAt,
} as const;

const CLEANUP_BATCH_SIZE = 10_000;

const mapConfig = (row: Record<string, unknown>): SiemConfig =>
  ({
    ...DEFAULT_SIEM_CONFIG,
    ...row,
    protocol: row.protocol as SiemProtocol,
    tcpFraming: row.tcpFraming as SiemTcpFraming,
    runtimeLevel: row.runtimeLevel as SiemLogLevel,
  }) as SiemConfig;

export const getConfig = async (exec: DbExecutor = db): Promise<SiemConfig> => {
  const rows = await exec.select(CONFIG_PROJECTION).from(siemConfig).where(eq(siemConfig.id, 1));
  return rows[0] ? mapConfig(rows[0]) : DEFAULT_SIEM_CONFIG;
};

export const updateConfig = async (
  patch: SiemConfigPatch,
  exec: DbExecutor = db,
): Promise<SiemConfig> => {
  const { clientKeyCiphertext, ...values } = patch;
  const result = await exec
    .update(siemConfig)
    .set({
      ...values,
      ...(clientKeyCiphertext !== undefined ? { clientKey: clientKeyCiphertext } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(siemConfig.id, 1))
    .returning(CONFIG_PROJECTION);
  if (!result[0]) throw new Error('siem_config row (id=1) not found; migration missing');
  return mapConfig(result[0]);
};

export const updateConfigForRevision = async (
  patch: SiemConfigPatch,
  expectedRevision: number,
  exec: DbExecutor = db,
): Promise<SiemConfig | null> => {
  const { clientKeyCiphertext, ...values } = patch;
  const result = await exec
    .update(siemConfig)
    .set({
      ...values,
      ...(clientKeyCiphertext !== undefined ? { clientKey: clientKeyCiphertext } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(siemConfig.id, 1), eq(siemConfig.revision, expectedRevision)))
    .returning(CONFIG_PROJECTION);
  return result[0] ? mapConfig(result[0]) : null;
};

export const enableTestedRevision = async (
  revision: number,
  exec: DbExecutor = db,
): Promise<SiemConfig | null> => {
  const result = await exec
    .update(siemConfig)
    .set({ enabled: true, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(siemConfig.id, 1),
        eq(siemConfig.revision, revision),
        eq(siemConfig.testedRevision, revision),
        eq(siemConfig.lastTestSuccess, true),
      ),
    )
    .returning(CONFIG_PROJECTION);
  return result[0] ? mapConfig(result[0]) : null;
};

export const enqueue = async (
  payloads: readonly SiemCanonicalEvent[],
  exec: DbExecutor = db,
): Promise<void> => {
  if (payloads.length === 0) return;
  await exec.insert(siemOutbox).values(
    payloads.map((payload) => ({
      id: generatePrefixedId('siem'),
      payload,
    })),
  );
};

export const claimBatch = async (
  claimToken: string,
  limit = 100,
  exec: DbExecutor = db,
): Promise<SiemOutboxItem[]> =>
  executeRows<SiemOutboxItem>(
    exec,
    sql`WITH candidates AS (
          SELECT id
          FROM siem_outbox
          WHERE available_at <= CURRENT_TIMESTAMP
            AND (claim_token IS NULL OR claimed_at < CURRENT_TIMESTAMP - INTERVAL '60 seconds')
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE siem_outbox AS outbox
        SET claim_token = ${claimToken}, claimed_at = CURRENT_TIMESTAMP
        FROM candidates
        WHERE outbox.id = candidates.id
        RETURNING outbox.id, outbox.payload, outbox.attempts`,
  );

export const complete = async (
  id: string,
  claimToken: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.execute(sql`DELETE FROM siem_outbox WHERE id = ${id} AND claim_token = ${claimToken}`);
};

export const retry = async (
  id: string,
  claimToken: string,
  availableAt: Date,
  error: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.execute(sql`UPDATE siem_outbox
    SET attempts = attempts + 1,
        available_at = ${availableAt},
        claim_token = NULL,
        claimed_at = NULL,
        last_error = ${error.slice(0, 4000)}
    WHERE id = ${id} AND claim_token = ${claimToken}`);
};

export const releaseClaims = async (claimToken: string, exec: DbExecutor = db): Promise<void> => {
  await exec.execute(sql`UPDATE siem_outbox
    SET claim_token = NULL, claimed_at = NULL
    WHERE claim_token = ${claimToken}`);
};
export const renewClaims = async (claimToken: string, exec: DbExecutor = db): Promise<void> => {
  await exec.execute(sql`UPDATE siem_outbox
    SET claimed_at = CURRENT_TIMESTAMP
    WHERE claim_token = ${claimToken}`);
};

export const recordDelivery = async (exec: DbExecutor = db): Promise<void> => {
  await exec.execute(sql`UPDATE siem_config
    SET last_delivery_at = CURRENT_TIMESTAMP, last_error = NULL
    WHERE id = 1`);
};

export const recordError = async (error: string, exec: DbExecutor = db): Promise<void> => {
  await exec.execute(sql`UPDATE siem_config
    SET last_error_at = CURRENT_TIMESTAMP, last_error = ${error.slice(0, 4000)}
    WHERE id = 1`);
};

export const getStatus = async (exec: DbExecutor = db): Promise<SiemStatus> => {
  const rows = await executeRows<SiemStatus>(
    exec,
    sql`SELECT
    config.enabled,
    config.revision,
    config.tested_revision AS "testedRevision",
    config.last_test_at AS "lastTestAt",
    config.last_test_success AS "lastTestSuccess",
    config.last_delivery_at AS "lastDeliveryAt",
    config.last_error_at AS "lastErrorAt",
    config.last_error AS "lastError",
    config.dropped_retention AS "droppedRetention",
    config.dropped_capacity AS "droppedCapacity",
    COUNT(outbox.id)::int AS "pendingCount",
    MIN(outbox.created_at) AS "oldestPendingAt"
  FROM siem_config config
  LEFT JOIN siem_outbox outbox ON TRUE
  WHERE config.id = 1
  GROUP BY config.id`,
  );
  if (!rows[0]) throw new Error('siem_config row (id=1) not found; migration missing');
  return rows[0];
};

export const cleanup = (
  retentionDays: number,
  maxEvents: number,
  exec: DbExecutor = db,
): Promise<{ retention: number; capacity: number }> =>
  runAtomically(exec, async (tx) => {
    const guardRows = await executeRows<{ acquired: boolean }>(
      tx,
      sql`SELECT pg_try_advisory_xact_lock(
        hashtext('praetor'), hashtext('siem_outbox_cleanup')
      ) AS acquired`,
    );
    if (!guardRows[0]?.acquired) return { retention: 0, capacity: 0 };
    const retentionRows = await executeRows<{ count: number }>(
      tx,
      sql`WITH expired AS (
    SELECT id FROM siem_outbox
    WHERE created_at < CURRENT_TIMESTAMP - (${retentionDays} * INTERVAL '1 day')
    ORDER BY created_at ASC
    LIMIT ${CLEANUP_BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM siem_outbox outbox USING expired WHERE outbox.id = expired.id
    RETURNING 1
  ) SELECT COUNT(*)::int AS count FROM deleted`,
    );
    const capacityRows = await executeRows<{ count: number }>(
      tx,
      sql`WITH overflow AS MATERIALIZED (
    SELECT LEAST(GREATEST(COUNT(*)::bigint - ${maxEvents}, 0), ${CLEANUP_BATCH_SIZE})::int AS count
    FROM siem_outbox
  ), excess AS (
    SELECT id FROM siem_outbox
    ORDER BY created_at ASC, id ASC
    LIMIT COALESCE((SELECT count FROM overflow), 0)
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM siem_outbox outbox USING excess WHERE outbox.id = excess.id RETURNING 1
  ) SELECT COUNT(*)::int AS count FROM deleted`,
    );
    const retention = retentionRows[0]?.count ?? 0;
    const capacity = capacityRows[0]?.count ?? 0;
    if (retention || capacity) {
      await tx.execute(sql`UPDATE siem_config SET
      dropped_retention = dropped_retention + ${retention},
      dropped_capacity = dropped_capacity + ${capacity}
      WHERE id = 1`);
    }
    return { retention, capacity };
  });
