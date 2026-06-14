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

  for (let attempt = 0; attempt < DOCUMENT_CODE_COLLISION_RETRIES; attempt++) {
    const sequence = await documentCodeTemplatesRepo.allocateSequence(moduleId, year, options.exec);
    const code = renderDocumentCode(template, { year, sequence });
    if (code.length > DOCUMENT_CODE_MAX_LENGTH) {
      throw new Error(`Generated document code exceeds ${DOCUMENT_CODE_MAX_LENGTH} characters`);
    }
    if (!(await documentCodeTemplatesRepo.existsForModule(moduleId, code, options.exec))) {
      return code;
    }
  }

  throw new DocumentCodeCollisionError(moduleId);
};

export const previewDocumentCode = async (
  moduleId: DocumentCodeModuleId,
  options: { date?: Date | string; exec?: DbExecutor } = {},
): Promise<DocumentCodePreview> => {
  const exec = options.exec ?? db;
  const year = getDocumentCodeYear(options.date);
  const template = await documentCodeTemplatesRepo.findByModuleId(moduleId, exec);
  const nextSequence = await documentCodeTemplatesRepo.getNextSequence(moduleId, year, exec);

  for (let attempt = 0; attempt < DOCUMENT_CODE_COLLISION_RETRIES; attempt++) {
    const sequence = nextSequence + attempt;
    const code = renderDocumentCode(template, { year, sequence });
    if (code.length > DOCUMENT_CODE_MAX_LENGTH) {
      throw new Error(`Generated document code exceeds ${DOCUMENT_CODE_MAX_LENGTH} characters`);
    }
    if (!(await documentCodeTemplatesRepo.existsForModule(moduleId, code, exec))) {
      return { moduleId, code, year, sequence };
    }
  }

  throw new DocumentCodeCollisionError(moduleId);
};
