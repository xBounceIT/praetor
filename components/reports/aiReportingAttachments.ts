export const AI_REPORTING_MAX_MESSAGE_CHARS = 16_000;
export const AI_REPORTING_MAX_ATTACHMENTS = 5;
export const AI_REPORTING_MAX_ATTACHMENT_BYTES = 64 * 1024;
export const AI_REPORTING_MAX_ATTACHMENT_CONTENT_CHARS = 8_000;
export const AI_REPORTING_MAX_TOTAL_ATTACHMENT_CONTENT_CHARS = 12_000;

const ATTACHMENT_START = '\u001ePRAETOR_AI_ATTACHMENTS_V1';
const ATTACHMENT_END = '\u001eEND_PRAETOR_AI_ATTACHMENTS_V1';

const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
  'application/json',
  'application/sql',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
]);

const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set([
  'c',
  'cpp',
  'css',
  'csv',
  'go',
  'h',
  'hpp',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'log',
  'markdown',
  'md',
  'py',
  'rs',
  'sh',
  'sql',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

export const AI_REPORTING_ATTACHMENT_ACCEPT = [
  'text/*',
  'application/json',
  'application/sql',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  ...Array.from(SUPPORTED_ATTACHMENT_EXTENSIONS, (extension) => `.${extension}`),
].join(',');

export interface AiReportingMessageAttachment {
  name: string;
  type: string;
  size: number;
  content: string;
}

export interface AiReportingPendingAttachment extends AiReportingMessageAttachment {
  id: string;
  lastModified: number;
}

export type AiReportingAttachmentErrorCode =
  | 'fileContentTooLong'
  | 'fileTooLarge'
  | 'readFailed'
  | 'tooManyFiles'
  | 'totalContentTooLarge'
  | 'unsupportedType';

export interface AiReportingAttachmentError {
  code: AiReportingAttachmentErrorCode;
  fileName?: string;
}

export interface AiReportingAttachmentReadResult {
  attachments: AiReportingPendingAttachment[];
  error?: AiReportingAttachmentError;
}

const getFileExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

export const isSupportedAiReportingAttachment = (file: Pick<File, 'name' | 'type'>) =>
  file.type.startsWith('text/') ||
  SUPPORTED_ATTACHMENT_MIME_TYPES.has(file.type.toLowerCase()) ||
  SUPPORTED_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name));

const isSameFile = (
  attachment: Pick<AiReportingPendingAttachment, 'lastModified' | 'name' | 'size'>,
  file: Pick<File, 'lastModified' | 'name' | 'size'>,
) =>
  attachment.name === file.name &&
  attachment.size === file.size &&
  attachment.lastModified === file.lastModified;

export const readAiReportingAttachments = async (
  selectedFiles: readonly File[],
  existingAttachments: readonly AiReportingPendingAttachment[] = [],
): Promise<AiReportingAttachmentReadResult> => {
  const files = selectedFiles.filter(
    (file, index) =>
      !existingAttachments.some((attachment) => isSameFile(attachment, file)) &&
      selectedFiles.findIndex((candidate) => isSameFile(candidate, file)) === index,
  );

  if (existingAttachments.length + files.length > AI_REPORTING_MAX_ATTACHMENTS) {
    return { attachments: [], error: { code: 'tooManyFiles' } };
  }

  for (const file of files) {
    if (!isSupportedAiReportingAttachment(file)) {
      return { attachments: [], error: { code: 'unsupportedType', fileName: file.name } };
    }
    if (file.size > AI_REPORTING_MAX_ATTACHMENT_BYTES) {
      return { attachments: [], error: { code: 'fileTooLarge', fileName: file.name } };
    }
  }

  try {
    const attachments = await Promise.all(
      files.map(async (file, index): Promise<AiReportingPendingAttachment> => {
        const content = await file.text();
        return {
          id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
          name: file.name,
          type: file.type || 'text/plain',
          size: file.size,
          lastModified: file.lastModified,
          content,
        };
      }),
    );

    const oversizedAttachment = attachments.find(
      (attachment) => attachment.content.length > AI_REPORTING_MAX_ATTACHMENT_CONTENT_CHARS,
    );
    if (oversizedAttachment) {
      return {
        attachments: [],
        error: { code: 'fileContentTooLong', fileName: oversizedAttachment.name },
      };
    }

    const totalContentLength = [...existingAttachments, ...attachments].reduce(
      (total, attachment) => total + attachment.content.length,
      0,
    );
    if (totalContentLength > AI_REPORTING_MAX_TOTAL_ATTACHMENT_CONTENT_CHARS) {
      return { attachments: [], error: { code: 'totalContentTooLarge' } };
    }

    return { attachments };
  } catch {
    return { attachments: [], error: { code: 'readFailed' } };
  }
};

export const serializeAiReportingMessage = (
  text: string,
  attachments: readonly AiReportingMessageAttachment[],
) => {
  const normalizedText = text.trim();
  if (attachments.length === 0) return normalizedText;

  const payload = JSON.stringify({
    instructions: 'Use the attached text files as context for the user request.',
    files: attachments.map(({ name, type, size, content }) => ({ name, type, size, content })),
  });

  return [normalizedText, ATTACHMENT_START, payload, ATTACHMENT_END].filter(Boolean).join('\n\n');
};

export const parseAiReportingMessage = (
  content: string,
): { text: string; attachments: AiReportingMessageAttachment[] } => {
  const startIndex = content.lastIndexOf(ATTACHMENT_START);
  const endIndex = content.lastIndexOf(ATTACHMENT_END);
  if (startIndex < 0 || endIndex <= startIndex) {
    return { text: content, attachments: [] };
  }

  const trailingContent = content.slice(endIndex + ATTACHMENT_END.length).trim();
  if (trailingContent) return { text: content, attachments: [] };

  try {
    const payload = JSON.parse(
      content.slice(startIndex + ATTACHMENT_START.length, endIndex).trim(),
    ) as { files?: unknown };
    if (!Array.isArray(payload.files)) return { text: content, attachments: [] };

    const attachments = payload.files.flatMap((file): AiReportingMessageAttachment[] => {
      if (!file || typeof file !== 'object') return [];
      const record = file as Record<string, unknown>;
      if (
        typeof record.name !== 'string' ||
        typeof record.type !== 'string' ||
        typeof record.size !== 'number' ||
        typeof record.content !== 'string'
      ) {
        return [];
      }
      return [
        {
          name: record.name,
          type: record.type,
          size: record.size,
          content: record.content,
        },
      ];
    });

    if (attachments.length !== payload.files.length) {
      return { text: content, attachments: [] };
    }

    return { text: content.slice(0, startIndex).trim(), attachments };
  } catch {
    return { text: content, attachments: [] };
  }
};
