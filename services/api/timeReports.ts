import type { TimeReportDefinition, TimeReportOptions, TimeReportResult } from '../../types';
import { fetchApi, fetchApiStream } from './client';

export const timeReportsApi = {
  options: (signal?: AbortSignal): Promise<TimeReportOptions> =>
    fetchApi<TimeReportOptions>('/reports/time-report/options', { signal }),

  generate: (definition: TimeReportDefinition, signal?: AbortSignal): Promise<TimeReportResult> =>
    fetchApi<TimeReportResult>('/reports/time-report/generate', {
      method: 'POST',
      body: JSON.stringify(definition),
      signal,
    }),

  exportCsv: async (definition: TimeReportDefinition, language: 'it' | 'en'): Promise<Blob> => {
    const response = await fetchApiStream('/reports/time-report/export.csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition, language }),
    });
    return response.blob();
  },
};
