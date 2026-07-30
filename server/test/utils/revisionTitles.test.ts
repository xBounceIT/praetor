import { describe, expect, test } from 'bun:test';
import { parseRevisionTitle, REVISION_TITLE_MAX_LENGTH } from '../../utils/revision-titles.ts';

describe('parseRevisionTitle', () => {
  test('normalizes missing and blank titles to null', () => {
    expect(parseRevisionTitle(undefined)).toEqual({ ok: true, value: null });
    expect(parseRevisionTitle('   ')).toEqual({ ok: true, value: null });
  });

  test('trims valid titles and rejects oversized input', () => {
    expect(parseRevisionTitle('  Q3 renewal  ')).toEqual({
      ok: true,
      value: 'Q3 renewal',
    });
    const maximumTitle = 'x'.repeat(REVISION_TITLE_MAX_LENGTH);
    expect(parseRevisionTitle(maximumTitle)).toEqual({ ok: true, value: maximumTitle });
    expect(parseRevisionTitle('x'.repeat(REVISION_TITLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      message: `revisionTitle must be ${REVISION_TITLE_MAX_LENGTH} characters or fewer`,
    });
  });
});
