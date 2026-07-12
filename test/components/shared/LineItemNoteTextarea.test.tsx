import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen } from '@testing-library/react';
import LineItemNoteTextarea from '../../../components/shared/LineItemNoteTextarea';
import {
  LINE_ITEM_NOTE_CELL_CLASSNAME,
  LINE_ITEM_NOTE_COLUMN_MIN_WIDTH,
} from '../../../components/shared/lineItemNoteStyles';
import { render } from '../../helpers/render';

describe('<LineItemNoteTextarea />', () => {
  test('reserves a note column at least three times wider than the previous editor', () => {
    expect(LINE_ITEM_NOTE_COLUMN_MIN_WIDTH).toBeGreaterThanOrEqual(660);
    expect(LINE_ITEM_NOTE_CELL_CLASSNAME).toBe('min-w-[660px]');
  });

  test('grows and shrinks only its own textarea with the entered content', () => {
    const onChange = mock(() => {});
    render(<LineItemNoteTextarea aria-label="Notes" value="" onChange={onChange} />);

    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    let scrollHeight = 84;
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });

    fireEvent.input(textarea, { target: { value: 'A note that wraps onto several lines' } });
    expect(textarea).toHaveStyle({ height: '84px' });

    scrollHeight = 20;
    fireEvent.input(textarea, { target: { value: 'Short' } });
    expect(textarea).toHaveStyle({ height: '36px' });
    expect(textarea).toHaveAttribute('rows', '1');
    expect(textarea).toHaveClass('resize-none', 'overflow-hidden');

    onChange.mockClear();
    fireEvent.change(textarea, { target: { value: 'Saved note' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
