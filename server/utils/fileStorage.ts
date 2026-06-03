import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_ALLOWED_MIME = new Set<string>([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const ATTACHMENT_ALLOWED_EXT = new Set<string>(['xlsx', 'pdf', 'docx']);

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
  // legitimate xlsx/docx uploads, so accept that as a generic fallback when the extension
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

// ---------------------------------------------------------------------------
// App branding logo — the single app-wide logo shown in the sidebar and on the
// login screen. Stored on disk like attachments; only metadata (stored name,
// mime, size) is persisted in the `app_branding` row. The stored name is always a
// UUID we generate, and it is served publicly via GET /api/branding/logo.
// ---------------------------------------------------------------------------

export const BRANDING_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const BRANDING_EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export const BRANDING_ALLOWED_EXT = new Set<string>(Object.keys(BRANDING_EXT_TO_MIME));
export const BRANDING_ALLOWED_MIME = new Set<string>(Object.values(BRANDING_EXT_TO_MIME));

const BRANDING_DIR = 'branding';

export const brandingMimeForExt = (ext: string): string =>
  BRANDING_EXT_TO_MIME[ext.toLowerCase()] ?? '';

export const isAllowedBrandingImage = (mimeType: string, fileName: string): boolean => {
  // Extension is the firm gate (same rationale as isAllowedAttachment): a file whose
  // extension is outside the allowlist is rejected regardless of the client-claimed MIME.
  const ext = getExtensionFromName(fileName);
  if (!BRANDING_ALLOWED_EXT.has(ext)) return false;
  // Browsers occasionally send an empty or generic type for legitimate images; accept it
  // when the extension itself is on the allowlist. Otherwise the MIME must match.
  if (mimeType === '' || mimeType === 'application/octet-stream') return true;
  return BRANDING_ALLOWED_MIME.has(mimeType);
};

const getBrandingDir = (): string => path.join(getUploadRoot(), BRANDING_DIR);

export interface SavedBrandingLogo {
  storedName: string;
  size: number;
  mimeType: string;
}

export const saveBrandingLogo = async (
  buffer: Buffer,
  originalName: string,
): Promise<SavedBrandingLogo> => {
  const ext = getExtensionFromName(originalName);
  if (!BRANDING_ALLOWED_EXT.has(ext)) {
    throw new Error('Unsupported branding logo extension');
  }
  const storedName = `${randomUUID()}.${ext}`;
  const dir = getBrandingDir();
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, storedName);
  await writeFile(fullPath, buffer, { flag: 'wx' });
  return { storedName, size: buffer.byteLength, mimeType: brandingMimeForExt(ext) };
};

export const openBrandingLogo = async (storedName: string): Promise<OpenedAttachment> => {
  ensureSafeBasename(storedName);
  const fullPath = path.join(getBrandingDir(), storedName);
  const info = await stat(fullPath);
  if (!info.isFile()) throw new Error('Branding logo is not a regular file');
  return { stream: createReadStream(fullPath), size: info.size };
};

export const deleteBrandingLogo = async (storedName: string): Promise<void> => {
  ensureSafeBasename(storedName);
  const fullPath = path.join(getBrandingDir(), storedName);
  try {
    await unlink(fullPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
};
