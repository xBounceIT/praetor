import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { downloadCsv, escapeCsvCell } from '../../utils/csv';

describe('escapeCsvCell - formula injection protection', () => {
  test.each([
    '=',
    '+',
    '-',
    '@',
  ])('prefixes leading "%s" with a single quote to neutralize formulas', (prefix) => {
    const input = `${prefix}1+1`;
    // No comma / CR / LF / quote → not wrapped in double quotes; only the
    // leading apostrophe is added.
    expect(escapeCsvCell(input)).toBe(`'${input}`);
  });

  test('prefixes leading whitespace + formula char (catches space-prefix bypass)', () => {
    expect(escapeCsvCell('   =1+1')).toBe(`'   =1+1`);
  });

  test('prefixes a leading tab character (formula prefix regex catches \\t)', () => {
    // Tab is in FORMULA_PREFIXES but not in the wrap regex, so output stays unwrapped.
    expect(escapeCsvCell('\t=danger')).toBe(`'\t=danger`);
  });

  test('prefixes a leading carriage return AND wraps in double quotes (CR triggers wrap)', () => {
    expect(escapeCsvCell('\r=danger')).toBe(`"'\r=danger"`);
  });

  test('does not prefix safe values that happen to contain = mid-string', () => {
    expect(escapeCsvCell('a=b')).toBe('a=b');
  });
});

describe('escapeCsvCell - quoting & escaping', () => {
  test('passes a plain string through unchanged', () => {
    expect(escapeCsvCell('hello world')).toBe('hello world');
  });

  test('wraps values containing a comma in double quotes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  test('wraps values containing a CR or LF in double quotes', () => {
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
    expect(escapeCsvCell('a\rb')).toBe('"a\rb"');
  });

  test('doubles embedded double-quotes inside a quoted value', () => {
    expect(escapeCsvCell('she said "hi"')).toBe(`"she said ""hi"""`);
  });

  test('combines formula prefix and quoting when a value needs both', () => {
    // Has a leading "=" (needs the ' prefix) AND a comma (needs wrapping quotes)
    expect(escapeCsvCell('=A1,B1')).toBe(`"'=A1,B1"`);
  });

  test('returns empty string for empty input', () => {
    expect(escapeCsvCell('')).toBe('');
  });
});

describe('downloadCsv - cleanup lifecycle', () => {
  // Stash references so we can swap implementations per-test.
  let createObjectURLSpy: ReturnType<typeof spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    createObjectURLSpy = spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url');
    revokeObjectURLSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    // Anchor clicks would otherwise attempt navigation under happy-dom.
    spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  test('returns a cancel function that clears the pending timeout', () => {
    const cancel = downloadCsv(
      [
        ['a', 'b'],
        ['1', '2'],
      ],
      'test.csv',
    );
    // The anchor was appended to body and the object URL created.
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(document.querySelectorAll('a[download="test.csv"]').length).toBe(1);

    // Cancelling runs cleanup synchronously: anchor goes away, URL is revoked.
    cancel();
    expect(document.querySelectorAll('a[download="test.csv"]').length).toBe(0);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');

    // Calling cancel again is a no-op — clearTimeout on null and no anchor present.
    expect(() => cancel()).not.toThrow();
  });

  test('cancel after the timer fires is idempotent', async () => {
    const cancel = downloadCsv([['x']], 'idempotent.csv');
    // Let the queued setTimeout(0) callback run.
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Original cleanup already ran — anchor is gone, URL revoked once.
    expect(document.querySelectorAll('a[download="idempotent.csv"]').length).toBe(0);
    const revokesBefore = revokeObjectURLSpy.mock.calls.length;
    cancel();
    // No double-revoke (cleanup early-returns: timeoutId is already null, anchor detached).
    expect(revokeObjectURLSpy.mock.calls.length).toBe(revokesBefore);
  });
});
