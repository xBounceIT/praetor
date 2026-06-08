import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Webhook, WebhookPayload } from '../../../types';
import { resolveAuthFieldsForType, resolveSecretForPayload } from '../../../utils/webhookPayload';
import { installI18nMock } from '../../helpers/i18n';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

installI18nMock();

const SAMPLE: Webhook = {
  id: 'webhook-1',
  name: 'Slack hook',
  description: '',
  url: 'https://hooks.slack.com/x',
  httpMethod: 'POST',
  authType: 'bearer',
  authUsername: '',
  authHeaderName: '',
  authSecret: '********',
  customHeaders: [],
  enabled: true,
};

const listMock = mock(async (): Promise<Webhook[]> => []);
const createMock = mock(async (_payload: WebhookPayload): Promise<Webhook> => SAMPLE);
const updateMock = mock(
  async (_id: string, _payload: Partial<WebhookPayload>): Promise<Webhook> => SAMPLE,
);
const deleteMock = mock(async (_id: string): Promise<void> => {});

mock.module('../../../services/api/webhooks', () => ({
  webhooksApi: {
    list: listMock,
    create: createMock,
    update: updateMock,
    delete: deleteMock,
  },
}));

const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});
mock.module('../../../utils/toast', () => ({
  toastSuccess: toastSuccessMock,
  toastError: toastErrorMock,
  toast: { success: () => {}, error: () => {}, info: () => {} },
}));

clearSpyStateAfterAll();

const WebhooksView = (await import('../../../components/administration/WebhooksView')).default;

const FULL_PERMS = [
  'administration.webhooks.view',
  'administration.webhooks.create',
  'administration.webhooks.update',
  'administration.webhooks.delete',
];

beforeEach(() => {
  for (const m of [
    listMock,
    createMock,
    updateMock,
    deleteMock,
    toastSuccessMock,
    toastErrorMock,
  ]) {
    m.mockReset();
  }
  listMock.mockResolvedValue([]);
  createMock.mockResolvedValue(SAMPLE);
  updateMock.mockResolvedValue(SAMPLE);
  deleteMock.mockResolvedValue(undefined);
});

describe('<WebhooksView />', () => {
  test('renders fetched webhooks in the table', async () => {
    listMock.mockResolvedValue([SAMPLE]);
    render(<WebhooksView permissions={FULL_PERMS} />);

    expect(await screen.findByText('Slack hook')).toBeDefined();
    expect(screen.getByText('https://hooks.slack.com/x')).toBeDefined();
  });

  test('shows the empty state when there are no webhooks', async () => {
    listMock.mockResolvedValue([]);
    render(<WebhooksView permissions={FULL_PERMS} />);

    expect(await screen.findByText('administration:webhooks.empty.title')).toBeDefined();
  });

  test('creates a webhook from the form', async () => {
    listMock.mockResolvedValue([]);
    render(<WebhooksView permissions={FULL_PERMS} />);
    await screen.findByText('administration:webhooks.empty.title');

    fireEvent.click(screen.getByText('administration:webhooks.createWebhook'));

    const nameInput = await screen.findByPlaceholderText(
      'administration:webhooks.placeholders.name',
    );
    fireEvent.change(nameInput, { target: { value: 'My Hook' } });
    fireEvent.change(screen.getByPlaceholderText('administration:webhooks.placeholders.url'), {
      target: { value: 'https://example.com/hook' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toMatchObject({
      name: 'My Hook',
      url: 'https://example.com/hook',
      authType: 'none',
    });
  });

  test('hides create and row actions without the matching permissions', async () => {
    listMock.mockResolvedValue([SAMPLE]);
    render(<WebhooksView permissions={['administration.webhooks.view']} />);
    await screen.findByText('Slack hook');

    expect(screen.queryByText('administration:webhooks.createWebhook')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });

  test('exposes edit and delete row actions when permitted', async () => {
    listMock.mockResolvedValue([SAMPLE]);
    render(<WebhooksView permissions={FULL_PERMS} />);
    await screen.findByText('Slack hook');

    // Complements the gating test above (which asserts these are hidden without permission). The
    // delete request itself is covered end-to-end by the backend route tests.
    expect(screen.getByRole('button', { name: 'common:buttons.edit' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeDefined();
  });
});

describe('resolveSecretForPayload', () => {
  test('authType none always clears the secret', () => {
    expect(
      resolveSecretForPayload({
        authType: 'none',
        isEditing: true,
        isReplacingSecret: false,
        authSecret: 'x',
      }),
    ).toBe('');
  });

  test('sends the typed secret when creating', () => {
    expect(
      resolveSecretForPayload({
        authType: 'bearer',
        isEditing: false,
        isReplacingSecret: false,
        authSecret: 'tok',
      }),
    ).toBe('tok');
  });

  test('sends an empty secret when creating with a blank field', () => {
    expect(
      resolveSecretForPayload({
        authType: 'bearer',
        isEditing: false,
        isReplacingSecret: false,
        authSecret: '',
      }),
    ).toBe('');
  });

  test('omits the secret for an untouched stored field so the stored value is preserved', () => {
    // Regression: editing then saving with an empty, NON-replacing secret field (after toggling the
    // auth type back and forth, or leaving the stored badge untouched) must NOT wipe the credential.
    expect(
      resolveSecretForPayload({
        authType: 'bearer',
        isEditing: true,
        isReplacingSecret: false,
        authSecret: '',
      }),
    ).toBeUndefined();
  });

  test('clears the secret when explicitly replacing with a blank field', () => {
    // The admin clicked "Replace" and saved an empty value: this explicit clear must reach the server
    // as '' (not be omitted), otherwise the documented authSecret:'' clear is unreachable from the UI.
    expect(
      resolveSecretForPayload({
        authType: 'bearer',
        isEditing: true,
        isReplacingSecret: true,
        authSecret: '',
      }),
    ).toBe('');
  });

  test('sends the new secret when explicitly replacing with a value', () => {
    expect(
      resolveSecretForPayload({
        authType: 'bearer',
        isEditing: true,
        isReplacingSecret: true,
        authSecret: 'new',
      }),
    ).toBe('new');
  });
});

describe('resolveAuthFieldsForType', () => {
  const basicOriginal = {
    authType: 'basic' as const,
    authUsername: 'svc-user',
    authHeaderName: '',
    authSecret: '********',
  };

  test('restores the credentials when returning to the original auth type', () => {
    // Regression (Codex PR review): toggling the auth type away and back to basic must not drop the
    // stored username/secret and then silently send authUsername:''.
    expect(resolveAuthFieldsForType('basic', basicOriginal)).toEqual({
      authUsername: 'svc-user',
      authHeaderName: '',
      secretStored: true,
    });
  });

  test('restores the api_key header when returning to the original api_key type', () => {
    expect(
      resolveAuthFieldsForType('api_key', {
        authType: 'api_key',
        authUsername: '',
        authHeaderName: 'X-API-Key',
        authSecret: '********',
      }),
    ).toEqual({ authUsername: '', authHeaderName: 'X-API-Key', secretStored: true });
  });

  test('clears credentials when switching to a different scheme', () => {
    expect(resolveAuthFieldsForType('bearer', basicOriginal)).toEqual({
      authUsername: '',
      authHeaderName: '',
      secretStored: false,
    });
  });

  test('clears credentials when creating (no original)', () => {
    expect(resolveAuthFieldsForType('basic', null)).toEqual({
      authUsername: '',
      authHeaderName: '',
      secretStored: false,
    });
  });

  test('never marks none as having a stored secret', () => {
    expect(
      resolveAuthFieldsForType('none', {
        authType: 'none',
        authUsername: '',
        authHeaderName: '',
        authSecret: '',
      }),
    ).toEqual({ authUsername: '', authHeaderName: '', secretStored: false });
  });
});
