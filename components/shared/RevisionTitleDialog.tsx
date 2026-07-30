import { LoaderCircle, Save, Tag } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const REVISION_TITLE_MAX_LENGTH = 200;
/** Above the shared document Modal default (60), below destructive confirmations (70). */
const REVISION_TITLE_DIALOG_Z_INDEX = 65;

interface RevisionTitleDialogProps {
  open: boolean;
  initialTitle?: string | null;
  isSaving?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (title: string) => void;
}

function RevisionTitleDialogContent({
  initialTitle,
  isSaving,
  error,
  onCancel,
  onConfirm,
}: {
  initialTitle: string | null;
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  const { t } = useTranslation('sales');
  const [title, setTitle] = useState(initialTitle ?? '');

  return (
    <DialogContent
      className="sm:max-w-md"
      overlayClassName="z-[65]"
      overlayStyle={{ zIndex: REVISION_TITLE_DIALOG_Z_INDEX }}
      style={{ zIndex: REVISION_TITLE_DIALOG_Z_INDEX + 1 }}
    >
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(title.trim());
        }}
      >
        <DialogHeader className="pr-7">
          <div className="mb-1 flex size-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Tag className="size-4" aria-hidden="true" />
          </div>
          <DialogTitle>
            {t('revisionTitleDialog.title', { defaultValue: 'Titolo revisione' })}
          </DialogTitle>
          <DialogDescription>
            {t('revisionTitleDialog.description', {
              defaultValue: 'Modifica il titolo usato per riconoscere e cercare questa revisione.',
            })}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="revision-title">
            {t('revisionTitleDialog.fieldLabel', { defaultValue: 'Titolo' })}
          </FieldLabel>
          <Input
            id="revision-title"
            autoFocus
            value={title}
            disabled={isSaving}
            maxLength={REVISION_TITLE_MAX_LENGTH}
            placeholder={t('revisionTitleDialog.placeholder', {
              defaultValue: 'Es. Proposta finale Q3',
            })}
            onChange={(event) => setTitle(event.target.value)}
          />
          <FieldDescription className="flex justify-between gap-3">
            <span>
              {t('revisionTitleDialog.hint', {
                defaultValue:
                  'Lascia vuoto per mostrare nuovamente la dicitura “Snapshot inviato”.',
              })}
            </span>
            <span className="shrink-0 tabular-nums">
              {title.length}/{REVISION_TITLE_MAX_LENGTH}
            </span>
          </FieldDescription>
        </Field>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isSaving} onClick={onCancel}>
            {t('revisionTitleDialog.cancel', { defaultValue: 'Annulla' })}
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {isSaving
              ? t('revisionTitleDialog.saving', { defaultValue: 'Salvataggio…' })
              : t('revisionTitleDialog.confirm', { defaultValue: 'Salva' })}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function RevisionTitleDialog({
  open,
  initialTitle = null,
  isSaving = false,
  error = null,
  onOpenChange,
  onConfirm,
}: RevisionTitleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <RevisionTitleDialogContent
          initialTitle={initialTitle}
          isSaving={isSaving}
          error={error}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
}
