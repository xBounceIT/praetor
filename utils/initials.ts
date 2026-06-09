/**
 * Initials from a display name: the first letter of the first and last word, or the
 * first two letters of a single-word name; `?` for a blank name. Shared source of truth
 * for the avatar-style abbreviations used across the app (member avatars, shared-view
 * owner badges, etc.) so the rule stays consistent in one place.
 */
export const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const initials =
    parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return initials.toUpperCase();
};
