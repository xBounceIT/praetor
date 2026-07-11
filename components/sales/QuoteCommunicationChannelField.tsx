import type React from 'react';
import { useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type {
  QuoteCommunicationChannel,
  QuoteCommunicationChannelIcon,
} from '../../services/api/quoteCommunicationChannels';
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
import StandardTable, { type Column } from '../shared/StandardTable';
import {
  getQuoteCommunicationChannelIconClass,
  QUOTE_COMMUNICATION_CHANNEL_ICON_OPTIONS,
} from './quoteCommunicationChannelIcons';

interface QuoteCommunicationChannelFieldProps {
  id: string;
  value: string;
  error?: string;
  disabled?: boolean;
  channels: QuoteCommunicationChannel[];
  canManage: boolean;
  onChange: (value: string) => void;
  onCreate: (data: { name: string; icon: QuoteCommunicationChannelIcon }) => Promise<void>;
  onUpdate: (
    id: string,
    updates: { name: string; icon: QuoteCommunicationChannelIcon },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const ChannelIcon: React.FC<{ icon: QuoteCommunicationChannelIcon }> = ({ icon }) => (
  <i
    className={`${getQuoteCommunicationChannelIconClass(icon)} w-4 shrink-0 text-center text-muted-foreground`}
    aria-hidden="true"
  ></i>
);

const ChannelIconPicker: React.FC<{
  value: QuoteCommunicationChannelIcon;
  onChange: (value: QuoteCommunicationChannelIcon) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation('sales');

  return (
    <div className="space-y-2">
      <FieldLabel id="communication-channel-icon-label">
        {t('communicationChannels.icon')}
      </FieldLabel>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue as QuoteCommunicationChannelIcon);
        }}
        variant="outline"
        spacing={1}
        aria-labelledby="communication-channel-icon-label"
        className="flex-wrap"
      >
        {QUOTE_COMMUNICATION_CHANNEL_ICON_OPTIONS.map((option) => {
          const label = t(`communicationChannels.icons.${option.value}`);
          return (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              aria-label={label}
              title={label}
              className="size-9 px-0"
            >
              <i className={option.className} aria-hidden="true"></i>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
};

interface ChannelManagerState {
  isManageOpen: boolean;
  editingChannel: QuoteCommunicationChannel | null;
  channelName: string;
  channelIcon: QuoteCommunicationChannelIcon;
  managerError: string | null;
  isSaving: boolean;
  deletingId: string | null;
}

type ChannelManagerAction =
  | { type: 'openManage' }
  | { type: 'closeManage' }
  | { type: 'editChannel'; channel: QuoteCommunicationChannel }
  | { type: 'setChannelName'; value: string }
  | { type: 'setChannelIcon'; value: QuoteCommunicationChannelIcon }
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
  channelIcon: 'comments',
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
        channelIcon: 'comments',
        managerError: null,
      };
    case 'closeManage':
      return { ...state, isManageOpen: false };
    case 'editChannel':
      return {
        ...state,
        editingChannel: action.channel,
        channelName: action.channel.name,
        channelIcon: action.channel.icon,
        managerError: null,
      };
    case 'setChannelName':
      return { ...state, channelName: action.value };
    case 'setChannelIcon':
      return { ...state, channelIcon: action.value };
    case 'showError':
      return { ...state, managerError: action.message };
    case 'saveStarted':
      return { ...state, isSaving: true, managerError: null };
    case 'saveSucceeded':
      return {
        ...state,
        isSaving: false,
        editingChannel: null,
        channelName: '',
        channelIcon: 'comments',
      };
    case 'saveFailed':
      return { ...state, isSaving: false, managerError: action.message };
    case 'deleteStarted':
      return { ...state, deletingId: action.id, managerError: null };
    case 'deleteSucceeded':
      return {
        ...state,
        deletingId: null,
        ...(state.editingChannel?.id === action.id
          ? { editingChannel: null, channelName: '', channelIcon: 'comments' as const }
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
    { isManageOpen, editingChannel, channelName, channelIcon, managerError, isSaving, deletingId },
    dispatchManager,
  ] = useReducer(channelManagerReducer, initialChannelManagerState);

  const channelOptions = useMemo(
    () =>
      channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        icon: <ChannelIcon icon={channel.icon} />,
      })),
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
        await onUpdate(editingChannel.id, { name: trimmed, icon: channelIcon });
      } else {
        await onCreate({ name: trimmed, icon: channelIcon });
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
    if (channel.isDefault) return;

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

  const channelColumns: Column<QuoteCommunicationChannel>[] = [
    {
      header: t('sales:communicationChannels.name'),
      accessorKey: 'name',
      disableFiltering: true,
      cell: ({ row: channel }) => (
        <div className="flex items-center gap-2">
          <ChannelIcon icon={channel.icon} />
          <span>{channel.name}</span>
          {channel.isDefault && (
            <>
              <span className="text-xs text-muted-foreground">
                {t('sales:communicationChannels.defaultValue')}
              </span>
              <span role="img" aria-label={t('sales:communicationChannels.defaultLocked')}>
                <i
                  className="fa-solid fa-lock text-xs text-muted-foreground"
                  aria-hidden="true"
                ></i>
              </span>
            </>
          )}
        </div>
      ),
    },
    {
      header: t('sales:communicationChannels.usedByQuotes'),
      accessorKey: 'totalQuoteCount',
      disableFiltering: true,
      align: 'right',
      className: 'tabular-nums',
    },
    {
      header: t('common:labels.actions'),
      id: 'actions',
      disableSorting: true,
      disableFiltering: true,
      cell: ({ row: channel }) =>
        channel.isDefault ? null : (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('common:buttons.edit')}
              onClick={() => dispatchManager({ type: 'editChannel', channel })}
            >
              <i className="fa-solid fa-pen text-[10px]" aria-hidden="true"></i>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('common:buttons.delete')}
              onClick={() => void handleDelete(channel)}
              disabled={deletingId === channel.id}
            >
              <i className="fa-solid fa-trash text-[10px]" aria-hidden="true"></i>
            </Button>
          </div>
        ),
    },
  ];

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
            <div className="space-y-3">
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
              <ChannelIconPicker
                value={channelIcon}
                onChange={(nextIcon) =>
                  dispatchManager({ type: 'setChannelIcon', value: nextIcon })
                }
              />
            </div>

            {managerError && <p className="text-sm font-medium text-destructive">{managerError}</p>}

            <StandardTable<QuoteCommunicationChannel>
              title={t('sales:communicationChannels.manageTitle')}
              data={channels}
              columns={channelColumns}
              defaultRowsPerPage={5}
              minBodyRows={0}
              containerClassName="shadow-none border-border"
              tableContainerClassName="max-h-[35vh] overflow-y-auto"
              emptyState={
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t('sales:communicationChannels.noChannels')}
                </div>
              }
            />
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
