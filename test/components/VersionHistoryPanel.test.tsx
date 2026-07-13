import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { VersionHistoryPanel } from '../../components/shared/VersionHistoryPanel';

const labels = {
  title: 'Version history',
  empty: 'No versions',
  reasonRestore: 'Restored',
  reasonUpdate: 'Saved',
  backToCurrent: 'Back to current',
  restoreButton: 'Restore',
};

const versionRow = {
  id: 'version-1',
  createdAt: 1_700_000_000_000,
  reason: 'update' as const,
};

const baseProps = {
  rows: [],
  selectedVersionId: null,
  isLoading: false,
  error: null,
  locale: 'en',
  labels,
  onSelect: mock(() => {}),
  onClearPreview: mock(() => {}),
  onRestore: mock(() => {}),
};

describe('<VersionHistoryPanel />', () => {
  test('collapses to a compact tab and restores its selected version actions when reopened', () => {
    const { container } = render(
      <VersionHistoryPanel {...baseProps} rows={[versionRow]} selectedVersionId={versionRow.id} />,
    );
    const panel = container.querySelector('[data-slot="collapsible"]');
    const trigger = screen.getByRole('button', { name: labels.title });

    expect(panel).toHaveClass('w-72');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(labels.reasonUpdate)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.restoreButton })).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(panel).toHaveClass('w-12');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(labels.reasonUpdate)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.restoreButton })).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(panel).toHaveClass('w-72');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(labels.reasonUpdate)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.restoreButton })).toBeInTheDocument();
  });
});
