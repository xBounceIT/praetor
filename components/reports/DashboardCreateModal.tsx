import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import type { ReportDashboard, ReportDashboardFolder } from '../../services/api/reports';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';

export interface DashboardCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'dashboard' | 'folder';
  folders: ReportDashboardFolder[];
  onCreated: (item: ReportDashboard | ReportDashboardFolder) => void;
}

const ROOT_FOLDER_VALUE = '__root__';

const DashboardCreateModal: React.FC<DashboardCreateModalProps> = ({
  isOpen,
  onClose,
  type,
  folders,
  onCreated,
}) => {
  const { t } = useTranslation('reports');
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState(ROOT_FOLDER_VALUE);

  useEffect(() => {
    if (isOpen) {
      setSelectedFolderId(ROOT_FOLDER_VALUE);
    }
  }, [isOpen]);

  const resetForm = () => {
    setName('');
    setError('');
    setSelectedFolderId(ROOT_FOLDER_VALUE);
  };

  const closeModal = () => {
    resetForm();
    onClose();
  };

  const handleClose = () => {
    if (isSaving) return;
    closeModal();
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      if (type === 'folder') {
        const folder = await api.reports.createDashboardFolder({ name: name.trim() });
        onCreated(folder);
      } else {
        const dashboard = await api.reports.createDashboard({
          name: name.trim(),
          ...(selectedFolderId !== ROOT_FOLDER_VALUE ? { folderId: selectedFolderId } : {}),
        });
        onCreated(dashboard);
      }
      closeModal();
    } catch (err) {
      setError((err as Error).message || t('dashboard.error'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim() && !isSaving) {
      void handleCreate();
    }
  };

  const title =
    type === 'folder'
      ? t('dashboard.createModal.createFolder')
      : t('dashboard.createModal.createDashboard');
  const folderOptions = [
    { id: ROOT_FOLDER_VALUE, name: t('dashboard.createModal.locationRoot') },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name })),
  ];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} closeOnBackdrop={!isSaving} closeOnEsc={!isSaving}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="mb-5 text-lg font-black text-slate-800">{title}</h2>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('dashboard.createModal.nameLabel')}
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('dashboard.createModal.namePlaceholder')}
            autoFocus
            disabled={isSaving}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-praetor focus:ring-2 focus:ring-praetor/20"
          />
        </div>

        {type === 'dashboard' && (
          <CustomSelect
            className="mb-4"
            label={t('dashboard.createModal.locationLabel')}
            options={folderOptions}
            value={selectedFolderId}
            onChange={(value) =>
              setSelectedFolderId(typeof value === 'string' ? value : ROOT_FOLDER_VALUE)
            }
            disabled={isSaving}
          />
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSaving}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
          >
            {t('dashboard.createModal.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={isSaving || !name.trim()}
            className="rounded-xl bg-praetor px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? (
              <i className="fa-solid fa-circle-notch fa-spin" />
            ) : (
              t('dashboard.createModal.create')
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default DashboardCreateModal;
