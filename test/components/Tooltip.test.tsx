import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FieldTooltip from '../../components/shared/FieldTooltip';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { applyTheme, THEME_STORAGE_KEY } from '../../utils/theme';

afterEach(() => {
  cleanup();
  localStorage.removeItem(THEME_STORAGE_KEY);
});

const renderTooltip = () =>
  render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button">trigger</button>
        </TooltipTrigger>
        <TooltipContent>Tip text</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
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

  test('renders above the shared modal overlay layer', async () => {
    renderTooltip();

    await userEvent.hover(screen.getByRole('button', { name: 'trigger' }));

    const tooltip = await findTooltipContent();
    expect(tooltip.className).toContain('z-[70]');
  });

  test('applies shared width and wrapping constraints', async () => {
    renderTooltip();

    await userEvent.hover(screen.getByRole('button', { name: 'trigger' }));

    const tooltip = await findTooltipContent();
    expect(tooltip.className).toContain('max-w-72');
    expect(tooltip.className).toContain('whitespace-normal');
  });

  test('uses inverted shadcn theme colors', async () => {
    renderTooltip();

    await userEvent.hover(screen.getByRole('button', { name: 'trigger' }));

    const tooltip = await findTooltipContent();
    expect(tooltip.className).toContain('bg-primary');
    expect(tooltip.className).toContain('text-primary-foreground');
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
      <TooltipProvider>
        <FieldTooltip description="Current field status" status="Active" />
      </TooltipProvider>,
    );
    const trigger = container.querySelector('span');
    expect(trigger).toBeInTheDocument();

    await userEvent.hover(trigger as HTMLElement);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Current field status');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Status: Active');
  });

  test('uses one app-level TooltipProvider instead of wrapping every tooltip root', async () => {
    const tooltipSource = await readFile('components/ui/tooltip.tsx', 'utf8');
    const entrySource = await readFile('index.tsx', 'utf8');

    expect(entrySource).toContain('<TooltipProvider>');
    expect(tooltipSource).not.toContain('<TooltipProvider>');
    expect(tooltipSource).toContain('<TooltipPrimitive.Root');
  });
});
