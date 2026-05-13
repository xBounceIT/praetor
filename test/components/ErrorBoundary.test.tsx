import { describe, expect, spyOn, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { installI18nMock } from '../helpers/i18n';
import { render } from '../helpers/render';

installI18nMock();

const ErrorBoundary = (await import('../../components/ErrorBoundary')).default;

// biome-ignore lint/style/useComponentExportOnlyModules: test-only throwing fixture, never exported.
const Boom = ({ message = 'kaboom' }: { message?: string }): null => {
  throw new Error(message);
};

describe('<ErrorBoundary />', () => {
  test('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  test('renders the fallback when a child throws', () => {
    // React's error machinery logs the error - silence it so the test output
    // is readable. We still assert the fallback rendered.
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Boom message="render-error-detail" />
        </ErrorBoundary>,
      );

      // Default fallback uses the i18n key (installI18nMock returns the key).
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('errorBoundary.title')).toBeInTheDocument();
      expect(screen.getByText('errorBoundary.message')).toBeInTheDocument();
      expect(screen.getByText('render-error-detail')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'errorBoundary.refresh' })).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('honors a custom fallback render prop', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary fallback={(err) => <div data-testid="custom">{err.message}</div>}>
          <Boom message="custom-fallback-err" />
        </ErrorBoundary>,
      );

      expect(screen.getByTestId('custom')).toHaveTextContent('custom-fallback-err');
    } finally {
      consoleError.mockRestore();
    }
  });

  test('uses shadcn theme tokens in the default fallback', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );

      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('bg-background');
      expect(alert.className).toContain('text-foreground');
      // The card inside uses the card token + border-border.
      const card = alert.firstElementChild as HTMLElement;
      expect(card.className).toContain('bg-card');
      expect(card.className).toContain('border-border');
    } finally {
      consoleError.mockRestore();
    }
  });
});
