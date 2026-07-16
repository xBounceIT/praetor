import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';
import type { AuditLogDetails } from '../db/schema/auditLogs.ts';
import type { SiemCanonicalEvent, SiemLogLevel } from '../db/schema/siem.ts';
import * as siemRepo from '../repositories/siemRepo.ts';
import { decrypt, encrypt, MASKED_SECRET } from '../utils/crypto.ts';
import {
  formatLeefEvent,
  normalizeRuntimeRecord,
  STREAM_MAX_BYTES,
  UDP_MAX_BYTES,
} from '../utils/leef.ts';
import { createChildLogger, registerSiemLogSink, serializeError } from '../utils/logger.ts';

const logger = createChildLogger({ module: 'siem-worker', siemInternal: true });
const LEVEL_PRIORITY: Record<SiemLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const CRITICAL_CONFIG_KEYS: ReadonlyArray<keyof SiemConfigInput> = [
  'host',
  'port',
  'protocol',
  'tcpFraming',
  'sourceIdentifier',
  'facility',
  'caPem',
  'serverName',
  'clientCertPem',
  'clientKey',
];
const CONFIG_UPDATE_ATTEMPTS = 3;
const CLAIM_RENEW_INTERVAL_MS = 30_000;
const RETRY_MAX_BASE_MS = 240_000;

export type SiemConfigInput = Partial<
  Pick<
    siemRepo.SiemConfig,
    | 'host'
    | 'port'
    | 'protocol'
    | 'tcpFraming'
    | 'sourceIdentifier'
    | 'facility'
    | 'runtimeLevel'
    | 'includeRuntime'
    | 'includeAudit'
    | 'caPem'
    | 'serverName'
    | 'clientCertPem'
    | 'retentionDays'
    | 'maxEvents'
  >
> & { clientKey?: string };

type SiemServiceError = Error & { code: string; statusCode?: number };

const createSiemError = (code: string, statusCode?: number): SiemServiceError => {
  const error = new Error(code) as SiemServiceError;
  error.code = code;
  if (statusCode !== undefined) error.statusCode = statusCode;
  return error;
};

export const buildSiemConfigPatch = (
  input: SiemConfigInput,
  current: siemRepo.SiemConfig,
  encryptKey: (value: string) => string = encrypt,
): { patch: siemRepo.SiemConfigPatch; criticalChanged: boolean } => {
  const criticalChanged = CRITICAL_CONFIG_KEYS.some((key) => {
    if (input[key] === undefined || input[key] === MASKED_SECRET) return false;
    const currentValue =
      key === 'clientKey' ? (current.clientKey ? MASKED_SECRET : '') : current[key];
    return input[key] !== currentValue;
  });
  const { clientKey, ...values } = input;
  return {
    criticalChanged,
    patch: {
      ...values,
      ...(clientKey !== undefined && clientKey !== MASKED_SECRET
        ? { clientKeyCiphertext: clientKey ? encryptKey(clientKey) : '' }
        : {}),
      revision: current.revision + 1,
      ...(criticalChanged
        ? {
            enabled: false,
            testedRevision: null,
            lastTestAt: null,
            lastTestSuccess: null,
          }
        : current.testedRevision === current.revision
          ? { testedRevision: current.revision + 1 }
          : {}),
    },
  };
};

export const calculateRetryDelay = (
  attempts: number,
  random: () => number = Math.random,
): number => {
  const baseDelay = Math.min(RETRY_MAX_BASE_MS, 1000 * 2 ** Math.max(attempts - 1, 0));
  return Math.round(baseDelay * (1 + random() * 0.25));
};

export const validateSiemConfigInput = (
  input: SiemConfigInput,
  current: siemRepo.SiemConfig,
): void => {
  const protocol = input.protocol ?? current.protocol;
  if (input.host !== undefined && !input.host.trim()) {
    throw createSiemError('SIEM_HOST_REQUIRED', 400);
  }
  if (input.sourceIdentifier !== undefined && !input.sourceIdentifier.trim()) {
    throw createSiemError('SIEM_SOURCE_IDENTIFIER_REQUIRED', 400);
  }
  const clientCert = input.clientCertPem ?? current.clientCertPem;
  const clientKey =
    input.clientKey === undefined || input.clientKey === MASKED_SECRET
      ? current.clientKey
      : input.clientKey;
  if (protocol === 'tls' && Boolean(clientCert) !== Boolean(clientKey)) {
    throw createSiemError('SIEM_MTLS_CERT_KEY_REQUIRED', 400);
  }
};

type SiemConfigReader = () => Promise<siemRepo.SiemConfig>;
type SiemConfigWriter = (
  patch: siemRepo.SiemConfigPatch,
  expectedRevision: number,
) => Promise<siemRepo.SiemConfig | null>;

export const persistSiemConfigUpdate = async (
  input: SiemConfigInput,
  readConfig: SiemConfigReader = siemRepo.getConfig,
  writeConfig: SiemConfigWriter = siemRepo.updateConfigForRevision,
): Promise<{ config: siemRepo.SiemConfig; criticalChanged: boolean }> => {
  for (let attempt = 0; attempt < CONFIG_UPDATE_ATTEMPTS; attempt += 1) {
    const current = await readConfig();
    validateSiemConfigInput(input, current);
    const { patch, criticalChanged } = buildSiemConfigPatch(input, current);
    const updated = await writeConfig(patch, current.revision);
    if (updated) return { config: updated, criticalChanged };
  }
  throw createSiemError('SIEM_CONFIG_CONFLICT', 409);
};

type AuditCapture = {
  action: string;
  actorId: string;
  actorName?: string;
  ipAddress: string;
  entityType: string | null;
  entityId: string | null;
  details: AuditLogDetails | null;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 5000): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('SIEM connection timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export class SiemTransport {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private revision: number | null = null;
  private sendQueue: Promise<void> = Promise.resolve();

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.revision = null;
  }

  private async getStream(config: siemRepo.SiemConfig): Promise<net.Socket | tls.TLSSocket> {
    if (this.socket && !this.socket.destroyed && this.revision === config.revision) {
      return this.socket;
    }
    this.close();

    const pending: { socket: net.Socket | tls.TLSSocket | null } = { socket: null };
    let socket: net.Socket | tls.TLSSocket;
    try {
      socket = await withTimeout(
        new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
          const onError = (error: Error) => reject(error);
          if (config.protocol === 'tls') {
            const tlsSocket = tls.connect({
              host: config.host,
              port: config.port,
              servername: config.serverName || config.host,
              minVersion: 'TLSv1.2',
              rejectUnauthorized: true,
              ...(config.caPem ? { ca: config.caPem } : {}),
              ...(config.clientCertPem ? { cert: config.clientCertPem } : {}),
              ...(config.clientKey ? { key: decrypt(config.clientKey) } : {}),
            });
            pending.socket = tlsSocket;
            tlsSocket.once('secureConnect', () => resolve(tlsSocket));
            tlsSocket.once('error', onError);
            return;
          }

          const tcpSocket = net.createConnection({ host: config.host, port: config.port });
          pending.socket = tcpSocket;
          tcpSocket.once('connect', () => resolve(tcpSocket));
          tcpSocket.once('error', onError);
        }),
      );
    } catch (error) {
      pending.socket?.destroy();
      throw error;
    }
    socket.on('error', () => {
      if (this.socket === socket) this.close();
    });
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.revision = null;
      }
    });
    this.socket = socket;
    this.revision = config.revision;
    return socket;
  }

  send(message: string, config: siemRepo.SiemConfig): Promise<void> {
    const queued = this.sendQueue.then(() => this.sendNow(message, config));
    this.sendQueue = queued.catch(() => undefined);
    return queued;
  }

  private async sendNow(message: string, config: siemRepo.SiemConfig): Promise<void> {
    if (config.protocol === 'udp') {
      const socket = dgram.createSocket(config.host.includes(':') ? 'udp6' : 'udp4');
      try {
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            socket.send(Buffer.from(message, 'utf8'), config.port, config.host, (error) => {
              if (error) reject(error);
              else resolve();
            });
            socket.once('error', reject);
          }),
        );
      } finally {
        socket.close();
      }
      return;
    }

    const socket = await this.getStream(config);
    const framed =
      config.tcpFraming === 'octet-counting'
        ? `${Buffer.byteLength(message, 'utf8')} ${message}`
        : `${message}\n`;
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          socket.write(framed, 'utf8', (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
      );
    } catch (error) {
      this.close();
      throw error;
    }
  }
}

class SiemService {
  private config: siemRepo.SiemConfig | null = null;
  private readonly transport = new SiemTransport();
  private readonly claimToken = randomUUID();
  private readonly runtimeSink = (record: Record<string, unknown>) => this.captureRuntime(record);
  private staging: SiemCanonicalEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private workerTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private workerPromise: Promise<void> | null = null;
  private stopping = false;

  async initialize(): Promise<void> {
    this.config = await siemRepo.getConfig();
    this.syncRuntimeSink();
    this.pollTimer = setInterval(() => void this.refreshConfig(), 5000);
    this.workerTimer = setInterval(() => void this.runWorker(), 1000);
    this.cleanupTimer = setInterval(() => void this.runCleanup(), 60_000);
    this.pollTimer.unref();
    this.workerTimer.unref();
    this.cleanupTimer.unref();
    await this.runCleanup();
  }

  private syncRuntimeSink(): void {
    const active = !this.stopping && this.config?.enabled && this.config.includeRuntime;
    registerSiemLogSink(active ? this.runtimeSink : null);
  }

  private async refreshConfig(): Promise<void> {
    try {
      const previous = this.config;
      const next = await siemRepo.getConfig();
      this.config = next;
      this.syncRuntimeSink();
      if (
        previous &&
        (previous.revision !== next.revision || (previous.enabled && !next.enabled))
      ) {
        this.transport.close();
      }
    } catch (error) {
      logger.error({ err: serializeError(error) }, 'Failed to refresh SIEM configuration');
    }
  }

  private captureRuntime(record: Record<string, unknown>): void {
    const config = this.config;
    if (!config?.enabled || !config.includeRuntime || this.stopping) return;
    const event = normalizeRuntimeRecord(record);
    if (!event || LEVEL_PRIORITY[event.level] < LEVEL_PRIORITY[config.runtimeLevel]) return;
    this.staging.push(event);
    if (this.staging.length >= 100) void this.flushStaging();
    else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flushStaging(), 250);
      this.flushTimer.unref();
    }
  }

  private flushStaging(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      while (this.staging.length > 0) {
        const events = this.staging.splice(0, 100);
        try {
          await siemRepo.enqueue(events);
        } catch (error) {
          logger.error(
            { err: serializeError(error), droppedEvents: events.length },
            'Failed to persist staged SIEM runtime events',
          );
        }
      }
    })().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  async captureAudit(input: AuditCapture): Promise<void> {
    if (!this.config?.enabled || !this.config.includeAudit || this.stopping) return;
    const detailAttributes = input.details
      ? Object.fromEntries(
          Object.entries(input.details).flatMap(([key, value]) => {
            if (value === undefined || value === null) return [];
            return [[key, typeof value === 'string' ? value : JSON.stringify(value)]];
          }),
        )
      : {};
    await siemRepo.enqueue([
      {
        eventId: input.action,
        occurredAt: new Date().toISOString(),
        level: 'info',
        category: 'audit',
        resource: input.entityType || 'application',
        message: input.action,
        attributes: {
          action: input.action,
          actorId: input.actorId,
          ...(input.actorName ? { actor: input.actorName } : {}),
          ip: input.ipAddress,
          ...(input.entityType ? { entity: input.entityType } : {}),
          ...(input.entityId ? { entityId: input.entityId } : {}),
          ...detailAttributes,
        },
      },
    ]);
  }

  async getConfig(): Promise<siemRepo.SiemConfig> {
    this.config = await siemRepo.getConfig();
    this.syncRuntimeSink();
    return this.config;
  }

  async saveConfig(input: SiemConfigInput): Promise<siemRepo.SiemConfig> {
    const { config, criticalChanged } = await persistSiemConfigUpdate(input);
    this.config = config;
    this.syncRuntimeSink();
    if (criticalChanged) this.transport.close();
    return config;
  }

  async test(): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig();
    if (!config.host) return { success: false, error: 'SIEM_HOST_REQUIRED' };
    const event: SiemCanonicalEvent = {
      eventId: 'siem.test',
      occurredAt: new Date().toISOString(),
      level: 'info',
      category: 'audit',
      resource: 'siem',
      message: 'Praetor SIEM connection test',
      attributes: { test: true, revision: config.revision },
    };
    try {
      const message = formatLeefEvent(event, {
        sourceIdentifier: config.sourceIdentifier,
        facility: config.facility,
        maxBytes: config.protocol === 'udp' ? UDP_MAX_BYTES : STREAM_MAX_BYTES,
      });
      await this.transport.send(message, config);
      this.config = await siemRepo.updateConfig({
        testedRevision: config.revision,
        lastTestAt: new Date(),
        lastTestSuccess: true,
        lastError: null,
      });
      return { success: true };
    } catch (error) {
      const message = errorMessage(error);
      this.config = await siemRepo.updateConfig({
        testedRevision: config.revision,
        lastTestAt: new Date(),
        lastTestSuccess: false,
        lastErrorAt: new Date(),
        lastError: message,
      });
      logger.warn({ err: serializeError(error) }, 'SIEM connection test failed');
      return { success: false, error: message };
    }
  }

  async enable(): Promise<siemRepo.SiemConfig> {
    const config = await this.getConfig();
    if (config.testedRevision !== config.revision || config.lastTestSuccess !== true) {
      throw createSiemError('SIEM_TEST_REQUIRED');
    }
    const enabled = await siemRepo.enableTestedRevision(config.revision);
    if (!enabled) {
      throw createSiemError('SIEM_TEST_REQUIRED');
    }
    this.config = enabled;
    this.syncRuntimeSink();
    return this.config;
  }

  async disable(): Promise<siemRepo.SiemConfig> {
    this.config = await siemRepo.updateConfig({ enabled: false });
    this.syncRuntimeSink();
    this.transport.close();
    return this.config;
  }

  private async runWorker(): Promise<void> {
    if (this.workerPromise || this.stopping || !this.config?.enabled) return;
    this.workerPromise = this.processBatch().finally(() => {
      this.workerPromise = null;
    });
    await this.workerPromise;
  }

  private async processBatch(): Promise<void> {
    const config = this.config;
    if (!config?.enabled) return;
    try {
      const items = await siemRepo.claimBatch(this.claimToken, 100);
      let lastClaimRenewal = Date.now();
      let delivered = false;
      let failure: string | null = null;
      for (const item of items) {
        if (this.stopping || !this.config?.enabled || this.config.revision !== config.revision)
          break;
        if (Date.now() - lastClaimRenewal >= CLAIM_RENEW_INTERVAL_MS) {
          await siemRepo.renewClaims(this.claimToken);
          lastClaimRenewal = Date.now();
        }
        try {
          const message = formatLeefEvent(item.payload, {
            sourceIdentifier: config.sourceIdentifier,
            facility: config.facility,
            maxBytes: config.protocol === 'udp' ? UDP_MAX_BYTES : STREAM_MAX_BYTES,
          });
          await this.transport.send(message, config);
          await siemRepo.complete(item.id, this.claimToken);
          delivered = true;
        } catch (error) {
          const attempts = item.attempts + 1;
          const delay = calculateRetryDelay(attempts);
          const message = errorMessage(error);
          await siemRepo.retry(item.id, this.claimToken, new Date(Date.now() + delay), message);
          failure = message;
          this.transport.close();
          break;
        }
      }
      if (delivered) await siemRepo.recordDelivery();
      if (failure) await siemRepo.recordError(failure);
    } catch (error) {
      logger.error({ err: serializeError(error) }, 'SIEM outbox worker failed');
    } finally {
      await siemRepo.releaseClaims(this.claimToken).catch(() => undefined);
    }
  }

  private async runCleanup(): Promise<void> {
    const config = this.config;
    if (!config || this.stopping) return;
    try {
      const dropped = await siemRepo.cleanup(config.retentionDays, config.maxEvents);
      if (dropped.retention || dropped.capacity) {
        logger.warn({ dropped }, 'SIEM outbox events dropped by retention or capacity policy');
      }
    } catch (error) {
      logger.error({ err: serializeError(error) }, 'SIEM outbox cleanup failed');
    }
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    registerSiemLogSink(null);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.workerTimer) clearInterval(this.workerTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.transport.close();
    const releaseClaimsPromise = siemRepo.releaseClaims(this.claimToken).catch((error) => {
      logger.warn({ err: serializeError(error) }, 'Failed to release SIEM claims during shutdown');
    });
    await withTimeout(
      Promise.all([
        this.flushStaging(),
        this.workerPromise ?? Promise.resolve(),
        releaseClaimsPromise,
      ]).then(() => undefined),
      5000,
    ).catch((error) => {
      logger.warn({ err: serializeError(error) }, 'SIEM shutdown flush timed out');
    });
  }
}

const siemService = new SiemService();
export default siemService;
