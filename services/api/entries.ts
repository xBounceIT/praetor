import type { TimeEntry } from '../../types';
import { fetchApi } from './client';
import { normalizeTimeEntry } from './normalizers';

export type EntriesPage = {
  entries: TimeEntry[];
  nextCursor: string | null;
};

export type EntriesCursorPosition = { createdAt: number; id: string };

// Mirror of server/repositories/entriesRepo.ts:encodeCursor. The server emits
// base64url(JSON({createdAt: µs-text, id})); we only need ms-precision here
// for "is this entry inside the page's coverage window" comparisons (the id
// tiebreaker handles same-ms collisions).
//
// `created_at::text` from a Postgres TIMESTAMP (without time zone) has no
// zone marker (e.g. `2026-05-16 10:32:45.123456`). pg-node parses TIMESTAMP
// columns as UTC server-side, so each entry's `createdAt` in the payload is
// UTC ms-since-epoch. The cursor text MUST be parsed in the same domain —
// `new Date(cursorText)` alone would interpret a no-zone string as local
// time and shift the window boundary by the browser's UTC offset, dropping
// or keeping the wrong rows.
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
      const hasZone = /Z$|[+-]\d{2}(?::?\d{2})?$/.test(c.createdAt);
      const isoLike = c.createdAt.replace(' ', 'T') + (hasZone ? '' : 'Z');
      const ms = new Date(isoLike).getTime();
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
