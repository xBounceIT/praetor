import type { ReactNode } from 'react';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RevisionRow } from '@/types';
import { asyncRowsReducer, createInitialAsyncRowsState } from './asyncRowsState';
import DeleteConfirmModal from './DeleteConfirmModal';
import { VersionHistoryPanel } from './VersionHistoryPanel';

type RevisionWithSnapshot = RevisionRow & { snapshot: unknown };

interface RevisionHistoryPanelProps<TRevision extends RevisionWithSnapshot, TRestored> {
  objectId: string;
  translationPrefix: string;
  selectedRevisionId: string | null;
  list: (id: string) => Promise<RevisionRow[]>;
  get: (id: string, revisionId: string) => Promise<TRevision>;
  restore: (id: string, revisionId: string) => Promise<TRestored>;
  onPreview: (revision: TRevision) => void;
  onClearPreview: () => void;
  onRestored: (restored: TRestored) => void;
  disabled?: boolean;
}

export function RevisionHistoryPanel<TRevision extends RevisionWithSnapshot, TRestored>({
  objectId,
  translationPrefix,
  selectedRevisionId,
  list,
  get,
  restore,
  onPreview,
  onClearPreview,
  onRestored,
  disabled,
}: RevisionHistoryPanelProps<TRevision, TRestored>) {
  const { t, i18n } = useTranslation('sales');
  const [state, dispatch] = useReducer(
    asyncRowsReducer<RevisionRow>,
    createInitialAsyncRowsState<RevisionRow>(),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreInFlight, setRestoreInFlight] = useState(false);

  const reload = useCallback(async () => {
    dispatch({ type: 'loading' });
    try {
      dispatch({ type: 'loaded', rows: await list(objectId) });
    } catch {
      dispatch({
        type: 'failed',
        error: t(`${translationPrefix}.revisionHistory.loadFailed`, {
          defaultValue: 'Impossibile caricare le revisioni',
        }),
      });
    }
  }, [list, objectId, t, translationPrefix]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSelect = useCallback(
    async (row: RevisionRow) => {
      if (row.id === selectedRevisionId) return;
      try {
        dispatch({ type: 'setError', error: null });
        onPreview(await get(objectId, row.id));
      } catch {
        dispatch({
          type: 'setError',
          error: t(`${translationPrefix}.revisionHistory.loadFailed`, {
            defaultValue: 'Impossibile caricare le revisioni',
          }),
        });
      }
    },
    [get, objectId, onPreview, selectedRevisionId, t, translationPrefix],
  );

  const handleRestore = useCallback(async () => {
    if (!selectedRevisionId) return;
    setRestoreInFlight(true);
    try {
      const restored = await restore(objectId, selectedRevisionId);
      onRestored(restored);
      setConfirmOpen(false);
      await reload();
    } catch (error) {
      dispatch({
        type: 'setError',
        error:
          error instanceof Error && error.message
            ? error.message
            : t(`${translationPrefix}.revisionHistory.restoreFailed`, {
                defaultValue: 'Ripristino non riuscito',
              }),
      });
    } finally {
      setRestoreInFlight(false);
    }
  }, [objectId, onRestored, reload, restore, selectedRevisionId, t, translationPrefix]);

  const rows = state.rows.map((row) => ({ ...row, reason: 'update' as const }));
  return (
    <>
      <VersionHistoryPanel
        embedded
        persistenceKey={`${translationPrefix}.revisions`}
        rows={rows}
        selectedVersionId={selectedRevisionId}
        isLoading={state.isLoading}
        error={state.error}
        locale={i18n.language}
        disabled={disabled}
        restoreInFlight={restoreInFlight}
        labels={{
          title: t(`${translationPrefix}.revisionHistory.title`, { defaultValue: 'Revisioni' }),
          empty: t(`${translationPrefix}.revisionHistory.empty`, {
            defaultValue: 'Nessuna revisione inviata',
          }),
          reasonRestore: '',
          reasonUpdate: t(`${translationPrefix}.revisionHistory.snapshot`, {
            defaultValue: 'Snapshot inviato',
          }),
          backToCurrent: t(`${translationPrefix}.revisionHistory.backToCurrent`, {
            defaultValue: 'Torna alla versione corrente',
          }),
          restoreButton: t(`${translationPrefix}.revisionHistory.restoreButton`, {
            defaultValue: 'Ripristina revisione',
          }),
        }}
        onSelect={handleSelect}
        onClearPreview={onClearPreview}
        onRestore={() => setConfirmOpen(true)}
      />
      <DeleteConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleRestore}
        zIndex={70}
        title={t(`${translationPrefix}.revisionHistory.restoreConfirmTitle`, {
          defaultValue: 'Ripristinare la revisione?',
        })}
        description={t(`${translationPrefix}.revisionHistory.restoreConfirmDescription`, {
          defaultValue:
            'Il contenuto verrà ripristinato in bozza senza liberare il numero di revisione corrente.',
        })}
      />
    </>
  );
}

export const HistoryRail = ({ children }: { children: ReactNode }) => (
  <aside className="hidden max-h-[90vh] w-72 flex-shrink-0 flex-col gap-2 overflow-y-auto 2xl:flex">
    {children}
  </aside>
);
