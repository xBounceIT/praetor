import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { parseAiReportingMessage } from '@/components/reports/aiReportingAttachments';
import type { ReportChatMessage, ReportChatSessionSummary } from '@/types';
import { render } from '../../helpers/render';

const listSessionsMock = mock();
const createSessionMock = mock();
const getSessionMessagesMock = mock();
const archiveSessionMock = mock();
const chatMock = mock();
const chatStreamMock = mock();
const editMessageStreamMock = mock();
const translationDefaults: Record<string, string> = {
  'aiReporting.placeholder': 'Ask a question about your business data...',
};

let speechRecognitionInstance: MockSpeechRecognition | null = null;
const speechRecognitionInstances: MockSpeechRecognition[] = [];

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ readonly length: number; [index: number]: { transcript: string } }>;
      }) => void)
    | null = null;
  start = mock(() => {});
  stop = mock(() => {
    this.onend?.();
  });
  abort = mock(() => {});

  constructor() {
    speechRecognitionInstance = this;
    speechRecognitionInstances.push(this);
  }

  emitResult(transcript: string) {
    const result = { 0: { transcript }, length: 1 };
    this.onresult?.({ resultIndex: 0, results: { 0: result, length: 1 } });
  }
}

const t = (key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
  let value = options?.defaultValue ?? translationDefaults[key] ?? key;
  for (const [name, replacement] of Object.entries(options ?? {})) {
    if (name !== 'defaultValue') value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};
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
      chat: chatMock,
      chatStream: chatStreamMock,
      editMessageStream: editMessageStreamMock,
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
  chatMock.mockReset();
  chatStreamMock.mockReset();
  editMessageStreamMock.mockReset();
  speechRecognitionInstance = null;
  speechRecognitionInstances.length = 0;

  listSessionsMock.mockResolvedValue(sessions);
  createSessionMock.mockResolvedValue({ id: 'new-session' });
  getSessionMessagesMock.mockResolvedValue(messages);
  archiveSessionMock.mockResolvedValue({ success: true });
  chatMock.mockResolvedValue({ sessionId: 'revenue', text: 'Analysis complete.' });
  chatStreamMock.mockImplementation(
    async (
      _payload: unknown,
      handlers?: { onStart?: (event: { sessionId: string; messageId: string }) => void },
    ) => {
      handlers?.onStart?.({ sessionId: 'revenue', messageId: 'assistant-2' });
      return { sessionId: 'revenue', text: 'Analysis complete.' };
    },
  );
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: MockSpeechRecognition,
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'SpeechRecognition');
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
    const deleteButton = screen.getByRole('button', { name: 'Delete chat Quarterly revenue' });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);

    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete chat' });
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(archiveSessionMock).toHaveBeenCalledWith('revenue'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete chat' })).toBeNull());
  });

  test('attaches a text file and sends its content with the prompt', async () => {
    renderView();

    await screen.findAllByText('Quarterly revenue');
    const attachmentInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(attachmentInput).not.toBeNull();
    const attachment = new File(['quarter,revenue\nQ1,120000'], 'metrics.csv', {
      type: 'text/csv',
      lastModified: 1,
    });

    fireEvent.change(attachmentInput as HTMLInputElement, { target: { files: [attachment] } });
    await screen.findByText('metrics.csv');
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Ask a question about your business data...' }),
      {
        target: { value: 'Summarize this file' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(chatStreamMock).toHaveBeenCalledTimes(1));
    const [payload] = chatStreamMock.mock.calls[0] as unknown as [{ message: string }];
    const parsedMessage = parseAiReportingMessage(payload.message);
    expect(parsedMessage.text).toBe('Summarize this file');
    expect(parsedMessage.attachments).toEqual([
      expect.objectContaining({
        name: 'metrics.csv',
        content: 'quarter,revenue\nQ1,120000',
      }),
    ]);
  });

  test('adds dictated speech to the composer', async () => {
    renderView();

    await screen.findAllByText('Quarterly revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Start voice dictation' }));

    expect(speechRecognitionInstance?.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      speechRecognitionInstance?.emitResult('Show the quarterly revenue');
    });

    expect(
      screen.getByRole('textbox', { name: 'Ask a question about your business data...' }),
    ).toHaveValue('Show the quarterly revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice dictation' }));
    expect(speechRecognitionInstance?.stop).toHaveBeenCalledTimes(1);
  });

  test('ignores a delayed end event from a previous dictation session', async () => {
    renderView();

    await screen.findAllByText('Quarterly revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Start voice dictation' }));
    const firstRecognition = speechRecognitionInstances[0];
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice dictation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start voice dictation' }));

    expect(speechRecognitionInstances).toHaveLength(2);
    await act(async () => {
      firstRecognition?.onend?.();
    });

    expect(screen.getByRole('button', { name: 'Stop voice dictation' })).toBeEnabled();
  });
});
