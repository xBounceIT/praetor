import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    technicalInfo: {
      provider: 'gemini',
      modelId: 'gemini-2.5-pro',
      contextTokensUsed: 850_000,
      contextWindowTokens: 1_000_000,
    },
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
});

describe('<AiReportingView /> interactions', () => {
  test('shows the experimental badge only in the chat sidebar', async () => {
    renderView();

    await screen.findAllByText('Quarterly revenue');
    expect(screen.getAllByText('Experimental')).toHaveLength(1);
  });

  test('reveals technical model and context stats with a warning above 80%', async () => {
    renderView();

    await screen.findAllByText('Quarterly revenue');
    fireEvent.click(screen.getByRole('switch', { name: 'Show technical information' }));

    expect(screen.getByText('gemini · gemini-2.5-pro')).toBeInTheDocument();
    const warning = screen.getByLabelText('Context window warning');
    expect(warning.closest('[data-slot="badge"]')?.textContent).toMatch(
      /850[.,]000 \/ 1[.,]000[.,]000 \(85%\)/,
    );
  });

  test('does not warn when context usage is exactly 80%', async () => {
    getSessionMessagesMock.mockResolvedValueOnce([
      messages[0],
      {
        ...messages[1],
        technicalInfo: {
          provider: 'gemini',
          modelId: 'gemini-2.5-pro',
          contextTokensUsed: 800_000,
          contextWindowTokens: 1_000_000,
        },
      },
    ]);
    renderView();

    await screen.findAllByText('Quarterly revenue');
    fireEvent.click(screen.getByRole('switch', { name: 'Show technical information' }));

    expect(screen.queryByLabelText('Context window warning')).toBeNull();
  });

  test('does not show stale technical info when the latest AI response has none', async () => {
    getSessionMessagesMock.mockResolvedValueOnce([
      ...messages,
      {
        id: 'user-2',
        sessionId: 'revenue',
        role: 'user',
        content: 'Run another analysis',
        createdAt: 1_752_493_600_002,
      },
      {
        id: 'assistant-2',
        sessionId: 'revenue',
        role: 'assistant',
        content: 'The second analysis is ready.',
        createdAt: 1_752_493_600_003,
      },
    ]);
    renderView();

    await screen.findAllByText('Quarterly revenue');
    fireEvent.click(screen.getByRole('switch', { name: 'Show technical information' }));

    expect(screen.queryByText('gemini · gemini-2.5-pro')).toBeNull();
    expect(screen.getByText('Available after the next AI response.')).toBeInTheDocument();
  });

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
      .mockResolvedValue([
        {
          id: 'fresh-session',
          title: 'First analysis',
          createdAt: 1_752_493_800_000,
          updatedAt: 1_752_493_800_000,
        },
      ]);
    getSessionMessagesMock.mockImplementation((sessionId: string) =>
      Promise.resolve(
        sessionId === 'fresh-session'
          ? [
              {
                id: 'user-fresh',
                sessionId,
                role: 'user',
                content: 'Run the first analysis',
                createdAt: 1_752_493_800_000,
              },
              {
                id: 'assistant-fresh',
                sessionId,
                role: 'assistant',
                content: 'The first analysis is ready.',
                thoughtContent: 'Checking the data.',
                createdAt: 1_752_493_800_001,
              },
            ]
          : [],
      ),
    );
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
    await act(async () => releaseStream?.());
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveInitialSessions?.([]);
      await Promise.resolve();
    });

    expect(await screen.findByText('The first analysis is ready.')).toBeInTheDocument();
    expect(screen.getByText('Run the first analysis')).toBeInTheDocument();
    await waitFor(() =>
      expect(getSessionMessagesMock).toHaveBeenCalledWith('fresh-session', {
        limit: 200,
      }),
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  test('starts only one request for two submissions in the same event batch', async () => {
    let releaseStream: (() => void) | undefined;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    chatStreamMock.mockImplementation(
      async (
        _payload: unknown,
        handlers?: { onStart?: (event: { sessionId: string; messageId: string }) => void },
      ) => {
        handlers?.onStart?.({ sessionId: 'revenue', messageId: 'assistant-new' });
        await streamGate;
        return { sessionId: 'revenue', text: 'One response.' };
      },
    );
    renderView();

    const composer = await screen.findByRole('textbox', {
      name: 'Ask a question about your business data...',
    });
    fireEvent.change(composer, { target: { value: 'Run this once' } });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    act(() => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await waitFor(() => expect(chatStreamMock).toHaveBeenCalledTimes(1));
    await act(async () => releaseStream?.());
    await waitFor(() => expect(getSessionMessagesMock).toHaveBeenCalledTimes(2));
  });

  test('ignores older messages that resolve after selecting another session', async () => {
    const revenueHistory: ReportChatMessage[] = Array.from({ length: 100 }, (_, index) => [
      {
        id: `revenue-user-${index}`,
        sessionId: 'revenue',
        role: 'user' as const,
        content: `Revenue question ${index}`,
        createdAt: 10_000 + index * 2,
      },
      {
        id: `revenue-assistant-${index}`,
        sessionId: 'revenue',
        role: 'assistant' as const,
        content: `Revenue answer ${index}`,
        createdAt: 10_001 + index * 2,
      },
    ]).flat();
    const capacityMessages: ReportChatMessage[] = [
      {
        id: 'capacity-user',
        sessionId: 'capacity',
        role: 'user',
        content: 'Show capacity',
        createdAt: 20_000,
      },
      {
        id: 'capacity-assistant',
        sessionId: 'capacity',
        role: 'assistant',
        content: 'Capacity is ready.',
        createdAt: 20_001,
      },
    ];
    let resolveOlderMessages: ((messages: ReportChatMessage[]) => void) | undefined;
    getSessionMessagesMock.mockImplementation(
      (sessionId: string, options?: { before?: number }) => {
        if (sessionId === 'capacity') return Promise.resolve(capacityMessages);
        if (options?.before) {
          return new Promise<ReportChatMessage[]>((resolve) => {
            resolveOlderMessages = resolve;
          });
        }
        return Promise.resolve(revenueHistory);
      },
    );

    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'Load older messages' }));
    await waitFor(() => expect(resolveOlderMessages).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Project capacity' }));
    await waitFor(() => expect(screen.getByText('Capacity is ready.')).toBeInTheDocument());

    await act(async () => {
      resolveOlderMessages?.([
        {
          id: 'stale-revenue-message',
          sessionId: 'revenue',
          role: 'assistant',
          content: 'Old revenue contamination',
          createdAt: 1,
        },
      ]);
    });

    expect(screen.queryByText('Old revenue contamination')).toBeNull();
  });

  test('clears failed edit stream state before loading another session', async () => {
    editMessageStreamMock.mockImplementation(
      async (
        _payload: unknown,
        handlers?: { onStart?: (event: { sessionId: string; messageId: string }) => void },
      ) => {
        handlers?.onStart?.({ sessionId: 'revenue', messageId: 'assistant-edit-failed' });
        throw new Error('Edit failed');
      },
    );
    getSessionMessagesMock.mockImplementation((sessionId: string) =>
      Promise.resolve(
        sessionId === 'capacity'
          ? [{ ...messages[1], id: 'capacity-answer', sessionId, content: 'Capacity is ready.' }]
          : messages,
      ),
    );

    renderView();

    await screen.findByText('Quarterly revenue is available.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editInput = screen.getByRole('textbox', { name: 'Edit message' });
    fireEvent.change(editInput, { target: { value: 'Show updated quarterly revenue' } });
    fireEvent.click(
      within(editInput.closest('[data-slot="card"]') as HTMLElement).getByRole('button', {
        name: 'Send',
      }),
    );
    await waitFor(() => expect(editMessageStreamMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getSessionMessagesMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole('button', { name: 'Project capacity' }));
    await waitFor(() =>
      expect(getSessionMessagesMock.mock.calls.some(([id]) => id === 'capacity')).toBe(true),
    );
  });

  test('reloads canonical messages after stopping an edit stream', async () => {
    editMessageStreamMock.mockImplementation(
      (
        _payload: unknown,
        handlers: { onStart?: (event: { sessionId: string; messageId: string }) => void },
        signal: AbortSignal,
      ) =>
        new Promise((_resolve, reject) => {
          handlers.onStart?.({ sessionId: 'revenue', messageId: 'assistant-edit-pending' });
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            {
              once: true,
            },
          );
        }),
    );

    renderView();

    await screen.findByText('Quarterly revenue is available.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editInput = screen.getByRole('textbox', { name: 'Edit message' });
    fireEvent.change(editInput, { target: { value: 'Show updated quarterly revenue' } });
    fireEvent.click(
      within(editInput.closest('[data-slot="card"]') as HTMLElement).getByRole('button', {
        name: 'Send',
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(getSessionMessagesMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(screen.getByText('Quarterly revenue is available.')).toBeInTheDocument(),
    );
  });

  test('updates technical metadata immediately after editing a message', async () => {
    getSessionMessagesMock
      .mockResolvedValueOnce(messages)
      .mockImplementationOnce(() => new Promise(() => {}));
    editMessageStreamMock.mockImplementation(
      async (
        _payload: unknown,
        handlers?: { onStart?: (event: { sessionId: string; messageId: string }) => void },
      ) => {
        handlers?.onStart?.({ sessionId: 'revenue', messageId: 'assistant-edited' });
        return {
          sessionId: 'revenue',
          text: 'Updated revenue analysis.',
          technicalInfo: {
            provider: 'openai',
            modelId: 'gpt-5.1',
            contextTokensUsed: 10_000,
            contextWindowTokens: 128_000,
          },
        };
      },
    );
    renderView();

    await screen.findByText('Quarterly revenue is available.');
    fireEvent.click(screen.getByRole('switch', { name: 'Show technical information' }));
    expect(screen.getByText('gemini · gemini-2.5-pro')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editInput = screen.getByRole('textbox', { name: 'Edit message' });
    fireEvent.change(editInput, { target: { value: 'Update the quarterly revenue analysis' } });
    fireEvent.click(
      within(editInput.closest('[data-slot="card"]') as HTMLElement).getByRole('button', {
        name: 'Send',
      }),
    );

    expect(await screen.findByText('Updated revenue analysis.')).toBeInTheDocument();
    expect(screen.getByText('openai · gpt-5.1')).toBeInTheDocument();
    expect(screen.queryByText('gemini · gemini-2.5-pro')).toBeNull();
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

  test('closes a chat action tooltip when the pointer leaves its trigger', async () => {
    const user = userEvent.setup();
    renderView();

    await screen.findAllByText('Quarterly revenue');
    const deleteButton = screen.getByRole('button', { name: 'Delete chat Quarterly revenue' });
    await user.hover(deleteButton);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Delete chat');

    await user.hover(tooltip);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
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

  test('keeps attachments selected when sending fails', async () => {
    chatStreamMock.mockImplementationOnce(() => Promise.reject(new Error('Stream failed')));
    chatMock.mockImplementationOnce(() => Promise.reject(new Error('Request failed')));
    renderView();

    await screen.findAllByText('Quarterly revenue');
    const attachmentInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(attachmentInput).not.toBeNull();
    const attachment = new File(['quarter,revenue\nQ1,120000'], 'metrics.csv', {
      type: 'text/csv',
      lastModified: 1,
    });

    fireEvent.change(attachmentInput as HTMLInputElement, { target: { files: [attachment] } });
    await screen.findByRole('button', { name: 'Remove attachment metrics.csv' });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Ask a question about your business data...' }),
      { target: { value: 'Summarize this file' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(chatMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getSessionMessagesMock.mock.calls.length).toBeGreaterThan(1));
    expect(
      screen.getByRole('button', { name: 'Remove attachment metrics.csv' }),
    ).toBeInTheDocument();
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
});
