import { afterEach, describe, expect, mock, test } from 'bun:test';
import { readTextFromClipboard, writeTextToClipboard } from '../../utils/clipboard';

// Save the original `navigator.clipboard` so each test can restore it cleanly,
// regardless of whether happy-dom provided a real one or it's undefined.
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

describe('writeTextToClipboard', () => {
  afterEach(() => {
    restoreClipboard();
  });

  test('uses navigator.clipboard.writeText when available and resolves to true', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    setClipboard({ writeText });

    const ok = await writeTextToClipboard('hello');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  test('returns false when clipboard.writeText rejects', async () => {
    const writeText = mock((_text: string) => Promise.reject(new Error('denied')));
    setClipboard({ writeText });

    const ok = await writeTextToClipboard('hello');
    expect(ok).toBe(false);
  });

  test('falls back to document.execCommand when navigator.clipboard is unavailable', async () => {
    setClipboard(undefined);
    const execCommand = mock((_cmd: string) => true);
    const original = document.execCommand;
    document.execCommand = execCommand as unknown as typeof document.execCommand;

    try {
      const ok = await writeTextToClipboard('fallback-text');
      expect(ok).toBe(true);
      expect(execCommand).toHaveBeenCalledWith('copy');
      // The temporary textarea should have been removed from the DOM.
      const textareas = document.body.querySelectorAll('textarea');
      expect(textareas.length).toBe(0);
    } finally {
      document.execCommand = original;
    }
  });

  test('returns false when execCommand reports failure in the fallback path', async () => {
    setClipboard(undefined);
    const original = document.execCommand;
    document.execCommand = (() => false) as unknown as typeof document.execCommand;

    try {
      const ok = await writeTextToClipboard('x');
      expect(ok).toBe(false);
    } finally {
      document.execCommand = original;
    }
  });

  test('falls back when navigator.clipboard exists but lacks writeText', async () => {
    setClipboard({}); // present, but no writeText
    const original = document.execCommand;
    document.execCommand = (() => true) as unknown as typeof document.execCommand;

    try {
      const ok = await writeTextToClipboard('hi');
      expect(ok).toBe(true);
    } finally {
      document.execCommand = original;
    }
  });
});

describe('readTextFromClipboard', () => {
  afterEach(() => {
    restoreClipboard();
  });

  test('returns { ok: true, text } on success', async () => {
    setClipboard({ readText: () => Promise.resolve('clipboard contents') });
    const result = await readTextFromClipboard();
    expect(result).toEqual({ ok: true, text: 'clipboard contents' });
  });

  test('returns "unavailable" when navigator.clipboard is missing', async () => {
    setClipboard(undefined);
    const result = await readTextFromClipboard();
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('returns "unavailable" when navigator.clipboard exists but lacks readText', async () => {
    setClipboard({});
    const result = await readTextFromClipboard();
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('returns "denied" when readText rejects (permission error)', async () => {
    setClipboard({ readText: () => Promise.reject(new Error('NotAllowedError')) });
    const result = await readTextFromClipboard();
    expect(result).toEqual({ ok: false, reason: 'denied' });
  });
});
