import { describe, expect, test } from 'bun:test';
import {
  buildUserLookupFilter,
  buildUserSyncFilter,
  escapeLdapFilterValue,
  validateUserFilterTemplate,
} from '../../utils/ldap-filter.ts';

// Built at runtime so the source file stays free of a literal NUL byte —
// otherwise git classifies the file as binary and skips CRLF→LF normalization.
const NUL = String.fromCharCode(0);

describe('escapeLdapFilterValue', () => {
  test.each([
    ['backslash', 'a\\b', 'a\\5cb'],
    ['asterisk', 'a*b', 'a\\2ab'],
    ['opening parenthesis', 'a(b', 'a\\28b'],
    ['closing parenthesis', 'a)b', 'a\\29b'],
    ['NUL', `a${NUL}b`, 'a\\00b'],
  ])('escapes %s', (_label, input, expected) => {
    expect(escapeLdapFilterValue(input)).toBe(expected);
  });

  test('passes through ordinary characters unchanged', () => {
    expect(escapeLdapFilterValue('alice@example.com')).toBe('alice@example.com');
  });

  test('escapes every special char in a single string', () => {
    expect(escapeLdapFilterValue('(*)\\')).toBe('\\28\\2a\\29\\5c');
  });

  test('returns empty string for empty input', () => {
    expect(escapeLdapFilterValue('')).toBe('');
  });
});

describe('validateUserFilterTemplate', () => {
  test('accepts a well-formed filter with the {0} placeholder', () => {
    expect(validateUserFilterTemplate('(uid={0})')).toEqual({ ok: true, value: '(uid={0})' });
  });

  test('trims surrounding whitespace before storing', () => {
    expect(validateUserFilterTemplate('  (uid={0})  ')).toEqual({ ok: true, value: '(uid={0})' });
  });

  test('rejects empty / whitespace-only filters', () => {
    expect(validateUserFilterTemplate('').ok).toBe(false);
    expect(validateUserFilterTemplate('   ').ok).toBe(false);
  });

  test('rejects filters that do not include the {0} placeholder', () => {
    const result = validateUserFilterTemplate('(uid=alice)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('{0}');
  });

  test('rejects malformed LDAP filter syntax', () => {
    const result = validateUserFilterTemplate('(uid={0}');
    expect(result.ok).toBe(false);
  });
});

describe('buildUserLookupFilter', () => {
  test('substitutes the escaped username into the {0} placeholder', () => {
    const filter = buildUserLookupFilter('(uid={0})', 'alice');
    expect(filter.toString()).toBe('(uid=alice)');
  });

  test('escapes special characters in the username before substitution', () => {
    const filter = buildUserLookupFilter('(uid={0})', 'a(b)c');
    expect(filter.toString()).toBe('(uid=a\\28b\\29c)');
  });

  test('throws when the template has no placeholder', () => {
    expect(() => buildUserLookupFilter('(uid=alice)', 'alice')).toThrow(/\{0\}/);
  });

  test('throws when the template is empty', () => {
    expect(() => buildUserLookupFilter('', 'alice')).toThrow(/userFilter is required/);
  });
});

describe('buildUserSyncFilter', () => {
  test('replaces the placeholder with a wildcard', () => {
    expect(buildUserSyncFilter('(uid={0})').toString()).toBe('(uid=*)');
  });

  test('throws when the template has no placeholder', () => {
    expect(() => buildUserSyncFilter('(uid=alice)')).toThrow(/\{0\}/);
  });

  test('throws with an LDAP-sync-specific message on invalid syntax', () => {
    expect(() => buildUserSyncFilter('(uid={0}')).toThrow(
      /userFilter cannot be used for LDAP sync/,
    );
  });
});
