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
  previewBadge: 'Preview',
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
    expect(screen.getByRole('heading', { level: 4, name: labels.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.searchAriaLabel })).toBeInTheDocument();
    expect(screen.getByText(labels.currentBadge)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'REV 3' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'REV 2' })).toBeChecked();

    const list = screen.getByRole('radiogroup');
    expect(list.parentElement).toHaveClass('h-[calc(3*3.75rem+0.75rem)]');

    fireEvent.click(screen.getByRole('radio', { name: 'REV 1' }));
    expect(onSelect).toHaveBeenCalledWith(versionRows[2]);
  });

  test('reserves empty slots so the inline list stays three rows tall', () => {
    render(
      <VersionHistoryPanel
        {...baseProps}
        rows={versionRows.slice(0, 1)}
        selectedVersionId={null}
      />,
    );

    const list = screen.getByRole('radiogroup');
    expect(list.parentElement).toHaveClass('h-[calc(3*3.75rem+0.75rem)]');
    expect(screen.getAllByTestId('version-history-empty-slot')).toHaveLength(2);
  });

  test('does not preselect a history row when viewing the live document', async () => {
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

    expect(screen.getByRole('radio', { name: 'REV 3' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: labels.backToCurrent })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'REV 3' }));
    expect(onSelect).toHaveBeenCalledWith(versionRows[0]);
    expect(onClearPreview).not.toHaveBeenCalled();
  });

  test('selecting the newest history row previews it instead of clearing', () => {
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
    expect(onSelect).toHaveBeenCalledWith(versionRows[0]);
    expect(onClearPreview).not.toHaveBeenCalled();
  });

  test('shows a preview badge on the selected historical row', () => {
    render(
      <VersionHistoryPanel
        {...baseProps}
        rows={versionRows}
        selectedVersionId={versionRows[1].id}
      />,
    );

    expect(screen.getByText(labels.previewBadge)).toBeInTheDocument();
    expect(screen.getAllByText(labels.currentBadge)).toHaveLength(1);
  });

  test('expands search on the header row and filters the local list', async () => {
    const user = userEvent.setup();
    render(<VersionHistoryPanel {...baseProps} rows={versionRows} />);

    const header = screen.getByTestId('version-history-inline-header');
    const restingLayer = screen.getByTestId('version-history-header-resting');
    const searchLayer = screen.getByTestId('version-history-header-search');
    const searchToggle = screen.getByRole('button', { name: labels.searchAriaLabel });

    expect(header).toContainElement(restingLayer);
    expect(header).toContainElement(searchLayer);
    expect(restingLayer).toContainElement(searchToggle);
    expect(screen.getByText(labels.title)).toBeVisible();
    expect(restingLayer).toHaveClass('opacity-100');
    expect(searchLayer).toHaveClass('opacity-0', 'pointer-events-none');

    await user.click(searchToggle);
    expect(header).toHaveAttribute('data-search-open', 'true');
    const input = screen.getByPlaceholderText(labels.searchPlaceholder);
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(searchLayer).toContainElement(input);
    expect(restingLayer).toHaveClass('opacity-0', 'pointer-events-none');
    expect(searchLayer).toHaveClass('opacity-100');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    await user.type(input, 'bob');
    expect(screen.getByRole('radio', { name: 'REV 2' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'REV 3' })).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'zzz-none');
    expect(screen.getByText(labels.noResults)).toBeInTheDocument();

    fireEvent.blur(input);
    expect(header).toHaveAttribute('data-search-open', 'false');
    expect(restingLayer).toHaveClass('opacity-100');
    expect(searchLayer).toHaveClass('opacity-0', 'pointer-events-none');
    expect(screen.getByRole('radio', { name: 'REV 3' })).toBeInTheDocument();
    expect(screen.queryByText(labels.noResults)).not.toBeInTheDocument();
  });

  test('crossfades resting and search header layers in sync', async () => {
    const user = userEvent.setup();
    render(<VersionHistoryPanel {...baseProps} rows={versionRows} />);

    const header = screen.getByTestId('version-history-inline-header');
    const restingLayer = screen.getByTestId('version-history-header-resting');
    const searchLayer = screen.getByTestId('version-history-header-search');
    const searchToggle = screen.getByTestId('version-history-search-toggle');

    expect(header).toHaveAttribute('data-search-open', 'false');
    expect(restingLayer).toHaveClass('opacity-100', 'duration-200', 'ease-in-out');
    expect(searchLayer).toHaveClass(
      'opacity-0',
      'pointer-events-none',
      'duration-200',
      'ease-in-out',
    );
    expect(restingLayer).toContainElement(screen.getByTestId('version-history-search-icon'));
    expect(searchLayer).toContainElement(screen.getByTestId('version-history-close-icon'));

    await user.click(searchToggle);
    expect(header).toHaveAttribute('data-search-open', 'true');
    expect(restingLayer).toHaveClass('opacity-0', 'pointer-events-none');
    expect(searchLayer).toHaveClass('opacity-100');

    const input = screen.getByPlaceholderText(labels.searchPlaceholder);
    fireEvent.blur(input);

    expect(header).toHaveAttribute('data-search-open', 'false');
    expect(restingLayer).toHaveClass('opacity-100');
    expect(searchLayer).toHaveClass('opacity-0', 'pointer-events-none');
    expect(screen.getByRole('button', { name: labels.searchAriaLabel })).toBe(searchToggle);
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

  test('uses a taller scroll area in dialog layout without search chrome', () => {
    render(<VersionHistoryPanel {...baseProps} layout="dialog" rows={versionRows} />);

    const list = screen.getByRole('radiogroup');
    expect(list.parentElement).toHaveClass('max-h-[min(24rem,50vh)]');
    expect(screen.queryByRole('button', { name: labels.searchAriaLabel })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(labels.searchPlaceholder)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.infoTooltip })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4, name: labels.title })).not.toBeInTheDocument();
    expect(screen.queryByText(String(versionRows.length))).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: labels.title })).not.toHaveClass('border');
  });

  test('exposes an info tooltip when provided', async () => {
    render(<VersionHistoryPanel {...baseProps} rows={versionRows} />);
    const infoButton = screen.getByRole('button', { name: labels.infoTooltip });
    await userEvent.hover(infoButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(labels.infoTooltip);
  });
});
