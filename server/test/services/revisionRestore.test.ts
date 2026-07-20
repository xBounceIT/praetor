import { describe, expect, test } from 'bun:test';
import {
  assertDraftRevisionRestore,
  RevisionRestoreConflict,
} from '../../services/revisionRestore.ts';

describe('revision restore draft guard', () => {
  test('allows restore only for an effective draft document', () => {
    expect(() => assertDraftRevisionRestore('draft')).not.toThrow();

    for (const status of ['sent', 'offer', 'accepted', 'denied', 'expired']) {
      expect(() => assertDraftRevisionRestore(status)).toThrow(RevisionRestoreConflict);
      try {
        assertDraftRevisionRestore(status);
      } catch (error) {
        expect(error).toMatchObject({ secondaryLabel: 'document_not_draft' });
      }
    }
  });
});
