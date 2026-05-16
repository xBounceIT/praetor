import { describe, expect, test } from 'bun:test';
import { decodeEntriesCursor } from '../../services/api/entries';

const toBase64Url = (json: string) =>
  btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('decodeEntriesCursor', () => {
  test('returns null for null/empty input', () => {
    expect(decodeEntriesCursor(null)).toBeNull();
    expect(decodeEntriesCursor('')).toBeNull();
  });

  test('returns null for malformed base64', () => {
    expect(decodeEntriesCursor('!!!not-base64!!!')).toBeNull();
  });

  test('returns null when the JSON payload is missing required fields', () => {
    expect(decodeEntriesCursor(toBase64Url(JSON.stringify({ id: 'x' })))).toBeNull();
    expect(
      decodeEntriesCursor(toBase64Url(JSON.stringify({ createdAt: '2026-05-16' }))),
    ).toBeNull();
    expect(decodeEntriesCursor(toBase64Url(JSON.stringify('scalar')))).toBeNull();
  });

  test('parses postgres-style (no zone) cursor text as UTC', () => {
    // `created_at::text` from a TIMESTAMP WITHOUT TIME ZONE column has no
    // zone marker. pg-node parses TIMESTAMP server-side as UTC, so the
    // entries payload's createdAt is UTC ms — the cursor MUST be parsed in
    // the same domain. Using `new Date(text)` directly would treat the
    // string as local time and shift the window boundary by the browser's
    // UTC offset.
    const raw = toBase64Url(
      JSON.stringify({ createdAt: '2026-05-16 10:32:45.123456', id: 'entry-id' }),
    );
    expect(decodeEntriesCursor(raw)).toEqual({
      createdAt: Date.UTC(2026, 4, 16, 10, 32, 45, 123),
      id: 'entry-id',
    });
  });

  test('honors an explicit Z marker without doubling it', () => {
    const z = toBase64Url(JSON.stringify({ createdAt: '2026-05-16T10:32:45.123Z', id: 'a' }));
    expect(decodeEntriesCursor(z)?.createdAt).toBe(Date.UTC(2026, 4, 16, 10, 32, 45, 123));
  });

  test('returns null for an unparseable createdAt', () => {
    const raw = toBase64Url(JSON.stringify({ createdAt: 'not-a-timestamp', id: 'a' }));
    expect(decodeEntriesCursor(raw)).toBeNull();
  });
});
