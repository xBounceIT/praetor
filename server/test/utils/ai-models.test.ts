import { describe, expect, test } from 'bun:test';
import { normalizeGeminiModelPath } from '../../utils/ai-models.ts';

describe('normalizeGeminiModelPath', () => {
  test('rejects empty string', () => {
    const result = normalizeGeminiModelPath('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('modelId is required');
    }
  });

  test('rejects whitespace-only after trim', () => {
    const result = normalizeGeminiModelPath('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('modelId is required');
    }
  });

  test('rejects internal whitespace', () => {
    const result = normalizeGeminiModelPath('gemini pro');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('whitespace');
    }
  });

  test('rejects modelIds with ".." traversal', () => {
    const result = normalizeGeminiModelPath('models/..');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('modelId contains invalid characters');
    }
  });

  test('rejects modelIds with "?"', () => {
    const result = normalizeGeminiModelPath('models/foo?bar');
    expect(result.ok).toBe(false);
  });

  test('rejects modelIds with "#"', () => {
    const result = normalizeGeminiModelPath('models/foo#bar');
    expect(result.ok).toBe(false);
  });

  test('rejects modelIds with "%"', () => {
    const result = normalizeGeminiModelPath('models/foo%20bar');
    expect(result.ok).toBe(false);
  });

  test('rejects modelIds with ":"', () => {
    const result = normalizeGeminiModelPath('models:foo');
    expect(result.ok).toBe(false);
  });

  test('prefixes a bare model id with "models/"', () => {
    const result = normalizeGeminiModelPath('gemini-1.5-pro');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('models/gemini-1.5-pro');
    }
  });

  test('trims whitespace before normalizing', () => {
    const result = normalizeGeminiModelPath('  gemini-1.5-pro  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('models/gemini-1.5-pro');
    }
  });

  test('rejects bare model id with disallowed characters', () => {
    const result = normalizeGeminiModelPath('gemini@1.5');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('modelId contains invalid characters');
    }
  });

  test('accepts the "models/<name>" path verbatim', () => {
    const result = normalizeGeminiModelPath('models/gemini-1.5-pro');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('models/gemini-1.5-pro');
    }
  });

  test('accepts the "tunedModels/<name>" path verbatim', () => {
    const result = normalizeGeminiModelPath('tunedModels/my-tuned-model');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('tunedModels/my-tuned-model');
    }
  });

  test('rejects unsupported two-segment prefix', () => {
    const result = normalizeGeminiModelPath('publishers/gemini-1.5-pro');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('modelId must use a supported Gemini model path');
    }
  });

  test('rejects two-segment id with bad characters in the second segment', () => {
    const result = normalizeGeminiModelPath('models/foo$bar');
    expect(result.ok).toBe(false);
  });

  test('rejects deep paths (three or more segments)', () => {
    const result = normalizeGeminiModelPath('models/foo/bar');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('modelId must use a supported Gemini model path');
    }
  });

  test('accepts hyphens, underscores, dots, digits', () => {
    const result = normalizeGeminiModelPath('models/Gemini_1.5-pro_v2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('models/Gemini_1.5-pro_v2');
    }
  });
});
