export const getHistoryPreviewIds = (
  preview: unknown,
): { revisionId: string | null; versionId: string | null } => {
  if (!preview || typeof preview !== 'object') return { revisionId: null, versionId: null };
  const candidate = preview as { id?: unknown; revisionCode?: unknown };
  if (typeof candidate.id !== 'string') return { revisionId: null, versionId: null };
  return typeof candidate.revisionCode === 'string'
    ? { revisionId: candidate.id, versionId: null }
    : { revisionId: null, versionId: candidate.id };
};
