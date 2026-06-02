// Triggers a client-side download of `content` as a text file named `filename`, via a transient
// object URL that is revoked immediately after the click. Shared by features that let the user
// save generated text locally (e.g. 2FA backup codes).
export const downloadTextFile = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
