import type { ReportChatMessage, ReportChatSessionSummary } from '../../types';
import { fetchApi, fetchApiStream } from './client';
import type { ReportChatStreamDoneEvent, ReportChatStreamHandlers } from './contracts';

const parseSseEventBlock = (rawBlock: string): { event: string; data: string } | null => {
  const lines = rawBlock.replace(/\r/g, '').split('\n');
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
};

const iterateSseEvents = async function* (body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value || new Uint8Array(), { stream: true });
      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const rawBlock = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseEventBlock(rawBlock);
        if (parsed) yield parsed;
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      const parsed = parseSseEventBlock(tail);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
};

const parseReportStream = async (
  response: Response,
  handlers: ReportChatStreamHandlers = {},
): Promise<ReportChatStreamDoneEvent> => {
  if (!response.ok) {
    const jsonError = await response.json().catch(() => null);
    const message =
      typeof jsonError?.error === 'string' ? jsonError.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error('Streaming response body is missing');
  }

  let streamError = '';
  let donePayload: ReportChatStreamDoneEvent | null = null;

  for await (const evt of iterateSseEvents(response.body)) {
    const rawData = String(evt.data || '').trim();
    if (!rawData || rawData === '[DONE]') continue;

    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawData) as unknown;
      if (parsed && typeof parsed === 'object') {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }

    if (evt.event === 'start') {
      handlers.onStart?.({
        sessionId: String(payload.sessionId || ''),
        messageId: String(payload.messageId || ''),
      });
      continue;
    }

    if (evt.event === 'thought_delta') {
      const delta = String(payload.delta || '');
      if (delta) handlers.onThoughtDelta?.(delta);
      continue;
    }

    if (evt.event === 'answer_delta') {
      const delta = String(payload.delta || '');
      if (delta) handlers.onAnswerDelta?.(delta);
      continue;
    }

    if (evt.event === 'thought_done') {
      handlers.onThoughtDone?.();
      continue;
    }

    if (evt.event === 'done') {
      donePayload = {
        sessionId: String(payload.sessionId || ''),
        text: String(payload.text || ''),
        thoughtContent:
          typeof payload.thoughtContent === 'string' ? payload.thoughtContent : undefined,
      };
      continue;
    }

    if (evt.event === 'error') {
      streamError = String(payload.message || 'AI request failed');
    }
  }

  if (streamError) throw new Error(streamError);
  if (!donePayload) throw new Error('Streaming response ended without a completion event');
  return donePayload;
};

export const reportsApi = {
  listSessions: (): Promise<ReportChatSessionSummary[]> =>
    fetchApi<ReportChatSessionSummary[]>('/reports/ai-reporting/sessions'),

  createSession: (data: { title?: string } = {}): Promise<{ id: string }> =>
    fetchApi('/reports/ai-reporting/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSessionMessages: (
    sessionId: string,
    opts: { limit?: number; before?: number } = {},
  ): Promise<ReportChatMessage[]> => {
    const params = new URLSearchParams();
    if (typeof opts.limit === 'number' && Number.isFinite(opts.limit)) {
      params.set('limit', String(Math.floor(opts.limit)));
    }
    if (typeof opts.before === 'number' && Number.isFinite(opts.before)) {
      params.set('before', String(Math.floor(opts.before)));
    }
    const suffix = params.toString();
    const endpoint = `/reports/ai-reporting/sessions/${sessionId}/messages${
      suffix ? `?${suffix}` : ''
    }`;
    return fetchApi<ReportChatMessage[]>(endpoint);
  },

  chat: (
    data: {
      sessionId?: string;
      message: string;
      language?: string;
    },
    signal?: AbortSignal,
  ): Promise<{
    sessionId: string;
    text: string;
    thoughtContent?: string;
  }> =>
    fetchApi('/reports/ai-reporting/chat', {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    }),

  chatStream: async (
    data: {
      sessionId?: string;
      message: string;
      language?: string;
    },
    handlers: ReportChatStreamHandlers = {},
    signal?: AbortSignal,
  ): Promise<ReportChatStreamDoneEvent> => {
    const response = await fetchApiStream('/reports/ai-reporting/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal,
    });

    return parseReportStream(response, handlers);
  },

  editMessageStream: async (
    data: {
      sessionId: string;
      messageId: string;
      content: string;
      language?: string;
    },
    handlers: ReportChatStreamHandlers = {},
    signal?: AbortSignal,
  ): Promise<ReportChatStreamDoneEvent> => {
    const response = await fetchApiStream('/reports/ai-reporting/chat/edit-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal,
    });

    return parseReportStream(response, handlers);
  },

  archiveSession: (sessionId: string): Promise<{ success: boolean }> =>
    fetchApi(`/reports/ai-reporting/sessions/${sessionId}/archive`, { method: 'POST' }),
};
