import { describe, expect, test } from 'bun:test';
import {
  LINE_ITEM_NOTE_CELL_CLASSNAME,
  LINE_ITEM_NOTE_COLUMN_MIN_WIDTH,
} from '../../../components/shared/lineItemNoteStyles';

describe('line item note column styles', () => {
  test('reserves a note column at least three times wider than the previous editor', () => {
    expect(LINE_ITEM_NOTE_COLUMN_MIN_WIDTH).toBeGreaterThanOrEqual(660);
    expect(LINE_ITEM_NOTE_CELL_CLASSNAME).toBe('min-w-[660px]');
  });
});
