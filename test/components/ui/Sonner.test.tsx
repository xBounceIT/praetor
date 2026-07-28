import { afterEach, describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { toast } from 'sonner';
import { Toaster } from '../../../components/ui/sonner';
import { offerCreatedToastClassNames } from '../../../components/ui/sonner-presets';
import { render } from '../../helpers/render';

describe('<Toaster />', () => {
  afterEach(() => localStorage.removeItem('praetor_theme'));

  test('inherits the selected app theme outside the layout theme scope', async () => {
    localStorage.setItem('praetor_theme', 'dark');

    const { container } = render(<Toaster />);
    const themeScope = container.querySelector('[data-shadcn-theme-scope]');
    toast('Theme probe');
    const toaster = (await screen.findByText('Theme probe')).closest('[data-sonner-toaster]');

    expect(themeScope?.getAttribute('data-shadcn-theme')).toBe('dark');
    expect(themeScope?.className).toContain('dark');
    expect(toaster?.getAttribute('data-sonner-theme')).toBe('dark');
  });

  test('supports a primary themed offer success without disabling rich colors globally', async () => {
    const { container } = render(<Toaster richColors closeButton position="top-center" />);

    toast.success('Offer created', {
      description: 'OFF_26_0015',
      classNames: offerCreatedToastClassNames,
      action: {
        label: 'View offer',
        onClick: () => {},
      },
    });

    const description = await screen.findByText('OFF_26_0015');
    const action = screen.getByRole('button', { name: 'View offer' });
    const closeButton = screen.getByRole('button', { name: 'Close toast' });
    const toastElement = description.closest('[data-sonner-toast]');
    const toaster = container.querySelector('[data-sonner-toaster]');
    const successIcon = toastElement?.querySelector('[data-icon]');

    expect(toaster?.getAttribute('data-x-position')).toBe('center');
    expect(toastElement?.getAttribute('data-rich-colors')).toBe('true');
    expect(toastElement?.className).toContain('bg-primary!');
    expect(toastElement?.className).toContain('rounded-lg!');
    expect(description.className).toContain('text-primary-foreground/70!');
    expect(action.className).toContain('bg-primary-foreground!');
    expect(action.className).toContain('rounded-md!');
    expect(closeButton.className).toContain('right-2!');
    expect(closeButton.className).toContain('top-2!');
    expect(closeButton.className).toContain('size-6!');
    expect(closeButton.className).toContain('rounded-md!');
    expect(closeButton.className).toContain('text-primary-foreground!');
    expect(closeButton.className).toContain('[&_svg]:size-4!');
    expect(successIcon?.className).toContain('text-primary-foreground!');
  });
});
