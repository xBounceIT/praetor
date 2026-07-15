import { describe, expect, test } from 'bun:test';
import {
  AI_REPORTING_MAX_ATTACHMENT_CONTENT_CHARS,
  AI_REPORTING_MAX_ATTACHMENTS,
  isSupportedAiReportingAttachment,
  parseAiReportingMessage,
  readAiReportingAttachments,
  serializeAiReportingMessage,
} from '@/components/reports/aiReportingAttachments';

describe('AI Reporting attachments', () => {
  test('accepts supported text and source-code file types', () => {
    expect(isSupportedAiReportingAttachment({ name: 'metrics.csv', type: 'text/csv' })).toBe(true);
    expect(isSupportedAiReportingAttachment({ name: 'query.sql', type: '' })).toBe(true);
    expect(isSupportedAiReportingAttachment({ name: 'invoice.pdf', type: 'application/pdf' })).toBe(
      false,
    );
  });

  test('reads and serializes attachment content without exposing transport metadata', async () => {
    const file = new File(['quarter,revenue\nQ1,120000'], 'metrics.csv', {
      type: 'text/csv',
      lastModified: 1,
    });

    const result = await readAiReportingAttachments([file]);
    expect(result.error).toBeUndefined();
    expect(result.attachments).toHaveLength(1);

    const serialized = serializeAiReportingMessage('Summarize the data', result.attachments);
    expect(serialized).not.toContain('"instructions"');
    const parsed = parseAiReportingMessage(serialized);
    expect(parsed.text).toBe('Summarize the data');
    expect(parsed.attachments).toEqual([
      {
        name: 'metrics.csv',
        type: 'text/csv',
        size: file.size,
        content: 'quarter,revenue\nQ1,120000',
      },
    ]);
  });

  test('rejects unsupported files and selections above the file limit', async () => {
    const unsupported = new File(['binary'], 'invoice.pdf', { type: 'application/pdf' });
    expect(await readAiReportingAttachments([unsupported])).toEqual({
      attachments: [],
      error: { code: 'unsupportedType', fileName: 'invoice.pdf' },
    });

    const tooManyFiles = Array.from(
      { length: AI_REPORTING_MAX_ATTACHMENTS + 1 },
      (_, index) => new File(['data'], `file-${index}.txt`, { type: 'text/plain' }),
    );
    expect(await readAiReportingAttachments(tooManyFiles)).toEqual({
      attachments: [],
      error: { code: 'tooManyFiles' },
    });
  });

  test('rejects text content above the per-file character limit', async () => {
    const longFile = new File(
      ['x'.repeat(AI_REPORTING_MAX_ATTACHMENT_CONTENT_CHARS + 1)],
      'long.txt',
      { type: 'text/plain' },
    );

    expect(await readAiReportingAttachments([longFile])).toEqual({
      attachments: [],
      error: { code: 'fileContentTooLong', fileName: 'long.txt' },
    });
  });

  test('falls back to plain text when attachment metadata is malformed', () => {
    const malformed = 'Question\n\n\u001ePRAETOR_AI_ATTACHMENTS_V1\n\nnot-json';
    expect(parseAiReportingMessage(malformed)).toEqual({
      text: malformed,
      attachments: [],
    });
  });
});
