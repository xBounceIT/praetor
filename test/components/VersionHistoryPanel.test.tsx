import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VersionHistoryPanel } from '../../components/shared/VersionHistoryPanel';
import { render } from '../helpers/render';

const labels = {
  title: 'Revision history',
  empty: 'No versions',
  reasonRestore: 'Restored',
  reasonUpdate: 'Saved',
  backToCurrent: 'Back to current',
  restoreButton: 'Restore',
  searchPlaceholder: 'Search revisions…',
  searchAriaLabel: 'Search revisions',
  noResults: 'No revisions match your search',
  currentBadge: 'Current',
  infoTooltip: 'Immutable sent snapshots.',
};

const versionRows = [
  {
    id: 'version-1',
    createdAt: 1_700_000_000_000,
    reason: 'update' as const,
    revisionCode: 'REV 3',
    createdByUserName: 'Alice',
  },
  {
    id: 'version-2',
    createdAt: 1_690_000_000_000,
    reason: 'update' as const,
    revisionCode: 'REV 2',
    createdByUserName: 'Bob',
  },
  {
    id: 'version-3',
    createdAt: 1_680_000_000_000,
    reason: 'restore' as const,
    revisionCode: 'REV 1',
    createdByUserName: 'Carol',
  },
  {
    id: 'version-4',
    createdAt: 1_670_000_000_000,
    reason: 'update' as const,
    revisionCode: 'REV 0',
    createdByUserName: 'Dave',
  },
];

const baseProps = {
  rows: [] as typeof versionRows,
  selectedVersionId: null as string | null,
  isLoading: false,
  error: null as string | null,
  locale: 'en',
  labels,
  onSelect: mock(() => {}),
  onClearPreview: mock(() => {}),
  onRestore: mock(() => {}),
};

describe('<VersionHistoryPanel />', () => {
  test('renders an inline section with search toggle and radio selection', async () => {
    const onSelect = mock(() => {});
    render(
      <VersionHistoryPanel
        {...baseProps}
        rows={versionRows}
        selectedVersionId={versionRows[1].id}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole('region', { name: labels.title })).toBeInTheDocument();
    expect(screen.getByText(labels.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.searchAriaLabel })).toBeInTheDocument();
    expect(screen.getByText(labels.currentBadge)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'REV 3' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'REV 2' })).toBeChecked();

    const list = screen.getByRole('radiogroup');
    expect(list.parentElement).toHaveClass('max-h-[calc(3*3.25rem)]');

    fireEvent.click(screen.getByRole('radio', { name: 'REV 1' }));
    expect(onSelect).toHaveBeenCalledWith(versionRows[2]);
  });

  test('checks the current row by default when nothing is previewed', async () => {
    const onSelect = mock(() => {});
    const onClearPreview = mock(() => {});
    render(
      <VersionHistoryPanel
        {...baseProps}
        rows={versionRows}
        selectedVersionId={null}
        onSelect={onSelect}
        onClearPreview={onClearPreview}
      />,
    );

    expect(screen.getByRole('radio', { name: 'REV 3' })).toBeChecked();
    expect(screen.queryByRole('button', { name: labels.backToCurrent })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'REV 3' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClearPreview).not.toHaveBeenCalled();
  });

  test('selecting the current row clears an active preview', () => {
    const onSelect = mock(() => {});
    const onClearPreview = mock(() => {});
    render(
      <VersionHistoryPanel
        {...baseProps}
        rows={versionRows}
        selectedVersionId={versionRows[1].id}
        onSelect={onSelect}
        onClearPreview={onClearPreview}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'REV 3' }));
    expect(onClearPreview).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('expands search on the header row and filters the local list', async () => {
    const user = userEvent.setup();
    render(<VersionHistoryPanel {...baseProps} rows={versionRows} />);

    const searchToggle = screen.getByRole('button', { name: labels.searchAriaLabel });
    const header = searchToggle.parentElement;
    expect(header).not.toBeNull();
    expect(screen.getByText(labels.title)).toBeVisible();

    await user.click(searchToggle);
    const input = screen.getByPlaceholderText(labels.searchPlaceholder);
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(header?.contains(input)).toBe(true);
    expect(screen.getByText(labels.title)).toHaveClass('opacity-0', 'max-w-0');

    await user.type(input, 'bob');
    expect(screen.getByRole('radio', { name: 'REV 2' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'REV 3' })).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'zzz-none');
    expect(screen.getByText(labels.noResults)).toBeInTheDocument();
  });

  test('shows restore actions and optional secondary action', async () => {
    const onSecondary = mock(() => {});
    render(
      <VersionHistoryPanel
        {...baseProps}
        rows={versionRows}
        selectedVersionId={versionRows[0].id}
        secondaryAction={{ label: 'Open version history', onClick: onSecondary }}
      />,
    );

    expect(screen.getByRole('button', { name: labels.backToCurrent })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.restoreButton })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open version history' }));
    expect(onSecondary).toHaveBeenCalled();
  });

  test('uses a taller scroll area in dialog layout', () => {
    render(<VersionHistoryPanel {...baseProps} layout="dialog" rows={versionRows} />);

    const list = screen.getByRole('radiogroup');
    expect(list.parentElement).toHaveClass('max-h-[min(24rem,50vh)]');
    expect(screen.queryByRole('button', { name: labels.infoTooltip })).not.toBeInTheDocument();
    expect(screen.queryByText(labels.title)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: labels.title })).not.toHaveClass('border');
  });

  test('exposes an info tooltip when provided', async () => {
    render(<VersionHistoryPanel {...baseProps} rows={versionRows} />);
    const infoButton = screen.getByRole('button', { name: labels.infoTooltip });
    await userEvent.hover(infoButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(labels.infoTooltip);
  });
});
