import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { parseAiReportingMessage } from '@/components/reports/aiReportingAttachments';
import type { ReportChatMessage, ReportChatSessionSummary } from '@/types';
import { render } from '../../helpers/render';

const listSessionsMock = mock();
const createSessionMock = mock();
const getSessionMessagesMock = mock();
const archiveSessionMock = mock();
const renameSessionMock = mock();
const chatMock = mock();
const chatStreamMock = mock();
const editMessageStreamMock = mock();
const translationDefaults: Record<string, string> = {
  'aiReporting.placeholder': 'Ask a question about your business data...',
  'buttons.noGoBack': 'Cancel',
  'buttons.saving': 'Saving...',
  'buttons.yesDelete': 'Delete',
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
      renameSession: renameSessionMock,
      chat: chatMock,
      chatStream: chatStreamMock,
      editMessageStream: editMessageStreamMock,
    },
  },
}));

// Bun module mocks are process-wide and other suites replace DeleteConfirmModal with
// feature-specific stubs. Pin an accessible deterministic version before importing the
// view so this interaction test is independent of full-suite execution order.
mock.module('../../../components/shared/DeleteConfirmModal', () => ({
  default: ({
    isOpen,
    isDeleting = false,
    onClose,
    onConfirm,
    title,
    description,
  }: {
    isOpen: boolean;
    isDeleting?: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    description?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-modal="true" aria-labelledby="ai-reporting-delete-title">
        <h2 id="ai-reporting-delete-title">{title}</h2>
        {description ? <p>{description}</p> : null}
        <button type="button" onClick={onClose} disabled={isDeleting}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={isDeleting}>
          {isDeleting ? 'Saving...' : 'Delete'}
        </button>
      </div>
    ) : null,
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
  renameSessionMock.mockReset();
  chatMock.mockReset();
  chatStreamMock.mockReset();
  editMessageStreamMock.mockReset();
  speechRecognitionInstance = null;
  speechRecognitionInstances.length = 0;

  listSessionsMock.mockResolvedValue(sessions);
  createSessionMock.mockResolvedValue({ id: 'new-session' });
  getSessionMessagesMock.mockResolvedValue(messages);
  archiveSessionMock.mockResolvedValue({ success: true });
  renameSessionMock.mockResolvedValue({ success: true });
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

  test('preserves the first streamed response while stale startup requests resolve', async () => {
    let resolveInitialSessions: ((sessions: ReportChatSessionSummary[]) => void) | undefined;
    listSessionsMock
      .mockImplementationOnce(
        () =>
          new Promise<ReportChatSessionSummary[]>((resolve) => {
            resolveInitialSessions = resolve;
          }),
      )
      .mockResolvedValue([]);
    getSessionMessagesMock.mockResolvedValue([]);
    let releaseStream: (() => void) | undefined;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    chatStreamMock.mockImplementation(
      async (
        _payload: unknown,
        handlers?: {
          onStart?: (event: { sessionId: string; messageId: string }) => void;
          onThoughtDelta?: (delta: string) => void;
          onThoughtDone?: () => void;
          onAnswerDelta?: (delta: string) => void;
        },
      ) => {
        handlers?.onStart?.({ sessionId: 'fresh-session', messageId: 'assistant-fresh' });
        await streamGate;
        handlers?.onThoughtDelta?.('Checking the data.');
        handlers?.onThoughtDone?.();
        handlers?.onAnswerDelta?.('The first analysis is ready.');
        return {
          sessionId: 'fresh-session',
          text: 'The first analysis is ready.',
          thoughtContent: 'Checking the data.',
        };
      },
    );

    renderView();

    const composer = await screen.findByRole('textbox', {
      name: 'Ask a question about your business data...',
    });
    fireEvent.change(composer, { target: { value: 'Run the first analysis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(chatStreamMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getSessionMessagesMock).not.toHaveBeenCalled();
    await act(async () => {
      resolveInitialSessions?.([]);
      await Promise.resolve();
    });
    await act(async () => releaseStream?.());

    expect(await screen.findByText('The first analysis is ready.')).toBeInTheDocument();
    expect(screen.getByText('Run the first analysis')).toBeInTheDocument();
  });

  test('renames a chat from the actions contained in its history row', async () => {
    renderView();

    await screen.findAllByText('Quarterly revenue');
    fireEvent.click(screen.getByRole('button', { name: 'Rename chat Quarterly revenue' }));

    const titleInput = screen.getByRole('textbox', { name: 'Chat title' });
    fireEvent.change(titleInput, { target: { value: 'Revenue review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save chat title' }));

    await waitFor(() =>
      expect(renameSessionMock).toHaveBeenCalledWith('revenue', 'Revenue review'),
    );
    expect((await screen.findAllByText('Revenue review')).length).toBeGreaterThan(0);
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

  test('renders a validated visualization and exposes its source data', async () => {
    const chartDefinition = {
      version: 1,
      type: 'bar',
      title: 'Monthly revenue',
      xKey: 'month',
      xLabel: 'Month',
      series: [
        { key: 'revenue', label: 'Revenue', format: 'currency', currency: 'EUR' },
        { key: 'margin', label: 'Margin', format: 'percent', unit: 'pts' },
      ],
      data: [
        { month: 'January', revenue: 1200, margin: 12 },
        { month: 'February', revenue: 1500, margin: 15 },
      ],
    };
    getSessionMessagesMock.mockResolvedValueOnce([
      messages[0],
      {
        ...messages[1],
        content: [
          'Revenue increased.',
          '```praetor-visualization',
          JSON.stringify(chartDefinition),
          '```',
        ].join('\n'),
      },
    ]);

    renderView();

    expect(await screen.findByRole('figure', { name: 'Monthly revenue' })).toBeInTheDocument();
    expect(screen.getByText('Revenue increased.')).toBeInTheDocument();
    expect(screen.queryByText(/praetor-visualization/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show data' }));
    const table = await screen.findByRole('table', { name: 'Data used for Monthly revenue' });
    expect(within(table).getByText('January')).toBeInTheDocument();
    expect(within(table).getByText('€1,200.00')).toBeInTheDocument();
    expect(within(table).getByText('12% pts')).toBeInTheDocument();
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
