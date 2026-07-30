import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { render } from '../helpers/render';

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { RevisionTitleDialog } = await import('../../components/shared/RevisionTitleDialog');
const { useRevisionTitlePrompt } = await import('../../components/shared/useRevisionTitlePrompt');

export function RevisionTitlePromptHarness() {
  const prompt = useRevisionTitlePrompt();
  const [result, setResult] = useState('');

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const nextResult = await prompt.requestRevisionTitle();
          setResult(
            nextResult.confirmed ? `confirmed:${nextResult.title ?? 'untitled'}` : 'cancelled',
          );
        }}
      >
        open-prompt
      </button>
      <output>{result}</output>
      <RevisionTitleDialog
        open={prompt.open}
        onOpenChange={prompt.onOpenChange}
        onConfirm={prompt.confirm}
      />
    </>
  );
}

describe('<RevisionTitleDialog />', () => {
  test('trims and returns an optional searchable title', async () => {
    render(<RevisionTitlePromptHarness />);

    fireEvent.click(screen.getByText('open-prompt'));
    const input = await screen.findByRole('textbox', {
      name: 'revisionTitleDialog.fieldLabel',
    });
    expect(input).toHaveAttribute('maxlength', '200');
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveStyle({ zIndex: '65' });
    expect(screen.getByRole('dialog')).toHaveStyle({ zIndex: '66' });
    fireEvent.change(input, { target: { value: '  Q3 renewal  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'revisionTitleDialog.confirm' }));

    await waitFor(() => expect(screen.getByText('confirmed:Q3 renewal')).toBeInTheDocument());
  });

  test('confirms an untitled revision when the optional field is blank', async () => {
    render(<RevisionTitlePromptHarness />);

    fireEvent.click(screen.getByText('open-prompt'));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'revisionTitleDialog.confirm',
      }),
    );

    await waitFor(() => expect(screen.getByText('confirmed:untitled')).toBeInTheDocument());
  });

  test('keeps the pending send cancelled when the dialog is dismissed', async () => {
    render(<RevisionTitlePromptHarness />);

    fireEvent.click(screen.getByText('open-prompt'));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'revisionTitleDialog.cancel',
      }),
    );

    await waitFor(() => expect(screen.getByText('cancelled')).toBeInTheDocument());
  });
});
