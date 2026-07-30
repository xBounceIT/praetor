import { Send, Tag } from 'lucide-react';
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
  onOpenChange: (open: boolean) => void;
  onConfirm: (title: string) => void;
}

function RevisionTitleDialogContent({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  const { t } = useTranslation('sales');
  const [title, setTitle] = useState('');

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
          onConfirm(title);
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
              defaultValue:
                'Aggiungi un titolo per riconoscere e cercare questa revisione. Puoi anche lasciarlo vuoto.',
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
            maxLength={REVISION_TITLE_MAX_LENGTH}
            placeholder={t('revisionTitleDialog.placeholder', {
              defaultValue: 'Es. Proposta finale Q3',
            })}
            onChange={(event) => setTitle(event.target.value)}
          />
          <FieldDescription className="flex justify-between gap-3">
            <span>
              {t('revisionTitleDialog.hint', {
                defaultValue: 'Apparirà nello storico al posto di “Snapshot inviato”.',
              })}
            </span>
            <span className="shrink-0 tabular-nums">
              {title.length}/{REVISION_TITLE_MAX_LENGTH}
            </span>
          </FieldDescription>
        </Field>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('revisionTitleDialog.cancel', { defaultValue: 'Annulla' })}
          </Button>
          <Button type="submit">
            <Send className="size-4" aria-hidden="true" />
            {t('revisionTitleDialog.confirm', { defaultValue: 'Invia' })}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function RevisionTitleDialog({ open, onOpenChange, onConfirm }: RevisionTitleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <RevisionTitleDialogContent onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />
      ) : null}
    </Dialog>
  );
}
