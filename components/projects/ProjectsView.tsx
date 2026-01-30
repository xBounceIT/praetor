import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Project, Client, UserRole } from '../types';
import { COLORS } from '../constants';
import CustomSelect from '../CustomSelect';
import StandardTable, { Column } from '../StandardTable';
import StatusBadge from '../StatusBadge';
import Modal from '../Modal';

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

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in duration-300 flex flex-col max-h-[90vh] overflow-hidden">
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
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={closeModal}>
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
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">{t('projects:projects.title')}</h2>
            <p className="text-slate-500 text-sm">{t('projects:projects.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            {isManagement && (
              <button
                onClick={openAddModal}
                className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> {t('projects:projects.addProject')}
              </button>
            )}
          </div>
        </div>
      </div>

      <StandardTable<Project>
        title={t('projects:projects.projectsDirectory')}
        defaultRowsPerPage={5}
        data={projects}
        onRowClick={isManagement ? openEditModal : undefined}
        rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
        columns={
          [
            {
              header: t('projects:projects.tableHeaders.client'),
              id: 'client',
              accessorFn: (row) =>
                clients.find((c) => c.id === row.clientId)?.name || t('projects:projects.unknown'),
              cell: ({ row }) => {
                const client = clients.find((c) => c.id === row.clientId);
                const isClientDisabled = client?.isDisabled || false;
                return (
                  <span
                    className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${
                      isClientDisabled
                        ? 'text-amber-600 bg-amber-50 border-amber-100'
                        : row.isDisabled
                          ? 'text-slate-400'
                          : 'text-praetor'
                    }`}
                  >
                    {client?.name || t('projects:projects.unknown')}
                    {isClientDisabled && (
                      <span className="ml-1 text-[8px]">
                        {t('projects:projects.disabledLabel')}
                      </span>
                    )}
                  </span>
                );
              },
            },
            {
              header: t('projects:projects.tableHeaders.projectName'),
              accessorKey: 'name',
              cell: ({ row }) => (
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  <span
                    className={`text-sm font-bold ${
                      row.isDisabled
                        ? 'text-slate-600 line-through decoration-slate-300'
                        : 'text-slate-800'
                    }`}
                  >
                    {row.name}
                  </span>
                </div>
              ),
            },
            {
              header: t('projects:projects.tableHeaders.description'),
              accessorKey: 'description',
              cell: ({ row }) => (
                <p
                  className={`text-xs max-w-md italic line-clamp-1 ${
                    row.isDisabled ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  {row.description || t('projects:projects.noDescriptionProvided')}
                </p>
              ),
            },
            {
              header: t('projects:projects.tableHeaders.status'),
              id: 'status',
              accessorFn: (row) => {
                const client = clients.find((c) => c.id === row.clientId);
                if (row.isDisabled) return t('projects:projects.statusDisabled');
                if (client?.isDisabled) return t('projects:projects.statusInheritedDisable');
                return t('projects:projects.statusActive');
              },
              cell: ({ row }) => {
                const client = clients.find((c) => c.id === row.clientId);
                const isClientDisabled = client?.isDisabled || false;
                if (row.isDisabled) {
                  return (
                    <StatusBadge type="disabled" label={t('projects:projects.statusDisabled')} />
                  );
                }
                if (isClientDisabled) {
                  return (
                    <StatusBadge
                      type="inherited"
                      label={t('projects:projects.statusInheritedDisable')}
                    />
                  );
                }
                return <StatusBadge type="active" label={t('projects:projects.statusActive')} />;
              },
            },
            {
              header: t('projects:projects.tableHeaders.actions'),
              id: 'actions',
              align: 'right',
              disableSorting: true,
              disableFiltering: true,
              cell: ({ row }) =>
                isManagement ? (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(row);
                      }}
                      className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                      title={t('projects:projects.editProject')}
                    >
                      <i className="fa-solid fa-pen-to-square"></i>
                    </button>
                    {row.isDisabled ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateProject(row.id, { isDisabled: false });
                        }}
                        className="p-2 text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                        title={t('projects:projects.enableProject')}
                      >
                        <i className="fa-solid fa-rotate-left"></i>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateProject(row.id, { isDisabled: true });
                        }}
                        className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                        title={t('projects:projects.disableProject')}
                      >
                        <i className="fa-solid fa-ban"></i>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        promptDelete(row);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      title={t('common:buttons.delete')}
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                ) : null,
            },
          ] as Column<Project>[]
        }
      />
    </div>
  );
};

export default ProjectsView;
