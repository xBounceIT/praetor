import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Returns direct delete buttons or StandardTable row-action triggers inside an edit dialog. */
export const rowDeleteButtons = (dialog: HTMLElement) => {
  const directDeleteButtons = within(dialog)
    .queryAllByRole('button', { hidden: true })
    .filter((button) => button.querySelector('.fa-trash-can'));

  if (directDeleteButtons.length > 0) return directDeleteButtons;

  return within(dialog)
    .queryAllByLabelText('table.rowActions')
    .filter((trigger) => trigger.closest('table')?.querySelector('input, [role="combobox"]'));
};

/** Opens a row action menu and returns its delete action. */
export const openRowDeleteButton = async (dialog: HTMLElement, index = 0) => {
  const triggers = rowDeleteButtons(dialog);
  const trigger = triggers[index];
  if (!trigger) throw new Error(`Row action trigger ${index} not found`);
  if (trigger.querySelector('.fa-trash-can')) return trigger as HTMLButtonElement;
  await userEvent.setup().click(trigger);

  let deleteButton: HTMLButtonElement | null = null;
  await waitFor(() => {
    const menus = document.querySelectorAll('[data-standard-table-action-menu="true"]');
    deleteButton =
      Array.from(menus)
        .map((menu) => menu.querySelector('.fa-trash-can')?.closest('button') ?? null)
        .find((button): button is HTMLButtonElement => button instanceof HTMLButtonElement) ?? null;
    if (!deleteButton) throw new Error('Delete row action not found');
  });
  if (!deleteButton) throw new Error('Delete row action not found');
  return deleteButton;
};
