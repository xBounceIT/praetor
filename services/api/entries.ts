import type { TimeEntry } from '../../types';
import { fetchApi } from './client';
import { normalizeTimeEntry } from './normalizers';

export type EntriesPage = {
  entries: TimeEntry[];
  nextCursor: string | null;
};

export type EntriesCursorPosition = { createdAt: number; id: string };

// Lexicographic compare matching the server's `(created_at, id) DESC` cursor
// ordering. Negative when `a` is older, positive when `a` is newer.
export const compareEntriesPosition = (
  a: EntriesCursorPosition,
  b: EntriesCursorPosition,
): number => {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

// Mirror of server/repositories/entriesRepo.ts:encodeCursor. The server emits
// base64url(JSON({createdAt: µs-text, id})); we only need ms-precision here for
// "is this entry inside the page's coverage window" comparisons (the id
// tiebreaker handles same-ms collisions).
export const decodeEntriesCursor = (raw: string | null): EntriesCursorPosition | null => {
  if (!raw) return null;
  try {
    const padded = raw.length % 4 === 0 ? raw : raw + '='.repeat(4 - (raw.length % 4));
    const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { createdAt?: unknown }).createdAt === 'string' &&
      typeof (parsed as { id?: unknown }).id === 'string'
    ) {
      const c = parsed as { createdAt: string; id: string };
      const ms = new Date(c.createdAt).getTime();
      if (Number.isFinite(ms)) return { createdAt: ms, id: c.id };
    }
  } catch {
    // fallthrough - corrupt/foreign cursor is treated as "no info"
  }
  return null;
};

export type GenerateRecurringResponse = {
  generated: TimeEntry[];
  generatedCount: number;
  skippedExistingCount: number;
  range: { fromDate: string; toDate: string };
};

type CreateTimeEntryInput = Omit<TimeEntry, 'id' | 'createdAt' | 'version' | 'hourlyCost' | 'cost'>;
type UpdateTimeEntryInput = Partial<Omit<TimeEntry, 'version'>> & Pick<TimeEntry, 'version'>;

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

  create: (entry: CreateTimeEntryInput): Promise<TimeEntry> =>
    fetchApi<TimeEntry>('/entries', {
      method: 'POST',
      body: JSON.stringify(entry),
    }).then(normalizeTimeEntry),

  update: (id: string, updates: UpdateTimeEntryInput): Promise<TimeEntry> =>
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

  /**
   * Materialize recurring task templates into placeholder time entries server-side.
   * Idempotent: re-running with the same window does not create duplicates.
   */
  generateRecurring: async (input: {
    fromDate: string;
    toDate: string;
    userId?: string;
  }): Promise<GenerateRecurringResponse> => {
    const result = await fetchApi<GenerateRecurringResponse>('/entries/recurring/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { ...result, generated: result.generated.map(normalizeTimeEntry) };
  },
};
