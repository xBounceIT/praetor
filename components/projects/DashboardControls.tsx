import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import ShareViewModal from '../shared/ShareViewModal';
import ViewOwnerAvatar from '../shared/ViewOwnerAvatar';
import type { ServerDashboardView } from './dashboardLayout';
import type { UseDashboardLayout } from './useDashboardLayout';

export interface DashboardControlsProps {
  controls: UseDashboardLayout;
}

// Modes for the name-prompt modal: a brand-new "Save as" snapshot, a "Rename" of
// an existing view, or a "Duplicate" into an owned copy. All three collect a name
// and round-trip through the server, so they share one modal.
type NameModalMode =
  | { kind: 'save' }
  | { kind: 'rename'; view: ServerDashboardView }
  | { kind: 'duplicate'; view: ServerDashboardView };

// Edit + Views buttons for the analytics section header. Mirrors the
// StandardTable column-views affordance: "Edit" enters an inline layout editor
// (drag to move / drag edges to resize / hide handled per-widget by
// DashboardGrid), and "Views" lists saved layouts plus a reset-to-default.
// The named-view library is now server-backed + shareable (own + shared-with-me);
// the global default and per-project override stay local per-user.
const DashboardControls: React.FC<DashboardControlsProps> = ({ controls }) => {
  const { t } = useTranslation(['projects', 'common']);
  const {
    editing,
    views,
    activeViewId,
    viewsLoading,
    viewsError,
    savingView,
    reloadViews,
    followingGlobal,
    startEditing,
    cancelEditing,
    doneEditing,
    saveAsView,
    applyView,
    deleteView,
    renameView,
    resaveView,
    duplicateView,
    followGlobalDefault,
    setAsGlobalDefault,
  } = controls;

  const [viewsOpen, setViewsOpen] = useState(false);
  // The name-prompt modal (save / rename / duplicate), or null when closed.
  const [nameModal, setNameModal] = useState<NameModalMode | null>(null);
  // The view currently being shared (owner-only), or null when the modal is closed.
  const [sharingView, setSharingView] = useState<ServerDashboardView | null>(null);

  const activeView = activeViewId ? views.find((v) => v.id === activeViewId) : undefined;
  // "Save changes to {name}" is offered only when the active view is writable
  // (owner or write) — re-saving overwrites the shared layout for everyone.
  const canResaveActive = Boolean(activeView && activeView.permission === 'write');

  const openSave = () => setNameModal({ kind: 'save' });

  // Remount the name modal per open so its internal `name` state re-seeds from the
  // mode (empty for save/duplicate, the existing name for rename).
  const nameModalKey =
    nameModal == null
      ? 'closed'
      : nameModal.kind === 'save'
        ? 'save'
        : `${nameModal.kind}-${nameModal.view.id}`;

  // Resolve the modal's submit against its mode. Each handler returns a boolean so
  // the modal can stay open on failure (e.g. the create round-trip rejected).
  const submitNameModal = async (name: string): Promise<boolean> => {
    if (!nameModal) return false;
    if (nameModal.kind === 'save') return saveAsView(name);
    if (nameModal.kind === 'rename') return renameView(nameModal.view.id, name);
    return duplicateView(nameModal.view.id, name);
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
          {canResaveActive && activeView && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={savingView}
              onClick={() => {
                void resaveView(activeView.id);
              }}
            >
              <i className="fa-solid fa-floppy-disk" aria-hidden="true"></i>
              {t('common:views.saveChangesTo', { name: activeView.name })}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={openSave}>
            <i className="fa-solid fa-bookmark" aria-hidden="true"></i>
            {t('common:views.saveAsNew')}
          </Button>
          <Button type="button" size="sm" onClick={doneEditing}>
            <i className="fa-solid fa-check" aria-hidden="true"></i>
            {t('projects:detail.dashboard.done')}
          </Button>
        </div>

        <NameViewModal
          key={nameModalKey}
          mode={nameModal}
          saving={savingView}
          onSubmit={submitNameModal}
          onClose={() => setNameModal(null)}
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
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>{t('projects:detail.dashboard.views')}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => followGlobalDefault()}>
            <i className="fa-solid fa-globe" aria-hidden="true"></i>
            <span className="flex-1">{t('projects:detail.dashboard.useGlobalDefault')}</span>
            {followingGlobal && (
              <i className="fa-solid fa-check text-xs text-muted-foreground" aria-hidden="true"></i>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {viewsLoading ? (
            <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
              <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
              {t('common:views.loadingViews')}
            </div>
          ) : viewsError ? (
            // Error + retry row. preventDefault keeps the menu open so the retry
            // result lands in place without re-opening.
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                reloadViews();
              }}
              className="flex items-center gap-2 text-destructive"
            >
              <i className="fa-solid fa-triangle-exclamation text-xs" aria-hidden="true"></i>
              <span className="flex-1">{t('common:views.loadViewsFailed')}</span>
              <span className="text-xs underline">{t('common:views.retry')}</span>
            </DropdownMenuItem>
          ) : views.length === 0 ? (
            <div className="p-2 text-xs text-muted-foreground">
              {t('projects:detail.dashboard.noViews')}
            </div>
          ) : (
            views.map((view) => (
              // Each row is a flex container holding SIBLING menu items (apply +
              // per-permission actions). Every action is a real DropdownMenuItem so
              // keyboard / screen-reader users can reach it via arrow keys — nesting
              // a raw <button> inside a single menu item makes it mouse-only (Radix
              // gives an item's focusable descendants tabindex=-1). Mirrors the
              // StandardTable custom-views pattern.
              <div key={view.id} className="group flex items-start gap-1">
                <DropdownMenuItem
                  // Apply closes the menu; preventDefault stops Radix's own close
                  // so the manual setViewsOpen(false) is the single close path.
                  onSelect={(e) => {
                    e.preventDefault();
                    applyView(view.id);
                    setViewsOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-start gap-2"
                >
                  {view.id === activeViewId ? (
                    <i className="fa-solid fa-check mt-0.5 text-xs" aria-hidden="true"></i>
                  ) : (
                    <i
                      className="fa-solid fa-table-cells-large mt-0.5 text-xs opacity-50"
                      aria-hidden="true"
                    ></i>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{view.name}</span>
                    {!view.isOwner && (
                      <span className="flex items-center gap-1">
                        <ViewOwnerAvatar ownerName={view.ownerName} />
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                          {view.permission === 'write'
                            ? t('common:views.permissionWrite')
                            : t('common:views.permissionRead')}
                        </Badge>
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
                {/* Duplicate — available to everyone (read recipients fork an
                    editable owned copy). Close the menu so the name dialog takes
                    over cleanly instead of stacking behind the open dropdown. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuItem
                      aria-label={t('common:views.duplicateView')}
                      onSelect={(e) => {
                        e.preventDefault();
                        setNameModal({ kind: 'duplicate', view });
                        setViewsOpen(false);
                      }}
                      className="size-7 shrink-0 justify-center p-0"
                    >
                      <i className="fa-solid fa-copy text-xs" aria-hidden="true"></i>
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('common:views.duplicateView')}</TooltipContent>
                </Tooltip>
                {/* Rename — owner or write. Overwrites the shared name for everyone.
                    Close the menu so the name dialog takes over cleanly. */}
                {view.permission === 'write' && (
                  <DropdownMenuItem
                    aria-label={t('common:views.rename')}
                    onSelect={(e) => {
                      e.preventDefault();
                      setNameModal({ kind: 'rename', view });
                      setViewsOpen(false);
                    }}
                    className="size-7 shrink-0 justify-center p-0"
                  >
                    <i className="fa-solid fa-pen text-xs" aria-hidden="true"></i>
                  </DropdownMenuItem>
                )}
                {/* Share — owner only (opens the self-contained ShareViewModal). */}
                {view.isOwner && (
                  <DropdownMenuItem
                    aria-label={t('common:views.shareView')}
                    onSelect={(e) => {
                      e.preventDefault();
                      setSharingView(view);
                      setViewsOpen(false);
                    }}
                    className="size-7 shrink-0 justify-center p-0"
                  >
                    <i className="fa-solid fa-user-plus text-xs" aria-hidden="true"></i>
                  </DropdownMenuItem>
                )}
                {/* Delete — owner only. Keep the menu open so several views can be
                    removed without re-opening. */}
                {view.isOwner && (
                  <DropdownMenuItem
                    aria-label={t('projects:detail.dashboard.deleteView')}
                    variant="destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      void deleteView(view.id);
                    }}
                    className="size-7 shrink-0 justify-center p-0"
                  >
                    <i className="fa-solid fa-trash text-xs" aria-hidden="true"></i>
                  </DropdownMenuItem>
                )}
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

      <NameViewModal
        key={nameModalKey}
        mode={nameModal}
        saving={savingView}
        onSubmit={submitNameModal}
        onClose={() => setNameModal(null)}
      />

      {sharingView && (
        <ShareViewModal
          isOpen={true}
          viewId={sharingView.id}
          viewName={sharingView.name}
          onClose={() => setSharingView(null)}
        />
      )}
    </div>
  );
};

// Seed name: rename pre-fills the existing name; save/duplicate start empty.
const initialName = (mode: NameModalMode | null): string =>
  mode?.kind === 'rename' ? mode.view.name : '';

// One name-prompt modal shared by save / rename / duplicate. Submit is async and
// the modal stays open on failure (the round-trip rejected) so the user can retry
// without re-typing. Title + initial name are driven by the active mode. The
// parent keys this element on the mode so its `name` state resets on each open.
const NameViewModal: React.FC<{
  mode: NameModalMode | null;
  saving: boolean;
  onSubmit: (name: string) => Promise<boolean>;
  onClose: () => void;
}> = ({ mode, saving, onSubmit, onClose }) => {
  const { t } = useTranslation(['projects', 'common']);
  const [name, setName] = useState(() => initialName(mode));
  const isOpen = mode !== null;
  const canSave = name.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSave) return;
    const ok = await onSubmit(name.trim());
    if (ok) onClose();
  };

  const title =
    mode?.kind === 'rename'
      ? t('common:views.rename')
      : mode?.kind === 'duplicate'
        ? t('common:views.duplicateView')
        : t('projects:detail.dashboard.saveViewTitle');

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>
              <i className="fa-solid fa-bookmark text-praetor"></i>
              {title}
            </ModalTitle>
            <ModalCloseButton onClick={onClose} disabled={saving} />
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
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('projects:detail.dashboard.viewNamePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
              />
            </Field>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('projects:detail.dashboard.cancel')}
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={!canSave}>
              {saving ? t('common:buttons.saving') : t('projects:detail.dashboard.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

export default DashboardControls;
