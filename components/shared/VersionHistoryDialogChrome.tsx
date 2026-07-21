import { createContext, useContext } from 'react';

interface VersionHistoryDialogChromeContextValue {
  setRowCount: (count: number) => void;
}

const VersionHistoryDialogChromeContext =
  createContext<VersionHistoryDialogChromeContextValue | null>(null);

/** Lets nested `VersionHistoryPanel` report its row count for the dialog header badge. */
export function useVersionHistoryDialogChrome() {
  return useContext(VersionHistoryDialogChromeContext);
}

export { VersionHistoryDialogChromeContext };
