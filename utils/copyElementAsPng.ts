const PNG_MIME_TYPE = 'image/png';

export type CopyElementAsPngFailure = 'render' | 'unsupported' | 'write';

export class CopyElementAsPngError extends Error {
  constructor(
    readonly failure: CopyElementAsPngFailure,
    options?: ErrorOptions,
  ) {
    super(`Could not copy element as PNG (${failure})`, options);
    this.name = 'CopyElementAsPngError';
  }
}

const includeInImage = (node: Node) =>
  !(node instanceof Element) || node.getAttribute('data-export-exclude') !== 'true';

export const copyElementAsPng = async (element: HTMLElement) => {
  if (
    window.isSecureContext === false ||
    typeof ClipboardItem === 'undefined' ||
    typeof navigator.clipboard?.write !== 'function' ||
    (typeof ClipboardItem.supports === 'function' && !ClipboardItem.supports(PNG_MIME_TYPE))
  ) {
    throw new CopyElementAsPngError('unsupported');
  }

  const renderOptions = {
    backgroundColor: getComputedStyle(element).backgroundColor,
    filter: includeInImage,
    pixelRatio: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2),
  };
  const pngBlob = import('html-to-image')
    .then(({ toBlob }) => toBlob(element, renderOptions))
    .then((blob) => {
      if (!blob) throw new CopyElementAsPngError('render');
      return blob;
    })
    .catch((error: unknown) => {
      if (error instanceof CopyElementAsPngError) throw error;
      throw new CopyElementAsPngError('render', { cause: error });
    });

  // Supplying the pending blob to ClipboardItem keeps the clipboard write tied to
  // the original click, including in browsers with strict user-activation rules.
  try {
    await navigator.clipboard.write([new ClipboardItem({ [PNG_MIME_TYPE]: pngBlob })]);
  } catch (error) {
    if (error instanceof CopyElementAsPngError) throw error;
    throw new CopyElementAsPngError('write', { cause: error });
  }
};
