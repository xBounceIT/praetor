import { describe, expect, test } from 'bun:test';
import {
  appErrorToastClassNames,
  appSuccessToastClassNames,
  appToasterProps,
  appWarningToastClassNames,
  mergeToastClassNames,
  offerCreatedToastClassNames,
  resolveOfferCreatedToastAction,
  resolveSonnerTheme,
} from '../../../components/ui/sonner-presets';

describe('Sonner configuration', () => {
  test('maps the selected app theme to Sonner without overriding an explicit theme', () => {
    expect(resolveSonnerTheme('dark')).toBe('dark');
    expect(resolveSonnerTheme('light')).toBe('light');
    expect(resolveSonnerTheme('zebra')).toBe('light');
    expect(resolveSonnerTheme('praetor')).toBe('light');
    expect(resolveSonnerTheme('dark', 'system')).toBe('system');
  });

  test('configures centered rich toasts with shared primary success styling', () => {
    expect(appToasterProps).toEqual({
      richColors: true,
      closeButton: true,
      position: 'top-center',
    });
    expect(appSuccessToastClassNames.toast).toContain('bg-primary!');
    expect(appSuccessToastClassNames.toast).toContain('rounded-lg!');
    expect(appSuccessToastClassNames.description).toContain('text-primary-foreground/70!');
    expect(appSuccessToastClassNames.actionButton).toContain('bg-primary-foreground!');
    expect(appSuccessToastClassNames.closeButton).toContain('right-2!');
    expect(appSuccessToastClassNames.icon).toContain('text-primary-foreground!');
    expect(offerCreatedToastClassNames).toBe(appSuccessToastClassNames);
  });

  test('defines matching error and warning variants', () => {
    expect(appErrorToastClassNames.toast).toContain('bg-destructive!');
    expect(appErrorToastClassNames.icon).toContain('text-destructive-foreground!');
    expect(appWarningToastClassNames.toast).toContain('bg-warning!');
    expect(appWarningToastClassNames.closeButton).toContain('text-warning-foreground!');
  });

  test('merges className overrides without dropping the shared base style', () => {
    const merged = mergeToastClassNames(appSuccessToastClassNames, {
      toast: 'extra-class',
      description: 'extra-desc',
    });
    expect(merged.toast).toContain('bg-primary!');
    expect(merged.toast).toContain('extra-class');
    expect(merged.description).toContain('text-primary-foreground/70!');
    expect(merged.description).toContain('extra-desc');
    expect(merged.icon).toBe(appSuccessToastClassNames.icon);
  });

  test('keeps the base style when the override object is empty', () => {
    expect(mergeToastClassNames(appSuccessToastClassNames, {})).toEqual(appSuccessToastClassNames);
  });

  test('merges Sonner default and loader className overrides', () => {
    const merged = mergeToastClassNames(appSuccessToastClassNames, {
      default: 'extra-default',
      loader: 'extra-loader',
    });
    expect(merged.default).toContain('extra-default');
    expect(merged.loader).toContain('extra-loader');
    expect(merged.toast).toBe(appSuccessToastClassNames.toast);
  });

  test('only exposes the offer action when the user can view client offers', () => {
    const action = { label: 'View offer', onClick: () => {} };

    expect(resolveOfferCreatedToastAction(true, action)).toBe(action);
    expect(resolveOfferCreatedToastAction(false, action)).toBeUndefined();
  });
});
