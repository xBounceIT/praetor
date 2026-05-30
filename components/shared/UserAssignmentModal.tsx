import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Role, User } from '../../types';
import { TOP_MANAGER_ROLE_ID } from '../../utils/permissions';
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
import StatusBadge, { type StatusType } from './StatusBadge';

type LoadState = 'loading' | 'error' | 'ready';

const EMPTY_ROLES: Role[] = [];

export interface UserAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  roles?: Role[];
  loadAssignedUserIds: (signal?: AbortSignal) => Promise<string[]>;
  saveAssignedUserIds: (userIds: string[]) => Promise<void>;
  entityLabel: string;
  entityName: string;
  disabled?: boolean;
}

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

const getRolePresentation = (user: User, roleLookup: Map<string, Role>) => {
  const role = roleLookup.get(user.role);
  const isAdminRole = role?.isAdmin || user.role === 'admin';
  const isTopManagerRole = role?.id === TOP_MANAGER_ROLE_ID || user.role === TOP_MANAGER_ROLE_ID;
  const isManagerRole =
    (role?.isSystem && !isAdminRole && role?.id === 'manager') || user.role === 'manager';

  return {
    roleBadgeType: (isAdminRole
      ? 'role_admin'
      : isTopManagerRole
        ? 'role_top_manager'
        : isManagerRole
          ? 'role_manager'
          : role?.isSystem
            ? 'role_user'
            : 'role_custom') as StatusType,
    roleName: role?.name || user.role,
  };
};

const UserRow: React.FC<{
  user: User;
  isSelected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  roleLookup: Map<string, Role>;
}> = ({ user, isSelected, onSelect, onDoubleClick, roleLookup }) => {
  const { roleBadgeType, roleName } = getRolePresentation(user, roleLookup);
  return (
    <div
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
        isSelected
          ? 'bg-primary/10 border-primary'
          : 'bg-card border-border hover:border-input hover:bg-accent'
      }`}
    >
      <div
        className={`size-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
          isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}
      >
        {user.avatarInitials || user.name.substring(0, 2).toUpperCase()}
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className={`text-sm font-bold truncate ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {user.name}
        </span>
      </div>
      <StatusBadge type={roleBadgeType} label={roleName} className="shrink-0" />
    </div>
  );
};

const UserAssignmentModal: React.FC<UserAssignmentModalProps> = ({
  isOpen,
  onClose,
  users,
  roles = EMPTY_ROLES,
  loadAssignedUserIds,
  saveAssignedUserIds,
  entityLabel,
  entityName,
  disabled = false,
}) => {
  const { t } = useTranslation('common');

  const roleLookup = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('ready');
  const [userSearch, setUserSearch] = useState('');
  const [selectedAvailableIds, setSelectedAvailableIds] = useState<Set<string>>(new Set());
  const [selectedAssignedIds, setSelectedAssignedIds] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const loadAbortControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadAbortControllerRef.current?.abort();
    const controller = new AbortController();
    loadAbortControllerRef.current = controller;

    setLoadState('loading');
    setAssignedUserIds([]);
    setSelectedAvailableIds(new Set());
    setSelectedAssignedIds(new Set());
    try {
      const ids = await loadAssignedUserIds(controller.signal);
      if (controller.signal.aborted) return;
      setAssignedUserIds(ids);
      setLoadState('ready');
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      console.error('Failed to load assignments', err);
      setLoadState('error');
    } finally {
      if (loadAbortControllerRef.current === controller) {
        loadAbortControllerRef.current = null;
      }
    }
  }, [loadAssignedUserIds]);

  useEffect(() => {
    if (isOpen && !initializedRef.current) {
      initializedRef.current = true;
      load();
    }
    if (!isOpen) {
      initializedRef.current = false;
      loadAbortControllerRef.current?.abort();
      loadAbortControllerRef.current = null;
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
    setUserSearch('');
    setSelectedAvailableIds(new Set());
    setSelectedAssignedIds(new Set());
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = null;
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (disabled) return;
    try {
      await saveAssignedUserIds(assignedUserIds);
      handleClose();
    } catch (err) {
      console.error('Failed to save assignments', err);
      toastError(t('assignment.saveFailed'));
    }
  }, [disabled, saveAssignedUserIds, assignedUserIds, handleClose, t]);

  const toggleAvailableSelection = useCallback((userId: string) => {
    setSelectedAvailableIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const toggleAssignedSelection = useCallback((userId: string) => {
    setSelectedAssignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const moveToAssigned = useCallback(
    (userId: string) => {
      if (disabled) return;
      setAssignedUserIds((prev) => [...prev, userId]);
      setSelectedAvailableIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    },
    [disabled],
  );

  const moveToAvailable = useCallback(
    (userId: string) => {
      if (disabled) return;
      setAssignedUserIds((prev) => prev.filter((id) => id !== userId));
      setSelectedAssignedIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    },
    [disabled],
  );

  const assignSelected = useCallback(() => {
    if (disabled || selectedAvailableIds.size === 0) return;
    setAssignedUserIds((prev) => [...prev, ...selectedAvailableIds]);
    setSelectedAvailableIds(new Set());
  }, [disabled, selectedAvailableIds]);

  const unassignSelected = useCallback(() => {
    if (disabled || selectedAssignedIds.size === 0) return;
    setAssignedUserIds((prev) => prev.filter((id) => !selectedAssignedIds.has(id)));
    setSelectedAssignedIds(new Set());
  }, [disabled, selectedAssignedIds]);

  const searchLower = userSearch.toLowerCase();

  const availableUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          !assignedUserIds.includes(u.id) &&
          (u.name.toLowerCase().includes(searchLower) ||
            u.username.toLowerCase().includes(searchLower)),
      ),
    [users, assignedUserIds, searchLower],
  );

  const assignedUsers = useMemo(() => {
    const assignedSet = new Set(assignedUserIds);
    return users
      .filter(
        (u) =>
          assignedSet.has(u.id) &&
          (u.name.toLowerCase().includes(searchLower) ||
            u.username.toLowerCase().includes(searchLower)),
      )
      .sort((a, b) => assignedUserIds.indexOf(a.id) - assignedUserIds.indexOf(b.id));
  }, [users, assignedUserIds, searchLower]);

  const renderUserList = (
    list: User[],
    selectedIds: Set<string>,
    onToggleSelect: (id: string) => void,
    onDoubleClickUser: (id: string) => void,
    emptyMessage: string,
  ) => {
    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <div className="size-12 bg-muted rounded-full flex items-center justify-center mb-2 text-muted-foreground">
            <i className="fa-solid fa-user-slash text-lg"></i>
          </div>
          <span className="text-xs italic">{emptyMessage}</span>
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        {list.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isSelected={selectedIds.has(user.id)}
            onSelect={() => onToggleSelect(user.id)}
            onDoubleClick={() => onDoubleClickUser(user.id)}
            roleLookup={roleLookup}
          />
        ))}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} ariaLabel={null}>
      {() => (
        <ModalContent size="2xl" className="max-h-[85vh]">
          <ModalHeader>
            <div>
              <ModalTitle>{t('assignment.title')}</ModalTitle>
              <ModalDescription>
                {entityLabel}: <span className="font-bold text-praetor">{entityName}</span>
              </ModalDescription>
            </div>
            <ModalCloseButton onClick={handleClose} />
          </ModalHeader>

          <div className="p-4 border-b border-border bg-background">
            <div className="relative">
              <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
              <Input
                type="text"
                placeholder={t('assignment.searchUsers')}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                disabled={loadState !== 'ready'}
                className="pl-10"
              />
            </div>
          </div>

          <ModalBody className="flex-1 overflow-hidden flex flex-col bg-muted/30 p-0">
            {loadState === 'loading' ? (
              <div className="flex items-center justify-center py-16 flex-1">
                <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
              </div>
            ) : loadState === 'error' ? (
              <div className="flex items-center justify-center py-16 flex-1">
                <div className="max-w-sm text-center space-y-4">
                  <div className="size-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mx-auto">
                    <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-foreground">
                      {t('assignment.loadFailed')}
                    </p>
                    <p className="text-sm text-muted-foreground">{t('assignment.loadRetryHint')}</p>
                  </div>
                  <Button type="button" onClick={load} variant="outline">
                    <i className="fa-solid fa-rotate-right"></i>
                    {t('buttons.refresh')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex gap-0 overflow-hidden p-4">
                <div className="flex-1 flex flex-col min-w-0">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
                    {t('assignment.availableUsers')}
                    <span className="ml-2 text-muted-foreground/70 font-normal">
                      ({availableUsers.length})
                    </span>
                  </h4>
                  <div className="flex-1 overflow-y-auto pr-2">
                    {renderUserList(
                      availableUsers,
                      selectedAvailableIds,
                      toggleAvailableSelection,
                      moveToAssigned,
                      t('assignment.noUsersToAssign'),
                    )}
                  </div>
                  <div className="pt-3 mt-2 border-t border-border">
                    <Button
                      type="button"
                      onClick={assignSelected}
                      disabled={disabled || selectedAvailableIds.size === 0}
                      className="w-full"
                    >
                      {t('assignment.assignSelected')}
                      <i className="fa-solid fa-angles-right text-xs"></i>
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
                    <i className="fa-solid fa-right-left text-lg"></i>
                  </div>
                </div>

                <div className="flex-1 flex flex-col min-w-0">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
                    {t('assignment.assignedUsers')}
                    <span className="ml-2 text-muted-foreground/70 font-normal">
                      ({assignedUsers.length})
                    </span>
                  </h4>
                  <div className="flex-1 overflow-y-auto pr-2">
                    {renderUserList(
                      assignedUsers,
                      selectedAssignedIds,
                      toggleAssignedSelection,
                      moveToAvailable,
                      t('assignment.noUsersAssigned'),
                    )}
                  </div>
                  <div className="pt-3 mt-2 border-t border-border">
                    <Button
                      type="button"
                      onClick={unassignSelected}
                      disabled={disabled || selectedAssignedIds.size === 0}
                      className="w-full"
                    >
                      <i className="fa-solid fa-angles-left text-xs"></i>
                      {t('assignment.unassignSelected')}
                      {selectedAssignedIds.size > 0 && (
                        <span className="bg-primary-foreground/20 px-1.5 py-0.5 rounded text-xs">
                          {selectedAssignedIds.size}
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              {t('buttons.cancel')}
            </Button>
            <Button type="button" onClick={handleSave} disabled={disabled || loadState !== 'ready'}>
              {t('buttons.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

export default UserAssignmentModal;
