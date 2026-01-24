import React, { useState } from 'react';
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
  const { t } = useTranslation(['projects', 'common']);
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [description, setDescription] = useState('');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [tempIsDisabled, setTempIsDisabled] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isManagement = role === 'admin' || role === 'manager';

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

  const openCreateModal = () => {
    setEditingProject(null);
    setName('');
    setClientId('');
    setDescription('');
    setColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
    setErrors({});
    setIsModalOpen(true);
  };

  const startEditing = (project: Project) => {
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
    setName('');
    setClientId('');
    setDescription('');
    setErrors({});
  };

  const confirmDelete = () => {
    setIsDeleteConfirmOpen(true);
  };

  const cancelDelete = () => {
    setIsDeleteConfirmOpen(false);
  };

  const handleDelete = () => {
    if (editingProject) {
      onDeleteProject(editingProject.id);
      closeModal();
    }
  };

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <i className="fa-solid fa-triangle-exclamation text-red-600 text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {t('common:messages.deleteConfirmNamed', { name: editingProject?.name })}
                </h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t('common:messages.deleteConfirmNamed', { name: editingProject?.name })}
                  {t('projects:projects.deleteConfirm')}
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
                  {t('common:buttons.delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Modal Overlay (For Editing Only Now) */}
      {isModalOpen && editingProject && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-2xl">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <i className="fa-solid fa-pen-to-square text-praetor"></i>
                {t('projects:projects.editProject')}
              </h3>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="space-y-2">
                <CustomSelect
                  label={t('projects:projects.client')}
                  options={clientOptions}
                  value={clientId}
                  onChange={(val) => {
                    setClientId(val);
                    if (errors.clientId) setErrors({ ...errors, clientId: '' });
                  }}
                  placeholder={t('projects:projects.selectClient')}
                  searchable={true}
                  className={errors.clientId ? 'border-red-300' : ''}
                />
                {errors.clientId && (
                  <p className="text-red-500 text-[10px] font-bold">{errors.clientId}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">
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
                  className={`w-full text-sm px-4 py-3 border rounded-xl outline-none focus:ring-2 bg-slate-50 focus:bg-white transition-all ${errors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                  autoFocus
                />
                {errors.name && <p className="text-red-500 text-[10px] font-bold">{errors.name}</p>}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">
                  {t('projects:projects.description')}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('projects:projects.descriptionPlaceholder')}
                  rows={3}
                  className="w-full text-sm px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-praetor bg-slate-50 focus:bg-white transition-all resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">
                  {t('projects:projects.color')}
                </label>
                <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
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

              {(() => {
                const client = clients.find((c) => c.id === clientId);
                const isClientDisabled = client?.isDisabled || false;
                const isCurrentlyDisabled = tempIsDisabled || isClientDisabled;

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <p
                          className={`text-sm font-bold ${isClientDisabled ? 'text-slate-400' : 'text-slate-700'}`}
                        >
                          {t('projects:projects.projectDisabled')}
                        </p>
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
                    {isClientDisabled && (
                      <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1 px-1">
                        <i className="fa-solid fa-circle-info"></i>
                        {t('projects:projects.inheritedFromDisabledClient', {
                          clientName: client?.name,
                        })}
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="pt-4 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="px-5 py-2.5 rounded-xl text-white text-sm font-bold shadow-lg transform active:scale-95 transition-all bg-red-500 shadow-red-200 hover:bg-red-600"
                >
                  {t('common:buttons.delete')}
                </button>

                <div className="flex gap-3 ml-auto">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    {t('common:buttons.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl text-white text-sm font-bold shadow-lg transform active:scale-95 transition-all bg-praetor shadow-slate-200 hover:bg-slate-700"
                  >
                    {t('projects:projects.saveChanges')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Creation Form (Visible to management) */}
      {isManagement && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <i className="fa-solid fa-briefcase text-praetor"></i>
            {t('projects:projects.createNewProject')}
          </h3>
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end"
          >
            <div className="lg:col-span-1">
              <CustomSelect
                label={t('projects:projects.client')}
                options={clientOptions}
                value={clientId}
                onChange={setClientId}
                placeholder={t('projects:projects.selectClient')}
                searchable={true}
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                {t('projects:projects.name')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('projects:projects.projectNamePlaceholder')}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                {t('projects:projects.description')}
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('projects:projects.projectDetailsPlaceholder')}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none text-sm font-semibold"
              />
            </div>
            <div className="lg:col-span-1">
              <button
                type="submit"
                className="w-full px-6 py-2 bg-praetor text-white font-bold rounded-lg hover:bg-slate-700 transition-all h-[38px] shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-plus"></i> {t('projects:projects.addProject')}
              </button>
            </div>
          </form>
        </div>
      )}

      <StandardTable
        title={`${t('projects:projects.projectsDirectory')} (${projects.length})`}
        totalCount={undefined}
        containerClassName="rounded-xl overflow-hidden"
      >
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects:projects.tableHeaders.client')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects:projects.tableHeaders.projectName')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects:projects.tableHeaders.description')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects:projects.tableHeaders.status')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest text-right">
                {t('projects:projects.tableHeaders.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {projects.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                  {t('projects:projects.noProjects')}
                </td>
              </tr>
            ) : (
              projects.map((project) => {
                const client = clients.find((c) => c.id === project.clientId);
                const isClientDisabled = client?.isDisabled || false;
                const isEffectivelyDisabled = project.isDisabled || isClientDisabled;

                return (
                  <tr
                    key={project.id}
                    onClick={() => startEditing(project)}
                    className={`group hover:bg-slate-50 transition-colors cursor-pointer ${isEffectivelyDisabled ? 'opacity-60 grayscale bg-slate-50/50' : ''}`}
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
                        <span
                          className={`text-sm font-bold ${isEffectivelyDisabled ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}
                        >
                          {project.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-slate-500 max-w-md italic">
                        {project.description || t('projects:projects.noDescriptionProvided')}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      {project.isDisabled ? (
                        <span className="text-[10px] font-black text-amber-500 uppercase">
                          {t('projects:projects.statusDisabled')}
                        </span>
                      ) : isClientDisabled ? (
                        <span className="text-[10px] font-black text-amber-400 uppercase">
                          {t('projects:projects.statusInheritedDisable')}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black text-emerald-500 uppercase">
                          {t('projects:projects.statusActive')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isManagement && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(project);
                          }}
                          className="text-slate-400 hover:text-praetor transition-colors p-2"
                          title={t('projects:projects.editProject')}
                        >
                          <i className="fa-solid fa-pen-to-square"></i>
                        </button>
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

export default ProjectsView;
