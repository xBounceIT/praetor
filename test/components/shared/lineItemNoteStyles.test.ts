import { describe, expect, test } from 'bun:test';
import {
  LINE_ITEM_NOTE_CELL_CLASSNAME,
  LINE_ITEM_NOTE_COLUMN_MIN_WIDTH,
} from '../../../components/shared/lineItemNoteStyles';

describe('line item note column styles', () => {
  test('starts the note editor at a compact width', () => {
    expect(LINE_ITEM_NOTE_COLUMN_MIN_WIDTH).toBe(244);
    expect(LINE_ITEM_NOTE_CELL_CLASSNAME).toBe('min-w-[220px]');
  });
});
