import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '../../components/ui/alert';

describe('<Alert />', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders with role="alert" and default variant tokens', () => {
    render(
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
      </Alert>,
    );

    const root = screen.getByRole('alert');
    expect(root.className).toContain('bg-card');
    expect(root.className).toContain('rounded-md');
    expect(screen.getByText('Heads up')).toBeDefined();
  });

  test('applies warning variant amber tokens with dark-mode support', () => {
    render(
      <Alert variant="warning">
        <AlertTitle>Read-only</AlertTitle>
      </Alert>,
    );

    const root = screen.getByRole('alert');
    expect(root.className).toContain('border-amber-500/30');
    expect(root.className).toContain('bg-amber-500/10');
    expect(root.className).toContain('text-amber-700');
    expect(root.className).toContain('dark:text-amber-300');
  });

  test('applies destructive variant tokens', () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
      </Alert>,
    );

    const root = screen.getByRole('alert');
    expect(root.className).toContain('text-destructive');
    expect(root.className).toContain('bg-destructive/10');
  });

  test('renders icon, title, description, and action slots together', () => {
    render(
      <Alert variant="warning">
        <AlertIcon>
          <i className="fa-solid fa-clock-rotate-left" data-testid="icon"></i>
        </AlertIcon>
        <AlertTitle>Preview mode</AlertTitle>
        <AlertDescription>Some description</AlertDescription>
        <AlertAction>
          <button type="button">Exit</button>
        </AlertAction>
      </Alert>,
    );

    expect(screen.getByTestId('icon')).toBeDefined();
    expect(screen.getByText('Preview mode')).toBeDefined();
    expect(screen.getByText('Some description')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Exit' })).toBeDefined();
  });

  test('marks AlertIcon aria-hidden so screen readers skip decorative glyphs', () => {
    render(
      <Alert variant="warning">
        <AlertIcon data-testid="icon-slot">
          <i className="fa-solid fa-triangle-exclamation"></i>
        </AlertIcon>
        <AlertTitle>Warning</AlertTitle>
      </Alert>,
    );

    const iconSlot = screen.getByTestId('icon-slot');
    expect(iconSlot.getAttribute('aria-hidden')).toBe('true');
  });

  test('forwards extra className via twMerge so caller overrides win', () => {
    render(
      <Alert variant="warning" className="rounded-xl">
        <AlertTitle>Custom</AlertTitle>
      </Alert>,
    );

    const root = screen.getByRole('alert');
    expect(root.className).toContain('rounded-xl');
    expect(root.className).not.toContain('rounded-md');
  });
});
