const GEMINI_ALLOWED_PREFIXES = new Set(['models', 'tunedModels']);
const GEMINI_MODEL_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

const invalidModelId = (message: string) => ({ ok: false as const, message });

export const normalizeGeminiModelPath = (modelId: string) => {
  const trimmed = modelId.trim();
  if (!trimmed) return invalidModelId('modelId is required');
  if (/\s/.test(trimmed)) {
    return invalidModelId('modelId must not contain whitespace');
  }
  if (
    trimmed.includes('..') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes('%') ||
    trimmed.includes(':')
  ) {
    return invalidModelId('modelId contains invalid characters');
  }

  const parts = trimmed.split('/');
  if (parts.length === 1) {
    if (!GEMINI_MODEL_SEGMENT_PATTERN.test(parts[0])) {
      return invalidModelId('modelId contains invalid characters');
    }
    return { ok: true as const, value: `models/${parts[0]}` };
  }

  if (
    parts.length === 2 &&
    GEMINI_ALLOWED_PREFIXES.has(parts[0]) &&
    GEMINI_MODEL_SEGMENT_PATTERN.test(parts[1])
  ) {
    return { ok: true as const, value: `${parts[0]}/${parts[1]}` };
  }

  return invalidModelId('modelId must use a supported Gemini model path');
};
