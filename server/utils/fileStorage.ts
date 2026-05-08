import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_ALLOWED_MIME = new Set<string>([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const ATTACHMENT_ALLOWED_EXT = new Set<string>(['xlsx', 'xls', 'csv', 'pdf', 'doc', 'docx']);

const SUPPLIER_QUOTE_ATTACHMENTS_DIR = 'supplier-quote-attachments';

export const getExtensionFromName = (name: string): string => {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
};

export const isAllowedAttachment = (mimeType: string, fileName: string): boolean => {
  // Extension is the firm gate: a file with an extension outside the allowlist is rejected
  // regardless of the client-supplied MIME type, otherwise an attacker could upload e.g.
  // `payload.exe` by claiming `application/pdf`.
  const ext = getExtensionFromName(fileName);
  if (!ATTACHMENT_ALLOWED_EXT.has(ext)) return false;
  // Some browsers (Safari, some Chrome configs) report `application/octet-stream` for
  // legitimate xlsx/doc uploads, so accept that as a generic fallback when the extension
  // itself is allowed. All other MIME types must be on the allowlist.
  if (mimeType === 'application/octet-stream') return true;
  return ATTACHMENT_ALLOWED_MIME.has(mimeType);
};

const getUploadRoot = (): string => {
  const configured = process.env.UPLOAD_PATH?.trim();
  return configured && configured.length > 0 ? path.resolve(configured) : path.resolve('./uploads');
};

const getSupplierQuoteAttachmentsDir = (): string =>
  path.join(getUploadRoot(), SUPPLIER_QUOTE_ATTACHMENTS_DIR);

const ensureSafeBasename = (storedName: string): void => {
  if (!storedName || storedName !== path.basename(storedName) || storedName.includes('..')) {
    throw new Error('Invalid stored attachment name');
  }
};

export interface SavedAttachment {
  storedName: string;
  size: number;
}

export const saveSupplierQuoteAttachment = async (
  buffer: Buffer,
  originalName: string,
): Promise<SavedAttachment> => {
  const ext = getExtensionFromName(originalName);
  const sanitizedExt = ext && /^[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : '';
  const storedName = sanitizedExt ? `${randomUUID()}.${sanitizedExt}` : randomUUID();
  const dir = getSupplierQuoteAttachmentsDir();
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, storedName);
  await writeFile(fullPath, buffer, { flag: 'wx' });
  return { storedName, size: buffer.byteLength };
};

export interface OpenedAttachment {
  stream: ReadStream;
  size: number;
}

export const openSupplierQuoteAttachment = async (
  storedName: string,
): Promise<OpenedAttachment> => {
  ensureSafeBasename(storedName);
  const fullPath = path.join(getSupplierQuoteAttachmentsDir(), storedName);
  const info = await stat(fullPath);
  if (!info.isFile()) throw new Error('Attachment is not a regular file');
  return { stream: createReadStream(fullPath), size: info.size };
};

export const deleteSupplierQuoteAttachment = async (storedName: string): Promise<void> => {
  ensureSafeBasename(storedName);
  const fullPath = path.join(getSupplierQuoteAttachmentsDir(), storedName);
  try {
    await unlink(fullPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
};
