export const REVISION_TITLE_MAX_LENGTH = 200;

type RevisionTitleResult = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * Revision titles are optional metadata: blank input is stored as null so
 * historical rows keep using the localized "sent snapshot" fallback.
 */
export const parseRevisionTitle = (
  value: unknown,
  fieldName = 'revisionTitle',
): RevisionTitleResult => {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, message: `${fieldName} must be a string` };
  }

  const title = value.trim();
  if (title.length > REVISION_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      message: `${fieldName} must be ${REVISION_TITLE_MAX_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, value: title || null };
};
