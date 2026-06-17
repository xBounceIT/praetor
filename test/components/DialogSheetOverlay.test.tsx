import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../components/ui/sheet';

const getOverlay = (slot: 'dialog-overlay' | 'sheet-overlay') => {
  const overlay = document.body.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  expect(overlay).not.toBeNull();
  return overlay as HTMLElement;
};

const expectImmediateBackdropClose = (overlay: HTMLElement) => {
  expect(overlay.className).not.toContain('data-[state=closed]:animate-out');
  expect(overlay.className).not.toContain('data-[state=closed]:fade-out-0');
  expect(overlay.className).toContain('data-[state=open]:animate-in');
  expect(overlay.className).toContain('data-[state=open]:fade-in-0');
};

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  document.body.style.pointerEvents = '';
});

describe('fullscreen overlay backdrops', () => {
  test('Dialog overlay has no closing animation classes', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expectImmediateBackdropClose(getOverlay('dialog-overlay'));
  });

  test('Dialog removes its backdrop when controlled closed', () => {
    const { rerender } = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(getOverlay('dialog-overlay')).toBeInTheDocument();

    rerender(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(document.body.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  });

  test('Sheet overlay has no closing animation classes', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expectImmediateBackdropClose(getOverlay('sheet-overlay'));
  });

  test('Sheet removes its backdrop when controlled closed', () => {
    const { rerender } = render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(getOverlay('sheet-overlay')).toBeInTheDocument();

    rerender(
      <Sheet open={false}>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(document.body.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
  });
});
