import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realRepo from '../../repositories/documentCodeTemplatesRepo.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';

const repoSnap = { ...realRepo };
const findByModuleIdMock = mock();
const listMock = mock();
const allocateSequenceMock = mock();
const getNextSequenceMock = mock();
const existsForModuleMock = mock();
const reserveSequenceAtLeastMock = mock();

mock.module('../../repositories/documentCodeTemplatesRepo.ts', () => ({
  ...repoSnap,
  findByModuleId: findByModuleIdMock,
  list: listMock,
  allocateSequence: allocateSequenceMock,
  getNextSequence: getNextSequenceMock,
  existsForModule: existsForModuleMock,
  reserveSequenceAtLeast: reserveSequenceAtLeastMock,
}));

let allocateDocumentCode: typeof import('../../services/documentCodes.ts').allocateDocumentCode;
let previewDocumentCode: typeof import('../../services/documentCodes.ts').previewDocumentCode;
let reserveDocumentCodeCounterFromCode: typeof import('../../services/documentCodes.ts').reserveDocumentCodeCounterFromCode;
let DocumentCodeCollisionError: typeof import('../../services/documentCodes.ts').DocumentCodeCollisionError;

beforeAll(async () => {
  const mod = await import('../../services/documentCodes.ts');
  allocateDocumentCode = mod.allocateDocumentCode;
  previewDocumentCode = mod.previewDocumentCode;
  reserveDocumentCodeCounterFromCode = mod.reserveDocumentCodeCounterFromCode;
  DocumentCodeCollisionError = mod.DocumentCodeCollisionError;
});

afterAll(() => {
  mock.module('../../repositories/documentCodeTemplatesRepo.ts', () => repoSnap);
});

beforeEach(() => {
  findByModuleIdMock.mockReset();
  listMock.mockReset();
  allocateSequenceMock.mockReset();
  getNextSequenceMock.mockReset();
  existsForModuleMock.mockReset();
  reserveSequenceAtLeastMock.mockReset();
  findByModuleIdMock.mockResolvedValue({
    moduleId: 'client_invoice',
    label: 'Client invoices',
    prefix: 'INV',
    template: '{PREFIX}_{YYYY}_{SEQ}',
    sequencePadding: 4,
  });
  listMock.mockResolvedValue([
    {
      moduleId: 'client_quote',
      label: 'Client quotes',
      prefix: 'PREV',
      template: '{PREFIX}_{YY}_{SEQ}',
      sequencePadding: 4,
    },
    {
      moduleId: 'client_offer',
      label: 'Client offers',
      prefix: 'OFF',
      template: '{PREFIX}_{YY}_{SEQ}',
      sequencePadding: 4,
    },
  ]);
  getNextSequenceMock.mockResolvedValue(1);
  existsForModuleMock.mockResolvedValue(false);
  reserveSequenceAtLeastMock.mockResolvedValue(undefined);
});

describe('allocateDocumentCode', () => {
  test('uses the provided document date year for invoice counters', async () => {
    allocateSequenceMock.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await allocateDocumentCode('client_invoice', {
      date: '2025-12-31',
      exec: TX_SENTINEL as never,
    });
    await allocateDocumentCode('client_invoice', {
      date: '2026-01-01',
      exec: TX_SENTINEL as never,
    });

    expect(allocateSequenceMock.mock.calls[0]).toEqual(['client_invoice', 2025, TX_SENTINEL]);
    expect(allocateSequenceMock.mock.calls[1]).toEqual(['client_invoice', 2026, TX_SENTINEL]);
  });

  test('keeps annual counters separated so a new year can start from sequence one', async () => {
    allocateSequenceMock.mockResolvedValueOnce(99).mockResolvedValueOnce(1);

    const oldYear = await allocateDocumentCode('client_invoice', {
      date: '2026-12-31',
      exec: TX_SENTINEL as never,
    });
    const newYear = await allocateDocumentCode('client_invoice', {
      date: '2027-01-01',
      exec: TX_SENTINEL as never,
    });

    expect(oldYear).toBe('INV_2026_0099');
    expect(newYear).toBe('INV_2027_0001');
    expect(allocateSequenceMock.mock.calls[0]).toEqual(['client_invoice', 2026, TX_SENTINEL]);
    expect(allocateSequenceMock.mock.calls[1]).toEqual(['client_invoice', 2027, TX_SENTINEL]);
  });

  test('inherits the year and sequence from a parseable source code', async () => {
    findByModuleIdMock.mockResolvedValue({
      moduleId: 'client_offer',
      label: 'Client offers',
      prefix: 'OFF',
      template: '{PREFIX}_{YY}_{SEQ}',
      sequencePadding: 4,
    });

    const code = await allocateDocumentCode('client_offer', {
      exec: TX_SENTINEL as never,
      sourceCode: 'PREV-26-0045-manual',
    });

    expect(code).toBe('OFF_26_0045');
    expect(reserveSequenceAtLeastMock).toHaveBeenCalledWith('client_offer', 2026, 45, TX_SENTINEL);
    expect(existsForModuleMock).toHaveBeenCalledWith('client_offer', 'OFF_26_0045', TX_SENTINEL);
    expect(allocateSequenceMock).not.toHaveBeenCalled();
  });

  test('uses source template shape when the sequence is not adjacent to the year', async () => {
    findByModuleIdMock.mockResolvedValue({
      moduleId: 'client_offer',
      label: 'Client offers',
      prefix: 'OFF',
      template: '{PREFIX}_{YYYY}_{SEQ}',
      sequencePadding: 4,
    });
    listMock.mockResolvedValue([
      {
        moduleId: 'client_quote',
        label: 'Client quotes',
        prefix: 'PREV',
        template: '{PREFIX}_{YYYY}_DOC_{SEQ}',
        sequencePadding: 4,
      },
    ]);

    const code = await allocateDocumentCode('client_offer', {
      exec: TX_SENTINEL as never,
      sourceCode: 'PREV_2026_DOC_0007',
    });

    expect(code).toBe('OFF_2026_0007');
    expect(reserveSequenceAtLeastMock).toHaveBeenCalledWith('client_offer', 2026, 7, TX_SENTINEL);
  });

  test('uses source template shape before numeric prefix segments', async () => {
    findByModuleIdMock.mockResolvedValue({
      moduleId: 'client_offer',
      label: 'Client offers',
      prefix: 'OFF',
      template: '{PREFIX}_{YYYY}_{SEQ}',
      sequencePadding: 4,
    });
    listMock.mockResolvedValue([
      {
        moduleId: 'client_quote',
        label: 'Client quotes',
        prefix: 'ACME_12_345',
        template: '{PREFIX}_{YYYY}_{SEQ}',
        sequencePadding: 4,
      },
    ]);

    const code = await allocateDocumentCode('client_offer', {
      exec: TX_SENTINEL as never,
      sourceCode: 'ACME_12_345_2026_0007',
    });

    expect(code).toBe('OFF_2026_0007');
    expect(reserveSequenceAtLeastMock).toHaveBeenCalledWith('client_offer', 2026, 7, TX_SENTINEL);
  });

  test('uses the first parseable candidate from ordered source codes', async () => {
    findByModuleIdMock.mockResolvedValue({
      moduleId: 'client_order',
      label: 'Client orders',
      prefix: 'ORD',
      template: '{PREFIX}_{YYYY}_{SEQ}',
      sequencePadding: 4,
    });
    listMock.mockResolvedValue([
      {
        moduleId: 'client_offer',
        label: 'Client offers',
        prefix: 'OFF',
        template: '{PREFIX}_{YYYY}_DOC_{SEQ}',
        sequencePadding: 4,
      },
    ]);

    const code = await allocateDocumentCode('client_order', {
      exec: TX_SENTINEL as never,
      sourceCodes: ['legacy-quote-id', 'OFF_2026_DOC_0007'],
    });

    expect(code).toBe('ORD_2026_0007');
    expect(reserveSequenceAtLeastMock).toHaveBeenCalledWith('client_order', 2026, 7, TX_SENTINEL);
    expect(allocateSequenceMock).not.toHaveBeenCalled();
  });
  test('falls back to sequential allocation when the source code is not parseable', async () => {
    findByModuleIdMock.mockResolvedValue({
      moduleId: 'client_offer',
      label: 'Client offers',
      prefix: 'OFF',
      template: '{PREFIX}_{YY}_{SEQ}',
      sequencePadding: 4,
    });
    allocateSequenceMock.mockResolvedValueOnce(7);

    const code = await allocateDocumentCode('client_offer', {
      date: '2027-01-02',
      exec: TX_SENTINEL as never,
      sourceCode: 'legacy-offer-7',
    });

    expect(code).toBe('OFF_27_0007');
    expect(allocateSequenceMock).toHaveBeenCalledWith('client_offer', 2027, TX_SENTINEL);
    expect(reserveSequenceAtLeastMock).not.toHaveBeenCalled();
  });

  test('does not advance to another sequence when an inherited target code already exists', async () => {
    findByModuleIdMock.mockResolvedValue({
      moduleId: 'client_offer',
      label: 'Client offers',
      prefix: 'OFF',
      template: '{PREFIX}_{YY}_{SEQ}',
      sequencePadding: 4,
    });
    existsForModuleMock.mockResolvedValue(true);

    await expect(
      allocateDocumentCode('client_offer', {
        exec: TX_SENTINEL as never,
        sourceCode: 'PREV-26-0045-manual',
      }),
    ).rejects.toBeInstanceOf(DocumentCodeCollisionError);
    expect(reserveSequenceAtLeastMock).toHaveBeenCalledWith('client_offer', 2026, 45, TX_SENTINEL);
    expect(allocateSequenceMock).not.toHaveBeenCalled();
  });

  test('skips existing legacy/manual collisions by advancing the counter', async () => {
    allocateSequenceMock.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    existsForModuleMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const code = await allocateDocumentCode('client_invoice', {
      date: '2026-06-14',
      exec: TX_SENTINEL as never,
    });

    expect(code).toBe('INV_2026_0002');
    expect(existsForModuleMock).toHaveBeenCalledWith(
      'client_invoice',
      'INV_2026_0001',
      TX_SENTINEL,
    );
    expect(existsForModuleMock).toHaveBeenCalledWith(
      'client_invoice',
      'INV_2026_0002',
      TX_SENTINEL,
    );
  });

  test('fails with a clear collision error after bounded retries', async () => {
    allocateSequenceMock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5);
    existsForModuleMock.mockResolvedValue(true);

    await expect(
      allocateDocumentCode('client_invoice', {
        date: '2026-06-14',
        exec: TX_SENTINEL as never,
      }),
    ).rejects.toBeInstanceOf(DocumentCodeCollisionError);
    expect(allocateSequenceMock).toHaveBeenCalledTimes(5);
  });
});

describe('reserveDocumentCodeCounterFromCode', () => {
  test('reserves the owning module counter from the configured template shape', async () => {
    findByModuleIdMock.mockResolvedValue({
      moduleId: 'supplier_order',
      label: 'Supplier orders',
      prefix: 'SORD',
      template: '{PREFIX}_{YYYY}_DOC_{SEQ}',
      sequencePadding: 4,
    });

    await expect(
      reserveDocumentCodeCounterFromCode(
        'supplier_order',
        'SORD_2026_DOC_0009',
        TX_SENTINEL as never,
      ),
    ).resolves.toBe(true);

    expect(reserveSequenceAtLeastMock).toHaveBeenCalledWith('supplier_order', 2026, 9, TX_SENTINEL);
  });

  test('reserves the owning module counter when a manual code is parseable', async () => {
    await expect(
      reserveDocumentCodeCounterFromCode(
        'supplier_order',
        'FORN_2026_0009_manual',
        TX_SENTINEL as never,
      ),
    ).resolves.toBe(true);

    expect(reserveSequenceAtLeastMock).toHaveBeenCalledWith('supplier_order', 2026, 9, TX_SENTINEL);
  });

  test('ignores manual codes that do not match the parseable counter shape', async () => {
    await expect(
      reserveDocumentCodeCounterFromCode(
        'supplier_order',
        'manual-supplier-order',
        TX_SENTINEL as never,
      ),
    ).resolves.toBe(false);

    expect(reserveSequenceAtLeastMock).not.toHaveBeenCalled();
  });
});

describe('previewDocumentCode', () => {
  test('uses the current next sequence without incrementing the counter', async () => {
    getNextSequenceMock.mockResolvedValue(42);

    const preview = await previewDocumentCode('client_invoice', {
      date: '2026-06-14',
      exec: TX_SENTINEL as never,
    });

    expect(preview).toEqual({
      moduleId: 'client_invoice',
      code: 'INV_2026_0042',
      year: 2026,
      sequence: 42,
    });
    expect(getNextSequenceMock).toHaveBeenCalledWith('client_invoice', 2026, TX_SENTINEL);
    expect(allocateSequenceMock).not.toHaveBeenCalled();
  });

  test('skips existing codes in the read-only preview', async () => {
    getNextSequenceMock.mockResolvedValue(1);
    existsForModuleMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const preview = await previewDocumentCode('client_invoice', {
      date: '2026-06-14',
      exec: TX_SENTINEL as never,
    });

    expect(preview.code).toBe('INV_2026_0002');
    expect(preview.sequence).toBe(2);
    expect(allocateSequenceMock).not.toHaveBeenCalled();
  });
});
