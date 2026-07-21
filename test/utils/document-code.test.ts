import { describe, expect, test } from 'bun:test';
import { formatDocumentCode } from '../../utils/document-code';

describe('formatDocumentCode', () => {
  test('shows the revision beside the raw document code', () => {
    expect(formatDocumentCode('OFF_26_001', 'REV2')).toBe('OFF_26_001 REV2');
  });

  test('keeps never-sent documents unchanged', () => {
    expect(formatDocumentCode('OFF_26_001', null)).toBe('OFF_26_001');
    expect(formatDocumentCode('OFF_26_001', undefined)).toBe('OFF_26_001');
  });
});
