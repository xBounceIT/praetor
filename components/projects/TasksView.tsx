import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectTask, Project, Client, UserRole, User } from '../../types';
import CustomSelect from '../shared/CustomSelect';
import StandardTable, { Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import { tasksApi } from '../../services/api';
import Modal from '../shared/Modal';

interface TasksViewProps {
  tasks: ProjectTask[];
  projects: Project[];
  clients: Client[];
  role: UserRole;
  users: User[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAddTask: (name: string, projectId: string, recurringConfig?: any, description?: string) => void;
  onUpdateTask: (id: string, updates: Partial<ProjectTask>) => void;
  onDeleteTask: (id: string) => void;
}

const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  projects,
  clients,
  role,
  users,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
}) => {
  const { t } = useTranslation(['projects', 'common']);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [tempIsDisabled, setTempIsDisabled] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  // Assignment State
  const [managingTaskId, setManagingTaskId] = useState<string | null>(null);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // Pagination State

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_tasks_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_tasks_rowsPerPage', value.toString());
    setCurrentPage(1);
  };

  const checkInheritedDisabled = useCallback(
    (task: ProjectTask) => {
      const project = projects.find((p) => p.id === task.projectId);
      const client = clients.find((c) => c.id === project?.clientId);
      return project?.isDisabled || false || client?.isDisabled || false;
    },
    [projects, clients],
  );

  // Pagination Logic
  const totalPages = Math.ceil(tasks.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedTasks = tasks.slice(startIndex, startIndex + rowsPerPage);

  const isManagement = role === 'admin' || role === 'manager';

  // Column definitions for StandardTable
  const columns: Column<ProjectTask>[] = useMemo(
    () => [
      {
        header: t('common:labels.client'),
        accessorFn: (task) => {
          const project = projects.find((p) => p.id === task.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          return client?.name || '—';
        },
        cell: ({ row }) => {
          const project = projects.find((p) => p.id === row.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          const isClientDisabled = client?.isDisabled || false;
          return client ? (
            <span
              className={`text-sm font-bold ${isClientDisabled ? 'text-amber-500' : 'text-slate-700'}`}
            >
              {client.name} {isClientDisabled && t('projects.disabledLabel')}
            </span>
          ) : (
            <span className="text-xs text-slate-400 italic">—</span>
          );
        },
      },
      {
        header: t('tasks.project'),
        accessorFn: (task) => {
          const project = projects.find((p) => p.id === task.projectId);
          return project?.name || t('projects.unknown');
        },
        cell: ({ row }) => {
          const project = projects.find((p) => p.id === row.projectId);
          const isProjectDisabled = project?.isDisabled || false;
          return (
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: project?.color || '#ccc' }}
              ></div>
              <span
                className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${
                  isProjectDisabled ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-praetor'
                }`}
              >
                {project?.name || t('projects.unknown')}
              </span>
            </div>
          );
        },
      },
      {
        header: t('tasks.name'),
        accessorKey: 'name',
        cell: ({ value, row }) => {
          const isDisabled = row.isDisabled || checkInheritedDisabled(row);
          return (
            <span
              className={`text-sm font-bold ${isDisabled ? 'text-slate-600 line-through decoration-slate-300' : 'text-slate-800'}`}
            >
              {value}
            </span>
          );
        },
      },
      {
        header: t('tasks.description'),
        accessorFn: (task) => task.description || '',
        cell: ({ value, row }) => {
          const isDisabled = row.isDisabled || checkInheritedDisabled(row);
          return (
            <p
              className={`text-xs truncate max-w-50 ${isDisabled ? 'text-slate-400 italic' : 'text-slate-500'}`}
            >
              {value || (
                <span className="italic text-slate-400">{t('projects.noDescriptionProvided')}</span>
              )}
            </p>
          );
        },
      },
      {
        header: t('projects.tableHeaders.status'),
        accessorFn: (task) => {
          const project = projects.find((p) => p.id === task.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          const isProjectDisabled = project?.isDisabled || false;
          const isClientDisabled = client?.isDisabled || false;
          const isInheritedDisabled = isProjectDisabled || isClientDisabled;
          if (task.isDisabled) return t('projects:projects.statusDisabled');
          if (isInheritedDisabled) return t('projects:projects.statusInheritedDisable');
          return t('projects:projects.statusActive');
        },
        cell: ({ row }) => {
          const project = projects.find((p) => p.id === row.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          const isProjectDisabled = project?.isDisabled || false;
          const isClientDisabled = client?.isDisabled || false;
          const isInheritedDisabled = isProjectDisabled || isClientDisabled;
          if (row.isDisabled) {
            return <StatusBadge type="disabled" label={t('projects:projects.statusDisabled')} />;
          }
          if (isInheritedDisabled) {
            return (
              <StatusBadge type="inherited" label={t('projects:projects.statusInheritedDisable')} />
            );
          }
          return <StatusBadge type="active" label={t('projects:projects.statusActive')} />;
        },
      },
      {
        header: t('projects.tableHeaders.actions'),
        id: 'actions',
        className: 'text-right w-[140px]',
        headerClassName: 'text-right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => {
          if (!isManagement) return null;
          const project = projects.find((p) => p.id === row.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          const isInheritedDisabled = project?.isDisabled || client?.isDisabled;
          const isTaskDisabled = row.isDisabled;

          return (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openAssignments(row.id);
                }}
                className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                title={t('tasks.manageMembers')}
              >
                <i className="fa-solid fa-users"></i>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEditModal(row);
                }}
                className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                title={t('tasks.editTask')}
              >
                <i className="fa-solid fa-pen-to-square"></i>
              </button>
              {!isInheritedDisabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateTask(row.id, { isDisabled: !isTaskDisabled });
                  }}
                  className={`p-2 rounded-lg transition-all ${
                    isTaskDisabled
                      ? 'text-praetor hover:bg-slate-100'
                      : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                  }`}
                  title={
                    isTaskDisabled ? t('projects.enableProject') : t('projects.disableProject')
                  }
                >
                  <i className={`fa-solid ${isTaskDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTask(row);
                  confirmDelete();
                }}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                title={t('common:buttons.delete')}
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            </div>
          );
        },
      },
    ],
    [t, projects, clients, isManagement, onUpdateTask, checkInheritedDisabled],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && projectId) {
      if (editingTask) {
        onUpdateTask(editingTask.id, { name, projectId, description, isDisabled: tempIsDisabled });
      } else {
        onAddTask(name, projectId, undefined, description);
      }
      closeModal();
    }
  };

  const openAddModal = () => {
    setEditingTask(null);
    setName('');
    setProjectId('');
    setDescription('');
    setTempIsDisabled(false);
    setIsModalOpen(true);
  };

  const openEditModal = (task: ProjectTask) => {
    setEditingTask(task);
    setName(task.name);
    setProjectId(task.projectId);
    setDescription(task.description || '');
    setTempIsDisabled(task.isDisabled || false);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setIsDeleteConfirmOpen(false);
    setEditingTask(null);
    setName('');
    setProjectId('');
    setDescription('');
  };

  const confirmDelete = () => {
    setIsDeleteConfirmOpen(true);
  };

  const cancelDelete = () => {
    setIsDeleteConfirmOpen(false);
  };

  const handleDelete = () => {
    if (editingTask) {
      onDeleteTask(editingTask.id);
      closeModal();
    }
  };

  // Assignment Handlers
  const openAssignments = async (taskId: string) => {
    setManagingTaskId(taskId);
    setIsLoadingAssignments(true);
    setAssignedUserIds([]);
    try {
      const userIds = await tasksApi.getUsers(taskId);
      setAssignedUserIds(userIds);
    } catch (err) {
      console.error('Failed to load task users', err);
      // Optional: show error notification
    } finally {
      setIsLoadingAssignments(false);
    }
  };

  const closeAssignments = () => {
    setManagingTaskId(null);
    setAssignedUserIds([]);
    setUserSearch('');
  };

  const toggleUserAssignment = (userId: string) => {
    setAssignedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const saveAssignments = async () => {
    if (!managingTaskId) return;
    try {
      await tasksApi.updateUsers(managingTaskId, assignedUserIds);
      closeAssignments();
      // Optional: show success notification
    } catch (err) {
      console.error('Failed to save task users', err);
      alert('Failed to save assignments');
    }
  };

  const projectSelectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  const managingTask = tasks.find((t) => t.id === managingTaskId);

  // Filter users for assignment modal
  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.username.toLowerCase().includes(userSearch.toLowerCase()),
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={cancelDelete}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">{t('tasks.deleteTaskTitle')}</h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                <span
                  dangerouslySetInnerHTML={{
                    __html: t('tasks.deleteConfirmDesc', { name: editingTask?.name }),
                  }}
                />
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={cancelDelete}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('tasks.yesDelete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* User Assignment Modal */}
      <Modal isOpen={!!managingTaskId} onClose={closeAssignments}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[85vh]">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="font-bold text-lg text-slate-800 flex flex-col">
              <span>{t('tasks.assignUsers')}</span>
              <span className="text-xs font-normal text-slate-500 mt-0.5">
                {t('common:labels.task')}:{' '}
                <span className="font-bold text-praetor">{managingTask?.name}</span>
              </span>
            </h3>
            <button
              onClick={closeAssignments}
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
                placeholder={t('tasks.searchUsers')}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none text-sm font-medium transition-all"
                autoFocus
              />
            </div>
          </div>

          <div className="p-4 overflow-y-auto flex-1 bg-slate-50/50">
            {isLoadingAssignments ? (
              <div className="flex items-center justify-center py-12">
                <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map((user) => (
                  <label
                    key={user.id}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      assignedUserIds.includes(user.id)
                        ? 'bg-white border-praetor shadow-sm ring-1 ring-praetor/10'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
                          assignedUserIds.includes(user.id)
                            ? 'bg-praetor text-white'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {user.avatarInitials || user.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex flex-col">
                        <span
                          className={`text-sm font-bold ${assignedUserIds.includes(user.id) ? 'text-slate-800' : 'text-slate-600'}`}
                        >
                          {user.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">{user.role}</span>
                      </div>
                    </div>
                    <div
                      className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${
                        assignedUserIds.includes(user.id)
                          ? 'bg-praetor border-praetor'
                          : 'bg-white border-slate-300'
                      }`}
                    >
                      {assignedUserIds.includes(user.id) && (
                        <i className="fa-solid fa-check text-white text-xs"></i>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={assignedUserIds.includes(user.id)}
                      onChange={() => toggleUserAssignment(user.id)}
                    />
                  </label>
                ))}
                {filteredUsers.length === 0 && (
                  <div className="text-center py-12 text-slate-400 italic text-sm">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-300">
                      <i className="fa-solid fa-user-slash text-2xl"></i>
                    </div>
                    {t('tasks.noUsersFound')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
            <button
              onClick={closeAssignments}
              className="px-6 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors text-sm border border-slate-200"
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              onClick={saveAssignments}
              className="px-8 py-2.5 bg-praetor text-white font-bold rounded-xl hover:bg-slate-700 transition-all shadow-lg shadow-slate-200 active:scale-95 text-sm"
            >
              {t('common:buttons.save')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-300">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingTask ? 'fa-pen-to-square' : 'fa-list-check'}`}></i>
              </div>
              {editingTask ? t('tasks.editTask') : t('tasks.createNewTask')}
            </h3>
            <button
              onClick={closeModal}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">{t('tasks.project')}</label>
              <CustomSelect
                options={projectSelectOptions}
                value={projectId}
                onChange={(val) => setProjectId(val as string)}
                placeholder={t('projects.selectProject')}
                searchable={true}
                buttonClassName="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-praetor shadow-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">{t('tasks.name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('tasks.taskNamePlaceholder')}
                className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all font-medium"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('tasks.description')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('tasks.taskDescriptionPlaceholder')}
                rows={3}
                className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none font-medium"
              />
            </div>

            {/* Status toggles - logic wrapped for conditional rendering */}
            {(() => {
              const project = projects.find((p) => p.id === projectId);
              const client = clients.find((c) => c.id === project?.clientId);
              const isProjectDisabled = project?.isDisabled || false;
              const isClientDisabled = client?.isDisabled || false;
              const isInheritedDisabled = isProjectDisabled || isClientDisabled;
              const isCurrentlyDisabled = tempIsDisabled || isInheritedDisabled;

              return (
                <div className="space-y-2 pt-2">
                  <div
                    className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                      isCurrentlyDisabled
                        ? 'bg-red-50 border-red-100'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <p
                      className={`text-sm font-black ${
                        isCurrentlyDisabled ? 'text-red-700' : 'text-slate-700'
                      }`}
                    >
                      {t('tasks.isDisabled')}
                    </p>
                    <button
                      type="button"
                      disabled={isInheritedDisabled}
                      onClick={() => {
                        if (!isInheritedDisabled) {
                          setTempIsDisabled(!tempIsDisabled);
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        isCurrentlyDisabled ? 'bg-red-500' : 'bg-slate-300'
                      } ${isInheritedDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isCurrentlyDisabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  {isInheritedDisabled && (
                    <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1.5 px-1 ml-1">
                      <i className="fa-solid fa-triangle-exclamation"></i>
                      {isClientDisabled
                        ? t('projects.inheritedFromDisabledClient', { clientName: client?.name })
                        : t('tasks.inheritedFromDisabledProject', {
                            projectName: project?.name,
                          })}
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="pt-6 flex items-center justify-between gap-4 border-t border-slate-100 mt-2">
              {editingTask && (
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="px-5 py-2.5 rounded-xl text-red-600 hover:bg-red-50 text-sm font-bold transition-all border border-transparent hover:border-red-100"
                >
                  <i className="fa-solid fa-trash-can mr-2"></i>
                  {t('common:buttons.delete')}
                </button>
              )}

              <div className="flex gap-3 ml-auto">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
                >
                  {t('common:buttons.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-8 py-2.5 rounded-xl text-white text-sm font-bold shadow-lg transform active:scale-95 transition-all bg-praetor shadow-slate-200 hover:bg-slate-700"
                >
                  {editingTask ? t('projects.saveChanges') : t('tasks.addTask')}
                </button>
              </div>
            </div>
          </form>
        </div>
      </Modal>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">{t('tasks.title')}</h2>
            <p className="text-slate-500 text-sm">{t('tasks.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            {isManagement && (
              <button
                onClick={openAddModal}
                className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> {t('tasks.addTask')}
              </button>
            )}
          </div>
        </div>
      </div>

      <StandardTable
        title={t('tasks.tasksDirectory')}
        data={paginatedTasks}
        columns={columns}
        defaultRowsPerPage={rowsPerPage}
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('common:labels.rowsPerPage')}
              </span>
              <CustomSelect
                options={[
                  { id: '5', name: '5' },
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={rowsPerPage.toString()}
                onChange={(val) => handleRowsPerPageChange(val as string)}
                className="w-20"
                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                searchable={false}
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('common:pagination.showing', {
                  start: paginatedTasks.length > 0 ? startIndex + 1 : 0,
                  end: Math.min(startIndex + rowsPerPage, tasks.length),
                  total: tasks.length,
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-left text-xs"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      currentPage === page
                        ? 'bg-praetor text-white shadow-md shadow-slate-200'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-right text-xs"></i>
              </button>
            </div>
          </>
        }
      />
    </div>
  );
};

export default TasksView;
