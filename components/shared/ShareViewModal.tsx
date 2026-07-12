import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrentUserId } from '../../contexts/useCurrentUserId';
import {
  type SavedViewPermission,
  type ViewDirectoryUser,
  viewsApi,
} from '../../services/api/views';
import { toastError } from '../../utils/toast';
import Modal from './Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from './ModalLayout';

type LoadState = 'loading' | 'error' | 'ready';

type ShareViewModalState = {
  directory: ViewDirectoryUser[];
  shares: Map<string, SavedViewPermission>;
  loadState: LoadState;
  search: string;
  selectedAvailableIds: Set<string>;
  selectedSharedIds: Set<string>;
  isSaving: boolean;
};

type ShareViewModalAction =
  | { type: 'loadStarted' }
  | {
      type: 'loadSucceeded';
      directory: ViewDirectoryUser[];
      shares: Map<string, SavedViewPermission>;
    }
  | { type: 'loadFailed' }
  | { type: 'setSearch'; search: string }
  | { type: 'setSaving'; isSaving: boolean }
  | { type: 'toggleAvailableSelection'; userId: string }
  | { type: 'toggleSharedSelection'; userId: string }
  | { type: 'shareUser'; userId: string }
  | { type: 'unshareUser'; userId: string }
  | { type: 'setPermission'; userId: string; permission: SavedViewPermission }
  | { type: 'shareSelected' }
  | { type: 'unshareSelected' };

export interface ShareViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewId: string;
  viewName: string;
  onSaved?: () => void;
  zIndex?: number;
  popupZIndex?: number;
}

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

const createShareViewModalState = (): ShareViewModalState => ({
  directory: [],
  shares: new Map(),
  loadState: 'loading',
  search: '',
  selectedAvailableIds: new Set(),
  selectedSharedIds: new Set(),
  isSaving: false,
});

const toggleSetItem = (values: Set<string>, value: string) => {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

const shareViewModalReducer = (
  state: ShareViewModalState,
  action: ShareViewModalAction,
): ShareViewModalState => {
  switch (action.type) {
    case 'loadStarted':
      return {
        ...state,
        shares: new Map(),
        loadState: 'loading',
        selectedAvailableIds: new Set(),
        selectedSharedIds: new Set(),
      };
    case 'loadSucceeded':
      return {
        ...state,
        directory: action.directory,
        shares: action.shares,
        loadState: 'ready',
      };
    case 'loadFailed':
      return { ...state, loadState: 'error' };
    case 'setSearch':
      return { ...state, search: action.search };
    case 'setSaving':
      return { ...state, isSaving: action.isSaving };
    case 'toggleAvailableSelection':
      return {
        ...state,
        selectedAvailableIds: toggleSetItem(state.selectedAvailableIds, action.userId),
      };
    case 'toggleSharedSelection':
      return {
        ...state,
        selectedSharedIds: toggleSetItem(state.selectedSharedIds, action.userId),
      };
    case 'shareUser': {
      const shares = new Map(state.shares);
      shares.set(action.userId, 'read');
      const selectedAvailableIds = new Set(state.selectedAvailableIds);
      selectedAvailableIds.delete(action.userId);
      return { ...state, shares, selectedAvailableIds };
    }
    case 'unshareUser': {
      const shares = new Map(state.shares);
      shares.delete(action.userId);
      const selectedSharedIds = new Set(state.selectedSharedIds);
      selectedSharedIds.delete(action.userId);
      return { ...state, shares, selectedSharedIds };
    }
    case 'setPermission': {
      const shares = new Map(state.shares);
      shares.set(action.userId, action.permission);
      return { ...state, shares };
    }
    case 'shareSelected': {
      const shares = new Map(state.shares);
      for (const userId of state.selectedAvailableIds) shares.set(userId, 'read');
      return { ...state, shares, selectedAvailableIds: new Set() };
    }
    case 'unshareSelected': {
      const shares = new Map(state.shares);
      for (const userId of state.selectedSharedIds) shares.delete(userId);
      return { ...state, shares, selectedSharedIds: new Set() };
    }
  }
};

const ShareEmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
    <div className="size-12 bg-muted rounded-full flex items-center justify-center mb-2 text-muted-foreground">
      <i className="fa-solid fa-user-slash text-lg" aria-hidden="true"></i>
    </div>
    <span className="text-xs italic">{message}</span>
  </div>
);

const AvatarBubble: React.FC<{ user: ViewDirectoryUser; isSelected?: boolean }> = ({
  user,
  isSelected,
}) => (
  <div
    className={`size-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
    }`}
  >
    {user.avatarInitials || user.name.substring(0, 2).toUpperCase()}
  </div>
);

const ShareModalHeader: React.FC<{
  viewName: string;
  isSaving: boolean;
  onClose: () => void;
}> = ({ viewName, isSaving, onClose }) => {
  const { t } = useTranslation('common');

  return (
    <ModalHeader>
      <div>
        <ModalTitle>{t('views.shareView')}</ModalTitle>
        <ModalDescription>
          {t('views.viewLabel')}: <span className="font-bold text-praetor">{viewName}</span>
        </ModalDescription>
      </div>
      <ModalCloseButton onClick={onClose} disabled={isSaving} />
    </ModalHeader>
  );
};

const ShareSearch: React.FC<{
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}> = ({ value, disabled, onChange }) => {
  const { t } = useTranslation('common');

  return (
    <div className="border-b border-border bg-background p-4">
      <div className="relative">
        <i
          className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        ></i>
        <Input
          type="text"
          placeholder={t('views.searchUsers')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="pl-10"
        />
      </div>
    </div>
  );
};

const ShareLoadingState: React.FC = () => (
  <div className="flex flex-1 items-center justify-center py-16">
    <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor" aria-hidden="true"></i>
  </div>
);

const ShareErrorState: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation('common');

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="max-w-sm space-y-4 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <i className="fa-solid fa-triangle-exclamation text-2xl" aria-hidden="true"></i>
        </div>
        <div className="space-y-2">
          <p className="font-bold text-foreground text-sm">{t('views.loadSharesFailed')}</p>
        </div>
        <Button type="button" onClick={onRetry} variant="outline">
          <i className="fa-solid fa-rotate-right" aria-hidden="true"></i>
          {t('buttons.refresh')}
        </Button>
      </div>
    </div>
  );
};

const ShareFooter: React.FC<{
  isSaving: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
}> = ({ isSaving, canSave, onCancel, onSave }) => {
  const { t } = useTranslation('common');

  return (
    <ModalFooter>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
        {t('buttons.cancel')}
      </Button>
      <Button type="button" onClick={onSave} disabled={isSaving || !canSave}>
        {isSaving ? t('buttons.saving') : t('buttons.save')}
      </Button>
    </ModalFooter>
  );
};

const ShareReadyBody: React.FC<{
  availableUsers: ViewDirectoryUser[];
  sharedUsers: ViewDirectoryUser[];
  selectedAvailableIds: Set<string>;
  selectedSharedIds: Set<string>;
  shares: Map<string, SavedViewPermission>;
  onToggleAvailable: (userId: string) => void;
  onShareUser: (userId: string) => void;
  onToggleShared: (userId: string) => void;
  onUnshareUser: (userId: string) => void;
  onSetPermission: (userId: string, permission: SavedViewPermission) => void;
  popupZIndex?: number;
  onShareSelected: () => void;
  onUnshareSelected: () => void;
}> = ({
  availableUsers,
  sharedUsers,
  selectedAvailableIds,
  selectedSharedIds,
  shares,
  onToggleAvailable,
  onShareUser,
  onToggleShared,
  onUnshareUser,
  onSetPermission,
  popupZIndex,
  onShareSelected,
  onUnshareSelected,
}) => {
  const { t } = useTranslation('common');

  const renderAvailableRow = (user: ViewDirectoryUser) => {
    const isSelected = selectedAvailableIds.has(user.id);
    return (
      <button
        key={user.id}
        type="button"
        onClick={() => onToggleAvailable(user.id)}
        onDoubleClick={() => onShareUser(user.id)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl border cursor-pointer text-left transition-all ${
          isSelected
            ? 'bg-primary/10 border-primary'
            : 'bg-card border-border hover:border-input hover:bg-accent'
        }`}
      >
        <AvatarBubble user={user} isSelected={isSelected} />
        <div className="flex flex-col min-w-0 flex-1">
          <span
            className={`text-sm font-bold truncate ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            {user.name}
          </span>
          <span className="text-xs text-muted-foreground/70 truncate">@{user.username}</span>
        </div>
      </button>
    );
  };

  const renderSharedRow = (user: ViewDirectoryUser) => {
    const isSelected = selectedSharedIds.has(user.id);
    const permission = shares.get(user.id) ?? 'read';
    return (
      <div
        key={user.id}
        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
          isSelected ? 'bg-primary/10 border-primary' : 'bg-card border-border'
        }`}
      >
        <button
          type="button"
          onClick={() => onToggleShared(user.id)}
          onDoubleClick={() => onUnshareUser(user.id)}
          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
        >
          <AvatarBubble user={user} isSelected={isSelected} />
          <div className="flex flex-col min-w-0 flex-1">
            <span
              className={`text-sm font-bold truncate ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {user.name}
            </span>
            <span className="text-xs text-muted-foreground/70 truncate">@{user.username}</span>
          </div>
        </button>
        <Select
          value={permission}
          onValueChange={(value) => onSetPermission(user.id, value as SavedViewPermission)}
        >
          <SelectTrigger size="sm" className="w-28 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent style={{ zIndex: popupZIndex }}>
            <SelectItem value="read">{t('views.permissionRead')}</SelectItem>
            <SelectItem value="write">{t('views.permissionWrite')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="flex-1 flex gap-0 overflow-hidden p-4">
      <div className="flex-1 flex flex-col min-w-0">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {t('views.availableUsers')}
          <span className="ml-2 text-muted-foreground/70 font-normal">
            ({availableUsers.length})
          </span>
        </h4>
        <div className="flex-1 overflow-y-auto pr-2">
          {availableUsers.length === 0 ? (
            <ShareEmptyState message={t('views.noUsersToShare')} />
          ) : (
            <div className="space-y-1.5">{availableUsers.map(renderAvailableRow)}</div>
          )}
        </div>
        <div className="pt-3 mt-2 border-t border-border">
          <Button
            type="button"
            onClick={onShareSelected}
            disabled={selectedAvailableIds.size === 0}
            className="w-full"
          >
            {t('views.shareSelected')}
            <i className="fa-solid fa-angles-right text-xs" aria-hidden="true"></i>
            {selectedAvailableIds.size > 0 && (
              <span className="bg-primary-foreground/20 px-1.5 py-0.5 rounded text-xs">
                {selectedAvailableIds.size}
              </span>
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-center px-3 shrink-0">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <i className="fa-solid fa-right-left text-lg" aria-hidden="true"></i>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          {t('views.sharedWith')}
          <span className="ml-2 text-muted-foreground/70 font-normal">({sharedUsers.length})</span>
        </h4>
        <div className="flex-1 overflow-y-auto pr-2">
          {sharedUsers.length === 0 ? (
            <ShareEmptyState message={t('views.noUsersShared')} />
          ) : (
            <div className="space-y-1.5">{sharedUsers.map(renderSharedRow)}</div>
          )}
        </div>
        <div className="pt-3 mt-2 border-t border-border">
          <Button
            type="button"
            onClick={onUnshareSelected}
            disabled={selectedSharedIds.size === 0}
            className="w-full"
          >
            <i className="fa-solid fa-angles-left text-xs" aria-hidden="true"></i>
            {t('views.unshareSelected')}
            {selectedSharedIds.size > 0 && (
              <span className="bg-primary-foreground/20 px-1.5 py-0.5 rounded text-xs">
                {selectedSharedIds.size}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

const ShareViewModalSession: React.FC<ShareViewModalProps> = ({
  isOpen,
  onClose,
  viewId,
  viewName,
  onSaved,
  zIndex,
  popupZIndex,
}) => {
  const { t } = useTranslation('common');
  const currentUserId = useCurrentUserId();
  const [state, dispatch] = useReducer(shareViewModalReducer, undefined, createShareViewModalState);
  const loadAbortControllerRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const {
    directory,
    shares,
    loadState,
    search,
    selectedAvailableIds,
    selectedSharedIds,
    isSaving,
  } = state;

  const load = useCallback(async () => {
    loadAbortControllerRef.current?.abort();
    const controller = new AbortController();
    loadAbortControllerRef.current = controller;

    dispatch({ type: 'loadStarted' });
    try {
      const [directoryUsers, currentShares] = await Promise.all([
        viewsApi.directory(controller.signal),
        viewsApi.getShares(viewId, controller.signal),
      ]);
      if (!controller.signal.aborted) {
        dispatch({
          type: 'loadSucceeded',
          directory: directoryUsers,
          shares: new Map(currentShares.map((share) => [share.userId, share.permission])),
        });
      }
    } catch (err) {
      if (!controller.signal.aborted && !isAbortError(err)) {
        console.error('Failed to load view shares', err);
        dispatch({ type: 'loadFailed' });
        toastError(tRef.current('views.loadSharesFailed'));
      }
    } finally {
      if (loadAbortControllerRef.current === controller) {
        loadAbortControllerRef.current = null;
      }
    }
  }, [viewId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => () => {
      loadAbortControllerRef.current?.abort();
      loadAbortControllerRef.current = null;
    },
    [],
  );

  const handleClose = useCallback(() => {
    if (isSaving) return;
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = null;
    onClose();
  }, [isSaving, onClose]);

  const forceClose = useCallback(() => {
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = null;
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving || loadState !== 'ready') return;
    dispatch({ type: 'setSaving', isSaving: true });
    try {
      await viewsApi.replaceShares(
        viewId,
        Array.from(shares, ([userId, permission]) => ({ userId, permission })),
      );
      onSaved?.();
      forceClose();
    } catch (err) {
      console.error('Failed to save view shares', err);
      toastError(t('views.saveSharesFailed'));
    } finally {
      dispatch({ type: 'setSaving', isSaving: false });
    }
  }, [isSaving, loadState, viewId, shares, onSaved, forceClose, t]);

  const toggleAvailableSelection = useCallback((userId: string) => {
    dispatch({ type: 'toggleAvailableSelection', userId });
  }, []);

  const toggleSharedSelection = useCallback((userId: string) => {
    dispatch({ type: 'toggleSharedSelection', userId });
  }, []);

  // New recipients default to read — the least-privileged grant.
  const shareUser = useCallback((userId: string) => {
    dispatch({ type: 'shareUser', userId });
  }, []);

  const unshareUser = useCallback((userId: string) => {
    dispatch({ type: 'unshareUser', userId });
  }, []);

  const setPermission = useCallback((userId: string, permission: SavedViewPermission) => {
    dispatch({ type: 'setPermission', userId, permission });
  }, []);

  const shareSelected = useCallback(() => {
    if (selectedAvailableIds.size === 0) return;
    dispatch({ type: 'shareSelected' });
  }, [selectedAvailableIds.size]);

  const unshareSelected = useCallback(() => {
    if (selectedSharedIds.size === 0) return;
    dispatch({ type: 'unshareSelected' });
  }, [selectedSharedIds.size]);

  const searchLower = search.toLowerCase();

  // The owner can't share with themselves — exclude the current user from the candidate list.
  const candidates = useMemo(
    () => directory.filter((u) => u.id !== currentUserId),
    [directory, currentUserId],
  );

  const matchesSearch = useCallback(
    (user: ViewDirectoryUser) =>
      user.name.toLowerCase().includes(searchLower) ||
      user.username.toLowerCase().includes(searchLower),
    [searchLower],
  );

  const availableUsers = useMemo(
    () => candidates.filter((u) => !shares.has(u.id) && matchesSearch(u)),
    [candidates, shares, matchesSearch],
  );

  const candidateIds = useMemo(() => new Set(candidates.map((u) => u.id)), [candidates]);

  // Shared recipients = directory users with a grant, plus any grant whose user the directory
  // omits (e.g. a now-disabled account, which `/views/directory` excludes). Without surfacing the
  // latter, an existing share would be invisible yet still serialized on save — a ghost grant that
  // silently reactivates if the account is re-enabled. We render orphans labelled by id so the
  // owner can still remove them.
  const sharedUsers = useMemo(() => {
    const known = candidates.filter((u) => shares.has(u.id) && matchesSearch(u));
    const orphans: ViewDirectoryUser[] = [];
    for (const userId of shares.keys()) {
      if (userId === currentUserId || candidateIds.has(userId)) continue;
      const fallback: ViewDirectoryUser = {
        id: userId,
        name: userId,
        username: '',
        avatarInitials: userId.slice(0, 2).toUpperCase() || '?',
      };
      if (matchesSearch(fallback)) orphans.push(fallback);
    }
    return [...known, ...orphans];
  }, [candidates, candidateIds, shares, currentUserId, matchesSearch]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} ariaLabel={null} zIndex={zIndex}>
      {() => (
        <ModalContent size="2xl" className="max-h-[85vh]">
          <ShareModalHeader viewName={viewName} isSaving={isSaving} onClose={handleClose} />

          <ShareSearch
            value={search}
            disabled={loadState !== 'ready'}
            onChange={(value) => dispatch({ type: 'setSearch', search: value })}
          />

          <ModalBody className="flex-1 overflow-hidden flex flex-col bg-muted/30 p-0">
            {loadState === 'loading' ? (
              <ShareLoadingState />
            ) : loadState === 'error' ? (
              <ShareErrorState onRetry={load} />
            ) : (
              <ShareReadyBody
                availableUsers={availableUsers}
                sharedUsers={sharedUsers}
                selectedAvailableIds={selectedAvailableIds}
                selectedSharedIds={selectedSharedIds}
                shares={shares}
                onToggleAvailable={toggleAvailableSelection}
                onShareUser={shareUser}
                onToggleShared={toggleSharedSelection}
                onUnshareUser={unshareUser}
                onSetPermission={setPermission}
                popupZIndex={popupZIndex}
                onShareSelected={shareSelected}
                onUnshareSelected={unshareSelected}
              />
            )}
          </ModalBody>

          <ShareFooter
            isSaving={isSaving}
            canSave={loadState === 'ready'}
            onCancel={handleClose}
            onSave={handleSave}
          />
        </ModalContent>
      )}
    </Modal>
  );
};

const ShareViewModal: React.FC<ShareViewModalProps> = (props) =>
  props.isOpen ? <ShareViewModalSession key={props.viewId} {...props} /> : null;

export default ShareViewModal;
