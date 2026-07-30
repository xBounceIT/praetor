import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../helpers/render';

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { RevisionTitleDialog } = await import('../../components/shared/RevisionTitleDialog');

describe('<RevisionTitleDialog />', () => {
  test('loads the current title and submits its trimmed replacement', () => {
    const onConfirm = mock((_title: string) => {});
    render(
      <RevisionTitleDialog
        open
        initialTitle="Existing title"
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const input = screen.getByRole('textbox', {
      name: 'revisionTitleDialog.fieldLabel',
    });
    expect(input).toHaveValue('Existing title');
    expect(input).toHaveAttribute('maxlength', '200');
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveStyle({ zIndex: '65' });
    expect(screen.getByRole('dialog')).toHaveStyle({ zIndex: '66' });

    fireEvent.change(input, { target: { value: '  Q3 renewal  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'revisionTitleDialog.confirm' }));

    expect(onConfirm).toHaveBeenCalledWith('Q3 renewal');
  });

  test('submits an empty title so the history can restore its fallback label', () => {
    const onConfirm = mock((_title: string) => {});
    render(
      <RevisionTitleDialog
        open
        initialTitle="Existing title"
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'revisionTitleDialog.fieldLabel',
      }),
      { target: { value: '   ' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'revisionTitleDialog.confirm' }));

    expect(onConfirm).toHaveBeenCalledWith('');
  });

  test('keeps the dialog locked and exposes the save error while updating', () => {
    render(
      <RevisionTitleDialog
        open
        initialTitle={null}
        isSaving
        error="Could not save"
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'revisionTitleDialog.cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'revisionTitleDialog.saving' })).toBeDisabled();
  });
});
