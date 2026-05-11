import { describe, expect, test } from 'bun:test';

const readSource = () =>
  Bun.file(new URL('../../../components/shared/DeleteConfirmModal.tsx', import.meta.url)).text();

describe('<DeleteConfirmModal /> loading prop', () => {
  test('exposes an optional loading prop with a default of false', async () => {
    const source = await readSource();

    // Type signature exposes a loading prop.
    expect(source).toMatch(/loading\?:\s*boolean;/);
    // Defaults to false when not provided so existing callers are unaffected.
    expect(source).toMatch(/loading\s*=\s*false,/);
  });

  test('disables both buttons and blocks dismissal while loading', async () => {
    const source = await readSource();

    // Confirm + Cancel buttons receive disabled={loading}.
    expect(source).toMatch(/onClick={onClose}\s+disabled={loading}/);
    expect(source).toMatch(/onClick={onConfirm}\s+disabled={loading}/);

    // While loading, the backdrop close handler is a no-op so the dialog can't be dismissed.
    expect(source).toContain('onClose={loading ? () => {} : onClose}');
  });

  test('renders a spinner inside the confirm label while loading', async () => {
    const source = await readSource();

    // Spinner is rendered conditionally on `loading`.
    expect(source).toMatch(/\{loading\s*&&\s*<i\s+className="fa-solid fa-circle-notch fa-spin"/);
  });
});
