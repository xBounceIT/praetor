import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FieldTooltip from '../../components/shared/FieldTooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { applyTheme, THEME_STORAGE_KEY } from '../../utils/theme';

afterEach(() => {
  cleanup();
  localStorage.removeItem(THEME_STORAGE_KEY);
});

const renderTooltip = () =>
  render(
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button">trigger</button>
      </TooltipTrigger>
      <TooltipContent>Tip text</TooltipContent>
    </Tooltip>,
  );

const findTooltipContent = async () => {
  await screen.findByRole('tooltip');
  return document.querySelector('[data-slot="tooltip-content"]') as HTMLElement;
};

describe('<Tooltip />', () => {
  test('renders content through Radix tooltip interaction', async () => {
    renderTooltip();

    await userEvent.hover(screen.getByRole('button', { name: 'trigger' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Tip text');
  });

  test('marks portaled tooltip content as a shadcn theme scope', async () => {
    renderTooltip();

    await userEvent.hover(screen.getByRole('button', { name: 'trigger' }));

    const tooltip = await findTooltipContent();
    expect(tooltip.hasAttribute('data-shadcn-theme-scope')).toBe(true);
    expect(tooltip.getAttribute('data-shadcn-theme')).toBe('light');
  });

  test('updates portaled tooltip content when the resolved theme changes', async () => {
    renderTooltip();

    await userEvent.hover(screen.getByRole('button', { name: 'trigger' }));
    const tooltip = await findTooltipContent();

    act(() => applyTheme('dark'));

    await waitFor(() => expect(tooltip.getAttribute('data-shadcn-theme')).toBe('dark'));
    expect(tooltip.className).toContain('dark');
  });

  test('renders FieldTooltip content with native tooltip primitives', async () => {
    const { container } = render(
      <FieldTooltip description="Current field status" status="Active" />,
    );
    const trigger = container.querySelector('span');
    expect(trigger).toBeInTheDocument();

    await userEvent.hover(trigger as HTMLElement);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Current field status');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Status: Active');
  });
});
