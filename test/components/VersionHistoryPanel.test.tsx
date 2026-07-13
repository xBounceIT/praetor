import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VersionHistoryPanel } from '../../components/shared/VersionHistoryPanel';
import { render } from '../helpers/render';

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
  test('delays vertical expansion until the width transition finishes', async () => {
    const css = await Bun.file(new URL('../../src/index.css', import.meta.url)).text();

    expect(css).toMatch(
      /\.version-history-viewport\s*{[^}]*display: grid;[^}]*grid-template-rows: 0fr;[^}]*grid-template-rows 200ms ease-in-out,/s,
    );
    expect(css).toMatch(
      /\.version-history-content\[data-state="open"\] > \.version-history-viewport\s*{[^}]*grid-template-rows: 1fr;[^}]*transition-delay: 200ms;/s,
    );
    expect(css).toMatch(
      /\.version-history-content\[data-state="closed"\] > \.version-history-viewport\s*{\s*transition-delay: 0ms;/,
    );
    expect(css).not.toContain('@keyframes version-history-content');
  });

  test('sequences width and height, reverses the arrow position, and uses a shadcn tooltip', async () => {
    const { container } = render(
      <VersionHistoryPanel {...baseProps} rows={[versionRow]} selectedVersionId={versionRow.id} />,
    );
    const panel = container.querySelector('[data-slot="collapsible"]');
    const trigger = screen.getByRole('button', { name: labels.title });
    const content = container.querySelector('[data-slot="collapsible-content"]');

    expect(panel).toHaveClass('w-72');
    expect(panel).toHaveClass('delay-0');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).not.toHaveAttribute('title');
    expect(trigger).toHaveClass('h-12', 'w-full');
    expect(trigger.querySelector('.fa-chevron-left')).toBeInTheDocument();
    expect(content).toHaveClass('version-history-content');
    expect(content).not.toHaveClass('flex-1');
    expect(content?.firstElementChild).toHaveClass('version-history-viewport');
    expect(content?.firstElementChild?.firstElementChild).toHaveClass('min-h-0', 'overflow-hidden');
    expect(content?.firstElementChild?.firstElementChild?.firstElementChild).toHaveClass(
      'max-h-[calc(90vh-3rem)]',
    );
    expect(content?.firstElementChild?.firstElementChild?.firstElementChild).not.toHaveClass(
      'h-full',
    );
    expect(content).toHaveAttribute('aria-hidden', 'false');
    expect(content).not.toHaveAttribute('inert');
    expect(screen.getByText(labels.reasonUpdate)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.restoreButton })).toBeInTheDocument();

    await userEvent.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(labels.title);
    await userEvent.unhover(trigger);

    fireEvent.click(trigger);

    expect(panel).toHaveClass('w-12');
    expect(panel).toHaveClass('delay-200');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveClass('h-12', 'w-full');
    expect(trigger.querySelector('.fa-chevron-right')).toBeInTheDocument();
    expect(content).toHaveAttribute('aria-hidden', 'true');
    expect(content).toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: labels.restoreButton })).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(panel).toHaveClass('w-72');
    expect(panel).toHaveClass('delay-0');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger.querySelector('.fa-chevron-left')).toBeInTheDocument();
    expect(content).toHaveAttribute('aria-hidden', 'false');
    expect(content).not.toHaveAttribute('inert');
    expect(screen.getByText(labels.reasonUpdate)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.restoreButton })).toBeInTheDocument();
  });
});
