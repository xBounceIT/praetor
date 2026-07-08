import { type DbExecutor, db } from '../db/drizzle.ts';
import * as documentCodeTemplatesRepo from '../repositories/documentCodeTemplatesRepo.ts';
import {
  DOCUMENT_CODE_MAX_LENGTH,
  type DocumentCodeModuleId,
  getDocumentCodeYear,
  parseDocumentCodeCounter,
  renderDocumentCode,
} from '../utils/document-codes.ts';

export class DocumentCodeCollisionError extends Error {
  constructor(
    readonly moduleId: DocumentCodeModuleId,
    message = 'Unable to allocate a unique document code',
  ) {
    super(message);
  }
}

export const DOCUMENT_CODE_COLLISION_RETRIES = 5;

export type DocumentCodePreview = {
  moduleId: DocumentCodeModuleId;
  code: string;
  year: number;
  sequence: number;
};

export type DocumentCodeAllocationOptions = {
  date?: Date | string;
  exec: DbExecutor;
  sourceCode?: string | null;
};

const renderAndValidateDocumentCode = (
  template: Parameters<typeof renderDocumentCode>[0],
  options: { year: number; sequence: number },
): string => {
  const code = renderDocumentCode(template, options);
  if (code.length > DOCUMENT_CODE_MAX_LENGTH) {
    throw new Error(`Generated document code exceeds ${DOCUMENT_CODE_MAX_LENGTH} characters`);
  }
  return code;
};

export const normalizeDocumentCodeSource = (
  sourceCode: string | null | undefined,
): string | undefined => {
  if (typeof sourceCode !== 'string') return undefined;
  return parseDocumentCodeCounter(sourceCode) ? sourceCode : undefined;
};

export const reserveDocumentCodeCounterFromCode = async (
  moduleId: DocumentCodeModuleId,
  code: string | null | undefined,
  exec: DbExecutor,
): Promise<boolean> => {
  const parsed = parseDocumentCodeCounter(code);
  if (!parsed) return false;
  await documentCodeTemplatesRepo.reserveSequenceAtLeast(
    moduleId,
    parsed.year,
    parsed.sequence,
    exec,
  );
  return true;
};

export const allocateDocumentCode = async (
  moduleId: DocumentCodeModuleId,
  options: DocumentCodeAllocationOptions,
): Promise<string> => {
  const template = await documentCodeTemplatesRepo.findByModuleId(moduleId, options.exec);
  const sourceCounter = parseDocumentCodeCounter(options.sourceCode);

  if (sourceCounter) {
    const code = renderAndValidateDocumentCode(template, sourceCounter);
    await documentCodeTemplatesRepo.reserveSequenceAtLeast(
      moduleId,
      sourceCounter.year,
      sourceCounter.sequence,
      options.exec,
    );
    if (await documentCodeTemplatesRepo.existsForModule(moduleId, code, options.exec)) {
      throw new DocumentCodeCollisionError(moduleId);
    }
    return code;
  }

  const year = getDocumentCodeYear(options.date);

  const allocateAttempt = async (attempt: number): Promise<string> => {
    if (attempt >= DOCUMENT_CODE_COLLISION_RETRIES) {
      throw new DocumentCodeCollisionError(moduleId);
    }
    const sequence = await documentCodeTemplatesRepo.allocateSequence(moduleId, year, options.exec);
    const code = renderAndValidateDocumentCode(template, { year, sequence });
    if (!(await documentCodeTemplatesRepo.existsForModule(moduleId, code, options.exec))) {
      return code;
    }
    return allocateAttempt(attempt + 1);
  };

  return allocateAttempt(0);
};

export const previewDocumentCode = async (
  moduleId: DocumentCodeModuleId,
  options: { date?: Date | string; exec?: DbExecutor } = {},
): Promise<DocumentCodePreview> => {
  const exec = options.exec ?? db;
  const year = getDocumentCodeYear(options.date);
  const [template, nextSequence] = await Promise.all([
    documentCodeTemplatesRepo.findByModuleId(moduleId, exec),
    documentCodeTemplatesRepo.getNextSequence(moduleId, year, exec),
  ]);

  const candidates = Array.from({ length: DOCUMENT_CODE_COLLISION_RETRIES }, (_, attempt) => {
    const sequence = nextSequence + attempt;
    const code = renderAndValidateDocumentCode(template, { year, sequence });
    return { moduleId, code, year, sequence };
  });
  const existing = await Promise.all(
    candidates.map((candidate) =>
      documentCodeTemplatesRepo.existsForModule(moduleId, candidate.code, exec),
    ),
  );
  const availableIndex = existing.findIndex((exists) => !exists);
  if (availableIndex >= 0) {
    return candidates[availableIndex];
  }

  throw new DocumentCodeCollisionError(moduleId);
};
