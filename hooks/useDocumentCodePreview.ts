import { useEffect, useState } from 'react';
import api from '../services/api';
import type { DocumentCodeModuleId } from '../types';

interface UseDocumentCodePreviewOptions {
  date?: string;
  enabled?: boolean;
}

export const useDocumentCodePreview = (
  moduleId: DocumentCodeModuleId,
  options: UseDocumentCodePreviewOptions = {},
) => {
  const [previewState, setPreviewState] = useState<{
    key: string;
    preview: string | null;
  }>({ key: '', preview: null });
  const enabled = options.enabled ?? true;
  const date = options.date;
  const requestKey = `${moduleId}:${date ?? ''}`;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    const loadPreview = api.documentCodeTemplates?.preview;
    if (!loadPreview) {
      return;
    }

    loadPreview(moduleId, date)
      .then((result) => {
        if (!cancelled) setPreviewState({ key: requestKey, preview: result.preview });
      })
      .catch(() => {
        if (!cancelled) setPreviewState({ key: requestKey, preview: null });
      });

    return () => {
      cancelled = true;
    };
  }, [date, enabled, moduleId, requestKey]);

  const preview = enabled && previewState.key === requestKey ? previewState.preview : null;

  return { preview, isLoading: false };
};
