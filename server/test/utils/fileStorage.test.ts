import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  brandingMimeForExt,
  deleteBrandingLogo,
  isAllowedBrandingImage,
  openBrandingLogo,
  saveBrandingLogo,
} from '../../utils/fileStorage.ts';

const readStream = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

describe('isAllowedBrandingImage', () => {
  test('accepts allowed extensions paired with their mime type', () => {
    expect(isAllowedBrandingImage('image/png', 'logo.png')).toBe(true);
    expect(isAllowedBrandingImage('image/jpeg', 'logo.jpg')).toBe(true);
    expect(isAllowedBrandingImage('image/jpeg', 'logo.jpeg')).toBe(true);
    expect(isAllowedBrandingImage('image/webp', 'logo.webp')).toBe(true);
    expect(isAllowedBrandingImage('image/svg+xml', 'logo.svg')).toBe(true);
  });

  test('accepts an allowed extension with a generic/empty mime (browser quirk)', () => {
    expect(isAllowedBrandingImage('application/octet-stream', 'logo.png')).toBe(true);
    expect(isAllowedBrandingImage('', 'logo.svg')).toBe(true);
  });

  test('rejects a disallowed extension regardless of the claimed mime', () => {
    // The classic spoof: an executable claiming to be a PNG.
    expect(isAllowedBrandingImage('image/png', 'payload.exe')).toBe(false);
    expect(isAllowedBrandingImage('image/gif', 'logo.gif')).toBe(false);
    expect(isAllowedBrandingImage('image/png', 'logo')).toBe(false);
  });

  test('rejects an allowed extension carrying a non-image, non-generic mime', () => {
    expect(isAllowedBrandingImage('text/html', 'logo.png')).toBe(false);
  });
});

describe('brandingMimeForExt', () => {
  test('maps known extensions, empty string otherwise', () => {
    expect(brandingMimeForExt('png')).toBe('image/png');
    expect(brandingMimeForExt('JPG')).toBe('image/jpeg');
    expect(brandingMimeForExt('svg')).toBe('image/svg+xml');
    expect(brandingMimeForExt('exe')).toBe('');
  });
});

describe('branding logo disk round-trip', () => {
  let tmpRoot: string;
  let priorUploadPath: string | undefined;

  beforeAll(async () => {
    priorUploadPath = process.env.UPLOAD_PATH;
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'praetor-branding-'));
    process.env.UPLOAD_PATH = tmpRoot;
  });

  afterAll(async () => {
    if (priorUploadPath === undefined) delete process.env.UPLOAD_PATH;
    else process.env.UPLOAD_PATH = priorUploadPath;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test('saves, reads back identical bytes, then deletes', async () => {
    const bytes = Buffer.from('a-tiny-fake-png');
    const saved = await saveBrandingLogo(bytes, 'company-logo.png');

    expect(saved.mimeType).toBe('image/png');
    expect(saved.size).toBe(bytes.byteLength);
    expect(saved.storedName.endsWith('.png')).toBe(true);
    // Stored name is a generated UUID, never the original filename.
    expect(saved.storedName).not.toContain('company-logo');

    const opened = await openBrandingLogo(saved.storedName);
    expect(opened.size).toBe(bytes.byteLength);
    expect(await readStream(opened.stream)).toEqual(bytes);

    await deleteBrandingLogo(saved.storedName);
    await expect(openBrandingLogo(saved.storedName)).rejects.toThrow();
  });

  test('deleting a missing file is a no-op (no throw)', async () => {
    await expect(deleteBrandingLogo('does-not-exist.png')).resolves.toBeUndefined();
  });

  test('saving a disallowed extension throws', async () => {
    await expect(saveBrandingLogo(Buffer.from('x'), 'logo.exe')).rejects.toThrow();
  });

  test('rejects path-traversal stored names', async () => {
    await expect(openBrandingLogo('../secret.png')).rejects.toThrow();
    await expect(openBrandingLogo('nested/logo.png')).rejects.toThrow();
    await expect(deleteBrandingLogo('../secret.png')).rejects.toThrow();
  });
});
