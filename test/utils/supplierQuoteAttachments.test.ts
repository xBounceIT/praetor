import { describe, expect, test } from 'bun:test';
import {
  formatAttachmentFileSize,
  getAttachmentExtension,
  uploadStagedAttachments,
  validateAttachmentFile,
} from '../../utils/supplierQuoteAttachments';

// Forge a File whose `size` we control without allocating the bytes.
const fileOf = (name: string, size: number): File => {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('getAttachmentExtension', () => {
  test('returns the lowercased extension', () => {
    expect(getAttachmentExtension('Report.PDF')).toBe('pdf');
    expect(getAttachmentExtension('archive.tar.xlsx')).toBe('xlsx');
  });

  test('returns empty when there is no usable extension', () => {
    expect(getAttachmentExtension('noext')).toBe('');
    expect(getAttachmentExtension('trailingdot.')).toBe('');
  });
});

describe('formatAttachmentFileSize', () => {
  test('scales through byte units', () => {
    expect(formatAttachmentFileSize(512)).toBe('512 B');
    expect(formatAttachmentFileSize(2048)).toBe('2.0 KB');
    expect(formatAttachmentFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  test('guards non-finite and non-positive inputs', () => {
    expect(formatAttachmentFileSize(0)).toBe('0 B');
    expect(formatAttachmentFileSize(-1)).toBe('0 B');
    expect(formatAttachmentFileSize(Number.NaN)).toBe('0 B');
  });
});

describe('validateAttachmentFile', () => {
  test('accepts allowed types within the size cap', () => {
    expect(validateAttachmentFile(fileOf('q.xlsx', 1024))).toBeNull();
    expect(validateAttachmentFile(fileOf('q.pdf', 1024))).toBeNull();
    expect(validateAttachmentFile(fileOf('q.docx', 1024))).toBeNull();
  });

  test('rejects disallowed types', () => {
    expect(validateAttachmentFile(fileOf('q.exe', 1024))).toBe('invalidType');
    expect(validateAttachmentFile(fileOf('q', 1024))).toBe('invalidType');
  });

  test('rejects oversize files, with size taking precedence over type', () => {
    expect(validateAttachmentFile(fileOf('q.xlsx', 11 * 1024 * 1024))).toBe('tooLarge');
    expect(validateAttachmentFile(fileOf('q.exe', 11 * 1024 * 1024))).toBe('tooLarge');
  });
});

describe('uploadStagedAttachments', () => {
  const fileA = fileOf('a.xlsx', 10);
  const fileB = fileOf('b.pdf', 10);
  const fileC = fileOf('c.docx', 10);

  test('uploads every file to the given quote id and reports no failures', async () => {
    const calls: Array<[string, string]> = [];
    const { failed } = await uploadStagedAttachments('SQ-1', [fileA, fileB], (quoteId, file) => {
      calls.push([quoteId, file.name]);
      return Promise.resolve({ id: 'ok' });
    });

    expect(failed).toEqual([]);
    expect(calls).toEqual([
      ['SQ-1', 'a.xlsx'],
      ['SQ-1', 'b.pdf'],
    ]);
  });

  test('collects the files that failed in input order without aborting the rest', async () => {
    const { failed } = await uploadStagedAttachments('SQ-1', [fileA, fileB, fileC], (_id, file) =>
      file.name === 'b.pdf' ? Promise.reject(new Error('boom')) : Promise.resolve({ id: 'ok' }),
    );

    expect(failed.map((file) => file.name)).toEqual(['b.pdf']);
  });

  test('does nothing for an empty queue', async () => {
    let called = 0;
    const { failed } = await uploadStagedAttachments('SQ-1', [], () => {
      called += 1;
      return Promise.resolve({});
    });

    expect(failed).toEqual([]);
    expect(called).toBe(0);
  });
});
