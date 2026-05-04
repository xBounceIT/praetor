// Write text to the system clipboard. Falls back to a hidden textarea +
// `document.execCommand('copy')` when `navigator.clipboard` is unavailable
// (older browsers, plain-HTTP origins). Returns `false` on failure so
// callers can surface user-visible feedback.
export const writeTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
};

// Read text from the system clipboard. Returns `null` when the API is
// unavailable, `false` when the user denies permission, and the text on
// success. Caller distinguishes the two failure modes for messaging.
export type ClipboardReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'unavailable' | 'denied' };

export const readTextFromClipboard = async (): Promise<ClipboardReadResult> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return { ok: false, reason: 'unavailable' };
  }
  try {
    const text = await navigator.clipboard.readText();
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'denied' };
  }
};

export const isClipboardWriteSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText;

export const isClipboardReadSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
