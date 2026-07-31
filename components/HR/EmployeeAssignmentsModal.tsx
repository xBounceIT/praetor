import { ChevronLeft, ChevronRight, LoaderCircle, Search, TriangleAlert, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { cn } from '@/lib/utils';
import { useLatestRef } from '../../hooks/useLatestRef';
import { usersApi } from '../../services/api/users';
import type { Client, Project, ProjectTask, User } from '../../types';
import { toastError } from '../../utils/toast';
import Modal from '../shared/Modal';
import SelectControl from '../shared/SelectControl';

interface EmployeeAssignmentsModalProps {
  user: User | null;
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  isOpen: boolean;
  onClose: () => void;
}

type AssignmentsState = {
  clientIds: string[];
  projectIds: string[];
  taskIds: string[];
};

const EMPTY_ASSIGNMENTS: AssignmentsState = {
  clientIds: [],
  projectIds: [],
  taskIds: [],
};

type AssignmentKind = 'client' | 'project' | 'task';

const ASSIGNMENTS_PAGE_SIZE = 7;
const EMPTY_ASSIGNMENT_PAGES: Record<AssignmentKind, number> = {
  client: 0,
  project: 0,
  task: 0,
};

type EmployeeAssignmentsState = {
  assignments: AssignmentsState;
  initialAssignments: AssignmentsState;
  clientSearch: string;
  projectSearch: string;
  taskSearch: string;
  filterClientId: string;
  filterProjectId: string;
  pages: Record<AssignmentKind, number>;
  isLoadingAssignments: boolean;
  loadFailed: boolean;
};

type EmployeeAssignmentsAction =
  | { type: 'resetSession'; isLoadingAssignments: boolean }
  | { type: 'loadSuccess'; assignments: AssignmentsState }
  | { type: 'loadFailed' }
  | { type: 'setClientSearch'; value: string }
  | { type: 'setProjectSearch'; value: string }
  | { type: 'setTaskSearch'; value: string }
  | { type: 'setFilterClient'; value: string }
  | { type: 'setFilterProject'; value: string }
  | { type: 'setPage'; assignmentType: AssignmentKind; value: number }
  | {
      type: 'toggleAssignment';
      assignmentType: AssignmentKind;
      id: string;
      clients: Client[];
      projects: Project[];
      tasks: ProjectTask[];
    };

const createEmployeeAssignmentsState = (
  isLoadingAssignments = false,
): EmployeeAssignmentsState => ({
  assignments: EMPTY_ASSIGNMENTS,
  initialAssignments: EMPTY_ASSIGNMENTS,
  clientSearch: '',
  projectSearch: '',
  taskSearch: '',
  filterClientId: 'all',
  filterProjectId: 'all',
  pages: { ...EMPTY_ASSIGNMENT_PAGES },
  isLoadingAssignments,
  loadFailed: false,
});

const toggleAssignments = (
  prev: AssignmentsState,
  type: AssignmentKind,
  id: string,
  clients: Client[],
  projects: Project[],
  tasks: ProjectTask[],
): AssignmentsState => {
  const list =
    type === 'client' ? prev.clientIds : type === 'project' ? prev.projectIds : prev.taskIds;
  const isAdding = !list.includes(id);
  const newList = isAdding ? [...list, id] : list.filter((item) => item !== id);

  let newClientIds = prev.clientIds;
  let newProjectIds = prev.projectIds;
  let newTaskIds = prev.taskIds;

  if (type === 'task') {
    newTaskIds = newList;
    if (isAdding) {
      const task = tasks.find((item) => item.id === id);
      if (task) {
        const project = projects.find((item) => item.id === task.projectId);
        if (project && !newProjectIds.includes(project.id)) {
          newProjectIds = [...newProjectIds, project.id];
        }
        if (project) {
          const client = clients.find((item) => item.id === project.clientId);
          if (client && !newClientIds.includes(client.id)) {
            newClientIds = [...newClientIds, client.id];
          }
        }
      }
    } else {
      const task = tasks.find((item) => item.id === id);
      if (newTaskIds.length === 0) {
        newProjectIds = [];
        newClientIds = [];
      } else if (task) {
        const project = projects.find((item) => item.id === task.projectId);
        if (project) {
          const hasTaskForProject = newTaskIds.some((taskId) => {
            const remainingTask = tasks.find((item) => item.id === taskId);
            return remainingTask?.projectId === project.id;
          });

          if (!hasTaskForProject) {
            newProjectIds = newProjectIds.filter((projectId) => projectId !== project.id);
          }

          const client = clients.find((item) => item.id === project.clientId);
          if (client) {
            const hasProjectForClient = newProjectIds.some((projectId) => {
              const remainingProject = projects.find((item) => item.id === projectId);
              return remainingProject?.clientId === client.id;
            });

            if (!hasProjectForClient) {
              newClientIds = newClientIds.filter((clientId) => clientId !== client.id);
            }
          }
        }
      }
    }
  } else if (type === 'project') {
    newProjectIds = newList;
    const project = projects.find((item) => item.id === id);
    if (project) {
      if (isAdding) {
        if (!newClientIds.includes(project.clientId)) {
          newClientIds = [...newClientIds, project.clientId];
        }
      } else {
        const hasProjectForClient = newProjectIds.some((projectId) => {
          const remainingProject = projects.find((item) => item.id === projectId);
          return remainingProject?.clientId === project.clientId;
        });

        const hasTaskForClient = newTaskIds.some((taskId) => {
          const remainingTask = tasks.find((item) => item.id === taskId);
          const remainingProject = remainingTask
            ? projects.find((item) => item.id === remainingTask.projectId)
            : null;
          return remainingProject?.clientId === project.clientId;
        });

        if (!hasProjectForClient && !hasTaskForClient) {
          newClientIds = newClientIds.filter((clientId) => clientId !== project.clientId);
        }
      }
    }
  } else {
    newClientIds = newList;
  }

  return {
    clientIds: newClientIds,
    projectIds: newProjectIds,
    taskIds: newTaskIds,
  };
};

const employeeAssignmentsReducer = (
  state: EmployeeAssignmentsState,
  action: EmployeeAssignmentsAction,
): EmployeeAssignmentsState => {
  switch (action.type) {
    case 'resetSession':
      return createEmployeeAssignmentsState(action.isLoadingAssignments);
    case 'loadSuccess':
      return {
        ...state,
        assignments: action.assignments,
        initialAssignments: action.assignments,
        isLoadingAssignments: false,
        loadFailed: false,
      };
    case 'loadFailed':
      return { ...state, isLoadingAssignments: false, loadFailed: true };
    case 'setClientSearch':
      return { ...state, clientSearch: action.value, pages: { ...EMPTY_ASSIGNMENT_PAGES } };
    case 'setProjectSearch':
      return { ...state, projectSearch: action.value, pages: { ...EMPTY_ASSIGNMENT_PAGES } };
    case 'setTaskSearch':
      return { ...state, taskSearch: action.value, pages: { ...EMPTY_ASSIGNMENT_PAGES } };
    case 'setFilterClient':
      return { ...state, filterClientId: action.value, pages: { ...EMPTY_ASSIGNMENT_PAGES } };
    case 'setFilterProject':
      return { ...state, filterProjectId: action.value, pages: { ...EMPTY_ASSIGNMENT_PAGES } };
    case 'setPage':
      return {
        ...state,
        pages: { ...state.pages, [action.assignmentType]: action.value },
      };
    case 'toggleAssignment':
      return {
        ...state,
        assignments: toggleAssignments(
          state.assignments,
          action.assignmentType,
          action.id,
          action.clients,
          action.projects,
          action.tasks,
        ),
      };
    default:
      return state;
  }
};

type AssignmentColumnItem = {
  id: string;
  name: string;
  subtitle?: string;
};

const AssignmentColumn: React.FC<{
  title: string;
  searchLabel: string;
  searchValue: string;
  items: AssignmentColumnItem[];
  selectedIds: string[];
  emptyMessage: string;
  previousLabel: string;
  nextLabel: string;
  paginationLabel: string;
  page: number;
  formatSelectedCountLabel: (count: number) => string;
  formatShowingLabel: (start: number, end: number, total: number) => string;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onToggle: (id: string) => void;
}> = ({
  title,
  searchLabel,
  searchValue,
  items,
  selectedIds,
  emptyMessage,
  previousLabel,
  nextLabel,
  paginationLabel,
  page,
  formatSelectedCountLabel,
  formatShowingLabel,
  onSearchChange,
  onPageChange,
  onToggle,
}) => {
  const selectedIdSet = new Set(selectedIds);
  const pageCount = Math.max(1, Math.ceil(items.length / ASSIGNMENTS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const firstItemIndex = safePage * ASSIGNMENTS_PAGE_SIZE;
  const pageItems = items.slice(firstItemIndex, firstItemIndex + ASSIGNMENTS_PAGE_SIZE);
  const visibleStart = items.length === 0 ? 0 : firstItemIndex + 1;
  const visibleEnd = Math.min(firstItemIndex + ASSIGNMENTS_PAGE_SIZE, items.length);

  return (
    <section className="flex min-h-[31rem] min-w-0 flex-col rounded-lg border border-border bg-card p-3 shadow-xs">
      <div className="border-b border-border pb-3">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <h4 className="truncate text-sm font-semibold text-foreground">{title}</h4>
          <Badge variant="secondary" className="h-6 shrink-0 rounded-md px-2 font-medium">
            {formatSelectedCountLabel(selectedIds.length)}
          </Badge>
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={searchLabel}
            aria-label={searchLabel}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-9 bg-background pl-8"
          />
        </div>
      </div>
      <div className="flex-1 space-y-2 py-3">
        {pageItems.map((item) => {
          const selected = selectedIdSet.has(item.id);
          return (
            <label
              key={item.id}
              className={cn(
                'flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-[color,background-color,border-color,box-shadow]',
                'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
                selected
                  ? 'border-primary/40 bg-primary/5 text-foreground shadow-xs'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
              )}
            >
              <Checkbox
                checked={selected}
                onCheckedChange={() => onToggle(item.id)}
                aria-label={item.name}
              />
              <span className="min-w-0 text-sm font-medium">
                <span className="block truncate">{item.name}</span>
                {item.subtitle && (
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {item.subtitle}
                  </span>
                )}
              </span>
            </label>
          );
        })}
        {pageItems.length === 0 && (
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border px-4 text-center">
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        )}
      </div>
      <Pagination
        aria-label={`${title}: ${paginationLabel}`}
        className="border-t border-border pt-3"
      >
        <PaginationContent className="w-full justify-between gap-2">
          <PaginationItem>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`${previousLabel}: ${title}`}
              disabled={safePage === 0}
              onClick={() => onPageChange(safePage - 1)}
            >
              <ChevronLeft />
            </Button>
          </PaginationItem>
          <li className="min-w-0 truncate text-center text-xs tabular-nums text-muted-foreground">
            {formatShowingLabel(visibleStart, visibleEnd, items.length)}
          </li>
          <PaginationItem>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`${nextLabel}: ${title}`}
              disabled={safePage >= pageCount - 1}
              onClick={() => onPageChange(safePage + 1)}
            >
              <ChevronRight />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </section>
  );
};

const EmployeeAssignmentsHeader: React.FC<{
  title: string;
  closeLabel: string;
  onClose: () => void;
}> = ({ title, closeLabel, onClose }) => (
  <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-5 py-4 sm:px-6">
    <h3 className="truncate text-lg font-semibold text-foreground">{title}</h3>
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClose}
      aria-label={closeLabel}
      data-skip-initial-focus
    >
      <X />
    </Button>
  </div>
);

const EmployeeAssignmentsFooter: React.FC<{
  cancelLabel: string;
  saveLabel: string;
  isDirty: boolean;
  loadFailed: boolean;
  onClose: () => void;
  onSave: () => void;
}> = ({ cancelLabel, saveLabel, isDirty, loadFailed, onClose, onSave }) => (
  <div className="flex flex-col-reverse gap-2 border-t border-border bg-muted/30 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
    <Button type="button" variant="ghost" onClick={onClose}>
      {cancelLabel}
    </Button>
    <Button type="button" onClick={onSave} disabled={!isDirty || loadFailed}>
      {saveLabel}
    </Button>
  </div>
);

const AssignmentsLoadingState: React.FC = () => (
  <div className="flex items-center justify-center py-12">
    <LoaderCircle className="size-8 animate-spin text-primary" />
  </div>
);

const AssignmentsLoadError: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
    <TriangleAlert className="mb-3 size-8 text-destructive" />
    <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
  </div>
);

const AssignmentFilters: React.FC<{
  clientOptions: { id: string; name: string }[];
  projectOptions: { id: string; name: string }[];
  filterClientId: string;
  filterProjectId: string;
  clientPlaceholder: string;
  projectPlaceholder: string;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
}> = ({
  clientOptions,
  projectOptions,
  filterClientId,
  filterProjectId,
  clientPlaceholder,
  projectPlaceholder,
  onClientChange,
  onProjectChange,
}) => (
  <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
    <SelectControl
      options={clientOptions}
      value={filterClientId}
      onChange={(value) => onClientChange(value as string)}
      placeholder={clientPlaceholder}
      searchable={true}
      buttonClassName="w-full px-3 py-2 bg-background border border-border rounded-md text-sm font-medium text-foreground shadow-xs"
    />
    <SelectControl
      options={projectOptions}
      value={filterProjectId}
      onChange={(value) => onProjectChange(value as string)}
      placeholder={projectPlaceholder}
      searchable={true}
      buttonClassName="w-full px-3 py-2 bg-background border border-border rounded-md text-sm font-medium text-foreground shadow-xs"
      disabled={projectOptions.length === 1}
    />
  </div>
);

type EmployeeAssignmentOptionsInput = {
  clients: Client[];
  projects: Project[];
  tasks: ProjectTask[];
  clientSearch: string;
  projectSearch: string;
  taskSearch: string;
  filterClientId: string;
  filterProjectId: string;
};

const useEmployeeAssignmentOptions = ({
  clients,
  projects,
  tasks,
  clientSearch,
  projectSearch,
  taskSearch,
  filterClientId,
  filterProjectId,
}: EmployeeAssignmentOptionsInput) => {
  const { t } = useTranslation(['hr']);
  const filteredProjectsForFilter = useMemo(
    () =>
      filterClientId === 'all'
        ? projects
        : projects.filter((project) => project.clientId === filterClientId),
    [filterClientId, projects],
  );

  const clientFilterOptions = useMemo(
    () => [
      { id: 'all', name: t('hr:workforce.allClients') },
      ...clients.map((client) => ({ id: client.id, name: client.name })),
    ],
    [clients, t],
  );

  const projectFilterOptions = useMemo(
    () => [
      { id: 'all', name: t('hr:workforce.allProjects') },
      ...filteredProjectsForFilter.map((project) => ({ id: project.id, name: project.name })),
    ],
    [filteredProjectsForFilter, t],
  );

  const { visibleClients, visibleProjects, visibleTasks } = useMemo(() => {
    const searchClient = clientSearch.trim().toLocaleLowerCase();
    const searchProject = projectSearch.trim().toLocaleLowerCase();
    const searchTask = taskSearch.trim().toLocaleLowerCase();
    const selectedClientFilter = filterClientId !== 'all' ? filterClientId : null;
    const selectedProjectFilter = filterProjectId !== 'all' ? filterProjectId : null;

    const nextVisibleTasks = tasks.filter((task) => {
      if (selectedProjectFilter && task.projectId !== selectedProjectFilter) return false;
      if (searchTask && !task.name.toLocaleLowerCase().includes(searchTask)) return false;

      const project = projects.find((item) => item.id === task.projectId);
      if (!project) return false;

      if (selectedClientFilter && project.clientId !== selectedClientFilter) return false;
      if (searchProject && !project.name.toLocaleLowerCase().includes(searchProject)) return false;

      const client = clients.find((item) => item.id === project.clientId);
      if (!client) return false;

      if (searchClient && !client.name.toLocaleLowerCase().includes(searchClient)) return false;
      return true;
    });

    const nextVisibleProjects = projects.filter((project) => {
      if (selectedProjectFilter && project.id !== selectedProjectFilter) return false;
      if (selectedClientFilter && project.clientId !== selectedClientFilter) return false;
      if (searchProject && !project.name.toLocaleLowerCase().includes(searchProject)) return false;

      const client = clients.find((item) => item.id === project.clientId);
      if (!client) return false;

      if (searchClient && !client.name.toLocaleLowerCase().includes(searchClient)) return false;

      if (searchTask) {
        const hasMatchingTask = tasks.some(
          (task) =>
            task.projectId === project.id && task.name.toLocaleLowerCase().includes(searchTask),
        );
        if (!hasMatchingTask) return false;
      }

      return true;
    });

    const nextVisibleClients = clients.filter((client) => {
      if (selectedClientFilter && client.id !== selectedClientFilter) return false;

      if (selectedProjectFilter) {
        const selectedProject = projects.find((project) => project.id === selectedProjectFilter);
        if (!selectedProject || selectedProject.clientId !== client.id) return false;
      }

      if (searchClient && !client.name.toLocaleLowerCase().includes(searchClient)) return false;

      if (searchProject || searchTask) {
        const hasMatchingPath = projects.some((project) => {
          if (project.clientId !== client.id) return false;
          if (selectedProjectFilter && project.id !== selectedProjectFilter) return false;
          if (searchProject && !project.name.toLocaleLowerCase().includes(searchProject)) {
            return false;
          }

          if (searchTask) {
            return tasks.some(
              (task) =>
                task.projectId === project.id && task.name.toLocaleLowerCase().includes(searchTask),
            );
          }

          return true;
        });

        if (!hasMatchingPath) return false;
      }

      return true;
    });

    return {
      visibleClients: nextVisibleClients,
      visibleProjects: nextVisibleProjects,
      visibleTasks: nextVisibleTasks,
    };
  }, [
    clientSearch,
    clients,
    filterClientId,
    filterProjectId,
    projectSearch,
    projects,
    taskSearch,
    tasks,
  ]);

  const visibleClientItems = useMemo(
    () => visibleClients.map((client) => ({ id: client.id, name: client.name })),
    [visibleClients],
  );
  const visibleProjectItems = useMemo(
    () =>
      visibleProjects.map((project) => ({
        id: project.id,
        name: project.name,
        subtitle:
          clients.find((client) => client.id === project.clientId)?.name ||
          t('hr:workforce.unknownClient'),
      })),
    [clients, visibleProjects, t],
  );
  const visibleTaskItems = useMemo(
    () =>
      visibleTasks.map((task) => ({
        id: task.id,
        name: task.name,
        subtitle:
          projects.find((project) => project.id === task.projectId)?.name ||
          t('hr:workforce.unknownProject'),
      })),
    [projects, visibleTasks, t],
  );

  return {
    clientFilterOptions,
    projectFilterOptions,
    visibleClientItems,
    visibleProjectItems,
    visibleTaskItems,
  };
};

const EmployeeAssignmentsModal: React.FC<EmployeeAssignmentsModalProps> = ({
  user,
  clients,
  projects,
  tasks,
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation(['hr', 'common']);
  const [state, dispatch] = useReducer(
    employeeAssignmentsReducer,
    undefined,
    createEmployeeAssignmentsState,
  );
  const {
    assignments,
    initialAssignments,
    clientSearch,
    projectSearch,
    taskSearch,
    filterClientId,
    filterProjectId,
    pages,
    isLoadingAssignments,
    loadFailed,
  } = state;
  const modalSessionKey = isOpen && user ? user.id : 'closed';
  const [activeModalSessionKey, setActiveModalSessionKey] = useState(modalSessionKey);
  const translationRef = useLatestRef(t);

  if (activeModalSessionKey !== modalSessionKey) {
    setActiveModalSessionKey(modalSessionKey);
    dispatch({ type: 'resetSession', isLoadingAssignments: modalSessionKey !== 'closed' });
  }

  const assignmentUserId = isOpen ? user?.id : undefined;

  useEffect(() => {
    if (!assignmentUserId) return;

    let isCancelled = false;

    const loadAssignments = async () => {
      try {
        const data = await usersApi.getAssignments(assignmentUserId);
        if (isCancelled) return;
        dispatch({ type: 'loadSuccess', assignments: data });
      } catch (err) {
        if (isCancelled) return;
        console.error('Failed to load assignments', err);
        dispatch({ type: 'loadFailed' });
        toastError(translationRef.current('hr:workforce.failedToLoadAssignments'));
      }
    };

    loadAssignments();

    return () => {
      isCancelled = true;
    };
  }, [assignmentUserId, translationRef]);

  const {
    clientFilterOptions,
    projectFilterOptions,
    visibleClientItems,
    visibleProjectItems,
    visibleTaskItems,
  } = useEmployeeAssignmentOptions({
    clientSearch,
    clients,
    filterClientId,
    filterProjectId,
    projectSearch,
    projects,
    taskSearch,
    tasks,
  });

  const toggleAssignment = (assignmentType: AssignmentKind, id: string) => {
    dispatch({ type: 'toggleAssignment', assignmentType, id, clients, projects, tasks });
  };

  const handleClientFilterChange = (value: string) => {
    dispatch({ type: 'setFilterClient', value });
    if (value === 'all' || filterProjectId === 'all') return;

    const selectedProject = projects.find((project) => project.id === filterProjectId);
    if (!selectedProject || selectedProject.clientId !== value) {
      dispatch({ type: 'setFilterProject', value: 'all' });
    }
  };

  const saveAssignments = async () => {
    if (!user) return;

    try {
      await usersApi.updateAssignments(
        user.id,
        assignments.clientIds,
        assignments.projectIds,
        assignments.taskIds,
      );
      onClose();
    } catch (err) {
      console.error('Failed to save assignments', err);
      toastError((err as Error).message || t('hr:competenceCenters.failedToSaveAssignments'));
    }
  };

  if (!isOpen || !user) {
    return null;
  }

  const isDirty = JSON.stringify(assignments) !== JSON.stringify(initialAssignments);
  const formatShowingLabel = (start: number, end: number, total: number) =>
    t('common:pagination.showing', { start, end, total });
  const formatSelectedCountLabel = (count: number) => t('hr:workforce.selectedCount', { count });
  const previousLabel = t('common:buttons.previous');
  const nextLabel = t('common:buttons.next');
  const paginationLabel = t('common:pagination.page');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('hr:workforce.manageAccess', { name: user.name })}
      zIndex={50}
      backdropClass="bg-black/50 backdrop-blur-sm"
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl animate-in fade-in zoom-in-95 animation-duration-200">
        <EmployeeAssignmentsHeader
          title={t('hr:workforce.manageAccess', { name: user.name })}
          closeLabel={t('common:buttons.close')}
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isLoadingAssignments ? (
            <AssignmentsLoadingState />
          ) : loadFailed ? (
            <AssignmentsLoadError message={t('hr:workforce.failedToLoadAssignments')} />
          ) : (
            <>
              <AssignmentFilters
                clientOptions={clientFilterOptions}
                projectOptions={projectFilterOptions}
                filterClientId={filterClientId}
                filterProjectId={filterProjectId}
                clientPlaceholder={t('hr:workforce.filterByClient')}
                projectPlaceholder={t('hr:workforce.filterByProject')}
                onClientChange={handleClientFilterChange}
                onProjectChange={(value) => dispatch({ type: 'setFilterProject', value })}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <AssignmentColumn
                  title={t('hr:workforce.clients')}
                  searchLabel={t('hr:workforce.searchClients')}
                  searchValue={clientSearch}
                  items={visibleClientItems}
                  selectedIds={assignments.clientIds}
                  emptyMessage={t('hr:workforce.noClientsFound')}
                  previousLabel={previousLabel}
                  nextLabel={nextLabel}
                  paginationLabel={paginationLabel}
                  page={pages.client}
                  formatSelectedCountLabel={formatSelectedCountLabel}
                  formatShowingLabel={formatShowingLabel}
                  onSearchChange={(value) => dispatch({ type: 'setClientSearch', value })}
                  onPageChange={(value) =>
                    dispatch({ type: 'setPage', assignmentType: 'client', value })
                  }
                  onToggle={(id) => toggleAssignment('client', id)}
                />
                <AssignmentColumn
                  title={t('hr:workforce.projects')}
                  searchLabel={t('hr:workforce.searchProjects')}
                  searchValue={projectSearch}
                  items={visibleProjectItems}
                  selectedIds={assignments.projectIds}
                  emptyMessage={t('hr:workforce.noProjectsFound')}
                  previousLabel={previousLabel}
                  nextLabel={nextLabel}
                  paginationLabel={paginationLabel}
                  page={pages.project}
                  formatSelectedCountLabel={formatSelectedCountLabel}
                  formatShowingLabel={formatShowingLabel}
                  onSearchChange={(value) => dispatch({ type: 'setProjectSearch', value })}
                  onPageChange={(value) =>
                    dispatch({ type: 'setPage', assignmentType: 'project', value })
                  }
                  onToggle={(id) => toggleAssignment('project', id)}
                />
                <AssignmentColumn
                  title={t('hr:workforce.tasks')}
                  searchLabel={t('hr:workforce.searchTasks')}
                  searchValue={taskSearch}
                  items={visibleTaskItems}
                  selectedIds={assignments.taskIds}
                  emptyMessage={t('hr:workforce.noTasksFound')}
                  previousLabel={previousLabel}
                  nextLabel={nextLabel}
                  paginationLabel={paginationLabel}
                  page={pages.task}
                  formatSelectedCountLabel={formatSelectedCountLabel}
                  formatShowingLabel={formatShowingLabel}
                  onSearchChange={(value) => dispatch({ type: 'setTaskSearch', value })}
                  onPageChange={(value) =>
                    dispatch({ type: 'setPage', assignmentType: 'task', value })
                  }
                  onToggle={(id) => toggleAssignment('task', id)}
                />
              </div>
            </>
          )}
        </div>

        <EmployeeAssignmentsFooter
          cancelLabel={t('common:buttons.cancel')}
          saveLabel={t('hr:workforce.saveAssignments')}
          isDirty={isDirty}
          loadFailed={loadFailed}
          onClose={onClose}
          onSave={saveAssignments}
        />
      </div>
    </Modal>
  );
};

export default EmployeeAssignmentsModal;
