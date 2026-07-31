import { decodeEntriesCursor } from '../services/api/entries';
import type { TimeEntry } from '../types';

export type TrackerEntryPageMergeOptions = Readonly<{
  userId: string;
  baselineEntryIds: ReadonlySet<string>;
  inputCursor: string | null;
  nextCursor: string | null;
}>;

/**
 * Merges one server page for the selected tracker user into local entry state.
 *
 * Only rows present when the request started may be removed as stale. This keeps
 * writes that commit during the request, and entries cached for other users, out
 * of the selected user's authoritative pagination window.
 */
export const mergeTrackerEntryPage = (
  previousEntries: TimeEntry[],
  pageEntries: TimeEntry[],
  options: TrackerEntryPageMergeOptions,
): TimeEntry[] => {
  const { userId, baselineEntryIds, inputCursor, nextCursor } = options;
  const incoming = new Map(pageEntries.map((entry) => [entry.id, entry]));
  const upperBound = decodeEntriesCursor(inputCursor);
  const oldestInPage = pageEntries[pageEntries.length - 1] ?? null;
  const hasMorePages = nextCursor !== null;

  const isMissingFromAuthoritativeWindow = (entry: TimeEntry): boolean => {
    if (entry.userId !== userId || !baselineEntryIds.has(entry.id)) return false;

    // A complete first page covers the selected user's entire dataset, including
    // the empty-result case. Rows created after the request began are not baseline
    // rows and were already excluded above.
    if (inputCursor === null && !hasMorePages) return true;

    if (!oldestInPage) {
      return !hasMorePages && upperBound !== null && entry.createdAt < upperBound.createdAt;
    }
    if (upperBound) {
      if (entry.createdAt >= upperBound.createdAt) return false;
    }

    // With another page pending, the oldest row is the conservative lower bound.
    // Keep equal-ms rows because the server cursor has microsecond precision that
    // is unavailable on the normalized client entry.
    if (hasMorePages && entry.createdAt <= oldestInPage.createdAt) return false;
    return true;
  };

  const seen = new Set<string>();
  const merged: TimeEntry[] = [];
  let changed = false;

  for (const entry of previousEntries) {
    const replacement = incoming.get(entry.id);
    if (replacement) {
      merged.push(replacement);
      seen.add(entry.id);
      if (replacement !== entry) changed = true;
    } else if (!isMissingFromAuthoritativeWindow(entry)) {
      merged.push(entry);
    } else {
      changed = true;
    }
  }

  for (const entry of pageEntries) {
    if (!seen.has(entry.id)) {
      merged.push(entry);
      changed = true;
    }
  }

  return changed ? merged : previousEntries;
};
