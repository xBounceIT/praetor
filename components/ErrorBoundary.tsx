import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Optional render override for the fallback. Receives the captured error so
   * consumers (mainly tests) can assert on it. When omitted the default
   * shadcn-themed fallback is rendered.
   */
  fallback?: (error: Error) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

interface ErrorBoundaryFallbackProps {
  error: Error;
  onRefresh: () => void;
}

const ErrorBoundaryFallback: React.FC<ErrorBoundaryFallbackProps> = ({ error, onRefresh }) => {
  const { t } = useTranslation('common');

  return (
    <div
      role="alert"
      className="min-h-[60vh] flex items-center justify-center bg-background text-foreground px-4"
    >
      <div className="max-w-md w-full rounded-lg border border-border bg-card text-card-foreground shadow-sm p-6 text-center">
        <h2 className="text-xl font-semibold mb-2">{t('errorBoundary.title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('errorBoundary.message')}</p>
        {error.message ? (
          <pre className="mb-4 max-h-32 overflow-auto rounded-md border border-border bg-muted px-3 py-2 text-left text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        ) : null}
        <Button type="button" onClick={onRefresh}>
          {t('errorBoundary.refresh')}
        </Button>
      </div>
    </div>
  );
};

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the stack out of the user-facing fallback, but log so devs can see it.
    console.error('ErrorBoundary caught an error:', error, info);
  }

  private readonly handleRefresh = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    } else {
      this.setState({ error: null });
    }
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error);
      return <ErrorBoundaryFallback error={error} onRefresh={this.handleRefresh} />;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
