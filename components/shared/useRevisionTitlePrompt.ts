import { useCallback, useRef, useState } from 'react';

export type RevisionTitlePromptResult =
  | { confirmed: true; title: string | null }
  | { confirmed: false };

export function useRevisionTitlePrompt() {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((result: RevisionTitlePromptResult) => void) | null>(null);

  const settle = useCallback((result: RevisionTitlePromptResult) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    resolve?.(result);
  }, []);

  const requestRevisionTitle = useCallback((): Promise<RevisionTitlePromptResult> => {
    if (resolverRef.current) return Promise.resolve({ confirmed: false });
    setOpen(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setOpen(true);
        return;
      }
      settle({ confirmed: false });
    },
    [settle],
  );

  const confirm = useCallback(
    (title: string) => settle({ confirmed: true, title: title.trim() || null }),
    [settle],
  );

  return { open, onOpenChange, confirm, requestRevisionTitle };
}
