import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AuditLogEntry } from '../../../types';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';
import { render } from '../../helpers/render';

const t = (key: string) => key;

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

const logsApiMock = {
  listAudit: mock(() => {
    const request = createDeferred<AuditLogEntry[]>();
    auditRequests.push(request);
    return request.promise;
  }),
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
});
