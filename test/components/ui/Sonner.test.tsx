import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { toast } from 'sonner';
import { Toaster } from '../../../components/ui/sonner';
import { neutralSuccessToastClassNames } from '../../../components/ui/sonner-presets';
import { render } from '../../helpers/render';

describe('<Toaster />', () => {
  test('supports a neutral themed success without disabling rich colors globally', async () => {
    const { container } = render(<Toaster richColors closeButton position="top-center" />);

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
    const toaster = container.querySelector('[data-sonner-toaster]');
    const successIcon = toastElement?.querySelector('[data-icon]');

    expect(toaster?.getAttribute('data-x-position')).toBe('center');
    expect(toastElement?.getAttribute('data-rich-colors')).toBe('true');
    expect(toastElement?.className).toContain('bg-popover!');
    expect(toastElement?.className).toContain('rounded-md!');
    expect(description.className).toContain('text-muted-foreground!');
    expect(action.className).toContain('bg-primary!');
    expect(action.className).toContain('rounded-md!');
    expect(closeButton.className).toContain('right-1!');
    expect(closeButton.className).toContain('top-0.5!');
    expect(closeButton.className).toContain('size-5!');
    expect(closeButton.className).toContain('rounded-md!');
    expect(successIcon?.className).toContain('text-primary!');
  });
});
