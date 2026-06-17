import { type DbExecutor, db } from '../db/drizzle.ts';
import * as documentCodeTemplatesRepo from '../repositories/documentCodeTemplatesRepo.ts';
import {
  DOCUMENT_CODE_MAX_LENGTH,
  type DocumentCodeModuleId,
  getDocumentCodeYear,
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

export const allocateDocumentCode = async (
  moduleId: DocumentCodeModuleId,
  options: { date?: Date | string; exec: DbExecutor },
): Promise<string> => {
  const year = getDocumentCodeYear(options.date);
  const template = await documentCodeTemplatesRepo.findByModuleId(moduleId, options.exec);

  const allocateAttempt = async (attempt: number): Promise<string> => {
    if (attempt >= DOCUMENT_CODE_COLLISION_RETRIES) {
      throw new DocumentCodeCollisionError(moduleId);
    }
    const sequence = await documentCodeTemplatesRepo.allocateSequence(moduleId, year, options.exec);
    const code = renderDocumentCode(template, { year, sequence });
    if (code.length > DOCUMENT_CODE_MAX_LENGTH) {
      throw new Error(`Generated document code exceeds ${DOCUMENT_CODE_MAX_LENGTH} characters`);
    }
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
    const code = renderDocumentCode(template, { year, sequence });
    if (code.length > DOCUMENT_CODE_MAX_LENGTH) {
      throw new Error(`Generated document code exceeds ${DOCUMENT_CODE_MAX_LENGTH} characters`);
    }
    return { moduleId, code, year, sequence };
  });
  const existing = await Promise.all(
    candidates.map((candidate) => documentCodeTemplatesRepo.existsForModule(moduleId, candidate.code, exec)),
  );
  const availableIndex = existing.findIndex((exists) => !exists);
  if (availableIndex >= 0) {
    return candidates[availableIndex];
  }

  throw new DocumentCodeCollisionError(moduleId);
};
