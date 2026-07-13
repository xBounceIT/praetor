import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
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

type UserAssignmentState = {
  assignedUserIds: string[];
  loadState: LoadState;
  userSearch: string;
  selectedAvailableIds: Set<string>;
  selectedAssignedIds: Set<string>;
  isSaving: boolean;
};

type UserAssignmentAction =
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; userIds: string[] }
  | { type: 'loadError' }
  | { type: 'setUserSearch'; value: string }
  | { type: 'resetSelection' }
  | { type: 'saveStart' }
  | { type: 'saveDone' }
  | { type: 'toggleAvailable'; userId: string }
  | { type: 'toggleAssigned'; userId: string }
  | { type: 'moveToAssigned'; userId: string }
  | { type: 'moveToAvailable'; userId: string }
  | { type: 'assignSelected' }
  | { type: 'unassignSelected' };

const createUserAssignmentState = (): UserAssignmentState => ({
  assignedUserIds: [],
  loadState: 'ready',
  userSearch: '',
  selectedAvailableIds: new Set(),
  selectedAssignedIds: new Set(),
  isSaving: false,
});

const toggleSetValue = (values: Set<string>, value: string): Set<string> => {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
};

const removeSetValue = (values: Set<string>, value: string): Set<string> => {
  const next = new Set(values);
  next.delete(value);
  return next;
};

const userAssignmentReducer = (
  state: UserAssignmentState,
  action: UserAssignmentAction,
): UserAssignmentState => {
  switch (action.type) {
    case 'loadStart':
      return {
        ...state,
        assignedUserIds: [],
        loadState: 'loading',
        selectedAvailableIds: new Set(),
        selectedAssignedIds: new Set(),
      };
    case 'loadSuccess':
      return { ...state, assignedUserIds: action.userIds, loadState: 'ready' };
    case 'loadError':
      return { ...state, loadState: 'error' };
    case 'setUserSearch':
      return { ...state, userSearch: action.value };
    case 'resetSelection':
      return {
        ...state,
        userSearch: '',
        selectedAvailableIds: new Set(),
        selectedAssignedIds: new Set(),
      };
    case 'saveStart':
      return { ...state, isSaving: true };
    case 'saveDone':
      return { ...state, isSaving: false };
    case 'toggleAvailable':
      return {
        ...state,
        selectedAvailableIds: toggleSetValue(state.selectedAvailableIds, action.userId),
      };
    case 'toggleAssigned':
      return {
        ...state,
        selectedAssignedIds: toggleSetValue(state.selectedAssignedIds, action.userId),
      };
    case 'moveToAssigned':
      return {
        ...state,
        assignedUserIds: [...state.assignedUserIds, action.userId],
        selectedAvailableIds: removeSetValue(state.selectedAvailableIds, action.userId),
      };
    case 'moveToAvailable':
      return {
        ...state,
        assignedUserIds: state.assignedUserIds.filter((id) => id !== action.userId),
        selectedAssignedIds: removeSetValue(state.selectedAssignedIds, action.userId),
      };
    case 'assignSelected':
      return {
        ...state,
        assignedUserIds: [...state.assignedUserIds, ...state.selectedAvailableIds],
        selectedAvailableIds: new Set(),
      };
    case 'unassignSelected':
      return {
        ...state,
        assignedUserIds: state.assignedUserIds.filter((id) => !state.selectedAssignedIds.has(id)),
        selectedAssignedIds: new Set(),
      };
    default:
      return state;
  }
};

export interface UserAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  roles?: Role[];
  loadAssignedUserIds: (signal?: AbortSignal) => Promise<string[]>;
  saveAssignedUserIds: (userIds: string[]) => Promise<void>;
  entityLabel: string;
  entityName: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  loadErrorMessage?: string;
  saveErrorMessage?: string;
  saveButtonLabel?: React.ReactNode;
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
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      className={`flex w-full items-center gap-3 p-3 rounded-xl border text-left cursor-pointer transition-all ${
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
    </button>
  );
};

const UserAssignmentList: React.FC<{
  list: User[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDoubleClickUser: (id: string) => void;
  emptyMessage: string;
  roleLookup: Map<string, Role>;
}> = ({ list, selectedIds, onToggleSelect, onDoubleClickUser, emptyMessage, roleLookup }) => {
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

const AssignmentModalHeader: React.FC<{
  title?: React.ReactNode;
  description?: React.ReactNode;
  entityLabel: string;
  entityName: string;
  isSaving: boolean;
  onClose: () => void;
}> = ({ title, description, entityLabel, entityName, isSaving, onClose }) => {
  const { t } = useTranslation('common');

  return (
    <ModalHeader>
      <div>
        <ModalTitle>{title ?? t('assignment.title')}</ModalTitle>
        <ModalDescription>
          {description ?? (
            <>
              {entityLabel}: <span className="font-bold text-praetor">{entityName}</span>
            </>
          )}
        </ModalDescription>
      </div>
      <ModalCloseButton onClick={onClose} disabled={isSaving} />
    </ModalHeader>
  );
};

const AssignmentSearch: React.FC<{
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
          placeholder={t('assignment.searchUsers')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="pl-10"
        />
      </div>
    </div>
  );
};

const AssignmentModalFooter: React.FC<{
  disabled: boolean;
  isSaving: boolean;
  canSave: boolean;
  saveButtonLabel?: React.ReactNode;
  onCancel: () => void;
  onSave: () => void;
}> = ({ disabled, isSaving, canSave, saveButtonLabel, onCancel, onSave }) => {
  const { t } = useTranslation('common');

  return (
    <ModalFooter>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
        {t('buttons.cancel')}
      </Button>
      <Button type="button" onClick={onSave} disabled={disabled || isSaving || !canSave}>
        {isSaving ? t('buttons.saving') : (saveButtonLabel ?? t('buttons.save'))}
      </Button>
    </ModalFooter>
  );
};

const AssignmentLoadingState: React.FC = () => (
  <div className="flex flex-1 items-center justify-center py-16">
    <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor" aria-hidden="true"></i>
  </div>
);

const AssignmentErrorState: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation('common');

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="max-w-sm space-y-4 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <i className="fa-solid fa-triangle-exclamation text-2xl" aria-hidden="true"></i>
        </div>
        <div className="space-y-2">
          <p className="font-bold text-foreground text-sm">{t('assignment.loadFailed')}</p>
          <p className="text-muted-foreground text-sm">{t('assignment.loadRetryHint')}</p>
        </div>
        <Button type="button" onClick={onRetry} variant="outline">
          <i className="fa-solid fa-rotate-right" aria-hidden="true"></i>
          {t('buttons.refresh')}
        </Button>
      </div>
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
  title,
  description,
  loadErrorMessage,
  saveErrorMessage,
  saveButtonLabel,
  disabled = false,
}) => {
  const { t } = useTranslation('common');

  const roleLookup = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const [state, dispatch] = useReducer(userAssignmentReducer, undefined, createUserAssignmentState);
  const {
    assignedUserIds,
    loadState,
    userSearch,
    selectedAvailableIds,
    selectedAssignedIds,
    isSaving,
  } = state;
  const initializedRef = useRef(false);
  const loadAbortControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadAbortControllerRef.current?.abort();
    const controller = new AbortController();
    loadAbortControllerRef.current = controller;

    dispatch({ type: 'loadStart' });
    try {
      const ids = await loadAssignedUserIds(controller.signal);
      if (!controller.signal.aborted) {
        dispatch({ type: 'loadSuccess', userIds: ids });
      }
    } catch (err) {
      if (!controller.signal.aborted && !isAbortError(err)) {
        console.error('Failed to load assignments', err);
        dispatch({ type: 'loadError' });
        if (loadErrorMessage) {
          toastError(loadErrorMessage);
        }
      }
    } finally {
      if (loadAbortControllerRef.current === controller) {
        loadAbortControllerRef.current = null;
      }
    }
  }, [loadAssignedUserIds, loadErrorMessage]);

  useEffect(() => {
    if (isOpen) {
      if (initializedRef.current) return;
      initializedRef.current = true;
      load();
      return;
    }

    if (!initializedRef.current) return;
    initializedRef.current = false;
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = null;
    if (isSaving) dispatch({ type: 'saveDone' });
  }, [isOpen, isSaving, load]);

  useEffect(
    () => () => {
      loadAbortControllerRef.current?.abort();
      loadAbortControllerRef.current = null;
    },
    [],
  );

  const handleClose = useCallback(() => {
    if (isSaving) return;
    dispatch({ type: 'resetSelection' });
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = null;
    onClose();
  }, [isSaving, onClose]);

  const forceClose = useCallback(() => {
    dispatch({ type: 'resetSelection' });
    loadAbortControllerRef.current?.abort();
    loadAbortControllerRef.current = null;
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (disabled || isSaving || loadState !== 'ready') return;
    dispatch({ type: 'saveStart' });
    try {
      await saveAssignedUserIds(assignedUserIds);
      forceClose();
    } catch (err) {
      console.error('Failed to save assignments', err);
      toastError(saveErrorMessage || t('assignment.saveFailed'));
    } finally {
      dispatch({ type: 'saveDone' });
    }
  }, [
    disabled,
    isSaving,
    loadState,
    saveAssignedUserIds,
    assignedUserIds,
    forceClose,
    saveErrorMessage,
    t,
  ]);

  const toggleAvailableSelection = useCallback((userId: string) => {
    dispatch({ type: 'toggleAvailable', userId });
  }, []);

  const toggleAssignedSelection = useCallback((userId: string) => {
    dispatch({ type: 'toggleAssigned', userId });
  }, []);

  const moveToAssigned = useCallback(
    (userId: string) => {
      if (disabled) return;
      dispatch({ type: 'moveToAssigned', userId });
    },
    [disabled],
  );

  const moveToAvailable = useCallback(
    (userId: string) => {
      if (disabled) return;
      dispatch({ type: 'moveToAvailable', userId });
    },
    [disabled],
  );

  const assignSelected = useCallback(() => {
    if (disabled || selectedAvailableIds.size === 0) return;
    dispatch({ type: 'assignSelected' });
  }, [disabled, selectedAvailableIds]);

  const unassignSelected = useCallback(() => {
    if (disabled || selectedAssignedIds.size === 0) return;
    dispatch({ type: 'unassignSelected' });
  }, [disabled, selectedAssignedIds]);

  const searchLower = userSearch.toLowerCase();
  const assignedIdSet = useMemo(() => new Set(assignedUserIds), [assignedUserIds]);
  const assignedOrderById = useMemo(
    () => new Map(assignedUserIds.map((id, index) => [id, index])),
    [assignedUserIds],
  );

  const availableUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          !assignedIdSet.has(u.id) &&
          (u.name.toLowerCase().includes(searchLower) ||
            u.username.toLowerCase().includes(searchLower)),
      ),
    [users, assignedIdSet, searchLower],
  );

  const assignedUsers = useMemo(() => {
    return users
      .filter(
        (u) =>
          assignedIdSet.has(u.id) &&
          (u.name.toLowerCase().includes(searchLower) ||
            u.username.toLowerCase().includes(searchLower)),
      )
      .sort((a, b) => (assignedOrderById.get(a.id) ?? 0) - (assignedOrderById.get(b.id) ?? 0));
  }, [users, assignedIdSet, assignedOrderById, searchLower]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} ariaLabel={null}>
      {() => (
        <ModalContent size="2xl" className="max-h-[85vh]">
          <AssignmentModalHeader
            title={title}
            description={description}
            entityLabel={entityLabel}
            entityName={entityName}
            isSaving={isSaving}
            onClose={handleClose}
          />

          <AssignmentSearch
            value={userSearch}
            disabled={loadState !== 'ready'}
            onChange={(value) => dispatch({ type: 'setUserSearch', value })}
          />

          <ModalBody className="flex-1 overflow-hidden flex flex-col bg-muted/30 p-0">
            {loadState === 'loading' ? (
              <AssignmentLoadingState />
            ) : loadState === 'error' ? (
              <AssignmentErrorState onRetry={load} />
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
                    <UserAssignmentList
                      list={availableUsers}
                      selectedIds={selectedAvailableIds}
                      onToggleSelect={toggleAvailableSelection}
                      onDoubleClickUser={moveToAssigned}
                      emptyMessage={t('assignment.noUsersToAssign')}
                      roleLookup={roleLookup}
                    />
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
                    <UserAssignmentList
                      list={assignedUsers}
                      selectedIds={selectedAssignedIds}
                      onToggleSelect={toggleAssignedSelection}
                      onDoubleClickUser={moveToAvailable}
                      emptyMessage={t('assignment.noUsersAssigned')}
                      roleLookup={roleLookup}
                    />
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

          <AssignmentModalFooter
            disabled={disabled}
            isSaving={isSaving}
            canSave={loadState === 'ready'}
            saveButtonLabel={saveButtonLabel}
            onCancel={handleClose}
            onSave={handleSave}
          />
        </ModalContent>
      )}
    </Modal>
  );
};

export default UserAssignmentModal;
