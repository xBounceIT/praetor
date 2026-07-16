import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const pngBlob = new Blob(['png'], { type: 'image/png' });
const toBlobMock = mock(
  (_node: HTMLElement, _options?: unknown): Promise<Blob | null> => Promise.resolve(pngBlob),
);

mock.module('html-to-image', () => ({ toBlob: toBlobMock }));

const { copyElementAsPng } = await import('../../utils/copyElementAsPng');

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  'clipboard',
);
const originalClipboardItemDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'ClipboardItem',
);

class ClipboardItemStub {
  constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
}

const setClipboard = (clipboard: unknown) => {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  });
};

const setClipboardItem = (value: unknown) => {
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value,
  });
};

const restoreDescriptor = (
  target: typeof globalThis | Navigator,
  key: 'ClipboardItem' | 'clipboard',
  descriptor: PropertyDescriptor | undefined,
) => {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
};

describe('copyElementAsPng', () => {
  beforeEach(() => {
    toBlobMock.mockClear();
    toBlobMock.mockResolvedValue(pngBlob);
    setClipboardItem(ClipboardItemStub);
  });

  afterEach(() => {
    restoreDescriptor(globalThis.navigator, 'clipboard', originalClipboardDescriptor);
    restoreDescriptor(globalThis, 'ClipboardItem', originalClipboardItemDescriptor);
  });

  test('renders the element and writes its PNG blob to the clipboard', async () => {
    let copiedItem: ClipboardItemStub | undefined;
    const write = mock(async (items: ClipboardItemStub[]) => {
      [copiedItem] = items;
      await Promise.all(Object.values(copiedItem.data));
    });
    setClipboard({ write });
    const element = document.createElement('div');
    element.style.backgroundColor = 'rgb(12, 34, 56)';

    await copyElementAsPng(element);

    expect(toBlobMock).toHaveBeenCalledTimes(1);
    const options = toBlobMock.mock.calls[0]?.[1] as {
      backgroundColor: string;
      filter: (node: HTMLElement) => boolean;
      pixelRatio: number;
    };
    expect(typeof options.backgroundColor).toBe('string');
    expect(options.pixelRatio).toBeGreaterThanOrEqual(1);
    expect(options.pixelRatio).toBeLessThanOrEqual(2);

    const copyButton = document.createElement('button');
    copyButton.dataset.exportExclude = 'true';
    expect(options.filter(copyButton)).toBe(false);
    expect(options.filter(document.createElement('div'))).toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    expect(await copiedItem?.data['image/png']).toBe(pngBlob);
  });

  test('fails clearly when PNG clipboard writes are unavailable', async () => {
    setClipboard({});
    setClipboardItem(undefined);

    await expect(copyElementAsPng(document.createElement('div'))).rejects.toThrow(
      'PNG clipboard writes are not supported',
    );
    expect(toBlobMock).not.toHaveBeenCalled();
  });

  test('rejects a failed DOM render instead of writing an empty clipboard item', async () => {
    const write = mock(async (items: ClipboardItemStub[]) => {
      await Promise.all(Object.values(items[0].data));
    });
    setClipboard({ write });
    toBlobMock.mockResolvedValueOnce(null);

    await expect(copyElementAsPng(document.createElement('div'))).rejects.toThrow(
      'Could not render the chart as PNG',
    );
    expect(write).toHaveBeenCalledTimes(1);
  });
});
