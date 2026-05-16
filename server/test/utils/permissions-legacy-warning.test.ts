import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  __resetLegacyPermissionWarningsForTests,
  __setLegacyPermissionWarnerForTests,
  normalizePermission,
} from '../../utils/permissions.ts';

const warnMock = mock<(legacy: string, normalized: string) => void>(() => {});

beforeEach(() => {
  warnMock.mockClear();
  __resetLegacyPermissionWarningsForTests();
  __setLegacyPermissionWarnerForTests(warnMock);
});

afterAll(() => {
  __setLegacyPermissionWarnerForTests(null);
  __resetLegacyPermissionWarningsForTests();
});

describe('normalizePermission deprecation warning', () => {
  test('warns when rewriting a legacy configuration.* permission', () => {
    normalizePermission('configuration.general.view');

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      'configuration.general.view',
      'administration.general.view',
    );
  });

  test('warns when rewriting a legacy suppliers.quotes.* permission', () => {
    normalizePermission('suppliers.quotes.create');

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      'suppliers.quotes.create',
      'sales.supplier_quotes.create',
    );
  });

  test('warns only once per unique legacy permission string', () => {
    normalizePermission('configuration.general.view');
    normalizePermission('configuration.general.view');
    normalizePermission('configuration.general.view');

    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  test('warns separately for each distinct legacy permission', () => {
    normalizePermission('configuration.general.view');
    normalizePermission('configuration.general.update');
    normalizePermission('suppliers.quotes.create');

    expect(warnMock).toHaveBeenCalledTimes(3);
  });

  test('does not warn for current-name permissions', () => {
    normalizePermission('administration.general.view');
    normalizePermission('crm.clients.view');
    normalizePermission('sales.supplier_quotes.create');

    expect(warnMock).not.toHaveBeenCalled();
  });

  test('does not warn (or record) when the rewrite produces an unknown permission', () => {
    expect(normalizePermission('configuration.does.not_exist')).toBe(
      'administration.does.not_exist',
    );
    expect(normalizePermission('suppliers.quotes.banana')).toBe('sales.supplier_quotes.banana');

    expect(warnMock).not.toHaveBeenCalled();
  });
});
