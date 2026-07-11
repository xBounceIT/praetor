import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { SupplierContact } from '../../types';
import StandardTable, { type Column } from '../shared/StandardTable';

export type SupplierContactRow = SupplierContact & { contactIndex: number };

export type SupplierContactsSectionProps = {
  address?: string;
  contactsExpanded: boolean;
  contactDraft: SupplierContact | null;
  editingContactIndex: number | null;
  contactDraftError: string | null;
  contactRows: SupplierContactRow[];
  contactColumns: Column<SupplierContactRow>[];
  onAddressChange: (value: string) => void;
  onToggleContacts: () => void;
  onAddContact: () => void;
  onUpdateContactDraft: (field: keyof SupplierContact, value: string) => void;
  onCancelContactDraft: () => void;
  onSaveContactDraft: () => void;
};

const SupplierContactsSection: React.FC<SupplierContactsSectionProps> = ({
  address,
  contactsExpanded,
  contactDraft,
  editingContactIndex,
  contactDraftError,
  contactRows,
  contactColumns,
  onAddressChange,
  onToggleContacts,
  onAddContact,
  onUpdateContactDraft,
  onCancelContactDraft,
  onSaveContactDraft,
}) => {
  const { t } = useTranslation(['crm', 'common']);

  return (
    <div className="space-y-4">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
        <span className="size-1.5 rounded-full bg-primary"></span>
        {t('crm:suppliers.contacts')}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field className="col-span-full">
          <FieldLabel htmlFor="supplier-address">{t('crm:suppliers.address')}</FieldLabel>
          <Textarea
            id="supplier-address"
            rows={2}
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            placeholder={t('crm:suppliers.addressPlaceholder')}
            className="resize-none"
          />
        </Field>
      </div>

      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onToggleContacts}
            className="gap-2 text-xs font-semibold uppercase tracking-wide"
          >
            <i
              className={
                contactsExpanded
                  ? 'fa-solid fa-chevron-up text-[10px]'
                  : 'fa-solid fa-chevron-down text-[10px]'
              }
              aria-hidden="true"
            ></i>
            {t('crm:suppliers.contactsList')} ({contactRows.length})
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAddContact}
            className="gap-2"
          >
            <i className="fa-solid fa-plus" aria-hidden="true"></i>
            {t('crm:suppliers.addContact')}
          </Button>
        </div>

        {contactsExpanded && (
          <div className="space-y-4">
            {contactDraft && (
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-muted/50 p-4 md:grid-cols-2">
                <Field data-invalid={Boolean(contactDraftError)}>
                  <FieldLabel htmlFor="supplier-contact-full-name" required>
                    {t('crm:suppliers.fullName')}
                  </FieldLabel>
                  <Input
                    id="supplier-contact-full-name"
                    value={contactDraft.fullName}
                    onChange={(event) => onUpdateContactDraft('fullName', event.target.value)}
                    placeholder={t('crm:suppliers.fullNamePlaceholder')}
                    aria-invalid={Boolean(contactDraftError)}
                  />
                  <FieldError>{contactDraftError}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-contact-role">{t('crm:suppliers.role')}</FieldLabel>
                  <Input
                    id="supplier-contact-role"
                    value={contactDraft.role || ''}
                    onChange={(event) => onUpdateContactDraft('role', event.target.value)}
                    placeholder={t('crm:suppliers.rolePlaceholder')}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-contact-email">
                    {t('crm:suppliers.email')}
                  </FieldLabel>
                  <Input
                    id="supplier-contact-email"
                    type="email"
                    value={contactDraft.email || ''}
                    onChange={(event) => onUpdateContactDraft('email', event.target.value)}
                    placeholder={t('crm:suppliers.emailPlaceholder')}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="supplier-contact-phone">
                    {t('crm:suppliers.phone')}
                  </FieldLabel>
                  <Input
                    id="supplier-contact-phone"
                    value={contactDraft.phone || ''}
                    onChange={(event) => onUpdateContactDraft('phone', event.target.value)}
                    placeholder={t('crm:suppliers.phonePlaceholder')}
                  />
                </Field>
                <div className="col-span-full flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={onCancelContactDraft}>
                    {t('common:buttons.cancel')}
                  </Button>
                  <Button type="button" size="sm" onClick={onSaveContactDraft}>
                    {editingContactIndex === null
                      ? t('common:buttons.save')
                      : t('common:buttons.update')}
                  </Button>
                </div>
              </div>
            )}
            <StandardTable<SupplierContactRow>
              title={t('crm:suppliers.contactsList')}
              data={contactRows}
              columns={contactColumns}
              defaultRowsPerPage={5}
              containerClassName="rounded-2xl border-border shadow-none"
              tableContainerClassName="max-h-[35vh] overflow-y-auto"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierContactsSection;
