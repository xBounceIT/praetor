import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import DocumentLineItemsScrollArea from '@/components/ui/document-line-items-scroll-area';
import { render } from '../../helpers/render';

describe('<DocumentLineItemsScrollArea />', () => {
  test('keeps wide document rows together and exposes horizontal scrolling', () => {
    render(
      <DocumentLineItemsScrollArea aria-label="Document items">
        <div>Header and rows</div>
      </DocumentLineItemsScrollArea>,
    );

    const scrollArea = screen.getByRole('region', { name: 'Document items' });

    expect(scrollArea).toHaveClass('overflow-x-auto', 'overscroll-x-contain');
    expect(scrollArea.firstElementChild).toHaveClass('min-w-0', 'lg:min-w-[76rem]');
  });
});
