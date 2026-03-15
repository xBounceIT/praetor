import type { AuditLogEntry } from '../../types';
import { fetchApi } from './client';

export interface AuditLogParams {
  startDate?: Date;
  endDate?: Date;
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
};
