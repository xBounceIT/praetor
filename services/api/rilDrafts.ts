import { fetchApi } from './client';
import type { RilDraft, RilDraftRow } from './contracts';

const draftPath = (monthKey: string, userId?: string): string => {
  const base = `/ril-drafts/${encodeURIComponent(monthKey)}`;
  return userId ? `${base}?userId=${encodeURIComponent(userId)}` : base;
};

export const rilDraftsApi = {
  // Fetch the saved draft for a month. The server returns an empty shape (rows: {}) when none
  // exists, so callers never have to special-case a 404. `userId` targets another user's RIL
  // (managers viewing reports); omit it for the current user.
  get: (monthKey: string, userId?: string): Promise<RilDraft> =>
    fetchApi(draftPath(monthKey, userId)),

  save: (monthKey: string, rows: Record<string, RilDraftRow>, userId?: string): Promise<RilDraft> =>
    fetchApi(draftPath(monthKey, userId), {
      method: 'PUT',
      body: JSON.stringify({ rows }),
    }),

  remove: (monthKey: string, userId?: string): Promise<void> =>
    fetchApi(draftPath(monthKey, userId), { method: 'DELETE' }),
};
