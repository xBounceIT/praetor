import { describe, expect, test } from 'bun:test';
import { generatePrefixedId } from '../../utils/order-ids.ts';

describe('generatePrefixedId', () => {
  test('formats id as `${prefix}-${uuid}`', () => {
    const id = generatePrefixedId('audit');
    expect(id).toMatch(/^audit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('produces a fresh id per call', () => {
    expect(generatePrefixedId('x')).not.toBe(generatePrefixedId('x'));
  });

  test('preserves multi-segment prefixes verbatim', () => {
    const id = generatePrefixedId('rpt-chat');
    expect(id.startsWith('rpt-chat-')).toBe(true);
  });
});
