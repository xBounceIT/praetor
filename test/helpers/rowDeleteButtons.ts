import { within } from '@testing-library/react';

/**
 * Returns the per-row trash buttons inside an edit dialog. The control labels
 * itself via an sr-only span (whose text the test environment's accessible-name
 * computation does not surface), and once a confirmation opens Radix marks the
 * underlying edit dialog aria-hidden — so match on the icon and include hidden
 * nodes to keep counting the rows behind the prompt.
 */
export const rowDeleteButtons = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('button', { hidden: true })
    .filter((button) => button.querySelector('.fa-trash-can'));
