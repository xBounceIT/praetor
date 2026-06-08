import { Pen, Plus, Trash2, Webhook as WebhookIcon, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { webhooksApi } from '../../services/api/webhooks';
import type { Webhook, WebhookAuthType, WebhookHttpMethod, WebhookPayload } from '../../types';
import { isStoredSecret } from '../../utils/maskedSecret';
import { buildPermission, hasPermission } from '../../utils/permissions';
import { toastError, toastSuccess } from '../../utils/toast';
import { resolveSecretForPayload } from '../../utils/webhookPayload';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import HeaderAddButton from '../shared/HeaderAddButton';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SecretField from '../shared/SecretField';
import SelectControl from '../shared/SelectControl';

export interface WebhooksViewProps {
  permissions: string[];
}

const HTTP_METHODS: WebhookHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_TYPES: WebhookAuthType[] = ['none', 'basic', 'bearer', 'api_key'];

type LoadStatus = 'loading' | 'ready' | 'error';

// Editable header row. `uid` is a stable client-only key for React lists (the API shape is just
// `{ key, value }`); it's stripped when building the request payload.
type HeaderRow = { uid: string; key: string; value: string };

let headerRowCounter = 0;
const newHeaderRow = (key = '', value = ''): HeaderRow => {
  headerRowCounter += 1;
  return { uid: `webhook-header-${headerRowCounter}`, key, value };
};

const asSingleValue = (value: string | string[]): string =>
  Array.isArray(value) ? (value[0] ?? '') : value;

const isValidWebhookUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

type FormState = {
  isOpen: boolean;
  editingId: string | null;
  name: string;
  description: string;
  url: string;
  httpMethod: WebhookHttpMethod;
  authType: WebhookAuthType;
  authUsername: string;
  authHeaderName: string;
  authSecret: string;
  // A secret is stored server-side for the webhook being edited, and the chosen auth type is
  // unchanged — so the SecretField shows the "stored" badge instead of an input.
  secretStored: boolean;
  isReplacingSecret: boolean;
  customHeaders: HeaderRow[];
  enabled: boolean;
  errors: Record<string, string>;
  isSaving: boolean;
};

const emptyForm: FormState = {
  isOpen: false,
  editingId: null,
  name: '',
  description: '',
  url: '',
  httpMethod: 'POST',
  authType: 'none',
  authUsername: '',
  authHeaderName: '',
  authSecret: '',
  secretStored: false,
  isReplacingSecret: false,
  customHeaders: [],
  enabled: true,
  errors: {},
  isSaving: false,
};

type FormAction =
  | { type: 'openCreate' }
  | { type: 'openEdit'; webhook: Webhook; headerRows: HeaderRow[] }
  | { type: 'close' }
  | { type: 'patch'; values: Partial<FormState> }
  | { type: 'changeAuthType'; authType: WebhookAuthType }
  | { type: 'startReplaceSecret' }
  | { type: 'cancelReplaceSecret' }
  | { type: 'addHeader'; row: HeaderRow }
  | { type: 'updateHeader'; uid: string; field: 'key' | 'value'; value: string }
  | { type: 'removeHeader'; uid: string };

const formReducer = (state: FormState, action: FormAction): FormState => {
  switch (action.type) {
    case 'openCreate':
      return { ...emptyForm, isOpen: true };
    case 'openEdit': {
      const { webhook } = action;
      return {
        ...emptyForm,
        isOpen: true,
        editingId: webhook.id,
        name: webhook.name,
        description: webhook.description,
        url: webhook.url,
        httpMethod: webhook.httpMethod,
        authType: webhook.authType,
        authUsername: webhook.authUsername,
        authHeaderName: webhook.authHeaderName,
        secretStored: webhook.authType !== 'none' && isStoredSecret(webhook.authSecret),
        customHeaders: action.headerRows,
        enabled: webhook.enabled,
      };
    }
    case 'close':
      return { ...emptyForm };
    case 'patch':
      return { ...state, ...action.values };
    case 'changeAuthType':
      // Switching scheme reinterprets every credential field, so clear them and force the admin to
      // re-enter the secret rather than carrying stale values across types.
      return {
        ...state,
        authType: action.authType,
        authUsername: '',
        authHeaderName: '',
        authSecret: '',
        secretStored: false,
        isReplacingSecret: false,
        errors: {},
      };
    case 'startReplaceSecret':
      return { ...state, isReplacingSecret: true, authSecret: '' };
    case 'cancelReplaceSecret':
      return { ...state, isReplacingSecret: false, authSecret: '' };
    case 'addHeader':
      return { ...state, customHeaders: [...state.customHeaders, action.row] };
    case 'updateHeader':
      return {
        ...state,
        customHeaders: state.customHeaders.map((header) =>
          header.uid === action.uid ? { ...header, [action.field]: action.value } : header,
        ),
      };
    case 'removeHeader':
      return {
        ...state,
        customHeaders: state.customHeaders.filter((header) => header.uid !== action.uid),
      };
    default:
      return state;
  }
};

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, label, onClick, destructive }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        aria-label={label}
        className={
          destructive
            ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
            : undefined
        }
      >
        {icon}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

const WebhooksView: React.FC<WebhooksViewProps> = ({ permissions }) => {
  const { t } = useTranslation(['common', 'administration']);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [form, dispatch] = useReducer(formReducer, emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const canCreate = hasPermission(
    permissions,
    buildPermission('administration.webhooks', 'create'),
  );
  const canUpdate = hasPermission(
    permissions,
    buildPermission('administration.webhooks', 'update'),
  );
  const canDelete = hasPermission(
    permissions,
    buildPermission('administration.webhooks', 'delete'),
  );
  const showActions = canUpdate || canDelete;

  // Guards every async setState (initial load and post-mutation reloads) so a fetch that resolves
  // after the view unmounts is dropped instead of updating a torn-down component.
  const isMountedRef = useRef(true);

  const reload = useCallback(async () => {
    try {
      const data = await webhooksApi.list();
      if (!isMountedRef.current) return;
      setWebhooks(data);
      setStatus('ready');
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('Failed to load webhooks', err);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void reload();
    return () => {
      isMountedRef.current = false;
    };
  }, [reload]);

  const closeForm = () => {
    if (form.isSaving) return;
    dispatch({ type: 'close' });
  };

  const openEdit = (webhook: Webhook) => {
    dispatch({
      type: 'openEdit',
      webhook,
      headerRows: webhook.customHeaders.map((header) => newHeaderRow(header.key, header.value)),
    });
  };

  const buildPayload = (): WebhookPayload => {
    const payload: WebhookPayload = {
      name: form.name.trim(),
      description: form.description.trim(),
      url: form.url.trim(),
      httpMethod: form.httpMethod,
      authType: form.authType,
      authUsername: form.authType === 'basic' ? form.authUsername.trim() : '',
      authHeaderName: form.authType === 'api_key' ? form.authHeaderName.trim() : '',
      customHeaders: form.customHeaders
        .map((header) => ({ key: header.key.trim(), value: header.value }))
        .filter((header) => header.key.length > 0),
      enabled: form.enabled,
    };

    const authSecret = resolveSecretForPayload({
      authType: form.authType,
      isEditing: Boolean(form.editingId),
      authSecret: form.authSecret,
    });
    if (authSecret !== undefined) payload.authSecret = authSecret;

    return payload;
  };

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = t('common:validation.nameRequired');
    if (!form.url.trim()) {
      errors.url = t('administration:webhooks.errors.urlRequired');
    } else if (!isValidWebhookUrl(form.url.trim())) {
      errors.url = t('administration:webhooks.errors.urlInvalid');
    }
    if (form.authType === 'api_key' && !form.authHeaderName.trim()) {
      errors.authHeaderName = t('administration:webhooks.errors.headerNameRequired');
    }
    if (
      form.customHeaders.some((header) => header.value.trim() !== '' && header.key.trim() === '')
    ) {
      errors.customHeaders = t('administration:webhooks.errors.headerKeyRequired');
    }
    return errors;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      dispatch({ type: 'patch', values: { errors } });
      return;
    }
    dispatch({ type: 'patch', values: { isSaving: true, errors: {} } });
    try {
      const payload = buildPayload();
      if (form.editingId) {
        await webhooksApi.update(form.editingId, payload);
        toastSuccess(t('administration:webhooks.toasts.updated'));
      } else {
        await webhooksApi.create(payload);
        toastSuccess(t('administration:webhooks.toasts.created'));
      }
      dispatch({ type: 'close' });
      await reload();
    } catch (err) {
      console.error('Failed to save webhook', err);
      dispatch({
        type: 'patch',
        values: { isSaving: false, errors: { general: t('common:messages.errorOccurred') } },
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await webhooksApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
      toastSuccess(t('administration:webhooks.toasts.deleted'));
    } catch (err) {
      console.error('Failed to delete webhook', err);
      toastError(t('common:messages.errorOccurred'));
    } finally {
      setIsDeleting(false);
    }
  };

  const secretLabel =
    form.authType === 'basic'
      ? t('administration:webhooks.fields.password')
      : form.authType === 'api_key'
        ? t('administration:webhooks.fields.apiKeyValue')
        : t('administration:webhooks.fields.token');

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('administration:webhooks.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('administration:webhooks.subtitle')}</p>
        </div>
        {canCreate && (
          <HeaderAddButton actionSize="wide" onClick={() => dispatch({ type: 'openCreate' })}>
            {t('administration:webhooks.createWebhook')}
          </HeaderAddButton>
        )}
      </div>

      {status === 'loading' && (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-16 text-sm text-muted-foreground">
          {t('administration:webhooks.loading')}
        </div>
      )}

      {status === 'error' && (
        <Empty className="border border-dashed border-destructive/40 bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WebhookIcon />
            </EmptyMedia>
            <EmptyTitle>{t('administration:webhooks.loadError')}</EmptyTitle>
            <EmptyDescription>{t('administration:webhooks.loadErrorHelp')}</EmptyDescription>
          </EmptyHeader>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setStatus('loading');
              void reload();
            }}
          >
            {t('administration:webhooks.actions.retry')}
          </Button>
        </Empty>
      )}

      {status === 'ready' && webhooks.length === 0 && (
        <Empty className="border border-dashed border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WebhookIcon />
            </EmptyMedia>
            <EmptyTitle>{t('administration:webhooks.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('administration:webhooks.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {status === 'ready' && webhooks.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('administration:webhooks.columns.name')}</TableHead>
                <TableHead>{t('administration:webhooks.columns.url')}</TableHead>
                <TableHead>{t('administration:webhooks.columns.method')}</TableHead>
                <TableHead>{t('administration:webhooks.columns.auth')}</TableHead>
                <TableHead>{t('administration:webhooks.columns.status')}</TableHead>
                {showActions && (
                  <TableHead className="text-right">
                    {t('administration:webhooks.columns.actions')}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((webhook) => (
                <TableRow key={webhook.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{webhook.name}</div>
                    {webhook.description && (
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {webhook.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className="block max-w-[260px] truncate font-mono text-xs text-muted-foreground"
                      title={webhook.url}
                    >
                      {webhook.url}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{webhook.httpMethod}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`administration:webhooks.authTypes.${webhook.authType}`)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={webhook.enabled ? 'default' : 'secondary'}>
                      {webhook.enabled
                        ? t('administration:webhooks.status.active')
                        : t('administration:webhooks.status.disabled')}
                    </Badge>
                  </TableCell>
                  {showActions && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canUpdate && (
                          <ActionButton
                            icon={<Pen />}
                            label={t('common:buttons.edit')}
                            onClick={() => openEdit(webhook)}
                          />
                        )}
                        {canDelete && (
                          <ActionButton
                            icon={<Trash2 />}
                            label={t('common:buttons.delete')}
                            destructive
                            onClick={() => setDeleteTarget(webhook)}
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Modal isOpen={form.isOpen} onClose={closeForm} ariaLabel={null}>
        {() => (
          <ModalContent size="xl">
            <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
              <ModalHeader>
                <div>
                  <ModalTitle>
                    {form.editingId
                      ? t('administration:webhooks.editWebhook')
                      : t('administration:webhooks.createWebhook')}
                  </ModalTitle>
                  <ModalDescription>{t('administration:webhooks.formSubtitle')}</ModalDescription>
                </div>
                <ModalCloseButton onClick={closeForm} />
              </ModalHeader>
              <ModalBody className="flex-1 space-y-5">
                <Field>
                  <FieldLabel htmlFor="webhook-name" required>
                    {t('administration:webhooks.fields.name')}
                  </FieldLabel>
                  <Input
                    id="webhook-name"
                    value={form.name}
                    onChange={(event) =>
                      dispatch({ type: 'patch', values: { name: event.target.value } })
                    }
                    placeholder={t('administration:webhooks.placeholders.name')}
                  />
                  {form.errors.name && <FieldError>{form.errors.name}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="webhook-description">
                    {t('administration:webhooks.fields.description')}
                  </FieldLabel>
                  <Textarea
                    id="webhook-description"
                    value={form.description}
                    onChange={(event) =>
                      dispatch({ type: 'patch', values: { description: event.target.value } })
                    }
                    placeholder={t('administration:webhooks.placeholders.description')}
                    rows={2}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="webhook-url" required>
                    {t('administration:webhooks.fields.url')}
                  </FieldLabel>
                  <Input
                    id="webhook-url"
                    type="url"
                    value={form.url}
                    onChange={(event) =>
                      dispatch({ type: 'patch', values: { url: event.target.value } })
                    }
                    placeholder={t('administration:webhooks.placeholders.url')}
                  />
                  {form.errors.url && <FieldError>{form.errors.url}</FieldError>}
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectControl
                    id="webhook-method"
                    label={t('administration:webhooks.fields.method')}
                    options={HTTP_METHODS.map((method) => ({ id: method, name: method }))}
                    value={form.httpMethod}
                    onChange={(value) =>
                      dispatch({
                        type: 'patch',
                        values: { httpMethod: asSingleValue(value) as WebhookHttpMethod },
                      })
                    }
                  />
                  <SelectControl
                    id="webhook-auth-type"
                    label={t('administration:webhooks.fields.authType')}
                    options={AUTH_TYPES.map((authType) => ({
                      id: authType,
                      name: t(`administration:webhooks.authTypes.${authType}`),
                    }))}
                    value={form.authType}
                    onChange={(value) =>
                      dispatch({
                        type: 'changeAuthType',
                        authType: asSingleValue(value) as WebhookAuthType,
                      })
                    }
                  />
                </div>

                {form.authType !== 'none' && (
                  <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                    {form.authType === 'basic' && (
                      <Field>
                        <FieldLabel htmlFor="webhook-username">
                          {t('administration:webhooks.fields.username')}
                        </FieldLabel>
                        <Input
                          id="webhook-username"
                          value={form.authUsername}
                          onChange={(event) =>
                            dispatch({
                              type: 'patch',
                              values: { authUsername: event.target.value },
                            })
                          }
                        />
                      </Field>
                    )}
                    {form.authType === 'api_key' && (
                      <Field>
                        <FieldLabel htmlFor="webhook-header-name" required>
                          {t('administration:webhooks.fields.headerName')}
                        </FieldLabel>
                        <Input
                          id="webhook-header-name"
                          value={form.authHeaderName}
                          onChange={(event) =>
                            dispatch({
                              type: 'patch',
                              values: { authHeaderName: event.target.value },
                            })
                          }
                          placeholder={t('administration:webhooks.placeholders.headerName')}
                        />
                        {form.errors.authHeaderName && (
                          <FieldError>{form.errors.authHeaderName}</FieldError>
                        )}
                      </Field>
                    )}
                    <SecretField
                      label={secretLabel}
                      value={form.authSecret}
                      onChange={(value) =>
                        dispatch({ type: 'patch', values: { authSecret: value } })
                      }
                      isStored={form.secretStored}
                      isReplacing={form.isReplacingSecret}
                      onStartReplace={() => dispatch({ type: 'startReplaceSecret' })}
                      onCancelReplace={() => dispatch({ type: 'cancelReplaceSecret' })}
                      storedLabel={t('administration:webhooks.secretStored')}
                      storedHelp={t('administration:webhooks.secretStoredHelp')}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <FieldLabel>{t('administration:webhooks.fields.customHeaders')}</FieldLabel>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => dispatch({ type: 'addHeader', row: newHeaderRow() })}
                    >
                      <Plus className="size-4" />
                      {t('administration:webhooks.actions.addHeader')}
                    </Button>
                  </div>
                  {form.customHeaders.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('administration:webhooks.noHeaders')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {form.customHeaders.map((header) => (
                        <div key={header.uid} className="flex items-center gap-2">
                          <Input
                            aria-label={t('administration:webhooks.fields.headerKey')}
                            placeholder={t('administration:webhooks.placeholders.headerKey')}
                            value={header.key}
                            onChange={(event) =>
                              dispatch({
                                type: 'updateHeader',
                                uid: header.uid,
                                field: 'key',
                                value: event.target.value,
                              })
                            }
                          />
                          <Input
                            aria-label={t('administration:webhooks.fields.headerValue')}
                            placeholder={t('administration:webhooks.placeholders.headerValue')}
                            value={header.value}
                            onChange={(event) =>
                              dispatch({
                                type: 'updateHeader',
                                uid: header.uid,
                                field: 'value',
                                value: event.target.value,
                              })
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('administration:webhooks.actions.removeHeader')}
                            onClick={() => dispatch({ type: 'removeHeader', uid: header.uid })}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {form.errors.customHeaders && (
                    <FieldError>{form.errors.customHeaders}</FieldError>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor="webhook-enabled">
                      {t('administration:webhooks.fields.enabled')}
                    </FieldLabel>
                    <p className="text-xs text-muted-foreground">
                      {t('administration:webhooks.fields.enabledHelp')}
                    </p>
                  </div>
                  <Switch
                    id="webhook-enabled"
                    checked={form.enabled}
                    onCheckedChange={(checked) =>
                      dispatch({ type: 'patch', values: { enabled: checked } })
                    }
                  />
                </div>

                {form.errors.general && (
                  <p className="text-sm font-medium text-destructive">{form.errors.general}</p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button type="button" variant="ghost" onClick={closeForm} disabled={form.isSaving}>
                  {t('common:buttons.cancel')}
                </Button>
                <Button type="submit" disabled={form.isSaving}>
                  {form.isSaving
                    ? t('common:buttons.saving')
                    : form.editingId
                      ? t('common:buttons.update')
                      : t('common:buttons.create')}
                </Button>
              </ModalFooter>
            </form>
          </ModalContent>
        )}
      </Modal>

      <DeleteConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title={t('administration:webhooks.deleteWebhook')}
        description={t('common:messages.deleteConfirmNamed', { name: deleteTarget?.name })}
      />
    </div>
  );
};

export default WebhooksView;
