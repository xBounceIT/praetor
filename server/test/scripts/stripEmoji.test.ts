import { describe, expect, test } from 'bun:test';
import { stripEmoji } from '../../scripts/strip-emoji.ts';

describe('stripEmoji', () => {
  test('strips drizzle-kit success emojis', () => {
    expect(stripEmoji("Everything's fine 🐶🔥")).toBe("Everything's fine ");
  });

  test('strips drizzle-kit generate completion emoji', () => {
    expect(stripEmoji('Migration written to 0001_foo.sql 🚀')).toBe(
      'Migration written to 0001_foo.sql ',
    );
  });

  test('strips emojis embedded mid-string', () => {
    expect(stripEmoji('alpha 🎉 beta 🐳 gamma')).toBe('alpha  beta  gamma');
  });

  test('preserves ASCII text and punctuation', () => {
    expect(stripEmoji('hello world 123 ()[]<>!@#$%^&*')).toBe('hello world 123 ()[]<>!@#$%^&*');
  });

  test('preserves non-emoji Unicode (em-dash, accents, CJK)', () => {
    expect(stripEmoji('café — résumé')).toBe('café — résumé');
    expect(stripEmoji('日本語テスト')).toBe('日本語テスト');
    expect(stripEmoji('Crème brûlée → done')).toBe('Crème brûlée → done');
  });

  test('handles empty string', () => {
    expect(stripEmoji('')).toBe('');
  });

  test('strips every emoji in a run (tests global flag)', () => {
    expect(stripEmoji('🚀🚀🚀🚀')).toBe('');
  });

  test('strips pictographic codepoints in a ZWJ sequence', () => {
    // ZWJ (U+200D) itself is not Extended_Pictographic, so it survives;
    // but every pictographic component is removed. This is acceptable
    // for CLI output sanitization — the visible glyph is gone.
    const result = stripEmoji('👨‍👩‍👧');
    expect(result).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
