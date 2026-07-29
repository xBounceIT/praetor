import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

const toastSuccessMock = mock((_message: string, _options?: unknown) => undefined);
const toastErrorMock = mock((_message: string, _options?: unknown) => undefined);
const toastWarningMock = mock((_message: string, _options?: unknown) => undefined);

mock.module('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: toastWarningMock,
  },
}));

clearSpyStateAfterAll();

const { toastError, toastSuccess, toastWarning } = await import('../../utils/toast');
const { appErrorToastClassNames, appSuccessToastClassNames, appWarningToastClassNames } =
  await import('../../components/ui/sonner-presets');

describe('utils/toast', () => {
  beforeEach(() => {
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    toastWarningMock.mockClear();
  });

  test('applies the shared success classNames used by offer conversion', () => {
    toastSuccess('Preferito salvato.', { description: 'Report A' });

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [message, options] = toastSuccessMock.mock.calls[0] ?? [];
    expect(message).toBe('Preferito salvato.');
    expect((options as { description?: string }).description).toBe('Report A');
    expect((options as { classNames: { toast: string } }).classNames.toast).toContain(
      'bg-primary!',
    );
    expect((options as { classNames: typeof appSuccessToastClassNames }).classNames.toast).toBe(
      appSuccessToastClassNames.toast,
    );
  });

  test('applies the shared error and warning classNames', () => {
    toastError('Failed');
    toastWarning('Sanitized');

    expect(
      (toastErrorMock.mock.calls[0]?.[1] as { classNames: typeof appErrorToastClassNames })
        .classNames.toast,
    ).toBe(appErrorToastClassNames.toast);
    expect(
      (toastWarningMock.mock.calls[0]?.[1] as { classNames: typeof appWarningToastClassNames })
        .classNames.toast,
    ).toBe(appWarningToastClassNames.toast);
  });
});
