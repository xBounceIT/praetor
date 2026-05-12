import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopyButton } from '../../components/ui/copy-button';

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  'clipboard',
);

const setClipboard = (clipboard: unknown) => {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: clipboard,
  });
};

const restoreClipboard = () => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  }
};

const clickAndFlush = (button: Element) =>
  act(async () => {
    fireEvent.click(button);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

describe('<CopyButton />', () => {
  let writeText: ReturnType<typeof mock<(text: string) => Promise<void>>>;

  beforeEach(() => {
    writeText = mock((_text: string) => Promise.resolve());
    setClipboard({ writeText });
  });

  afterEach(() => {
    restoreClipboard();
    cleanup();
  });

  test('renders the default label and swaps to the copied label after click', async () => {
    render(<CopyButton value="hello" label="Copy" copiedLabel="Copied!" />);

    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button).toBeInTheDocument();

    await clickAndFlush(button);

    expect(writeText).toHaveBeenCalledWith('hello');
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Copied!');
    });
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  test('reverts to the default label after resetMs elapses', async () => {
    render(<CopyButton value="x" label="Copy" copiedLabel="Done" resetMs={50} />);

    await clickAndFlush(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Done'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copy'), {
      timeout: 500,
    });
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });

  test('invokes onCopyError and does NOT enter the copied state when clipboard write fails', async () => {
    setClipboard({ writeText: (_t: string) => Promise.reject(new Error('denied')) });
    // Force the execCommand fallback to also fail so writeTextToClipboard returns false.
    const originalExec = document.execCommand;
    document.execCommand = (() => false) as unknown as typeof document.execCommand;

    const onCopyError = mock((_err: unknown) => {});
    try {
      render(<CopyButton value="x" label="Copy" copiedLabel="Copied!" onCopyError={onCopyError} />);
      await clickAndFlush(screen.getByRole('button'));
      await waitFor(() => expect(onCopyError).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button')).toHaveTextContent('Copy');
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
    } finally {
      document.execCommand = originalExec;
    }
  });

  test('iconOnly mode hides text and uses aria-label for accessibility', async () => {
    render(<CopyButton iconOnly value="abc" aria-label="Copy message" />);

    const button = screen.getByRole('button', { name: 'Copy message' });
    expect(button).toBeInTheDocument();
    expect(button.textContent).toBe('');

    await clickAndFlush(button);

    expect(writeText).toHaveBeenCalledWith('abc');
  });

  test('function value resolves the text to copy at click time', async () => {
    let invocationCount = 0;
    const resolver = () => {
      invocationCount += 1;
      return `dynamic-${invocationCount}`;
    };

    render(<CopyButton value={resolver} label="Copy" copiedLabel="Copied!" resetMs={50} />);

    await clickAndFlush(screen.getByRole('button'));

    expect(writeText).toHaveBeenCalledWith('dynamic-1');
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied!'));
  });

  test('function value returning null aborts — no clipboard write, no copied state', async () => {
    render(<CopyButton value={() => null} label="Copy" copiedLabel="Copied!" />);

    await clickAndFlush(screen.getByRole('button'));

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveTextContent('Copy');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });

  test('external disabled prop blocks the click and lets shadcn disabled styling apply', async () => {
    render(<CopyButton disabled value="x" label="Copy" copiedLabel="Copied!" />);

    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // The opacity-100 override must only apply during the copied state, not when
    // the caller has explicitly disabled the button. Otherwise a disabled
    // CopyButton looks identical to an enabled one.
    expect(button.className).not.toContain('disabled:opacity-100');

    await clickAndFlush(button);
    expect(writeText).not.toHaveBeenCalled();
  });
});
