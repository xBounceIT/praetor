import type { AuditLogEntry } from '../../types';
import { fetchApi } from './client';

export interface AuditLogParams {
  startDate?: Date;
  endDate?: Date;
}

export type SiemProtocol = 'udp' | 'tcp' | 'tls';
export type SiemTcpFraming = 'newline' | 'octet-counting';
export type SiemLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface SiemConfig {
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
  lastTestAt: string | null;
  lastTestSuccess: boolean | null;
  lastDeliveryAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  droppedRetention: number;
  droppedCapacity: number;
  updatedAt: string;
}

export type SiemConfigUpdate = Pick<
  SiemConfig,
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
  | 'clientKey'
  | 'retentionDays'
  | 'maxEvents'
>;

export interface SiemStatus {
  enabled: boolean;
  revision: number;
  testedRevision: number | null;
  lastTestAt: string | null;
  lastTestSuccess: boolean | null;
  lastDeliveryAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  droppedRetention: number;
  droppedCapacity: number;
  pendingCount: number;
  oldestPendingAt: string | null;
}

export const logsApi = {
  listAudit: (params?: AuditLogParams): Promise<AuditLogEntry[]> => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) {
      searchParams.set('startDate', params.startDate.toISOString());
    }
    if (params?.endDate) {
      searchParams.set('endDate', params.endDate.toISOString());
    }
    const queryString = searchParams.toString();
    return fetchApi(`/logs/audit${queryString ? `?${queryString}` : ''}`);
  },
  getSiemConfig: (): Promise<SiemConfig> => fetchApi('/logs/siem/config'),
  updateSiemConfig: (config: SiemConfigUpdate): Promise<SiemConfig> =>
    fetchApi('/logs/siem/config', { method: 'PUT', body: JSON.stringify(config) }),
  getSiemStatus: (): Promise<SiemStatus> => fetchApi('/logs/siem/status'),
  testSiem: (): Promise<{ success: boolean; error?: string }> =>
    fetchApi('/logs/siem/test', { method: 'POST' }),
  enableSiem: (): Promise<SiemConfig> => fetchApi('/logs/siem/enable', { method: 'POST' }),
  disableSiem: (): Promise<SiemConfig> => fetchApi('/logs/siem/disable', { method: 'POST' }),
};
