export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

export type OllamaMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type OllamaTextResult = {
  text: string;
  thoughtContent?: string;
};

export type OllamaStreamCallbacks = {
  onThoughtDelta?: (delta: string) => Promise<void> | void;
  onAnswerDelta?: (delta: string) => Promise<void> | void;
  onThoughtDone?: () => Promise<void> | void;
};

export type OllamaModel = {
  name: string;
  model: string;
};

type StreamReader = {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  releaseLock?: () => void;
};

type ReadableNdjsonBody = {
  getReader?: () => StreamReader;
};

const invalidBaseUrl = (message: string) => ({ ok: false as const, message });

export const normalizeOllamaBaseUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return invalidBaseUrl('ollamaBaseUrl is required');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return invalidBaseUrl('ollamaBaseUrl must be a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return invalidBaseUrl('ollamaBaseUrl must use http or https');
  }
  if (parsed.username || parsed.password) {
    return invalidBaseUrl('ollamaBaseUrl must not include credentials');
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    return invalidBaseUrl('ollamaBaseUrl must not include a query string or fragment');
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true as const, value: `${parsed.origin}${path === '/' ? '' : path}` };
};

const buildOllamaUrl = (baseUrl: string, path: 'api/chat' | 'api/tags') => {
  const normalized = normalizeOllamaBaseUrl(baseUrl);
  if (!normalized.ok) throw new Error(normalized.message);
  return `${normalized.value}/${path}`;
};

const buildHeaders = (bearerToken: string, includeJsonContentType = false) => {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) headers['Content-Type'] = 'application/json';
  if (bearerToken.trim()) headers.Authorization = `Bearer ${bearerToken}`;
  return headers;
};

const ollamaResponseError = async (response: Response) => {
  let detail = '';
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string') detail = payload.error.trim();
  } catch {
    // Some reverse proxies return HTML or an empty body. The HTTP status remains actionable.
  }
  return new Error(`Ollama request failed: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
};

export const listOllamaModels = async (
  baseUrl: string,
  bearerToken: string,
): Promise<OllamaModel[]> => {
  const response = await fetch(buildOllamaUrl(baseUrl, 'api/tags'), {
    method: 'GET',
    headers: buildHeaders(bearerToken),
    redirect: 'error',
  });
  if (!response.ok) throw await ollamaResponseError(response);

  const payload = (await response.json()) as {
    models?: Array<{ name?: unknown; model?: unknown }>;
  };
  return (payload.models || []).flatMap((model) => {
    const name = typeof model.name === 'string' ? model.name.trim() : '';
    const modelId = typeof model.model === 'string' ? model.model.trim() : '';
    if (!name && !modelId) return [];
    return [{ name: name || modelId, model: modelId || name }];
  });
};

export const ollamaGenerateText = async (
  baseUrl: string,
  bearerToken: string,
  modelId: string,
  messages: OllamaMessage[],
): Promise<OllamaTextResult> => {
  const response = await fetch(buildOllamaUrl(baseUrl, 'api/chat'), {
    method: 'POST',
    headers: buildHeaders(bearerToken, true),
    redirect: 'error',
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: false,
      think: true,
      options: { temperature: 0.2 },
    }),
  });
  if (!response.ok) throw await ollamaResponseError(response);

  const payload = (await response.json()) as {
    error?: unknown;
    message?: { content?: unknown; thinking?: unknown };
  };
  if (typeof payload.error === 'string' && payload.error.trim()) {
    throw new Error(`Ollama request failed: ${payload.error.trim()}`);
  }

  const text = typeof payload.message?.content === 'string' ? payload.message.content.trim() : '';
  const thoughtContent =
    typeof payload.message?.thinking === 'string' ? payload.message.thinking.trim() : '';
  return { text, thoughtContent: thoughtContent || undefined };
};

async function* iterateNdjson(body: unknown): AsyncGenerator<unknown> {
  const stream = body as ReadableNdjsonBody | null;
  if (!stream?.getReader) throw new Error('Ollama response did not include a readable body');

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const parseLine = (rawLine: string): unknown | undefined => {
    const line = rawLine.trim();
    if (!line) return undefined;
    try {
      return JSON.parse(line);
    } catch {
      throw new Error('Ollama returned an invalid streaming response');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const parsed = parseLine(buffer.slice(0, newlineIndex).replace(/\r$/, ''));
        buffer = buffer.slice(newlineIndex + 1);
        if (parsed !== undefined) yield parsed;
        newlineIndex = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    const parsed = parseLine(buffer.replace(/\r$/, ''));
    if (parsed !== undefined) yield parsed;
  } finally {
    reader.releaseLock?.();
  }
}

const createAbortError = () => {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
};

export const ollamaGenerateTextStream = async (
  baseUrl: string,
  bearerToken: string,
  modelId: string,
  messages: OllamaMessage[],
  callbacks: OllamaStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<OllamaTextResult> => {
  if (signal?.aborted) throw createAbortError();

  const response = await fetch(buildOllamaUrl(baseUrl, 'api/chat'), {
    method: 'POST',
    headers: buildHeaders(bearerToken, true),
    redirect: 'error',
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: true,
      think: true,
      options: { temperature: 0.2 },
    }),
    signal,
  });
  if (!response.ok) throw await ollamaResponseError(response);

  let text = '';
  let thoughtContent = '';
  let thoughtDone = false;

  for await (const rawPayload of iterateNdjson(response.body)) {
    if (signal?.aborted) throw createAbortError();
    const payload = rawPayload as {
      error?: unknown;
      message?: { content?: unknown; thinking?: unknown };
    };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      throw new Error(`Ollama request failed: ${payload.error.trim()}`);
    }

    const thoughtDelta =
      typeof payload.message?.thinking === 'string' ? payload.message.thinking : '';
    if (thoughtDelta) {
      thoughtContent += thoughtDelta;
      await callbacks.onThoughtDelta?.(thoughtDelta);
    }

    const answerDelta = typeof payload.message?.content === 'string' ? payload.message.content : '';
    if (answerDelta) {
      if (!thoughtDone) {
        thoughtDone = true;
        await callbacks.onThoughtDone?.();
      }
      text += answerDelta;
      await callbacks.onAnswerDelta?.(answerDelta);
    }
  }

  if (signal?.aborted) throw createAbortError();
  if (!thoughtDone) await callbacks.onThoughtDone?.();
  return { text: text.trim(), thoughtContent: thoughtContent.trim() || undefined };
};
