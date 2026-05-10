import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { THEME_STORAGE_KEY } = await import('../../utils/theme');
const Modal = (await import('../../components/shared/Modal')).default;

describe('<Modal />', () => {
  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  test('renders nothing when isOpen is false', () => {
    render(
      <Modal isOpen={false} onClose={() => {}}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    expect(screen.queryByTestId('modal-content')).toBeNull();
  });

  test('renders children inside a portal when isOpen is true', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    expect(screen.getByTestId('modal-content')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('focuses the first focusable child when opened', async () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div data-testid="modal-content">
          <input aria-label="Name" />
        </div>
      </Modal>,
    );

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
  });

  test('prefers data-autofocus over the first focusable child', async () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div data-testid="modal-content">
          <button type="button">First</button>
          <input aria-label="Preferred" data-autofocus />
        </div>
      </Modal>,
    );

    await waitFor(() => expect(screen.getByLabelText('Preferred')).toHaveFocus());
  });

  test('normalizes raw modal form elements through shadcn primitives', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div>
          <label htmlFor="modal-name">Name</label>
          <input id="modal-name" />
          <textarea aria-label="Notes" />
          <button type="button">Save</button>
        </div>
      </Modal>,
    );

    expect(screen.getByText('Name').getAttribute('data-slot')).toBe('field-label');
    expect(screen.getByLabelText('Name').getAttribute('data-slot')).toBe('input');
    expect(screen.getByLabelText('Notes').getAttribute('data-slot')).toBe('textarea');
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('data-slot')).toBe('button');
  });

  test('does not normalize checkbox inputs or wrapper labels', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <label>
          <input type="checkbox" aria-label="Enabled" />
          Enabled
        </label>
      </Modal>,
    );

    expect(screen.getByLabelText('Enabled').getAttribute('data-slot')).toBeNull();
    expect(screen.getByText('Enabled').getAttribute('data-slot')).toBeNull();
  });

  test('clicking the backdrop calls onClose', () => {
    const onClose = mock(() => {});
    render(
      <Modal isOpen={true} onClose={onClose}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    const backdrop = document.body.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('clicking inside the modal content does not call onClose', () => {
    const onClose = mock(() => {});
    render(
      <Modal isOpen={true} onClose={onClose}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('modal-content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('closeOnBackdrop=false prevents backdrop close', () => {
    const onClose = mock(() => {});
    render(
      <Modal isOpen={true} onClose={onClose} closeOnBackdrop={false}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    const backdrop = document.body.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Escape key calls onClose by default', () => {
    const onClose = mock(() => {});
    render(
      <Modal isOpen={true} onClose={onClose}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('non-Escape keys do not call onClose', () => {
    const onClose = mock(() => {});
    render(
      <Modal isOpen={true} onClose={onClose}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('closeOnEsc=false ignores Escape key', () => {
    const onClose = mock(() => {});
    render(
      <Modal isOpen={true} onClose={onClose} closeOnEsc={false}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('custom zIndex is applied to backdrop style', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} zIndex={999}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    const backdrop = document.body.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    const dialog = screen.getByRole('dialog');
    expect(backdrop.style.zIndex).toBe('999');
    expect(dialog.style.zIndex).toBe('1000');
  });

  test('custom backdropClass is applied', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} backdropClass="custom-backdrop">
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    const backdrop = document.body.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    expect(backdrop.className).toContain('custom-backdrop');
  });

  test('portaled content carries the resolved shadcn theme scope', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-shadcn-theme-scope')).toBe('');
    expect(dialog.getAttribute('data-shadcn-theme')).toBe('dark');
    expect(dialog.className).toContain('dark');
  });

  test('unmounting restores body overflow', () => {
    const { unmount } = render(
      <Modal isOpen={true} onClose={() => {}}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
