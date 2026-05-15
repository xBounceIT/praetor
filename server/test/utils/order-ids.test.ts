import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  formatSequenceSuffix,
  generateClientOrderId,
  generatePrefixedId,
  generateSupplierOrderId,
} from '../../utils/order-ids.ts';

describe('generatePrefixedId', () => {
  test('formats id as prefix-uuid', () => {
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

describe('formatSequenceSuffix', () => {
  test('uses 4 digits as the minimum display width', () => {
    expect(formatSequenceSuffix(1)).toBe('0001');
    expect(formatSequenceSuffix(9999)).toBe('9999');
  });

  test('keeps sequence suffixes untruncated after 9999', () => {
    expect(formatSequenceSuffix(10000)).toBe('10000');
  });
});

// `generateClientOrderId` / `generateSupplierOrderId` should be race-free: they back onto
// PostgreSQL SEQUENCEs (`order_id_seq`, `supplier_order_id_seq`) via `nextval()`. We mock
// the executor so the test runs without a live DB while still exercising the actual logic
// the routes will execute.
describe('generateSequentialId (sequence-backed)', () => {
  let counter: number;
  let mockExec: { execute: ReturnType<typeof mock> };

  beforeEach(() => {
    counter = 0;
    mockExec = {
      execute: mock(async () => {
        counter += 1;
        return { rows: [{ nextValue: counter }] };
      }),
    };
  });

  afterEach(() => {
    mockExec.execute.mockReset();
  });

  test('uses nextval() rather than SELECT MAX', async () => {
    await generateClientOrderId(mockExec as never);
    // The drizzle SQL object passed to execute() carries the literal `nextval(` we wrote.
    const callArg = mockExec.execute.mock.calls[0]?.[0] as unknown;
    const serialized = JSON.stringify(callArg);
    expect(serialized).toContain('nextval');
    expect(serialized).not.toContain('MAX(');
  });

  test('concurrent generateClientOrderId calls produce unique sequential ids', async () => {
    const ids = await Promise.all(
      Array.from({ length: 50 }, () => generateClientOrderId(mockExec as never)),
    );
    expect(new Set(ids).size).toBe(ids.length);
    const year = new Date().getFullYear();
    for (const id of ids) {
      expect(id).toMatch(new RegExp(`^ORD-${year}-\\d{4,}$`));
    }
  });

  test('concurrent generateSupplierOrderId calls produce unique sequential ids', async () => {
    const ids = await Promise.all(
      Array.from({ length: 25 }, () => generateSupplierOrderId(mockExec as never)),
    );
    expect(new Set(ids).size).toBe(ids.length);
    const year = new Date().getFullYear();
    for (const id of ids) {
      expect(id).toMatch(new RegExp(`^SORD-${year}-\\d{4,}$`));
    }
  });

  test('formats sequence value as zero-padded 4-digit suffix', async () => {
    const id = await generateClientOrderId(mockExec as never);
    const year = new Date().getFullYear();
    expect(id).toBe(`ORD-${year}-0001`);
  });

  test('does not truncate generated ids after the 4-digit range', async () => {
    counter = 9999;
    const id = await generateClientOrderId(mockExec as never);
    const year = new Date().getFullYear();
    expect(id).toBe(`ORD-${year}-10000`);
  });
});
