import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { SiemConfig, SiemStatus } from '../../../services/api/logs';
import type { AuditLogEntry } from '../../../types';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

const t = (key: string) => key;

const toastSuccess = mock(() => undefined);
const toastError = mock(() => undefined);

mock.module('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t,
    i18n: { language: 'en', changeLanguage: () => {} },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const auditRequests: Deferred<AuditLogEntry[]>[] = [];

const siemConfig: SiemConfig = {
  enabled: false,
  host: 'siem.example.test',
  port: 6514,
  protocol: 'tls' as const,
  tcpFraming: 'newline' as const,
  sourceIdentifier: 'praetor-test',
  facility: 16,
  runtimeLevel: 'info' as const,
  includeRuntime: true,
  includeAudit: true,
  caPem: '',
  serverName: '',
  clientCertPem: '',
  clientKey: '',
  retentionDays: 30,
  maxEvents: 1_000_000,
  revision: 1,
  testedRevision: null,
  lastTestAt: null,
  lastTestSuccess: null,
  lastDeliveryAt: null,
  lastErrorAt: null,
  lastError: null,
  droppedRetention: 0,
  droppedCapacity: 0,
  updatedAt: '2026-07-14T10:00:00.000Z',
};

const siemStatus: SiemStatus = {
  enabled: false,
  revision: 1,
  testedRevision: null,
  lastTestAt: null,
  lastTestSuccess: null,
  lastDeliveryAt: null,
  lastErrorAt: null,
  lastError: null,
  droppedRetention: 0,
  droppedCapacity: 0,
  pendingCount: 0,
  oldestPendingAt: null,
};

const logsApiMock = {
  listAudit: mock(() => {
    const request = createDeferred<AuditLogEntry[]>();
    auditRequests.push(request);
    return request.promise;
  }),
  getSiemConfig: mock(() => Promise.resolve(siemConfig)),
  getSiemStatus: mock(() => Promise.resolve(siemStatus)),
  updateSiemConfig: mock(() => Promise.resolve(siemConfig)),
  testSiem: mock(
    (): Promise<{ success: boolean; error?: string }> => Promise.resolve({ success: true }),
  ),
  enableSiem: mock(() => Promise.resolve({ ...siemConfig, enabled: true })),
  disableSiem: mock(() => Promise.resolve(siemConfig)),
};

mock.module('../../../services/api/logs', () => ({
  logsApi: logsApiMock,
}));

clearSpyStateAfterAll();

const LogsView = (await import('../../../components/administration/LogsView')).default;

const makeAuditLog = (id: string, username: string): AuditLogEntry => ({
  id,
  userId: `user-${id}`,
  userName: username,
  username,
  action: 'user.login',
  entityType: 'user',
  entityId: `user-${id}`,
  ipAddress: '127.0.0.1',
  createdAt: Date.UTC(2026, 0, 1, 12),
  details: null,
});

const selectTimeRange = (currentLabel: string, nextLabel: string) => {
  const trigger = screen.getByText(currentLabel).closest('button');
  if (!trigger) throw new Error(`time range trigger "${currentLabel}" not found`);

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('option', { name: nextLabel }));
};

describe('<LogsView />', () => {
  beforeEach(() => {
    localStorage.clear();
    auditRequests.length = 0;
    logsApiMock.listAudit.mockClear();
    logsApiMock.getSiemConfig.mockClear();
    logsApiMock.getSiemStatus.mockClear();
    logsApiMock.updateSiemConfig.mockClear();
    logsApiMock.testSiem.mockClear();
    logsApiMock.enableSiem.mockClear();
    logsApiMock.disableSiem.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  test('ignores stale audit log responses after rapid date range changes', async () => {
    render(<LogsView />);

    await waitFor(() => expect(logsApiMock.listAudit).toHaveBeenCalledTimes(1));

    await act(async () => {
      auditRequests[0].resolve([makeAuditLog('initial', 'Initial User')]);
    });

    expect(await screen.findByText('Initial User')).toBeInTheDocument();

    selectTimeRange('logs.timeRanges.last7Days', 'logs.timeRanges.last30Days');
    await waitFor(() => expect(logsApiMock.listAudit).toHaveBeenCalledTimes(2));

    selectTimeRange('logs.timeRanges.last30Days', 'logs.timeRanges.last90Days');
    await waitFor(() => expect(logsApiMock.listAudit).toHaveBeenCalledTimes(3));

    await act(async () => {
      auditRequests[2].resolve([makeAuditLog('latest', 'Latest User')]);
    });

    expect(await screen.findByText('Latest User')).toBeInTheDocument();

    await act(async () => {
      auditRequests[1].resolve([makeAuditLog('stale', 'Stale User')]);
      await Promise.resolve();
    });

    expect(screen.getByText('Latest User')).toBeInTheDocument();
    expect(screen.queryByText('Stale User')).not.toBeInTheDocument();
  });

  test('loads SIEM configuration lazily when its tab is opened', async () => {
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);

    expect(logsApiMock.getSiemConfig).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));

    await waitFor(() => expect(logsApiMock.getSiemConfig).toHaveBeenCalledTimes(1));
    expect(await screen.findByDisplayValue('siem.example.test')).toBeInTheDocument();
  });

  test('groups SIEM settings into an LDAP-style configuration card', async () => {
    const user = userEvent.setup();
    const { container } = render(<LogsView canUpdateSiem />);

    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));
    await screen.findByDisplayValue('siem.example.test');

    const configurationCard = screen
      .getByText('logs.siem.destination.title')
      .closest('[data-slot="card"]');
    expect(configurationCard).not.toBeNull();
    expect(configurationCard?.closest('.max-w-5xl')).toHaveClass('mx-auto', 'max-w-5xl');
    expect(
      within(configurationCard as HTMLElement).getByText('logs.siem.events.title'),
    ).toBeInTheDocument();
    expect(
      within(configurationCard as HTMLElement).getByText('logs.siem.queue.title'),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(2);
  });

  test('renders SIEM configuration when the initial status request fails', async () => {
    logsApiMock.getSiemStatus.mockRejectedValueOnce(new Error('status unavailable'));
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));

    expect(await screen.findByDisplayValue('siem.example.test')).toBeInTheDocument();
  });

  test('shows a retry state when SIEM configuration cannot be loaded', async () => {
    logsApiMock.getSiemConfig.mockRejectedValueOnce(new Error('config unavailable'));
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('config unavailable');
    await user.click(screen.getByRole('button', { name: 'common:buttons.retry' }));

    await waitFor(() => expect(logsApiMock.getSiemConfig).toHaveBeenCalledTimes(2));
    expect(await screen.findByDisplayValue('siem.example.test')).toBeInTheDocument();
  });

  test('disables SIEM controls in view-only mode', async () => {
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem={false} />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));

    const host = await screen.findByDisplayValue('siem.example.test');
    expect(host).toBeDisabled();
    expect(screen.getByText('logs.siem.viewOnly')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'logs.siem.actions.save' })).toBeDisabled();
  });

  test('explains, highlights, and focuses a missing SIEM host before testing', async () => {
    logsApiMock.getSiemConfig.mockResolvedValueOnce({ ...siemConfig, host: '' });
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));

    const host = await screen.findByLabelText('logs.siem.fields.host');
    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.test' }));

    expect(logsApiMock.testSiem).not.toHaveBeenCalled();
    expect(host).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('logs.siem.validation.hostRequired')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith('logs.siem.validation.hostRequired');
    await waitFor(() => expect(host).toHaveFocus());
  });

  test('imports CA, client certificate, and private key files into the TLS fields', async () => {
    logsApiMock.getSiemConfig.mockResolvedValueOnce({ ...siemConfig, clientKey: '********' });
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));

    await user.upload(
      await screen.findByLabelText('logs.siem.actions.importPem: logs.siem.fields.ca'),
      new File(['CA PEM'], 'ca.pem'),
    );
    await user.upload(
      screen.getByLabelText('logs.siem.actions.importPem: logs.siem.fields.clientCert'),
      new File(['CLIENT CERT PEM'], 'client.pem'),
    );
    await user.upload(
      screen.getByLabelText('logs.siem.actions.importPem: logs.siem.fields.clientKey'),
      new File(['CLIENT KEY PEM'], 'client.key'),
    );

    expect(screen.getByLabelText('logs.siem.fields.ca')).toHaveValue('CA PEM');
    expect(screen.getByLabelText('logs.siem.fields.clientCert')).toHaveValue('CLIENT CERT PEM');
    expect(screen.getByLabelText('logs.siem.fields.clientKey')).toHaveValue('CLIENT KEY PEM');
    expect(screen.getByTestId('siem-client-key-keep-stored')).toBeInTheDocument();
  });

  test('rejects imported PEM files larger than 64 KB', async () => {
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));

    await user.upload(
      await screen.findByLabelText('logs.siem.actions.importPem: logs.siem.fields.ca'),
      new File([new Uint8Array(65_537)], 'oversized.pem'),
    );

    expect(screen.getByLabelText('logs.siem.fields.ca')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('logs.siem.validation.pemFileTooLarge')).toBeInTheDocument();
  });

  test('keeps a successful save successful when the status refresh fails', async () => {
    logsApiMock.getSiemStatus
      .mockResolvedValueOnce(siemStatus)
      .mockRejectedValueOnce(new Error('status unavailable'));
    logsApiMock.updateSiemConfig.mockResolvedValueOnce({
      ...siemConfig,
      host: 'new-siem.example.test',
    });
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));
    const host = await screen.findByDisplayValue('siem.example.test');
    await user.clear(host);
    await user.type(host, 'new-siem.example.test');
    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.save' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('logs.siem.messages.saved'));
    expect(toastError).not.toHaveBeenCalled();
  });

  test('ignores an older status response that completes after a newer refresh', async () => {
    const staleStatus = createDeferred<SiemStatus>();
    logsApiMock.getSiemStatus
      .mockResolvedValueOnce(siemStatus)
      .mockImplementationOnce(() => staleStatus.promise)
      .mockResolvedValueOnce({
        ...siemStatus,
        testedRevision: 1,
        lastTestAt: '2026-07-14T10:05:00.000Z',
        lastTestSuccess: true,
        lastError: 'new-status',
      });
    logsApiMock.getSiemConfig.mockResolvedValueOnce(siemConfig).mockResolvedValueOnce({
      ...siemConfig,
      testedRevision: 1,
      lastTestAt: '2026-07-14T10:05:00.000Z',
      lastTestSuccess: true,
    });
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));
    const host = await screen.findByDisplayValue('siem.example.test');
    await user.clear(host);
    await user.type(host, 'new-siem.example.test');
    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.save' }));
    await waitFor(() => expect(logsApiMock.updateSiemConfig).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.test' }));

    expect(await screen.findByText('new-status')).toBeInTheDocument();
    await act(async () => {
      staleStatus.resolve({ ...siemStatus, lastError: 'stale-status' });
      await Promise.resolve();
    });
    expect(screen.getByText('new-status')).toBeInTheDocument();
    expect(screen.queryByText('stale-status')).not.toBeInTheDocument();
  });

  test('uses polled test status when refreshing config after a successful test fails', async () => {
    logsApiMock.getSiemConfig
      .mockResolvedValueOnce(siemConfig)
      .mockRejectedValueOnce(new Error('config refresh unavailable'));
    logsApiMock.getSiemStatus
      .mockResolvedValueOnce(siemStatus)
      .mockResolvedValueOnce({ ...siemStatus, testedRevision: 1, lastTestSuccess: true });
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));
    const testButton = await screen.findByRole('button', { name: 'logs.siem.actions.test' });
    const enableButton = screen.getByRole('button', { name: 'logs.siem.actions.enable' });

    expect(enableButton).toBeDisabled();
    await user.click(testButton);
    await waitFor(() => expect(logsApiMock.testSiem).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(enableButton).toBeEnabled());
  });

  test('blocks activation after a newer failed test when refreshing config fails', async () => {
    const testedConfig = {
      ...siemConfig,
      testedRevision: 1,
      lastTestAt: '2026-07-14T10:05:00.000Z',
      lastTestSuccess: true,
    };
    const testedStatus = {
      ...siemStatus,
      testedRevision: 1,
      lastTestAt: '2026-07-14T10:05:00.000Z',
      lastTestSuccess: true,
    };
    logsApiMock.getSiemConfig
      .mockResolvedValueOnce(testedConfig)
      .mockRejectedValueOnce(new Error('config refresh unavailable'));
    logsApiMock.getSiemStatus.mockResolvedValueOnce(testedStatus).mockResolvedValueOnce({
      ...testedStatus,
      lastTestAt: '2026-07-14T10:06:00.000Z',
      lastTestSuccess: false,
    });
    logsApiMock.testSiem.mockResolvedValueOnce({ success: false, error: 'connection failed' });
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'logs.siem.actions.enable' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.test' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'logs.siem.actions.enable' })).toBeDisabled(),
    );
    expect(screen.getByText('logs.siem.status.testFailed')).toBeInTheDocument();
  });

  test('supports the Save, Test, Enable activation flow', async () => {
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));
    const host = await screen.findByDisplayValue('siem.example.test');

    expect(screen.getByRole('button', { name: 'logs.siem.actions.test' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'logs.siem.actions.enable' })).toBeDisabled();
    await user.clear(host);
    await user.type(host, 'new-siem.example.test');
    expect(screen.getByRole('button', { name: 'logs.siem.actions.test' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.save' }));
    await waitFor(() => expect(logsApiMock.updateSiemConfig).toHaveBeenCalledTimes(1));
    expect(logsApiMock.updateSiemConfig).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'new-siem.example.test' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'logs.siem.actions.test' })).toBeEnabled(),
    );

    logsApiMock.getSiemConfig.mockResolvedValueOnce({
      ...siemConfig,
      testedRevision: siemConfig.revision,
      lastTestAt: '2026-07-14T10:05:00.000Z',
      lastTestSuccess: true,
    });
    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.test' }));
    await waitFor(() => expect(logsApiMock.testSiem).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'logs.siem.actions.enable' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.enable' }));
    await waitFor(() => expect(logsApiMock.enableSiem).toHaveBeenCalledTimes(1));
  });

  test('allows runtime and audit capture to be disabled independently at the same time', async () => {
    const user = userEvent.setup();
    render(<LogsView canUpdateSiem />);
    await user.click(screen.getByRole('tab', { name: 'logs.tabs.siem' }));
    await screen.findByDisplayValue('siem.example.test');

    await user.click(screen.getByRole('switch', { name: 'logs.siem.fields.runtime' }));
    await user.click(screen.getByRole('switch', { name: 'logs.siem.fields.audit' }));
    await user.click(screen.getByRole('button', { name: 'logs.siem.actions.save' }));

    await waitFor(() => expect(logsApiMock.updateSiemConfig).toHaveBeenCalledTimes(1));
    expect(logsApiMock.updateSiemConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        includeRuntime: false,
        includeAudit: false,
      }),
    );
  });
});
