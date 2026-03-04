import ldap from 'ldapjs';

const USER_FILTER_PLACEHOLDER = '{0}';
const VALIDATION_USERNAME = 'praetor-validation-user';

type ParsedLdapFilter = ReturnType<typeof ldap.parseFilter>;

const replaceUserFilterPlaceholder = (userFilter: string, replacement: string) =>
  userFilter.split(USER_FILTER_PLACEHOLDER).join(replacement);

export const escapeLdapFilterValue = (value: string) => {
  let escaped = '';

  for (const char of value) {
    switch (char) {
      case '\\':
        escaped += '\\5c';
        break;
      case '*':
        escaped += '\\2a';
        break;
      case '(':
        escaped += '\\28';
        break;
      case ')':
        escaped += '\\29';
        break;
      case '\u0000':
        escaped += '\\00';
        break;
      default:
        escaped += char;
    }
  }

  return escaped;
};

const parseUserFilterTemplate = (
  userFilter: string,
  replacement: string,
  invalidMessage: string,
): ParsedLdapFilter => {
  const normalizedFilter = userFilter.trim();

  if (!normalizedFilter) {
    throw new Error('userFilter is required');
  }

  if (!normalizedFilter.includes(USER_FILTER_PLACEHOLDER)) {
    throw new Error(`userFilter must include ${USER_FILTER_PLACEHOLDER} placeholder`);
  }

  const resolvedFilter = replaceUserFilterPlaceholder(normalizedFilter, replacement);

  try {
    return ldap.parseFilter(resolvedFilter);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Invalid LDAP filter';
    throw new Error(`${invalidMessage}: ${errorMessage}`);
  }
};

export const validateUserFilterTemplate = (
  userFilter: string,
): { ok: true; value: string } | { ok: false; message: string } => {
  const normalizedFilter = userFilter.trim();

  if (!normalizedFilter) {
    return { ok: false, message: 'userFilter is required' };
  }

  try {
    parseUserFilterTemplate(
      normalizedFilter,
      escapeLdapFilterValue(VALIDATION_USERNAME),
      'userFilter must be a valid LDAP filter template',
    );
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'userFilter must be a valid LDAP filter template';
    return { ok: false, message: errorMessage };
  }

  return { ok: true, value: normalizedFilter };
};

export const buildUserLookupFilter = (userFilter: string, username: string): ParsedLdapFilter =>
  parseUserFilterTemplate(
    userFilter,
    escapeLdapFilterValue(username),
    'userFilter must be a valid LDAP filter template',
  );

export const buildUserSyncFilter = (userFilter: string): ParsedLdapFilter =>
  parseUserFilterTemplate(userFilter, '*', 'userFilter cannot be used for LDAP sync');
