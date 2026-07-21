import { describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { VersionHistoryDialog } from '../../components/shared/VersionHistoryDialog';

describe('<VersionHistoryDialog />', () => {
  test('stacks above the default document modal z-index', () => {
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
    expect(content).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(content?.style.zIndex).toBe('66');
    expect(overlay?.style.zIndex).toBe('65');
    expect(screen.getByText('panel')).toBeInTheDocument();
    expect(screen.getByText('Save history')).toBeInTheDocument();
    cleanup();
  });
});
