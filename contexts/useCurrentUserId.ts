import { use } from 'react';
import { CurrentUserIdContext } from './currentUserIdContext';

// Returns the current user's id, or `undefined` when no provider is mounted.
export const useCurrentUserId = (): string | undefined => use(CurrentUserIdContext);
