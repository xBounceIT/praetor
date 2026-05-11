import type React from 'react';
import api from '../../services/api';
import type { UpdateTimeEntryInput } from '../../services/api/entries';
import type { TimeEntry, User } from '../../types';

export type EntryHandlersDeps = {
  getCurrentUser: () => User | null;
  getViewingUserId: () => string;
  setEntries: React.Dispatch<React.SetStateAction<TimeEntry[]>>;
};

export const makeEntryHandlers = (deps: EntryHandlersDeps) => {
  const { getCurrentUser, getViewingUserId, setEntries } = deps;

  const add = async (newEntry: Omit<TimeEntry, 'id' | 'createdAt' | 'userId' | 'hourlyCost'>) => {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    try {
      const targetUserId = getViewingUserId() || currentUser.id;
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
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    try {
      const targetUserId = getViewingUserId() || currentUser.id;
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

  const update = async (id: string, updates: UpdateTimeEntryInput) => {
    try {
      const updated = await api.entries.update(id, updates);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      console.error('Failed to update entry:', err);
    }
  };

  return { add, addBulk, delete: remove, update };
};
