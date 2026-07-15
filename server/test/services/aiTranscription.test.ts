import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  AiTranscriptionUnavailableError,
  transcribeAiReportingAudio,
} from '../../services/aiTranscription.ts';

const fetchMock = mock();
const originalFetch = globalThis.fetch;

const config = {
  aiProvider: 'gemini' as const,
  geminiApiKey: 'gemini-key',
  geminiModelId: 'gemini-2.5-flash',
  openrouterApiKey: '',
  openaiApiKey: '',
};

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('transcribeAiReportingAudio', () => {
  test('sends a supported recording to the selected Gemini provider', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '  Testo dettato  ' }] } }],
      }),
    });

    const text = await transcribeAiReportingAudio(config, Buffer.from('audio'), 'audio/wav', 'it');

    expect(text).toBe('Testo dettato');
    const [url, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain(
      'generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    const body = JSON.parse(String(request.body)) as {
      contents: Array<{
        parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
      }>;
    };
    expect(body.contents[0]?.parts[0]?.text).toContain('verbatim in Italian');
    expect(body.contents[0]?.parts[1]?.inlineData).toEqual({
      mimeType: 'audio/wav',
      data: Buffer.from('audio').toString('base64'),
    });
  });

  test('normalizes configured Gemini tuned model paths', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Tuned transcript' }] } }],
      }),
    });

    await transcribeAiReportingAudio(
      { ...config, geminiModelId: '  tunedModels/company-transcriber  ' },
      Buffer.from('audio'),
      'audio/wav',
      'en',
    );

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain(
      'generativelanguage.googleapis.com/v1beta/tunedModels/company-transcriber:generateContent',
    );
  });

  test('falls back from Gemini to OpenAI for Chrome WebM recordings', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: 'Chrome transcript' }),
    });

    const text = await transcribeAiReportingAudio(
      { ...config, openaiApiKey: 'openai-key' },
      Buffer.from('audio'),
      'audio/webm;codecs=opus',
      'en',
    );

    expect(text).toBe('Chrome transcript');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
  });

  test('rejects Chrome WebM when only Gemini transcription is configured', async () => {
    await expect(
      transcribeAiReportingAudio(config, Buffer.from('audio'), 'audio/webm;codecs=opus', 'en'),
    ).rejects.toBeInstanceOf(AiTranscriptionUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('falls back to a configured OpenAI key when Anthropic is selected', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: 'Fallback transcript' }),
    });

    const text = await transcribeAiReportingAudio(
      {
        ...config,
        aiProvider: 'anthropic',
        geminiApiKey: '',
        geminiModelId: '',
        openaiApiKey: 'openai-key',
      },
      Buffer.from('audio'),
      'audio/webm',
      'en',
    );

    expect(text).toBe('Fallback transcript');
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(request.headers).toEqual({ Authorization: 'Bearer openai-key' });
    const body = request.body as FormData;
    expect(body.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(body.get('language')).toBe('en');
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  test('sends Firefox Ogg recordings directly to OpenAI', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: 'Firefox transcript' }),
    });

    const text = await transcribeAiReportingAudio(
      { ...config, aiProvider: 'openai', openaiApiKey: 'openai-key' },
      Buffer.from('audio'),
      'audio/ogg;codecs=opus',
      'en',
    );

    expect(text).toBe('Firefox transcript');
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const body = request.body as FormData;
    expect((body.get('file') as Blob).type).toBe('audio/ogg;codecs=opus');
  });

  test('rejects unsupported audio before calling OpenAI when no fallback is configured', async () => {
    await expect(
      transcribeAiReportingAudio(
        {
          ...config,
          aiProvider: 'openai',
          geminiApiKey: '',
          geminiModelId: '',
          openaiApiKey: 'openai-key',
        },
        Buffer.from('audio'),
        'audio/aac',
        'en',
      ),
    ).rejects.toBeInstanceOf(AiTranscriptionUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('uses the container format expected by OpenRouter', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: 'OpenRouter transcript' }),
    });

    await transcribeAiReportingAudio(
      {
        ...config,
        aiProvider: 'openrouter',
        geminiApiKey: '',
        geminiModelId: '',
        openrouterApiKey: 'openrouter-key',
      },
      Buffer.from('audio'),
      'audio/webm;codecs=opus',
      'en',
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      input_audio: { data: string; format: string };
    };
    expect(body.input_audio).toEqual({
      data: Buffer.from('audio').toString('base64'),
      format: 'webm',
    });
  });

  test('maps Safari MP4 recordings to the OpenRouter M4A format', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: 'Safari transcript' }),
    });

    await transcribeAiReportingAudio(
      {
        ...config,
        aiProvider: 'openrouter',
        openrouterApiKey: 'openrouter-key',
      },
      Buffer.from('audio'),
      'audio/mp4;codecs=mp4a.40.2',
      'en',
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as { input_audio: { format: string } };
    expect(body.input_audio.format).toBe('m4a');
  });

  test('reports unavailable transcription when no audio-capable provider is configured', async () => {
    await expect(
      transcribeAiReportingAudio(
        {
          ...config,
          aiProvider: 'anthropic',
          geminiApiKey: '',
          geminiModelId: '',
        },
        Buffer.from('audio'),
        'audio/webm',
        'en',
      ),
    ).rejects.toBeInstanceOf(AiTranscriptionUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
