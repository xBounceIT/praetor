import type React from 'react';
import api from '../../services/api';
import type { TimeEntry, TimeEntryDraft, User } from '../../types';
import { toastError } from '../../utils/toast';

type TimeEntryUpdate = Partial<Omit<TimeEntry, 'version'>> & Pick<TimeEntry, 'version'>;

export type AddBulkResult = {
  created: TimeEntry[];
  failed: Array<{ error: unknown; entry: TimeEntryDraft }>;
};

const upsertEntriesById = (prev: TimeEntry[], next: TimeEntry[]): TimeEntry[] => {
  const byId = new Map(prev.map((entry) => [entry.id, entry]));
  for (const entry of next) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
};

export type EntryHandlersDeps = {
  currentUser: User | null;
  viewingUserId: string;
  setEntries: React.Dispatch<React.SetStateAction<TimeEntry[]>>;
};

// Invariant: callers MUST recreate these handlers whenever `currentUser` or
// `viewingUserId` change (see the `useMemo` deps in App.tsx). Each handler
// reads `currentUser` / `viewingUserId` synchronously BEFORE the first await
// (and `setEntries` after the await — that's safe because the setter
// reference is stable). There are no deferred callbacks (setTimeout /
// setInterval / detached promise chains), so as long as the factory is
// rebuilt when the user identity changes, the values are always fresh.
export const makeEntryHandlers = (deps: EntryHandlersDeps) => {
  const { currentUser, viewingUserId, setEntries } = deps;

  const add = async (newEntry: TimeEntryDraft) => {
    if (!currentUser) return;
    try {
      const targetUserId = viewingUserId || currentUser.id;
      const entry = await api.entries.create({
        ...newEntry,
        userId: targetUserId,
      });
      setEntries((prev) => upsertEntriesById(prev, [entry]));
    } catch (err) {
      console.error('Failed to add entry:', err);
      toastError('Failed to add time entry');
    }
  };

  const addBulk = async (
    newEntries: TimeEntryDraft[],
    options?: { silent?: boolean },
  ): Promise<AddBulkResult> => {
    if (!currentUser) return { created: [], failed: [] };
    const targetUserId = viewingUserId || currentUser.id;
    const created: TimeEntry[] = [];
    const failures: Array<{ error: unknown; entry: TimeEntryDraft }> = [];

    // Each POST locks the user row inside a SERIALIZABLE transaction; parallel
    // creates for the same user trigger Postgres 40001 serialization failures.
    for (const entry of newEntries) {
      try {
        const createdEntry = await api.entries.create({
          ...entry,
          userId: targetUserId,
        });
        created.push(createdEntry);
      } catch (err) {
        failures.push({ error: err, entry });
        console.error('Failed to add bulk entry:', err);
      }
    }

    if (created.length > 0) {
      setEntries((prev) => upsertEntriesById(prev, created));
    }

    if (failures.length > 0 && !options?.silent) {
      toastError('Failed to add some time entries');
    }

    return { created, failed: failures };
  };

  const remove = async (id: string) => {
    try {
      await api.entries.delete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to delete entry:', err);
    }
  };

  const update = async (id: string, updates: TimeEntryUpdate) => {
    try {
      const updated = await api.entries.update(id, updates);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      console.error('Failed to update entry:', err);
      throw err;
    }
  };

  return { add, addBulk, delete: remove, update };
};
