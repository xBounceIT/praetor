import type React from 'react';
import { useMemo, useReducer } from 'react';
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

interface ChannelManagerState {
  isManageOpen: boolean;
  editingChannel: QuoteCommunicationChannel | null;
  channelName: string;
  managerError: string | null;
  isSaving: boolean;
  deletingId: string | null;
}

type ChannelManagerAction =
  | { type: 'openManage' }
  | { type: 'closeManage' }
  | { type: 'editChannel'; channel: QuoteCommunicationChannel }
  | { type: 'setChannelName'; value: string }
  | { type: 'showError'; message: string }
  | { type: 'saveStarted' }
  | { type: 'saveSucceeded' }
  | { type: 'saveFailed'; message: string }
  | { type: 'deleteStarted'; id: string }
  | { type: 'deleteSucceeded'; id: string }
  | { type: 'deleteFailed'; message: string };

const initialChannelManagerState: ChannelManagerState = {
  isManageOpen: false,
  editingChannel: null,
  channelName: '',
  managerError: null,
  isSaving: false,
  deletingId: null,
};

const channelManagerReducer = (
  state: ChannelManagerState,
  action: ChannelManagerAction,
): ChannelManagerState => {
  switch (action.type) {
    case 'openManage':
      return {
        ...state,
        isManageOpen: true,
        editingChannel: null,
        channelName: '',
        managerError: null,
      };
    case 'closeManage':
      return { ...state, isManageOpen: false };
    case 'editChannel':
      return {
        ...state,
        editingChannel: action.channel,
        channelName: action.channel.name,
        managerError: null,
      };
    case 'setChannelName':
      return { ...state, channelName: action.value };
    case 'showError':
      return { ...state, managerError: action.message };
    case 'saveStarted':
      return { ...state, isSaving: true, managerError: null };
    case 'saveSucceeded':
      return { ...state, isSaving: false, editingChannel: null, channelName: '' };
    case 'saveFailed':
      return { ...state, isSaving: false, managerError: action.message };
    case 'deleteStarted':
      return { ...state, deletingId: action.id, managerError: null };
    case 'deleteSucceeded':
      return {
        ...state,
        deletingId: null,
        ...(state.editingChannel?.id === action.id
          ? { editingChannel: null, channelName: '' }
          : {}),
      };
    case 'deleteFailed':
      return { ...state, deletingId: null, managerError: action.message };
  }
};

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
  const [
    { isManageOpen, editingChannel, channelName, managerError, isSaving, deletingId },
    dispatchManager,
  ] = useReducer(channelManagerReducer, initialChannelManagerState);

  const channelOptions = useMemo(
    () => channels.map((channel) => ({ id: channel.id, name: channel.name })),
    [channels],
  );

  const openManage = () => {
    dispatchManager({ type: 'openManage' });
  };

  const handleSave = async () => {
    const trimmed = channelName.trim();
    if (!trimmed) {
      dispatchManager({
        type: 'showError',
        message: t('sales:communicationChannels.errors.nameRequired'),
      });
      return;
    }

    dispatchManager({ type: 'saveStarted' });
    try {
      if (editingChannel) {
        await onUpdate(editingChannel.id, { name: trimmed });
      } else {
        await onCreate({ name: trimmed });
      }
      dispatchManager({ type: 'saveSucceeded' });
    } catch (err) {
      dispatchManager({
        type: 'saveFailed',
        message: errorMessage(err, t('common:messages.errorOccurred')),
      });
    }
  };

  const handleDelete = async (channel: QuoteCommunicationChannel) => {
    if (channel.totalQuoteCount > 0) {
      dispatchManager({
        type: 'showError',
        message: t('sales:communicationChannels.errors.deleteBlocked', {
          count: channel.totalQuoteCount,
          name: channel.name,
        }),
      });
      return;
    }
    if (channels.length <= 1) {
      dispatchManager({
        type: 'showError',
        message: t('sales:communicationChannels.errors.deleteLast'),
      });
      return;
    }

    dispatchManager({ type: 'deleteStarted', id: channel.id });
    try {
      await onDelete(channel.id);
      if (value === channel.id) {
        const next = channels.find((candidate) => candidate.id !== channel.id);
        onChange(next?.id ?? '');
      }
      dispatchManager({ type: 'deleteSucceeded', id: channel.id });
    } catch (err) {
      dispatchManager({
        type: 'deleteFailed',
        message: errorMessage(err, t('common:messages.errorOccurred')),
      });
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

      <Modal
        isOpen={isManageOpen}
        onClose={() => dispatchManager({ type: 'closeManage' })}
        zIndex={90}
      >
        <ModalContent className="max-w-3xl">
          <ModalHeader>
            <ModalTitle>{t('sales:communicationChannels.manageTitle')}</ModalTitle>
            <ModalCloseButton onClick={() => dispatchManager({ type: 'closeManage' })} />
          </ModalHeader>
          <ModalBody className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input
                value={channelName}
                onChange={(event) =>
                  dispatchManager({ type: 'setChannelName', value: event.target.value })
                }
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
                            onClick={() => dispatchManager({ type: 'editChannel', channel })}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => dispatchManager({ type: 'closeManage' })}
            >
              {t('common:buttons.close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default QuoteCommunicationChannelField;
