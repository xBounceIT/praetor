import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import type { UseDashboardLayout } from './useDashboardLayout';

export interface DashboardControlsProps {
  controls: UseDashboardLayout;
}

// Edit + Views buttons for the analytics section header. Mirrors the
// StandardTable column-views affordance: "Edit" enters an inline layout editor
// (resize / hide / reorder handled per-widget by DashboardWidgetFrame), and
// "Views" lists saved layouts plus a reset-to-default.
const DashboardControls: React.FC<DashboardControlsProps> = ({ controls }) => {
  const { t } = useTranslation(['projects']);
  const {
    editing,
    views,
    activeViewId,
    followingGlobal,
    startEditing,
    cancelEditing,
    doneEditing,
    saveAsView,
    applyView,
    deleteView,
    followGlobalDefault,
    setAsGlobalDefault,
  } = controls;

  const [saveOpen, setSaveOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [name, setName] = useState('');

  const openSave = () => {
    setName('');
    setSaveOpen(true);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveAsView(trimmed);
    setSaveOpen(false);
  };

  if (editing) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">
            {t('projects:detail.dashboard.editingHint')}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={cancelEditing}>
            {t('projects:detail.dashboard.cancel')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={openSave}>
            <i className="fa-solid fa-bookmark" aria-hidden="true"></i>
            {t('projects:detail.dashboard.saveAsView')}
          </Button>
          <Button type="button" size="sm" onClick={doneEditing}>
            <i className="fa-solid fa-check" aria-hidden="true"></i>
            {t('projects:detail.dashboard.done')}
          </Button>
        </div>

        <SaveViewModal
          isOpen={saveOpen}
          name={name}
          onNameChange={setName}
          onClose={() => setSaveOpen(false)}
          onSave={handleSave}
        />
      </>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu open={viewsOpen} onOpenChange={setViewsOpen}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <i className="fa-solid fa-table-cells-large" aria-hidden="true"></i>
            {t('projects:detail.dashboard.views')}
            <i className="fa-solid fa-chevron-down text-xs opacity-70" aria-hidden="true"></i>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t('projects:detail.dashboard.views')}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => followGlobalDefault()}>
            <i className="fa-solid fa-globe" aria-hidden="true"></i>
            <span className="flex-1">{t('projects:detail.dashboard.useGlobalDefault')}</span>
            {followingGlobal && (
              <i className="fa-solid fa-check text-xs text-muted-foreground" aria-hidden="true"></i>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {views.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              {t('projects:detail.dashboard.noViews')}
            </div>
          ) : (
            views.map((view) => (
              // Row is a plain flex container holding two SIBLING menu items
              // (apply + delete). Both are real DropdownMenuItems so keyboard /
              // screen-reader users can reach delete via arrow keys — nesting a
              // raw <button> inside a single menu item makes it mouse-only
              // (Radix gives an item's focusable descendants tabindex=-1).
              // Mirrors the StandardTable custom-views pattern.
              <div key={view.id} className="group flex items-center gap-1">
                <DropdownMenuItem
                  // Apply closes the menu; preventDefault stops Radix's own close
                  // so the manual setViewsOpen(false) is the single close path.
                  onSelect={(e) => {
                    e.preventDefault();
                    applyView(view.id);
                    setViewsOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  {view.id === activeViewId ? (
                    <i className="fa-solid fa-check text-xs" aria-hidden="true"></i>
                  ) : (
                    <i
                      className="fa-solid fa-table-cells-large text-xs opacity-50"
                      aria-hidden="true"
                    ></i>
                  )}
                  <span className="flex-1 truncate">{view.name}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  aria-label={t('projects:detail.dashboard.deleteView')}
                  variant="destructive"
                  // Keep the menu open after delete (no manual close) so several
                  // views can be removed without re-opening.
                  onSelect={(e) => {
                    e.preventDefault();
                    deleteView(view.id);
                  }}
                  className="size-7 shrink-0 justify-center p-0"
                >
                  <i className="fa-solid fa-trash text-xs" aria-hidden="true"></i>
                </DropdownMenuItem>
              </div>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAsGlobalDefault()}>
            <i className="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i>
            <span className="flex-1">{t('projects:detail.dashboard.setGlobalDefault')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button type="button" variant="outline" size="sm" onClick={startEditing}>
        <i className="fa-solid fa-sliders" aria-hidden="true"></i>
        {t('projects:detail.dashboard.edit')}
      </Button>
    </div>
  );
};

const SaveViewModal: React.FC<{
  isOpen: boolean;
  name: string;
  onNameChange: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}> = ({ isOpen, name, onNameChange, onClose, onSave }) => {
  const { t } = useTranslation(['projects']);
  const canSave = name.trim().length > 0;
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>
              <i className="fa-solid fa-bookmark text-praetor"></i>
              {t('projects:detail.dashboard.saveViewTitle')}
            </ModalTitle>
            <ModalCloseButton onClick={onClose} />
          </ModalHeader>
          <ModalBody className="space-y-4">
            <Field>
              <FieldLabel htmlFor="dashboard-view-name">
                {t('projects:detail.dashboard.viewName')}
              </FieldLabel>
              <Input
                id="dashboard-view-name"
                type="text"
                data-autofocus
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder={t('projects:detail.dashboard.viewNamePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave) {
                    e.preventDefault();
                    onSave();
                  }
                }}
              />
            </Field>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('projects:detail.dashboard.cancel')}
            </Button>
            <Button type="button" onClick={onSave} disabled={!canSave}>
              {t('projects:detail.dashboard.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

export default DashboardControls;
