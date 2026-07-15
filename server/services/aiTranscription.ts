import { normalizeGeminiModelPath } from '../utils/ai-models.ts';

export type AiTranscriptionProvider = 'gemini' | 'openrouter' | 'anthropic' | 'openai';

export interface AiTranscriptionConfig {
  aiProvider: AiTranscriptionProvider;
  geminiApiKey: string;
  geminiModelId: string;
  openrouterApiKey: string;
  openaiApiKey: string;
}

export class AiTranscriptionUnavailableError extends Error {
  constructor() {
    super('No configured AI provider supports audio transcription.');
    this.name = 'AiTranscriptionUnavailableError';
  }
}
const getAudioFormat = (mimeType: string) => {
  const subtype = mimeType.split(';', 1)[0]?.split('/', 2)[1]?.replace(/^x-/, '') || 'webm';
  return subtype === 'mpeg' ? 'mp3' : subtype;
};

const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const OPENROUTER_TRANSCRIPTION_MODEL = 'openai/whisper-large-v3';
const OPENAI_TRANSCRIPTION_FORMATS = new Set([
  'flac',
  'mp3',
  'mp4',
  'mpga',
  'm4a',
  'ogg',
  'wav',
  'webm',
]);

const supportsOpenAiTranscription = (mimeType: string) =>
  OPENAI_TRANSCRIPTION_FORMATS.has(getAudioFormat(mimeType));

const parseTranscript = (payload: unknown) => {
  const text = (payload as { text?: unknown })?.text;
  return typeof text === 'string' ? text.trim() : '';
};

const requireTranscript = (payload: unknown) => {
  const transcript = parseTranscript(payload);
  if (!transcript) throw new Error('The transcription provider returned no text.');
  return transcript;
};

const transcribeWithOpenAi = async (
  apiKey: string,
  audio: Buffer,
  mimeType: string,
  language: string,
) => {
  const body = new FormData();
  body.append('model', OPENAI_TRANSCRIPTION_MODEL);
  body.append('language', language);
  const format = getAudioFormat(mimeType);
  body.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `dictation.${format}`);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  if (!response.ok) throw new Error(`OpenAI transcription failed: HTTP ${response.status}`);
  return requireTranscript(await response.json());
};

const transcribeWithOpenRouter = async (
  apiKey: string,
  audio: Buffer,
  mimeType: string,
  language: string,
) => {
  const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_TRANSCRIPTION_MODEL,
      language,
      input_audio: {
        data: audio.toString('base64'),
        format: getAudioFormat(mimeType),
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter transcription failed: HTTP ${response.status}`);
  return requireTranscript(await response.json());
};

const transcribeWithGemini = async (
  apiKey: string,
  modelId: string,
  audio: Buffer,
  mimeType: string,
  language: string,
) => {
  const normalizedModel = normalizeGeminiModelPath(modelId);
  if (!normalizedModel.ok) throw new AiTranscriptionUnavailableError();
  const url = new URL(
    `/v1beta/${normalizedModel.value}:generateContent`,
    'https://generativelanguage.googleapis.com',
  );
  url.searchParams.set('key', apiKey);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: `Transcribe this audio verbatim in ${language}. Return only the transcript.` },
            { inlineData: { mimeType, data: audio.toString('base64') } },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini transcription failed: HTTP ${response.status}`);
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return requireTranscript({
    text: payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(''),
  });
};

export const transcribeAiReportingAudio = async (
  config: AiTranscriptionConfig,
  audio: Buffer,
  mimeType: string,
  language: 'en' | 'it',
) => {
  const available = {
    openai: Boolean(config.openaiApiKey.trim()) && supportsOpenAiTranscription(mimeType),
    openrouter: Boolean(config.openrouterApiKey.trim()),
    gemini: Boolean(config.geminiApiKey.trim() && config.geminiModelId.trim()),
  };
  const fallbackOrder = ['openai', 'openrouter', 'gemini'] as const;
  const preferred = config.aiProvider === 'anthropic' ? null : config.aiProvider;
  const provider = [preferred, ...fallbackOrder].find(
    (candidate, index, values) =>
      candidate && values.indexOf(candidate) === index && available[candidate],
  );

  if (!provider) throw new AiTranscriptionUnavailableError();
  if (provider === 'openai') {
    return transcribeWithOpenAi(config.openaiApiKey, audio, mimeType, language);
  }
  if (provider === 'openrouter') {
    return transcribeWithOpenRouter(config.openrouterApiKey, audio, mimeType, language);
  }
  return transcribeWithGemini(config.geminiApiKey, config.geminiModelId, audio, mimeType, language);
};
