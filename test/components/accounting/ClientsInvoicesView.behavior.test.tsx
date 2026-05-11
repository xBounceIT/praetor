import { describe, expect, test } from 'bun:test';
import { readComponentSource } from '../modalStylingTestUtils';

describe('<ClientsInvoicesView /> invoice ID generation', () => {
  test('does not generate invoice IDs from invoices.length (avoids collision after delete)', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    // The previous bug computed the next id as `invoices.length + 1`, which collides
    // with existing ids when an invoice in the middle of the sequence is deleted.
    // The fix removes client-side id generation and lets the server (which uses
    // MAX(sequence)+1) assign the id.
    expect(source).not.toContain('invoices.length + 1');
    expect(source).not.toContain('generateInvoiceId');
  });

  test('opens the add modal with an empty invoice id (server-assigned)', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    // When opening the add modal, the id field must be initialized to '' so the
    // server populates it from `invoicesRepo.generateNextId(year)`.
    expect(source).toMatch(/setEditingInvoice\(null\);\s+setFormData\(\{[\s\S]*?id: ''/);
  });

  test('keeps invoice number required only for edits, never on create', async () => {
    const source = await readComponentSource('accounting/ClientsInvoicesView.tsx');

    // For new invoices the id is server-assigned; the field is optional.
    // For edits, the existing id must be preserved (required).
    expect(source).toContain('required={Boolean(editingInvoice)}');
    expect(source).toContain('if (editingInvoice && !formData.id)');
  });
});
