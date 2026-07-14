import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  listOllamaModels,
  normalizeOllamaBaseUrl,
  ollamaGenerateText,
  ollamaGenerateTextStream,
} from '../../services/ollama.ts';

const originalFetch = globalThis.fetch;
const fetchMock = mock();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('normalizeOllamaBaseUrl', () => {
  test('normalizes whitespace, trailing slashes, and optional proxy paths', () => {
    expect(normalizeOllamaBaseUrl(' http://ollama:11434/ ')).toEqual({
      ok: true,
      value: 'http://ollama:11434',
    });
    expect(normalizeOllamaBaseUrl('https://ai.example.test/ollama///')).toEqual({
      ok: true,
      value: 'https://ai.example.test/ollama',
    });
  });

  test('rejects unsupported schemes, credentials, queries, fragments, and empty values', () => {
    for (const value of [
      '',
      'file:///tmp/ollama.sock',
      'http://user:pass@ollama:11434',
      'http://ollama:11434?token=secret',
      'http://ollama:11434?',
      'http://ollama:11434#fragment',
      'http://ollama:11434#',
    ]) {
      expect(normalizeOllamaBaseUrl(value).ok).toBe(false);
    }
  });
});

describe('Ollama HTTP client', () => {
  test('lists models through a proxy path and sends an optional Bearer token', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }, { name: 'alias-only' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      listOllamaModels('https://ai.example.test/ollama/', 'proxy-token'),
    ).resolves.toEqual([
      { name: 'qwen3:8b', model: 'qwen3:8b' },
      { name: 'alias-only', model: 'alias-only' },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ai.example.test/ollama/api/tags');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        redirect: 'error',
        headers: { Authorization: 'Bearer proxy-token' },
      }),
    );
  });

  test('generates non-streaming text and captures thinking content', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { role: 'assistant', thinking: 'Check the data', content: 'The answer' },
          done: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      ollamaGenerateText('http://ollama:11434', '', 'qwen3:8b', [
        { role: 'user', content: 'Question' },
      ]),
    ).resolves.toEqual({ text: 'The answer', thoughtContent: 'Check the data' });

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).toEqual(
      expect.objectContaining({
        model: 'qwen3:8b',
        stream: false,
        think: true,
        options: { temperature: 0.2 },
      }),
    );
  });

  test('parses fragmented NDJSON and emits thinking before answer deltas', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      '{"message":{"thinking":"Inspect "},"done":false}\n{"message":',
      '{"thinking":"rows"},"done":false}\n{"message":{"content":"Result "},',
      '"done":false}\n{"message":{"content":"ready"},"done":true}',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

    const events: string[] = [];
    const result = await ollamaGenerateTextStream(
      'http://ollama:11434',
      '',
      'qwen3:8b',
      [{ role: 'user', content: 'Question' }],
      {
        onThoughtDelta: (delta) => {
          events.push(`thought:${delta}`);
        },
        onThoughtDone: () => {
          events.push('thought-done');
        },
        onAnswerDelta: (delta) => {
          events.push(`answer:${delta}`);
        },
      },
    );

    expect(result).toEqual({ text: 'Result ready', thoughtContent: 'Inspect rows' });
    expect(events).toEqual([
      'thought:Inspect ',
      'thought:rows',
      'thought-done',
      'answer:Result ',
      'answer:ready',
    ]);
  });

  test('surfaces provider errors without exposing credentials', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'model not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(listOllamaModels('http://ollama:11434', 'secret-token')).rejects.toThrow(
      'Ollama request failed: HTTP 404 - model not found',
    );
  });

  test('honors an aborted inference signal', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":{"content":"late"},"done":true}\n', { status: 200 }),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      ollamaGenerateTextStream(
        'http://ollama:11434',
        '',
        'qwen3:8b',
        [{ role: 'user', content: 'Question' }],
        {},
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
