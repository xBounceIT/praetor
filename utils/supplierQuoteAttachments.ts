// Shared constants + pure helpers for supplier-quote attachments. Both the persisted
// attachments section (SupplierQuoteAttachmentsSection, which uploads immediately) and the
// create-flow staging component (SupplierQuoteAttachmentsStaging, which buffers files until the
// quote is saved) import these, so the allowed types, size cap, and display formatting stay in
// lockstep with each other and with the server-side guard in server/routes/supplier-quotes.ts.

export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['xlsx', 'pdf', 'docx']);
export const ATTACHMENT_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ATTACHMENT_ACCEPT_ATTR = '.xlsx,.pdf,.docx';

/** Stable validation-outcome codes; callers map them to localized messages where `t` lives. */
export type AttachmentValidationError = 'tooLarge' | 'invalidType';

export const getAttachmentExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
};

export const formatAttachmentFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
};

/** Size is checked before type so an oversized file reports `tooLarge` regardless of extension. */
export const validateAttachmentFile = (file: File): AttachmentValidationError | null => {
  if (file.size > ATTACHMENT_MAX_FILE_SIZE) return 'tooLarge';
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(getAttachmentExtension(file.name))) return 'invalidType';
  return null;
};

/**
 * Upload a batch of staged files to a freshly-created quote. Runs them through `allSettled` so a
 * single bad file doesn't abort the rest, and returns the files that failed (input order preserved)
 * so the caller can tell the user which ones to retry. Never throws. The uploader is injected so the
 * orchestration stays pure and unit-testable without the network layer.
 */
export const uploadStagedAttachments = async (
  quoteId: string,
  files: File[],
  upload: (quoteId: string, file: File) => Promise<unknown>,
): Promise<{ failed: File[] }> => {
  const results = await Promise.allSettled(files.map((file) => upload(quoteId, file)));
  const failed = files.filter((_, index) => results[index].status === 'rejected');
  return { failed };
};
