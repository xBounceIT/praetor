import type { TimeEntry } from '../../types';
import { fetchApi } from './client';
import { normalizeTimeEntry } from './normalizers';

type EntriesPage = {
  entries: TimeEntry[];
  nextCursor: string | null;
};

export const entriesApi = {
  list: async (userId?: string): Promise<TimeEntry[]> => {
    const all: TimeEntry[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      params.set('limit', '500');
      if (cursor) params.set('cursor', cursor);
      const page = await fetchApi<EntriesPage>(`/entries?${params.toString()}`);
      for (const entry of page.entries) all.push(normalizeTimeEntry(entry));
      cursor = page.nextCursor;
    } while (cursor);
    return all;
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
