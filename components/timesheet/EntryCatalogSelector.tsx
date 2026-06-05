import type React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Client, Project, ProjectTask, TimeEntryLocation } from '../../types';
import SelectControl from '../shared/SelectControl';
import { CUSTOM_TASK_SENTINEL } from './useCatalogSelection';

export interface EntryCatalogSelectorErrors {
  clientId?: string;
  projectId?: string;
  task?: string;
}

export interface EntryCatalogSelectorProps {
  clients: Client[];
  filteredProjects: Project[];
  filteredTasks: ProjectTask[];
  selectedClientId: string;
  selectedProjectId: string;
  selectedTaskId: string;
  location: TimeEntryLocation;
  onClientChange: (id: string) => void;
  onProjectChange: (id: string) => void;
  onTaskChange: (taskId: string) => void;
  onLocationChange: (location: TimeEntryLocation) => void;
  errors?: EntryCatalogSelectorErrors;
  // Show the "+ Custom Task..." option in the task dropdown. The parent
  // intercepts `onTaskChange(CUSTOM_TASK_SENTINEL)` to open a modal — the
  // selector itself never renders an inline custom-task input.
  allowCustomTask?: boolean;
  showLocation?: boolean;
  className?: string;
  extraTrailing?: React.ReactNode;
}

const EntryCatalogSelector: React.FC<EntryCatalogSelectorProps> = ({
  clients,
  filteredProjects,
  filteredTasks,
  selectedClientId,
  selectedProjectId,
  selectedTaskId,
  location,
  onClientChange,
  onProjectChange,
  onTaskChange,
  onLocationChange,
  errors,
  allowCustomTask = false,
  showLocation = true,
  className,
  extraTrailing,
}) => {
  const { t } = useTranslation('timesheets');

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
  const projectOptions = filteredProjects.map((p) => ({ id: p.id, name: p.name }));
  const taskOptions = filteredTasks.map((task) => ({ id: task.id, name: task.name }));
  if (allowCustomTask) {
    taskOptions.push({ id: CUSTOM_TASK_SENTINEL, name: t('entry.customTask') });
  }

  const gridClass = cn(
    'grid grid-cols-1 md:grid-cols-2 gap-4 items-start',
    showLocation
      ? 'xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)]'
      : 'xl:grid-cols-3',
    extraTrailing
      ? 'xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto]'
      : null,
    className,
  );

  return (
    <div className={gridClass}>
      <div className="min-w-0">
        <SelectControl
          label={t('entry.client')}
          required
          options={clientOptions}
          value={selectedClientId}
          onChange={(val) => onClientChange(val as string)}
          searchable={true}
          className={errors?.clientId ? 'border-destructive' : ''}
        />
        {errors?.clientId && (
          <p className="text-destructive text-[10px] font-bold ml-1 mt-1">{errors.clientId}</p>
        )}
      </div>

      <div className="min-w-0">
        <SelectControl
          label={t('entry.project')}
          required
          options={projectOptions}
          value={selectedProjectId}
          onChange={(val) => onProjectChange(val as string)}
          placeholder={
            filteredProjects.length === 0 ? t('entry.noProjects') : t('entry.selectProject')
          }
          searchable={true}
          className={errors?.projectId ? 'border-destructive' : ''}
        />
        {errors?.projectId && (
          <p className="text-destructive text-[10px] font-bold ml-1 mt-1">{errors.projectId}</p>
        )}
      </div>

      <div className="min-w-0">
        <SelectControl
          label={t('entry.task')}
          required
          options={taskOptions}
          value={selectedTaskId}
          onChange={(val) => onTaskChange(val as string)}
          placeholder={
            filteredTasks.length === 0 && !allowCustomTask
              ? t('entry.noTasks')
              : t('entry.selectTask')
          }
          searchable={true}
          className={errors?.task ? 'border-destructive' : ''}
        />
        {errors?.task && (
          <p className="text-destructive text-[10px] font-bold ml-1 mt-1">{errors.task}</p>
        )}
      </div>

      {showLocation && (
        <div className="min-w-0">
          <SelectControl
            label={t('entry.location')}
            options={[
              { id: 'office', name: t('entry.locationTypes.office') },
              { id: 'customer_premise', name: t('entry.locationTypes.customerPremise') },
              { id: 'remote', name: t('entry.locationTypes.remote') },
              { id: 'transfer', name: t('entry.locationTypes.transfer') },
            ]}
            value={location}
            onChange={(val) => onLocationChange(val as TimeEntryLocation)}
          />
        </div>
      )}

      {extraTrailing}
    </div>
  );
};

export default EntryCatalogSelector;
