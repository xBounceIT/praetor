import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useCurrentUserId } from '../../contexts/CurrentUserContext';
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

export interface ShareViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewId: string;
  viewName: string;
  onSaved?: () => void;
}

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

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

const ShareViewModal: React.FC<ShareViewModalProps> = ({
  isOpen,
  onClose,
  viewId,
  viewName,
  onSaved,
}) => {
  const { t } = useTranslation('common');
  const currentUserId = useCurrentUserId();

  const [directory, setDirectory] = useState<ViewDirectoryUser[]>([]);
  // Source of truth for the shared column: who is shared with, at what permission.
  const [shares, setShares] = useState<Map<string, SavedViewPermission>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>('ready');
  const [search, setSearch] = useState('');
  const [selectedAvailableIds, setSelectedAvailableIds] = useState<Set<string>>(new Set());
  const [selectedSharedIds, setSelectedSharedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const initializedRef = useRef(false);
  const loadAbortControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadAbortControllerRef.current?.abort();
    const controller = new AbortController();
    loadAbortControllerRef.current = controller;

    setLoadState('loading');
    setShares(new Map());
    setSelectedAvailableIds(new Set());
    setSelectedSharedIds(new Set());
    try {
      const [directoryUsers, currentShares] = await Promise.all([
        viewsApi.directory(controller.signal),
        viewsApi.getShares(viewId, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setDirectory(directoryUsers);
      setShares(new Map(currentShares.map((share) => [share.userId, share.permission])));
      setLoadState('ready');
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      console.error('Failed to load view shares', err);
      setLoadState('error');
      toastError(t('views.loadSharesFailed'));
    } finally {
      if (loadAbortControllerRef.current === controller) {
        loadAbortControllerRef.current = null;
      }
    }
  }, [viewId, t]);

  useEffect(() => {
    if (isOpen && !initializedRef.current) {
      initializedRef.current = true;
      load();
    }
    if (!isOpen) {
      initializedRef.current = false;
      loadAbortControllerRef.current?.abort();
      loadAbortControllerRef.current = null;
      setIsSaving(false);
      setSearch('');
    }
  }, [isOpen, load]);

  useEffect(
    () => () => {
      loadAbortControllerRef.current?.abort();
      loadAbortControllerRef.current = null;
    },
    [],
  );

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setSearch('');
    setSelectedAvailableIds(new Set());
    setSelectedSharedIds(new Set());
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = null;
    onClose();
  }, [isSaving, onClose]);

  const forceClose = useCallback(() => {
    setSearch('');
    setSelectedAvailableIds(new Set());
    setSelectedSharedIds(new Set());
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = null;
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving || loadState !== 'ready') return;
    setIsSaving(true);
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
      setIsSaving(false);
    }
  }, [isSaving, loadState, viewId, shares, onSaved, forceClose, t]);

  const toggleAvailableSelection = useCallback((userId: string) => {
    setSelectedAvailableIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const toggleSharedSelection = useCallback((userId: string) => {
    setSelectedSharedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  // New recipients default to read — the least-privileged grant.
  const shareUser = useCallback((userId: string) => {
    setShares((prev) => {
      const next = new Map(prev);
      next.set(userId, 'read');
      return next;
    });
    setSelectedAvailableIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  const unshareUser = useCallback((userId: string) => {
    setShares((prev) => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
    setSelectedSharedIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  const setPermission = useCallback((userId: string, permission: SavedViewPermission) => {
    setShares((prev) => {
      const next = new Map(prev);
      next.set(userId, permission);
      return next;
    });
  }, []);

  const shareSelected = useCallback(() => {
    if (selectedAvailableIds.size === 0) return;
    setShares((prev) => {
      const next = new Map(prev);
      for (const userId of selectedAvailableIds) next.set(userId, 'read');
      return next;
    });
    setSelectedAvailableIds(new Set());
  }, [selectedAvailableIds]);

  const unshareSelected = useCallback(() => {
    if (selectedSharedIds.size === 0) return;
    setShares((prev) => {
      const next = new Map(prev);
      for (const userId of selectedSharedIds) next.delete(userId);
      return next;
    });
    setSelectedSharedIds(new Set());
  }, [selectedSharedIds]);

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

  const sharedUsers = useMemo(
    () => candidates.filter((u) => shares.has(u.id) && matchesSearch(u)),
    [candidates, shares, matchesSearch],
  );

  const renderAvailableRow = (user: ViewDirectoryUser) => {
    const isSelected = selectedAvailableIds.has(user.id);
    return (
      <button
        key={user.id}
        type="button"
        onClick={() => toggleAvailableSelection(user.id)}
        onDoubleClick={() => shareUser(user.id)}
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
          onClick={() => toggleSharedSelection(user.id)}
          onDoubleClick={() => unshareUser(user.id)}
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
          onValueChange={(value) => setPermission(user.id, value as SavedViewPermission)}
        >
          <SelectTrigger size="sm" className="w-28 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read">{t('views.permissionRead')}</SelectItem>
            <SelectItem value="write">{t('views.permissionWrite')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  };

  const renderEmpty = (message: string) => (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
      <div className="size-12 bg-muted rounded-full flex items-center justify-center mb-2 text-muted-foreground">
        <i className="fa-solid fa-user-slash text-lg" aria-hidden="true"></i>
      </div>
      <span className="text-xs italic">{message}</span>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} ariaLabel={null}>
      {() => (
        <ModalContent size="2xl" className="max-h-[85vh]">
          <ModalHeader>
            <div>
              <ModalTitle>{t('views.shareView')}</ModalTitle>
              <ModalDescription>
                {t('views.viewLabel')}: <span className="font-bold text-praetor">{viewName}</span>
              </ModalDescription>
            </div>
            <ModalCloseButton onClick={handleClose} disabled={isSaving} />
          </ModalHeader>

          <div className="p-4 border-b border-border bg-background">
            <div className="relative">
              <i
                className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              ></i>
              <Input
                type="text"
                placeholder={t('views.searchUsers')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={loadState !== 'ready'}
                className="pl-10"
              />
            </div>
          </div>

          <ModalBody className="flex-1 overflow-hidden flex flex-col bg-muted/30 p-0">
            {loadState === 'loading' ? (
              <div className="flex items-center justify-center py-16 flex-1">
                <i
                  className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"
                  aria-hidden="true"
                ></i>
              </div>
            ) : loadState === 'error' ? (
              <div className="flex items-center justify-center py-16 flex-1">
                <div className="max-w-sm text-center space-y-4">
                  <div className="size-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto">
                    <i className="fa-solid fa-triangle-exclamation text-2xl" aria-hidden="true"></i>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-foreground">
                      {t('views.loadSharesFailed')}
                    </p>
                  </div>
                  <Button type="button" onClick={load} variant="outline">
                    <i className="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    {t('buttons.refresh')}
                  </Button>
                </div>
              </div>
            ) : (
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
                      renderEmpty(t('views.noUsersToShare'))
                    ) : (
                      <div className="space-y-1.5">{availableUsers.map(renderAvailableRow)}</div>
                    )}
                  </div>
                  <div className="pt-3 mt-2 border-t border-border">
                    <Button
                      type="button"
                      onClick={shareSelected}
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
                    <span className="ml-2 text-muted-foreground/70 font-normal">
                      ({sharedUsers.length})
                    </span>
                  </h4>
                  <div className="flex-1 overflow-y-auto pr-2">
                    {sharedUsers.length === 0 ? (
                      renderEmpty(t('views.noUsersShared'))
                    ) : (
                      <div className="space-y-1.5">{sharedUsers.map(renderSharedRow)}</div>
                    )}
                  </div>
                  <div className="pt-3 mt-2 border-t border-border">
                    <Button
                      type="button"
                      onClick={unshareSelected}
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
            )}
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSaving}>
              {t('buttons.cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving || loadState !== 'ready'}>
              {isSaving ? t('buttons.saving') : t('buttons.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

export default ShareViewModal;
