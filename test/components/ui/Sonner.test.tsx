import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { toast } from 'sonner';
import { Toaster } from '../../../components/ui/sonner';
import { neutralSuccessToastClassNames } from '../../../components/ui/sonner-presets';
import { render } from '../../helpers/render';

describe('<Toaster />', () => {
  test('supports a neutral themed success without disabling rich colors globally', async () => {
    render(<Toaster richColors closeButton />);

    toast.success('Offer created', {
      description: 'OFF_26_0015',
      classNames: neutralSuccessToastClassNames,
      action: {
        label: 'View offer',
        onClick: () => {},
      },
    });

    const description = await screen.findByText('OFF_26_0015');
    const action = screen.getByRole('button', { name: 'View offer' });
    const closeButton = screen.getByRole('button', { name: 'Close toast' });
    const toastElement = description.closest('[data-sonner-toast]');
    const successIcon = toastElement?.querySelector('[data-icon]');

    expect(toastElement?.getAttribute('data-rich-colors')).toBe('true');
    expect(toastElement?.className).toContain('bg-popover!');
    expect(description.className).toContain('text-muted-foreground!');
    expect(action.className).toContain('bg-primary!');
    expect(closeButton.className).toContain('bg-background!');
    expect(successIcon?.className).toContain('text-emerald-600!');
  });
});
