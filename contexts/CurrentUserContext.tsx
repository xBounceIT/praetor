import type React from 'react';
import { CurrentUserIdContext } from './currentUserIdContext';

// Carries the authenticated user's id so components deep in the tree (StandardTable, the project
// dashboard) can compute view ownership without prop-drilling a user object through every level.
// Defaults to `undefined` so reads outside a provider (e.g. in isolated tests) are null-safe.
export const CurrentUserIdProvider: React.FC<{
  userId: string | undefined;
  children: React.ReactNode;
}> = ({ userId, children }) => (
  <CurrentUserIdContext.Provider value={userId}>{children}</CurrentUserIdContext.Provider>
);
