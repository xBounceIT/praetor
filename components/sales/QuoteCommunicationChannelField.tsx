import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { QuoteCommunicationChannel } from '../../services/api/quoteCommunicationChannels';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';

interface QuoteCommunicationChannelFieldProps {
  id: string;
  value: string;
  error?: string;
  disabled?: boolean;
  channels: QuoteCommunicationChannel[];
  canManage: boolean;
  onChange: (value: string) => void;
  onCreate: (data: { name: string }) => Promise<void>;
  onUpdate: (id: string, updates: { name: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const QuoteCommunicationChannelField: React.FC<QuoteCommunicationChannelFieldProps> = ({
  id,
  value,
  error,
  disabled = false,
  channels,
  canManage,
  onChange,
  onCreate,
  onUpdate,
  onDelete,
}) => {
  const { t } = useTranslation(['sales', 'common']);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<QuoteCommunicationChannel | null>(null);
  const [channelName, setChannelName] = useState('');
  const [managerError, setManagerError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const channelOptions = useMemo(
    () => channels.map((channel) => ({ id: channel.id, name: channel.name })),
    [channels],
  );

  const openManage = () => {
    setIsManageOpen(true);
    setEditingChannel(null);
    setChannelName('');
    setManagerError(null);
  };

  const handleSave = async () => {
    const trimmed = channelName.trim();
    if (!trimmed) {
      setManagerError(t('sales:communicationChannels.errors.nameRequired'));
      return;
    }

    setIsSaving(true);
    setManagerError(null);
    try {
      if (editingChannel) {
        await onUpdate(editingChannel.id, { name: trimmed });
      } else {
        await onCreate({ name: trimmed });
      }
      setEditingChannel(null);
      setChannelName('');
    } catch (err) {
      setManagerError(errorMessage(err, t('common:messages.errorOccurred')));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (channel: QuoteCommunicationChannel) => {
    if (channel.totalQuoteCount > 0) {
      setManagerError(
        t('sales:communicationChannels.errors.deleteBlocked', {
          count: channel.totalQuoteCount,
          name: channel.name,
        }),
      );
      return;
    }
    if (channels.length <= 1) {
      setManagerError(t('sales:communicationChannels.errors.deleteLast'));
      return;
    }

    setDeletingId(channel.id);
    setManagerError(null);
    try {
      await onDelete(channel.id);
      if (value === channel.id) {
        const next = channels.find((candidate) => candidate.id !== channel.id);
        onChange(next?.id ?? '');
      }
      if (editingChannel?.id === channel.id) {
        setEditingChannel(null);
        setChannelName('');
      }
    } catch (err) {
      setManagerError(errorMessage(err, t('common:messages.errorOccurred')));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="space-y-1.5">
        <div className="relative h-4">
          <FieldLabel htmlFor={id} required className="pr-24">
            {t('sales:communicationChannels.fieldLabel')}
          </FieldLabel>
          {canManage && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={openManage}
              className="absolute -top-1 right-0 gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              <i className="fa-solid fa-gear" aria-hidden="true"></i>
              {t('common:buttons.manage')}
            </Button>
          )}
        </div>
        <SelectControl
          id={id}
          options={channelOptions}
          value={value}
          onChange={(next) => onChange(next as string)}
          placeholder={t('sales:communicationChannels.placeholder')}
          searchable={false}
          disabled={disabled || channelOptions.length === 0}
          buttonClassName={error ? 'py-2.5 text-sm border-destructive' : 'py-2.5 text-sm'}
        />
        {error && <FieldError className="text-xs">{error}</FieldError>}
      </div>

      <Modal isOpen={isManageOpen} onClose={() => setIsManageOpen(false)} zIndex={90}>
        <ModalContent className="max-w-3xl">
          <ModalHeader>
            <ModalTitle>{t('sales:communicationChannels.manageTitle')}</ModalTitle>
            <ModalCloseButton onClick={() => setIsManageOpen(false)} />
          </ModalHeader>
          <ModalBody className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input
                value={channelName}
                onChange={(event) => setChannelName(event.target.value)}
                placeholder={t('sales:communicationChannels.namePlaceholder')}
              />
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {editingChannel ? t('common:buttons.save') : t('common:buttons.add')}
              </Button>
            </div>

            {managerError && <p className="text-sm font-medium text-destructive">{managerError}</p>}

            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">
                      {t('sales:communicationChannels.name')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('sales:communicationChannels.usedByQuotes')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('common:labels.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((channel) => (
                    <tr key={channel.id} className="border-t border-border">
                      <td className="px-3 py-2">{channel.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {channel.totalQuoteCount}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingChannel(channel);
                              setChannelName(channel.name);
                              setManagerError(null);
                            }}
                          >
                            {t('common:buttons.edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(channel)}
                            disabled={deletingId === channel.id}
                          >
                            {t('common:buttons.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {channels.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-muted-foreground" colSpan={3}>
                        {t('sales:communicationChannels.noChannels')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setIsManageOpen(false)}>
              {t('common:buttons.close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default QuoteCommunicationChannelField;
