const PNG_MIME_TYPE = 'image/png';

const includeInImage = (node: HTMLElement) => node.dataset.exportExclude !== 'true';

export const copyElementAsPng = async (element: HTMLElement) => {
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
    throw new Error('PNG clipboard writes are not supported');
  }

  const renderOptions = {
    backgroundColor: getComputedStyle(element).backgroundColor,
    filter: includeInImage,
    pixelRatio: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2),
  };
  const pngBlob = import('html-to-image')
    .then(({ toBlob }) => toBlob(element, renderOptions))
    .then((blob) => {
      if (!blob) throw new Error('Could not render the chart as PNG');
      return blob;
    });

  // Supplying the pending blob to ClipboardItem keeps the clipboard write tied to
  // the original click, including in browsers with strict user-activation rules.
  await navigator.clipboard.write([new ClipboardItem({ [PNG_MIME_TYPE]: pngBlob })]);
};
