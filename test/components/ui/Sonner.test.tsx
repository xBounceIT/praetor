import { describe, expect, test } from 'bun:test';
import {
  appToasterProps,
  offerCreatedToastClassNames,
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

  test('configures centered rich toasts and primary offer styling', () => {
    expect(appToasterProps).toEqual({
      richColors: true,
      closeButton: true,
      position: 'top-center',
    });
    expect(offerCreatedToastClassNames.toast).toContain('bg-primary!');
    expect(offerCreatedToastClassNames.toast).toContain('rounded-lg!');
    expect(offerCreatedToastClassNames.description).toContain('text-primary-foreground/70!');
    expect(offerCreatedToastClassNames.actionButton).toContain('bg-primary-foreground!');
    expect(offerCreatedToastClassNames.actionButton).toContain('rounded-md!');
    expect(offerCreatedToastClassNames.closeButton).toContain('right-2!');
    expect(offerCreatedToastClassNames.closeButton).toContain('top-2!');
    expect(offerCreatedToastClassNames.closeButton).toContain('size-6!');
    expect(offerCreatedToastClassNames.closeButton).toContain('rounded-md!');
    expect(offerCreatedToastClassNames.closeButton).toContain('text-primary-foreground!');
    expect(offerCreatedToastClassNames.closeButton).toContain('[&_svg]:size-4!');
    expect(offerCreatedToastClassNames.icon).toContain('text-primary-foreground!');
  });
});
