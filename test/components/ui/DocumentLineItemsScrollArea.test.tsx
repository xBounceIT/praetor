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

  test('allows wider document types to override the shared desktop minimum', () => {
    render(
      <DocumentLineItemsScrollArea
        aria-label="Wide document items"
        contentClassName="lg:min-w-[88rem]"
      >
        <div>Header and rows</div>
      </DocumentLineItemsScrollArea>,
    );

    const content = screen.getByRole('region', { name: 'Wide document items' }).firstElementChild;

    expect(content).toHaveClass('min-w-0', 'lg:min-w-[88rem]');
    expect(content).not.toHaveClass('lg:min-w-[76rem]');
  });
});
