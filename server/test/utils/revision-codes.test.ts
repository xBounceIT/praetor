import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_REVISION_CODE_TEMPLATE,
  renderRevisionCode,
  validateRevisionCodeTemplate,
} from '../../utils/revision-codes.ts';

describe('revision code templates', () => {
  test('renders the default and custom padded codes', () => {
    expect(renderRevisionCode(DEFAULT_REVISION_CODE_TEMPLATE, 1)).toBe('REV1');
    expect(
      renderRevisionCode({ prefix: 'R', template: '{PREFIX}-{SEQ}', sequencePadding: 3 }, 12),
    ).toBe('R-012');
  });

  test('requires SEQ and rejects unsupported placeholders', () => {
    expect(
      validateRevisionCodeTemplate({
        prefix: 'REV',
        template: '{PREFIX}{SEQ}',
        sequencePadding: 1,
      }),
    ).toEqual({
      ok: true,
      value: { prefix: 'REV', template: '{PREFIX}{SEQ}', sequencePadding: 1 },
    });
    expect(
      validateRevisionCodeTemplate({
        prefix: 'REV',
        template: '{PREFIX}',
        sequencePadding: 1,
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
    expect(
      validateRevisionCodeTemplate({
        prefix: 'REV',
        template: '{PREFIX}{YEAR}{SEQ}',
        sequencePadding: 1,
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
  });

  test('enforces padding and rendered-code limits', () => {
    expect(
      validateRevisionCodeTemplate({
        prefix: 'REV',
        template: '{PREFIX}{SEQ}',
        sequencePadding: 0,
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
    expect(
      validateRevisionCodeTemplate({
        prefix: 'R'.repeat(20),
        template: '{PREFIX}-ABCDEFGHIJKLMNOPQRSTUVWXYZ-{SEQ}',
        sequencePadding: 12,
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
  });
});
