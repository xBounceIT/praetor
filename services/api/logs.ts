import type { AuditLogEntry } from '../../types';
import { fetchApi } from './client';

export const logsApi = {
  listAudit: (): Promise<AuditLogEntry[]> => fetchApi('/logs/audit'),
};
