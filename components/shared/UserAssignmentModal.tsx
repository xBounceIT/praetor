import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../types';
import Modal from './Modal';
import StatusBadge from './StatusBadge';

type LoadState = 'loading' | 'error' | 'ready';

export interface UserAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  loadAssignedUserIds: () => Promise<string[]>;
  saveAssignedUserIds: (userIds: string[]) => Promise<void>;
  entityLabel: string;
  entityName: string;
  disabled?: boolean;
}

const UserRow: React.FC<{
  user: User;
  isSelected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
}> = ({ user, isSelected, onSelect, onDoubleClick }) => (
  <div
    onClick={onSelect}
    onDoubleClick={onDoubleClick}
    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
      isSelected
        ? 'bg-praetor/5 border-praetor'
        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
    }`}
  >
    <div
      className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
        isSelected ? 'bg-praetor text-white' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {user.avatarInitials || user.name.substring(0, 2).toUpperCase()}
    </div>
    <div className="flex flex-col min-w-0 flex-1">
      <span
        className={`text-sm font-bold truncate ${isSelected ? 'text-slate-800' : 'text-slate-600'}`}
      >
        {user.name}
      </span>
    </div>
    <StatusBadge type={user.employeeType ?? 'app_user'} label={user.role} className="shrink-0" />
  </div>
);

const UserAssignmentModal: React.FC<UserAssignmentModalProps> = ({
  isOpen,
  onClose,
  users,
  loadAssignedUserIds,
  saveAssignedUserIds,
  entityLabel,
  entityName,
  disabled = false,
}) => {
  const { t } = useTranslation('common');
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('ready');
  const [userSearch, setUserSearch] = useState('');
  const [selectedAvailableIds, setSelectedAvailableIds] = useState<Set<string>>(new Set());
  const [selectedAssignedIds, setSelectedAssignedIds] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    setLoadState('loading');
    setAssignedUserIds([]);
    setSelectedAvailableIds(new Set());
    setSelectedAssignedIds(new Set());
    try {
      const ids = await loadAssignedUserIds();
      setAssignedUserIds(ids);
      setLoadState('ready');
    } catch (err) {
      console.error('Failed to load assignments', err);
      setLoadState('error');
    }
  }, [loadAssignedUserIds]);

  useEffect(() => {
    if (isOpen && !initializedRef.current) {
      initializedRef.current = true;
      load();
    }
    if (!isOpen) {
      initializedRef.current = false;
    }
  }, [isOpen, load]);

  const handleClose = useCallback(() => {
    setUserSearch('');
    setSelectedAvailableIds(new Set());
    setSelectedAssignedIds(new Set());
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (disabled) return;
    try {
      await saveAssignedUserIds(assignedUserIds);
      handleClose();
    } catch (err) {
      console.error('Failed to save assignments', err);
      alert(t('assignment.saveFailed'));
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
        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-2 text-slate-300">
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
          />
        ))}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[85vh]">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="font-bold text-lg text-slate-800 flex flex-col">
            <span>{t('assignment.title')}</span>
            <span className="text-xs font-normal text-slate-500 mt-0.5">
              {entityLabel}: <span className="font-bold text-praetor">{entityName}</span>
            </span>
          </h3>
          <button
            onClick={handleClose}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div className="p-4 border-b border-slate-100 bg-white">
          <div className="relative">
            <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
            <input
              type="text"
              placeholder={t('assignment.searchUsers')}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              disabled={loadState !== 'ready'}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              autoFocus={loadState === 'ready'}
            />
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/50">
          {loadState === 'loading' ? (
            <div className="flex items-center justify-center py-16 flex-1">
              <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
            </div>
          ) : loadState === 'error' ? (
            <div className="flex items-center justify-center py-16 flex-1">
              <div className="max-w-sm text-center space-y-4">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
                  <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-bold text-slate-800">{t('assignment.loadFailed')}</p>
                  <p className="text-sm text-slate-500">{t('assignment.loadRetryHint')}</p>
                </div>
                <button
                  type="button"
                  onClick={load}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
                >
                  <i className="fa-solid fa-rotate-right"></i>
                  {t('buttons.refresh')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex gap-0 overflow-hidden p-4">
              <div className="flex-1 flex flex-col min-w-0">
                <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3 px-1">
                  {t('assignment.availableUsers')}
                  <span className="ml-2 text-slate-300 font-normal">({availableUsers.length})</span>
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
                <div className="pt-3 mt-2 border-t border-slate-200/60">
                  <button
                    type="button"
                    onClick={assignSelected}
                    disabled={disabled || selectedAvailableIds.size === 0}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all ${
                      selectedAvailableIds.size > 0 && !disabled
                        ? 'bg-praetor text-white hover:bg-slate-700 active:scale-[0.98]'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {t('assignment.assignSelected')}
                    <i className="fa-solid fa-angles-right text-xs"></i>
                    {selectedAvailableIds.size > 0 && (
                      <span className="bg-white/20 px-1.5 py-0.5 rounded text-xs">
                        {selectedAvailableIds.size}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-center px-3 shrink-0">
                <div className="flex flex-col items-center gap-3 text-slate-300">
                  <i className="fa-solid fa-right-left text-lg"></i>
                </div>
              </div>

              <div className="flex-1 flex flex-col min-w-0">
                <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3 px-1">
                  {t('assignment.assignedUsers')}
                  <span className="ml-2 text-slate-300 font-normal">({assignedUsers.length})</span>
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
                <div className="pt-3 mt-2 border-t border-slate-200/60">
                  <button
                    type="button"
                    onClick={unassignSelected}
                    disabled={disabled || selectedAssignedIds.size === 0}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all ${
                      selectedAssignedIds.size > 0 && !disabled
                        ? 'bg-praetor text-white hover:bg-slate-700 active:scale-[0.98]'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {t('assignment.unassignSelected')}
                    <i className="fa-solid fa-angles-left text-xs"></i>
                    {selectedAssignedIds.size > 0 && (
                      <span className="bg-white/20 px-1.5 py-0.5 rounded text-xs">
                        {selectedAssignedIds.size}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-6 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors text-sm border border-slate-200"
          >
            {t('buttons.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={disabled || loadState !== 'ready'}
            className={`px-8 py-2.5 text-white font-bold rounded-xl transition-all shadow-lg active:scale-95 text-sm ${
              !disabled && loadState === 'ready'
                ? 'bg-praetor shadow-slate-200 hover:bg-slate-700'
                : 'bg-slate-300 shadow-none cursor-not-allowed'
            }`}
          >
            {t('buttons.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default UserAssignmentModal;
