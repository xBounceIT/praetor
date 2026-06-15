import { describe, expect, test } from 'bun:test';
import enLayout from '../../locales/en/layout.json';
import itLayout from '../../locales/it/layout.json';

describe('layout translations', () => {
  test('standalone settings route has localized page header text', () => {
    expect(enLayout.routes.settings).toBe('Settings');
    expect(itLayout.routes.settings).toBe('Impostazioni');
  });

  test('project resales route has localized sidebar and title text', () => {
    expect(enLayout.routes.commissions).toBe('Jobs');
    expect(enLayout.titles.commissions).toBe('Jobs');
    expect(enLayout.routes.resales).toBe('Resales');
    expect(enLayout.titles.resales).toBe('Resales');
    expect(itLayout.routes.commissions).toBe('Commesse');
    expect(itLayout.titles.commissions).toBe('Commesse');
    expect(itLayout.routes.resales).toBe('Rivendite');
    expect(itLayout.titles.resales).toBe('Rivendite');
  });
});
