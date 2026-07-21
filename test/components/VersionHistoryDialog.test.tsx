import { describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { VersionHistoryDialog } from '../../components/shared/VersionHistoryDialog';

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
});
