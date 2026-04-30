import type { TimeEntry } from '../../types';
import { fetchApi } from './client';
import { normalizeTimeEntry } from './normalizers';

export type EntriesPage = {
  entries: TimeEntry[];
  nextCursor: string | null;
};

export const entriesApi = {
  listPage: async (
    options: { userId?: string; cursor?: string | null; limit?: number } = {},
  ): Promise<EntriesPage> => {
    const params = new URLSearchParams();
    if (options.userId) params.set('userId', options.userId);
    params.set('limit', String(options.limit ?? 500));
    if (options.cursor) params.set('cursor', options.cursor);
    const page = await fetchApi<EntriesPage>(`/entries?${params.toString()}`);
    return { entries: page.entries.map(normalizeTimeEntry), nextCursor: page.nextCursor };
  },

  create: (entry: Omit<TimeEntry, 'id' | 'createdAt'>): Promise<TimeEntry> =>
    fetchApi<TimeEntry>('/entries', {
      method: 'POST',
      body: JSON.stringify(entry),
    }).then(normalizeTimeEntry),

  update: (id: string, updates: Partial<TimeEntry>): Promise<TimeEntry> =>
    fetchApi<TimeEntry>(`/entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeTimeEntry),

  delete: (id: string): Promise<void> => fetchApi(`/entries/${id}`, { method: 'DELETE' }),

  bulkDelete: (
    projectId: string,
    task: string,
    options?: { futureOnly?: boolean; placeholderOnly?: boolean },
  ): Promise<void> => {
    const params = new URLSearchParams({ projectId, task });
    if (options?.futureOnly) params.append('futureOnly', 'true');
    if (options?.placeholderOnly) params.append('placeholderOnly', 'true');
    return fetchApi(`/entries?${params.toString()}`, { method: 'DELETE' });
  },
};
