import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Project, Client, UserRole } from '../types';
import { COLORS } from '../constants';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';

interface ProjectsViewProps {
  projects: Project[];
  clients: Client[];
  role: UserRole;
  onAddProject: (name: string, clientId: string, description?: string) => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onDeleteProject: (id: string) => void;
}

const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  clients,
  role,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
}) => {
  const { t } = useTranslation(['projects', 'common', 'form']);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [tempIsDisabled, setTempIsDisabled] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_projects_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });
  const [disabledCurrentPage, setDisabledCurrentPage] = useState(1);
  const [disabledRowsPerPage, setDisabledRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_projects_disabled_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_projects_rowsPerPage', value.toString());
    setCurrentPage(1);
  };

  const handleDisabledRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setDisabledRowsPerPage(value);
    localStorage.setItem('praetor_projects_disabled_rowsPerPage', value.toString());
    setDisabledCurrentPage(1);
  };

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClientId, setFilterClientId] = useState('all');

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const hasActiveFilters = normalizedSearch !== '' || filterClientId !== 'all';

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterClientId('all');
    setCurrentPage(1);
    setDisabledCurrentPage(1);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
    setDisabledCurrentPage(1);
  };

  const handleFilterClientChange = (val: string) => {
    setFilterClientId(val);
    setCurrentPage(1);
    setDisabledCurrentPage(1);
  };

  const isManagement = role === 'admin' || role === 'manager';

  // Modal Handlers
  const openAddModal = () => {
    setEditingProject(null);
    setName('');
    setClientId('');
    setDescription('');
    setColor(COLORS[0]);
    setTempIsDisabled(false);
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setName(project.name);
    setClientId(project.clientId);
    setDescription(project.description || '');
    setColor(project.color);
    setTempIsDisabled(project.isDisabled || false);
    setErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setIsDeleteConfirmOpen(false);
    setEditingProject(null);
    setProjectToDelete(null);
    setErrors({});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const newErrors: Record<string, string> = {};
    if (!name?.trim()) newErrors.name = t('projects:projects.projectNameRequired');
    if (!clientId) newErrors.clientId = t('projects:projects.clientRequired');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (editingProject) {
      onUpdateProject(editingProject.id, {
        name,
        clientId,
        description,
        color,
        isDisabled: tempIsDisabled,
      });
    } else {
      onAddProject(name, clientId, description);
    }
    closeModal();
  };

  const promptDelete = (project: Project) => {
    setProjectToDelete(project);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (projectToDelete) {
      onDeleteProject(projectToDelete.id);
      closeModal();
    }
  };

  // Filter Logic
  const matchesFilters = useCallback(
    (project: Project) => {
      const client = clients.find((c) => c.id === project.clientId);
      const clientName = client?.name.toLowerCase() || '';

      const matchesSearch =
        normalizedSearch === '' ||
        project.name.toLowerCase().includes(normalizedSearch) ||
        clientName.includes(normalizedSearch) ||
        (project.description || '').toLowerCase().includes(normalizedSearch);

      const matchesClient = filterClientId === 'all' || project.clientId === filterClientId;

      return matchesSearch && matchesClient;
    },
    [clients, normalizedSearch, filterClientId],
  );

  const filteredActiveProjectsTotal = useMemo(() => {
    return projects.filter((p) => !p.isDisabled).filter(matchesFilters);
  }, [projects, matchesFilters]);

  const filteredDisabledProjectsTotal = useMemo(() => {
    return projects.filter((p) => p.isDisabled).filter(matchesFilters);
  }, [projects, matchesFilters]);

  const hasAnyDisabledProjects = projects.some((p) => p.isDisabled);

  // Pagination Logic
  const totalPages = Math.ceil(filteredActiveProjectsTotal.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const activeProjects = filteredActiveProjectsTotal.slice(startIndex, startIndex + rowsPerPage);

  const disabledTotalPages = Math.ceil(filteredDisabledProjectsTotal.length / disabledRowsPerPage);
  const disabledStartIndex = (disabledCurrentPage - 1) * disabledRowsPerPage;
  const disabledProjectsPage = filteredDisabledProjectsTotal.slice(
    disabledStartIndex,
    disabledStartIndex + disabledRowsPerPage,
  );

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
  const filterClientOptions = [
    { id: 'all', name: t('common:filters.allClients') },
    ...clientOptions,
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in duration-300 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i
                    className={`fa-solid ${editingProject ? 'fa-pen-to-square' : 'fa-briefcase'}`}
                  ></i>
                </div>
                {editingProject
                  ? t('projects:projects.editProject')
                  : t('projects:projects.createNewProject')}
              </h3>
              <button
                onClick={closeModal}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('projects:projects.client')}
                  </label>
                  <CustomSelect
                    options={clientOptions}
                    value={clientId}
                    onChange={(val) => {
                      setClientId(val as string);
                      if (errors.clientId) setErrors({ ...errors, clientId: '' });
                    }}
                    placeholder={t('projects:projects.selectClient')}
                    searchable={true}
                    className={errors.clientId ? 'border-red-300' : ''}
                    buttonClassName={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${errors.clientId ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}
                  />
                  {errors.clientId && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientId}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('projects:projects.name')}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (errors.name) setErrors({ ...errors, name: '' });
                    }}
                    placeholder={t('projects:projects.projectNamePlaceholder')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                      errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200'
                    }`}
                  />
                  {errors.name && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('projects:projects.description')}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('projects:projects.descriptionPlaceholder')}
                    rows={3}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('projects:projects.color')}
                  </label>
                  <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`w-8 h-8 rounded-full border-2 transition-all transform active:scale-90 ${color === c ? 'border-praetor scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>

                {editingProject && (
                  <div className="space-y-1.5">
                    {(() => {
                      const client = clients.find((c) => c.id === clientId);
                      const isClientDisabled = client?.isDisabled || false;
                      const isCurrentlyDisabled = tempIsDisabled || isClientDisabled;

                      return (
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                          <div>
                            <p
                              className={`text-sm font-bold ${isClientDisabled ? 'text-slate-400' : 'text-slate-700'}`}
                            >
                              {t('projects:projects.projectDisabled')}
                            </p>
                            {isClientDisabled && (
                              <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1 mt-1">
                                <i className="fa-solid fa-circle-info"></i>
                                {t('projects:projects.inheritedFromDisabledClient', {
                                  clientName: client?.name,
                                })}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={isClientDisabled}
                            onClick={() => {
                              if (!isClientDisabled) {
                                setTempIsDisabled(!tempIsDisabled);
                              }
                            }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isCurrentlyDisabled ? 'bg-red-500' : 'bg-slate-300'} ${isClientDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isCurrentlyDisabled ? 'translate-x-6' : 'translate-x-1'}`}
                            />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-slate-100 gap-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
                >
                  {t('common:buttons.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-8 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {editingProject ? t('common:buttons.update') : t('projects:projects.addProject')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {t('common:messages.deleteConfirmNamed', { name: projectToDelete?.name })}
                </h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t('common:messages.deleteConfirmNamed', { name: projectToDelete?.name })}
                  {t('projects:projects.deleteConfirm')}
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeModal}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  {t('common:buttons.cancel')}
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                >
                  {t('common:buttons.delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('projects:projects.title')}</h2>
          <p className="text-slate-500 text-sm">{t('projects:projects.subtitle')}</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            placeholder={t('common:form.searchPlaceholder')}
            value={searchTerm}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
          />
        </div>
        <div>
          <CustomSelect
            options={filterClientOptions}
            value={filterClientId}
            onChange={(val) => handleFilterClientChange(val as string)}
            placeholder={t('projects:projects.selectClient')}
            searchable={true}
            buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleClearFilters}
            disabled={!hasActiveFilters}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-rotate-left"></i>
            {t('common:form.clearFilters')}
          </button>
        </div>
      </div>

      <StandardTable
        title={t('projects:projects.projectsDirectory')}
        totalCount={filteredActiveProjectsTotal.length}
        headerAction={
          isManagement ? (
            <button
              onClick={openAddModal}
              className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i> {t('projects:projects.addProject')}
            </button>
          ) : undefined
        }
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
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
                  start: activeProjects.length > 0 ? startIndex + 1 : 0,
                  end: Math.min(startIndex + rowsPerPage, filteredActiveProjectsTotal.length),
                  total: filteredActiveProjectsTotal.length,
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
      >
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest w-[160px]">
                {t('projects:projects.tableHeaders.client')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest w-[200px]">
                {t('projects:projects.tableHeaders.projectName')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects:projects.tableHeaders.description')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest w-[120px]">
                {t('projects:projects.tableHeaders.status')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right w-[140px]">
                {t('projects:projects.tableHeaders.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredActiveProjectsTotal.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                    <i className="fa-solid fa-briefcase text-2xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-bold">
                    {t('projects:projects.noProjects')}
                  </p>
                  {isManagement && (
                    <button
                      onClick={openAddModal}
                      className="mt-4 text-praetor text-sm font-black hover:underline"
                    >
                      {t('projects:projects.createNewProject')}
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              activeProjects.map((project) => {
                const client = clients.find((c) => c.id === project.clientId);
                const isClientDisabled = client?.isDisabled || false;

                return (
                  <tr
                    key={project.id}
                    onClick={() => isManagement && openEditModal(project)}
                    className={`group hover:bg-slate-50 transition-colors ${isManagement ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <td className="px-6 py-4">
                      <span
                        className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${isClientDisabled ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-praetor'}`}
                      >
                        {client?.name || t('projects:projects.unknown')}
                        {isClientDisabled && (
                          <span className="ml-1 text-[8px]">
                            {t('projects:projects.disabledLabel')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: project.color }}
                        ></div>
                        <span className="text-sm font-bold text-slate-800">{project.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-slate-500 max-w-md italic line-clamp-1">
                        {project.description || t('projects:projects.noDescriptionProvided')}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[10px] font-black text-emerald-500 uppercase">
                        {t('projects:projects.statusActive')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isManagement && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(project);
                            }}
                            className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                            title={t('projects:projects.editProject')}
                          >
                            <i className="fa-solid fa-pen-to-square"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateProject(project.id, { isDisabled: true });
                            }}
                            className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                            title={t('projects:projects.disableProject')}
                          >
                            <i className="fa-solid fa-ban"></i>
                          </button>
                          {/* Admin only maybe? keeping it for management now */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              promptDelete(project);
                            }}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title={t('common:buttons.delete')}
                          >
                            <i className="fa-solid fa-trash-can"></i>
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

      {hasAnyDisabledProjects && (
        <StandardTable
          title={t('projects:projects.disabledProjects')}
          totalCount={filteredDisabledProjectsTotal.length}
          totalLabel="DISABLED"
          containerClassName="border-dashed bg-slate-50"
          footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
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
                  value={disabledRowsPerPage.toString()}
                  onChange={(val) => handleDisabledRowsPerPageChange(val as string)}
                  className="w-20"
                  buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                  searchable={false}
                />
                <span className="text-xs font-bold text-slate-400 ml-2">
                  {t('common:pagination.showing', {
                    start: disabledProjectsPage.length > 0 ? disabledStartIndex + 1 : 0,
                    end: Math.min(
                      disabledStartIndex + disabledRowsPerPage,
                      filteredDisabledProjectsTotal.length,
                    ),
                    total: filteredDisabledProjectsTotal.length,
                  })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDisabledCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={disabledCurrentPage === 1}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  <i className="fa-solid fa-chevron-left text-xs"></i>
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: disabledTotalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setDisabledCurrentPage(page)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                        disabledCurrentPage === page
                          ? 'bg-praetor text-white shadow-md shadow-slate-200'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() =>
                    setDisabledCurrentPage((prev) => Math.min(disabledTotalPages, prev + 1))
                  }
                  disabled={disabledCurrentPage === disabledTotalPages || disabledTotalPages === 0}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  <i className="fa-solid fa-chevron-right text-xs"></i>
                </button>
              </div>
            </>
          }
        >
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest w-[160px]">
                  {t('projects:projects.tableHeaders.client')}
                </th>
                <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest w-[200px]">
                  {t('projects:projects.tableHeaders.projectName')}
                </th>
                <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  {t('projects:projects.tableHeaders.description')}
                </th>
                <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest w-[120px]">
                  {t('projects:projects.tableHeaders.status')}
                </th>
                <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right w-[140px]">
                  {t('projects:projects.tableHeaders.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {disabledProjectsPage.map((project) => {
                const client = clients.find((c) => c.id === project.clientId);
                const isClientDisabled = client?.isDisabled || false;

                return (
                  <tr
                    key={project.id}
                    onClick={() => isManagement && openEditModal(project)}
                    className={`group hover:bg-slate-100 transition-colors opacity-70 grayscale hover:grayscale-0 ${isManagement ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <td className="px-6 py-4">
                      <span
                        className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${isClientDisabled ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-slate-400'}`}
                      >
                        {client?.name || t('projects:projects.unknown')}
                        {isClientDisabled && (
                          <span className="ml-1 text-[8px]">
                            {t('projects:projects.disabledLabel')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: project.color }}
                        ></div>
                        <span className="text-sm font-bold text-slate-600 line-through decoration-slate-300">
                          {project.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-slate-400 max-w-md italic line-clamp-1">
                        {project.description || t('projects:projects.noDescriptionProvided')}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[10px] font-black text-amber-500 uppercase">
                        {t('projects:projects.statusDisabled')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isManagement && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(project);
                            }}
                            className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                            title={t('projects:projects.editProject')}
                          >
                            <i className="fa-solid fa-pen-to-square"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateProject(project.id, { isDisabled: false });
                            }}
                            className="p-2 text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <i className="fa-solid fa-rotate-left"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              promptDelete(project);
                            }}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title={t('common:buttons.delete')}
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StandardTable>
      )}
    </div>
  );
};

export default ProjectsView;
