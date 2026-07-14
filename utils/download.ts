/** @hidden */
export const downloadBlob = (filename: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Defer revocation: some browsers begin fetching the blob asynchronously after click(), so
  // revoking synchronously in the same task can cancel the download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

// Triggers a client-side download of `content` as a text file named `filename`. Shared by
// features that let the user save generated text locally (e.g. 2FA backup codes).
export const downloadTextFile = (filename: string, content: string): void => {
  downloadBlob(filename, new Blob([content], { type: 'text/plain;charset=utf-8' }));
};
