import { describe, expect, test } from 'bun:test';
import {
  DOCUMENT_CODE_MODULES,
  formatDocumentSequence,
  getDocumentCodeYear,
  parseDocumentCodeCounter,
  parseDocumentCodeCounterFromTemplate,
  renderDocumentCode,
  validateDocumentCodeTemplate,
} from '../../utils/document-codes.ts';

describe('document code templates', () => {
  test('renders default module templates with short year and padded sequence', () => {
    expect(
      renderDocumentCode(DOCUMENT_CODE_MODULES.client_quote, {
        year: 2026,
        sequence: 1,
      }),
    ).toBe('PREV_26_0001');
    expect(
      renderDocumentCode(DOCUMENT_CODE_MODULES.supplier_invoice, {
        year: 2026,
        sequence: 42,
      }),
    ).toBe('SINV_26_0042');
  });

  test('renders custom placeholders and keeps sequences wider than padding', () => {
    expect(
      renderDocumentCode(
        { prefix: 'INV', template: '{PREFIX}-{YYYY}-{SEQ}', sequencePadding: 2 },
        { year: 2026, sequence: 123 },
      ),
    ).toBe('INV-2026-123');
  });

  test('parses source counters from supported document code separators', () => {
    expect(parseDocumentCodeCounter('PREV_26_045')).toEqual({ year: 2026, sequence: 45 });
    expect(parseDocumentCodeCounter('PREV-26-045')).toEqual({ year: 2026, sequence: 45 });
    expect(parseDocumentCodeCounter('PREV_2026_00045_extra')).toEqual({
      year: 2026,
      sequence: 45,
    });
    expect(parseDocumentCodeCounter('PREV-2026-00045-extra')).toEqual({
      year: 2026,
      sequence: 45,
    });
    expect(parseDocumentCodeCounter('PREV_2026_00045_01')).toEqual({
      year: 2026,
      sequence: 45,
    });
    expect(parseDocumentCodeCounter('PREV-2026-00045-01')).toEqual({
      year: 2026,
      sequence: 45,
    });
  });

  test('parses source counters when prefixes or literals contain separators', () => {
    expect(parseDocumentCodeCounter('ACME_PREV_26_0045')).toEqual({
      year: 2026,
      sequence: 45,
    });
    expect(parseDocumentCodeCounter('ACME-PREV-26-0045')).toEqual({
      year: 2026,
      sequence: 45,
    });
    expect(parseDocumentCodeCounter('PREV_EU_2026_00045_extra')).toEqual({
      year: 2026,
      sequence: 45,
    });
    expect(parseDocumentCodeCounter('PREV-EU-2026-00045-extra')).toEqual({
      year: 2026,
      sequence: 45,
    });
  });

  test('parses counters from the configured template shape before generic segment order', () => {
    expect(
      parseDocumentCodeCounterFromTemplate('PREV_2026_DOC_0007', {
        prefix: 'PREV',
        template: '{PREFIX}_{YYYY}_DOC_{SEQ}',
      }),
    ).toEqual({ year: 2026, sequence: 7 });
    expect(
      parseDocumentCodeCounterFromTemplate('ACME_12_345_2026_0007', {
        prefix: 'ACME_12_345',
        template: '{PREFIX}_{YYYY}_{SEQ}',
      }),
    ).toEqual({ year: 2026, sequence: 7 });
    expect(
      parseDocumentCodeCounterFromTemplate('PREV_0007_2026', {
        prefix: 'PREV',
        template: '{PREFIX}_{SEQ}_{YYYY}',
      }),
    ).toEqual({ year: 2026, sequence: 7 });
  });

  test('rejects document codes without a valid year and numeric sequence segment pair', () => {
    for (const code of [
      'PREV/26/045',
      'PREV_2026_0000',
      'PREV_20A6_0045',
      'PREV_2026_ABC',
      '_26_0045',
      'PREV_20260_0045',
      'PREV__0045',
      null,
    ]) {
      expect(parseDocumentCodeCounter(code)).toBeNull();
    }
  });

  test('validates configurable settings', () => {
    expect(
      validateDocumentCodeTemplate({
        moduleId: 'client_invoice',
        prefix: 'CI',
        template: '{PREFIX}-{YYYY}-{SEQ}',
        sequencePadding: 6,
      }),
    ).toEqual({
      ok: true,
      value: {
        moduleId: 'client_invoice',
        prefix: 'CI',
        template: '{PREFIX}-{YYYY}-{SEQ}',
        sequencePadding: 6,
      },
    });
  });

  test('rejects template text that would break document id routes', () => {
    const base = {
      moduleId: 'client_invoice',
      prefix: 'INV',
      sequencePadding: 4,
    };

    for (const template of [
      '{PREFIX}/{YYYY}/{SEQ}',
      '{PREFIX}?{YYYY}_{SEQ}',
      '{PREFIX}_{YY}#{SEQ}',
    ]) {
      expect(validateDocumentCodeTemplate({ ...base, template })).toEqual(
        expect.objectContaining({
          ok: false,
          message:
            'template text can only contain letters, numbers, underscores, hyphens, and placeholders',
        }),
      );
    }
  });

  test('rejects invalid template inputs', () => {
    const base = {
      moduleId: 'client_invoice',
      prefix: 'INV',
      template: '{PREFIX}_{YY}_{SEQ}',
      sequencePadding: 4,
    };

    expect(validateDocumentCodeTemplate({ ...base, template: 'INV' })).toEqual(
      expect.objectContaining({ ok: false, message: 'template must include {SEQ}' }),
    );
    expect(validateDocumentCodeTemplate({ ...base, template: '{PREFIX}_{SEQ}' })).toEqual(
      expect.objectContaining({ ok: false, message: 'template must include {YY} or {YYYY}' }),
    );
    expect(validateDocumentCodeTemplate({ ...base, template: '{PREFIX}_{MONTH}_{SEQ}' })).toEqual(
      expect.objectContaining({ ok: false, message: 'Unknown placeholder {MONTH}' }),
    );
    expect(validateDocumentCodeTemplate({ ...base, prefix: 'INV 2026' })).toEqual(
      expect.objectContaining({
        ok: false,
        message: 'prefix can only contain letters, numbers, underscores, and hyphens',
      }),
    );
    expect(validateDocumentCodeTemplate({ ...base, sequencePadding: 10 })).toEqual(
      expect.objectContaining({
        ok: false,
        message: 'sequencePadding must be an integer between 1 and 9',
      }),
    );
    expect(validateDocumentCodeTemplate({ ...base, sequencePadding: '4abc' })).toEqual(
      expect.objectContaining({
        ok: false,
        message: 'sequencePadding must be an integer between 1 and 9',
      }),
    );
    expect(
      validateDocumentCodeTemplate({
        ...base,
        template: `${'X'.repeat(88)}{YYYY}{SEQ}`,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        message: 'rendered document code must be 100 characters or fewer',
      }),
    );
    expect(
      validateDocumentCodeTemplate({
        ...base,
        template: `${'X'.repeat(90)}{YY}{SEQ}`,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        message: 'rendered document code must be 100 characters or fewer',
      }),
    );
  });

  test('extracts the counter year from dates and validates sequence values', () => {
    expect(getDocumentCodeYear('2026-06-14')).toBe(2026);
    expect(getDocumentCodeYear('1999-12-31')).toBe(1999);
    expect(getDocumentCodeYear(new Date('2027-01-02T00:00:00Z'))).toBe(2027);
    expect(() => getDocumentCodeYear('0000-01-01')).toThrow(
      'Document code date must start with a valid 4-digit year',
    );
    expect(formatDocumentSequence(7, 4)).toBe('0007');
    expect(() => formatDocumentSequence('abc', 4)).toThrow('Invalid sequence value');
  });
});
