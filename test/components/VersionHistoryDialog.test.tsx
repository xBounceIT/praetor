import { describe, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { act, useEffect } from 'react';
import {
  useVersionHistoryDialogOpen,
  VersionHistoryDialog,
} from '../../components/shared/VersionHistoryDialog';
import { VersionHistoryPanel } from '../../components/shared/VersionHistoryPanel';

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
];

describe('<VersionHistoryDialog />', () => {
  test('uses the shared Modal shell above the document modal z-index', () => {
    render(
      <VersionHistoryDialog
        open
        onOpenChange={() => {}}
        title="Version History"
        description="Save history"
      >
        <div>panel</div>
      </VersionHistoryDialog>,
    );

    const content = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
    const overlay = document.body.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    const modalCard = document.body.querySelector<HTMLElement>('[data-slot="modal-content"]');
    expect(content).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(modalCard).not.toBeNull();
    expect(content?.style.zIndex).toBe('66');
    expect(overlay?.style.zIndex).toBe('65');
    expect(screen.getByRole('heading', { name: 'Version History' })).toBeInTheDocument();
    expect(screen.getByText('Save history')).toBeInTheDocument();
    expect(screen.getByText('panel')).toBeInTheDocument();
    cleanup();
  });

  test('shows the row count badge beside the close button', () => {
    render(
      <VersionHistoryDialog open onOpenChange={() => {}} title="Version History">
        <VersionHistoryPanel
          layout="dialog"
          rows={versionRows}
          selectedVersionId={null}
          isLoading={false}
          error={null}
          locale="en"
          labels={labels}
          onSelect={() => {}}
          onClearPreview={() => {}}
          onRestore={() => {}}
        />
      </VersionHistoryDialog>,
    );

    expect(screen.getByText(String(versionRows.length))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.searchAriaLabel })).not.toBeInTheDocument();
    cleanup();
  });

  test('useVersionHistoryDialogOpen clears a version preview when the dialog closes', () => {
    const onClearVersionPreview = mock(() => {});
    type DialogOpenApi = ReturnType<typeof useVersionHistoryDialogOpen>;
    const apiRef: { current: DialogOpenApi | null } = { current: null };

    function Probe({ selectedVersionId }: { selectedVersionId: string | null }) {
      const value = useVersionHistoryDialogOpen(selectedVersionId, onClearVersionPreview);
      useEffect(() => {
        apiRef.current = value;
      }, [value]);
      return null;
    }

    const { rerender } = render(<Probe selectedVersionId="qv-1" />);
    expect(apiRef.current).not.toBeNull();

    act(() => {
      apiRef.current?.onOpenChange(true);
    });
    rerender(<Probe selectedVersionId="qv-1" />);
    expect(apiRef.current?.open).toBe(true);
    expect(onClearVersionPreview).not.toHaveBeenCalled();

    act(() => {
      apiRef.current?.onOpenChange(false);
    });
    expect(onClearVersionPreview).toHaveBeenCalledTimes(1);

    onClearVersionPreview.mockClear();
    rerender(<Probe selectedVersionId={null} />);
    act(() => {
      apiRef.current?.onOpenChange(true);
      apiRef.current?.onOpenChange(false);
    });
    expect(onClearVersionPreview).not.toHaveBeenCalled();
    cleanup();
  });
});
