export const formatDocumentCode = (
  objectCode: string | null | undefined,
  revisionCode: string | null | undefined,
) => [objectCode, revisionCode].filter(Boolean).join(' ');
