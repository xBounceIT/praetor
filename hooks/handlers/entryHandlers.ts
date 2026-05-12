import type React from 'react';
import api from '../../services/api';
import type { TimeEntry, User } from '../../types';

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

  const add = async (newEntry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId' | 'hourlyCost'>) => {
    if (!currentUser) return;
    try {
      const targetUserId = viewingUserId || currentUser.id;
      const entry = await api.entries.create({
        ...newEntry,
        userId: targetUserId,
        hourlyCost: currentUser?.costPerHour || 0,
      } as TimeEntry);
      setEntries((prev) => [entry, ...prev]);
    } catch (err) {
      console.error('Failed to add entry:', err);
      alert('Failed to add time entry');
    }
  };

  const addBulk = async (newEntries: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[]) => {
    if (!currentUser) return;
    try {
      const targetUserId = viewingUserId || currentUser.id;
      const createdEntries = await Promise.all(
        newEntries.map((entry) =>
          api.entries.create({
            ...entry,
            userId: targetUserId,
            hourlyCost: currentUser?.costPerHour || 0,
          } as TimeEntry),
        ),
      );
      setEntries((prev) => [...createdEntries, ...prev].sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error('Failed to add bulk entries:', err);
      alert('Failed to add some time entries');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.entries.delete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Failed to delete entry:', err);
    }
  };

  const update = async (id: string, updates: Partial<TimeEntry>) => {
    try {
      const updated = await api.entries.update(id, updates);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      console.error('Failed to update entry:', err);
    }
  };

  return { add, addBulk, delete: remove, update };
};
