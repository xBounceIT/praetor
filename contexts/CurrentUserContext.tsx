import type React from 'react';
import { createContext, useContext } from 'react';

// Carries the authenticated user's id so components deep in the tree (StandardTable, the project
// dashboard) can compute view ownership without prop-drilling a user object through every level.
// Defaults to `undefined` so reads outside a provider (e.g. in isolated tests) are null-safe.
const CurrentUserIdContext = createContext<string | undefined>(undefined);

export const CurrentUserIdProvider: React.FC<{
  userId: string | undefined;
  children: React.ReactNode;
}> = ({ userId, children }) => (
  <CurrentUserIdContext.Provider value={userId}>{children}</CurrentUserIdContext.Provider>
);

// Returns the current user's id, or `undefined` when no provider is mounted.
export const useCurrentUserId = (): string | undefined => useContext(CurrentUserIdContext);
