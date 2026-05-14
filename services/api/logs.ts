import type { AuditLogEntry } from '../../types';
import { fetchApi } from './client';

export interface AuditLogParams {
  startDate?: Date;
  endDate?: Date;
  username?: string;
  action?: string;
  entityType?: string;
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
    if (params?.username) {
      searchParams.set('username', params.username);
    }
    if (params?.action) {
      searchParams.set('action', params.action);
    }
    if (params?.entityType) {
      searchParams.set('entityType', params.entityType);
    }
    const queryString = searchParams.toString();
    return fetchApi(`/logs/audit${queryString ? `?${queryString}` : ''}`);
  },
};
