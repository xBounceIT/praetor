import { describe, expect, test } from 'bun:test';
import enLayout from '../../locales/en/layout.json';
import itLayout from '../../locales/it/layout.json';

describe('layout translations', () => {
  test('standalone settings route has localized page header text', () => {
    expect(enLayout.routes.settings).toBe('Settings');
    expect(itLayout.routes.settings).toBe('Impostazioni');
  });
});
