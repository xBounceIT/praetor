import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReportChatMessage, ReportChatSessionSummary } from '@/types';
import { render } from '../../helpers/render';

const listSessionsMock = mock();
const createSessionMock = mock();
const getSessionMessagesMock = mock();
const archiveSessionMock = mock();

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
const i18n = { language: 'en', changeLanguage: () => {} };

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t, i18n }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

mock.module('../../../services/api', () => ({
  default: {
    reports: {
      listSessions: listSessionsMock,
      createSession: createSessionMock,
      getSessionMessages: getSessionMessagesMock,
      archiveSession: archiveSessionMock,
    },
  },
}));

const { default: AiReportingView } = await import('../../../components/reports/AiReportingView');

const sessions: ReportChatSessionSummary[] = [
  {
    id: 'revenue',
    title: 'Quarterly revenue',
    createdAt: 1_752_493_600_000,
    updatedAt: 1_752_493_600_000,
  },
  {
    id: 'capacity',
    title: 'Project capacity',
    createdAt: 1_752_407_200_000,
    updatedAt: 1_752_407_200_000,
  },
];

const messages: ReportChatMessage[] = [
  {
    id: 'user-1',
    sessionId: 'revenue',
    role: 'user',
    content: 'Show quarterly revenue',
    createdAt: 1_752_493_600_000,
  },
  {
    id: 'assistant-1',
    sessionId: 'revenue',
    role: 'assistant',
    content: 'Quarterly revenue is available.',
    createdAt: 1_752_493_600_001,
  },
];

const renderView = () =>
  render(
    <AiReportingView
      currentUserId="user-1"
      permissions={['reports.ai_reporting.view', 'reports.ai_reporting.create']}
      enableAiReporting
    />,
  );

beforeEach(() => {
  listSessionsMock.mockReset();
  createSessionMock.mockReset();
  getSessionMessagesMock.mockReset();
  archiveSessionMock.mockReset();

  listSessionsMock.mockResolvedValue(sessions);
  createSessionMock.mockResolvedValue({ id: 'new-session' });
  getSessionMessagesMock.mockResolvedValue(messages);
  archiveSessionMock.mockResolvedValue({ success: true });
});

describe('<AiReportingView /> interactions', () => {
  test('opens the mobile history sheet and closes it after session selection', async () => {
    renderView();

    await screen.findAllByText('Quarterly revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Open chat history' }));

    const historyDialog = await screen.findByRole('dialog', { name: 'Chat history' });
    fireEvent.click(within(historyDialog).getByRole('button', { name: 'Project capacity' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chat history' })).toBeNull());
    expect(screen.getAllByText('Project capacity').length).toBeGreaterThan(0);
  });

  test('creates a new chat from the persistent sidebar action', async () => {
    listSessionsMock.mockResolvedValueOnce(sessions).mockResolvedValueOnce([
      {
        id: 'new-session',
        title: 'New analysis',
        createdAt: 1_752_493_700_000,
        updatedAt: 1_752_493_700_000,
      },
      ...sessions,
    ]);
    getSessionMessagesMock.mockImplementation((sessionId: string) =>
      Promise.resolve(sessionId === 'new-session' ? [] : messages),
    );
    renderView();

    const newChatButton = await screen.findByRole('button', { name: 'New Chat' });
    await waitFor(() => expect(newChatButton).toBeEnabled());
    fireEvent.click(newChatButton);

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText('New analysis')).length).toBeGreaterThan(0);
  });

  test('confirms deletion through the destructive dialog', async () => {
    renderView();

    await screen.findAllByText('Quarterly revenue');
    const deleteButton = screen.getByRole('button', { name: 'Delete active chat' });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete chat' });
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(archiveSessionMock).toHaveBeenCalledWith('revenue'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete chat' })).toBeNull());
  });
});
