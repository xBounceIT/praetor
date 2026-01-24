import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import CustomSelect from './CustomSelect';
import StandardTable from './StandardTable';
import { Project, Client } from '../types';

interface ProjectsReadOnlyProps {
  projects: Project[];
  clients: Client[];
}

const ProjectsReadOnly: React.FC<ProjectsReadOnlyProps> = ({ projects, clients }) => {
  const { t } = useTranslation(['timesheets', 'common']);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClientId, setFilterClientId] = useState('all');

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_timesheets_projects_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_timesheets_projects_rowsPerPage', value.toString());
    setCurrentPage(1);
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const hasActiveFilters = normalizedSearch !== '' || filterClientId !== 'all';

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterClientId('all');
    setCurrentPage(1);
  };

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterClientId]);

  const clientLookup = React.useMemo(() => {
    return new Map(clients.map((client) => [client.id, client]));
  }, [clients]);

  const filteredProjectsTotal = React.useMemo(() => {
    return projects.filter((project) => {
      const client = clientLookup.get(project.clientId);
      const clientName = client?.name ?? '';
      const matchesSearch =
        normalizedSearch === '' ||
        project.name.toLowerCase().includes(normalizedSearch) ||
        (project.description ?? '').toLowerCase().includes(normalizedSearch) ||
        clientName.toLowerCase().includes(normalizedSearch);
      const matchesClient = filterClientId === 'all' || project.clientId === filterClientId;

      return matchesSearch && matchesClient;
    });
  }, [projects, clientLookup, normalizedSearch, filterClientId]);

  const totalPages = Math.ceil(filteredProjectsTotal.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const projectsPage = filteredProjectsTotal.slice(startIndex, startIndex + rowsPerPage);

  const clientOptions = [
    { id: 'all', name: t('projects.allClients') },
    ...clients.map((client) => ({ id: client.id, name: client.name })),
  ];

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            placeholder={t('projects:projects.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
          />
        </div>
        <div>
          <CustomSelect
            options={clientOptions}
            value={filterClientId}
            onChange={setFilterClientId}
            placeholder={t('projects.filterByClient')}
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
            {t('common:labels.clearFilters')}
          </button>
        </div>
      </div>

      <StandardTable
        title={t('projects.projectsDirectory')}
        totalCount={filteredProjectsTotal.length}
        containerClassName="rounded-xl"
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('common:pagination.rowsPerPage')}:
              </span>
              <CustomSelect
                options={[
                  { id: '5', name: '5' },
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={rowsPerPage.toString()}
                onChange={(val) => handleRowsPerPageChange(val)}
                className="w-20"
                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                searchable={false}
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('common:pagination.showing', {
                  start: projectsPage.length > 0 ? startIndex + 1 : 0,
                  end: Math.min(startIndex + rowsPerPage, filteredProjectsTotal.length),
                  total: filteredProjectsTotal.length,
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
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects.client')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects.projectName')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects.description')}
              </th>
              <th className="px-6 py-3 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                {t('projects.status')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredProjectsTotal.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                  {t('projects.noProjectsFound')}
                </td>
              </tr>
            ) : (
              projectsPage.map((project) => {
                const client = clientLookup.get(project.clientId);
                const isClientDisabled = client?.isDisabled || false;
                const isEffectivelyDisabled = project.isDisabled || isClientDisabled;

                return (
                  <tr
                    key={project.id}
                    className={`group hover:bg-slate-50 transition-colors ${isEffectivelyDisabled ? 'opacity-60 grayscale bg-slate-50/50' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <span
                        className={`text-[10px] font-black uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ${isClientDisabled ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-praetor'}`}
                      >
                        {client?.name || t('projects.unknown')}
                        {isClientDisabled && <span className="ml-1 text-[8px]">(DISABLED)</span>}
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
                        {project.description || t('projects.noDescription')}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      {project.isDisabled ? (
                        <span className="text-[10px] font-black text-amber-500 uppercase">
                          {t('projects.disabled')}
                        </span>
                      ) : isClientDisabled ? (
                        <span className="text-[10px] font-black text-amber-400 uppercase">
                          {t('projects.inheritedDisable')}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black text-emerald-500 uppercase">
                          {t('projects.active')}
                        </span>
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

export default ProjectsReadOnly;
