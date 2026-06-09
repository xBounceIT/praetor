import type { ReactNode } from 'react';

/**
 * Deterministic stand-in for the shared DeleteConfirmModal used by the line-item
 * deletion suites. Other suites stub that component process-wide via Bun's
 * `mock.module` (last-write-wins), so each line-item deletion suite installs this
 * stub against its own SUT binding. The `mock.module(path, ...)` call must stay in
 * the test file (Bun resolves the path relative to the caller and binds at the
 * caller's first import), so this module owns only the path-independent stub body.
 */
export const LineDeleteConfirmStub = ({
  isOpen,
  onConfirm,
  onClose,
  title,
}: {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
  title?: ReactNode;
}) =>
  isOpen ? (
    <div data-testid="line-delete-confirm">
      <span data-testid="line-delete-title">{title}</span>
      <button type="button" data-testid="line-delete-cancel" onClick={onClose}>
        cancel
      </button>
      <button type="button" data-testid="line-delete-confirm-btn" onClick={onConfirm}>
        confirm
      </button>
    </div>
  ) : null;
