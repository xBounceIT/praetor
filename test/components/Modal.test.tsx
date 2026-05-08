import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';

const Modal = (await import('../../components/shared/Modal')).default;

describe('<Modal />', () => {
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
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('clicking the backdrop calls onClose', () => {
    const onClose = mock(() => {});
    render(
      <Modal isOpen={true} onClose={onClose}>
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    const backdrop = screen.getByTestId('modal-content').parentElement as HTMLElement;
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
    const backdrop = screen.getByTestId('modal-content').parentElement as HTMLElement;
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
    const backdrop = screen.getByTestId('modal-content').parentElement as HTMLElement;
    expect(backdrop.style.zIndex).toBe('999');
  });

  test('custom backdropClass is applied', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} backdropClass="custom-backdrop">
        <div data-testid="modal-content">Hi</div>
      </Modal>,
    );
    const backdrop = screen.getByTestId('modal-content').parentElement as HTMLElement;
    expect(backdrop.className).toContain('custom-backdrop');
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
