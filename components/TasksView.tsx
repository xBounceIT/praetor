import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectTask, Project, Client, UserRole, User } from '../types';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import { tasksApi } from '../services/api';

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

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('all');

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const hasActiveFilters = normalizedSearch !== '' || filterProjectId !== 'all';

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterProjectId('all');
  };

  const filteredTasks = tasks.filter((t) => {
    const matchesSearch =
      normalizedSearch === '' ||
      t.name.toLowerCase().includes(normalizedSearch) ||
      (t.description || '').toLowerCase().includes(normalizedSearch);

    const matchesProject = filterProjectId === 'all' || t.projectId === filterProjectId;

    return matchesSearch && matchesProject;
  });

  const projectFilterOptions = [
    { id: 'all', name: t('common:filters.allProjects') },
    ...projects.map((p) => ({ id: p.id, name: p.name })),
  ];

  const isManagement = role === 'manager';

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

  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

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
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
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
        </div>
      )}

      {/* User Assignment Modal */}
      {managingTaskId && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
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
        </div>
      )}

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i
                    className={`fa-solid ${editingTask ? 'fa-pen-to-square' : 'fa-list-check'}`}
                  ></i>
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
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('tasks.project')}
                </label>
                <CustomSelect
                  options={projectOptions}
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
                          : 'bg-emerald-50 border-emerald-100'
                      }`}
                    >
                      <div className="flex gap-3 items-center">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            isCurrentlyDisabled
                              ? 'bg-white text-red-500'
                              : 'bg-white text-emerald-500'
                          }`}
                        >
                          <i
                            className={`fa-solid ${isCurrentlyDisabled ? 'fa-ban' : 'fa-check'}`}
                          ></i>
                        </div>
                        <div>
                          <p
                            className={`text-sm font-black ${
                              isCurrentlyDisabled ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {t('tasks.isDisabled')}
                          </p>
                          <p
                            className={`text-[10px] font-bold ${
                              isCurrentlyDisabled ? 'text-red-500/70' : 'text-emerald-500/70'
                            }`}
                          >
                            {isCurrentlyDisabled
                              ? t('projects.statusDisabled')
                              : t('projects.statusActive')}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isInheritedDisabled}
                        onClick={() => {
                          if (!isInheritedDisabled) {
                            setTempIsDisabled(!tempIsDisabled);
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          isCurrentlyDisabled ? 'bg-red-500' : 'bg-emerald-500'
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
        </div>
      )}

      {/* Header & Filters */}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('tasks.title')}</h2>
          <p className="text-slate-500 text-sm">{t('tasks.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-5 relative">
            <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
            <input
              type="text"
              placeholder={t('tasks.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
            />
          </div>
          <div className="md:col-span-4">
            <CustomSelect
              options={projectFilterOptions}
              value={filterProjectId}
              onChange={(val) => setFilterProjectId(val as string)}
              placeholder={t('common:filters.filterByProject')}
              searchable={true}
              buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button
              type="button"
              onClick={handleClearFilters}
              disabled={!hasActiveFilters}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <i className="fa-solid fa-rotate-left"></i>
              {t('common:filters.clearFilters')}
            </button>
          </div>
        </div>
      </div>

      <StandardTable
        title={t('tasks.tasksDirectoryWithCount', { count: filteredTasks.length })}
        totalCount={filteredTasks.length}
        headerAction={
          isManagement && (
            <button
              onClick={openAddModal}
              className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i> {t('tasks.addTask')}
            </button>
          )
        }
        containerClassName="rounded-xl overflow-hidden shadow-sm border border-slate-200"
      >
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('tasks.project')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('tasks.name')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('tasks.description')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects.tableHeaders.status')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">
                {t('projects.tableHeaders.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                    <i className="fa-solid fa-list-check text-2xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-bold">{t('tasks.noTasks')}</p>
                  {isManagement && (
                    <button
                      onClick={openAddModal}
                      className="mt-4 text-praetor text-sm font-black hover:underline"
                    >
                      {t('tasks.createFirstTask')}
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => {
                const project = projects.find((p) => p.id === task.projectId);
                const client = clients.find((c) => c.id === project?.clientId);

                const isProjectDisabled = project?.isDisabled || false;
                const isClientDisabled = client?.isDisabled || false;
                const isInheritedDisabled = isProjectDisabled || isClientDisabled;
                const isEffectivelyDisabled = task.isDisabled || isInheritedDisabled;

                return (
                  <tr
                    key={task.id}
                    onClick={() => {
                      if (isManagement) {
                        openEditModal(task);
                      }
                    }}
                    className={`group hover:bg-slate-50 transition-colors ${
                      isManagement ? 'cursor-pointer' : 'cursor-default'
                    } ${isEffectivelyDisabled ? 'opacity-60 grayscale bg-slate-50/50' : ''}`}
                  >
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: project?.color || '#ccc' }}
                          ></div>
                          <span
                            className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${
                              isProjectDisabled
                                ? 'text-amber-600 bg-amber-50 border-amber-100'
                                : 'text-praetor'
                            }`}
                          >
                            {project?.name || t('projects.unknown')}
                            {isProjectDisabled && (
                              <span className="ml-1 text-[8px]">{t('projects.disabledLabel')}</span>
                            )}
                          </span>
                        </div>
                        {client && (
                          <span
                            className={`text-[9px] font-bold ml-4 ${
                              isClientDisabled ? 'text-amber-500' : 'text-slate-400'
                            }`}
                          >
                            {t('projects.client')}: {client.name}{' '}
                            {isClientDisabled && t('projects.disabledLabel')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center">
                          <i className="fa-solid fa-check-double text-xs"></i>
                        </div>
                        <span
                          className={`text-sm font-bold ${
                            isEffectivelyDisabled
                              ? 'text-slate-500 line-through decoration-slate-300'
                              : 'text-slate-800'
                          }`}
                        >
                          {task.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <p className="text-xs text-slate-500 max-w-md line-clamp-2">
                        {task.description || (
                          <span className="italic text-slate-400">
                            {t('projects.noDescriptionProvided')}
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="px-6 py-5">
                      {task.isDisabled ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 text-[10px] font-black uppercase">
                          <i className="fa-solid fa-ban"></i>
                          {t('projects.statusDisabled')}
                        </span>
                      ) : isInheritedDisabled ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-500 border border-amber-100 text-[10px] font-black uppercase">
                          <i className="fa-solid fa-triangle-exclamation"></i>
                          {t('projects.statusInheritedDisable')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-black uppercase">
                          <i className="fa-solid fa-check"></i>
                          {t('projects.statusActive')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-5 text-right">
                      {isManagement && (
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openAssignments(task.id);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-praetor hover:bg-slate-100 transition-all"
                            title={t('tasks.manageMembers')}
                          >
                            <i className="fa-solid fa-users"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(task);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-praetor hover:bg-slate-100 transition-all"
                            title={t('tasks.editTask')}
                          >
                            <i className="fa-solid fa-pen-to-square"></i>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </StandardTable>
    </div>
  );
};

export default TasksView;
