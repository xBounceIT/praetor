export const getErrorMessage = (error: unknown): string => {
  // Whitespace-only messages render as a blank string in the UI; treat them as
  // missing so the user always sees something actionable.
  if (error instanceof Error && error.message?.trim()) return error.message;
  return 'Unknown error';
};
