import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realRepo from '../../repositories/documentCodeTemplatesRepo.ts';
import { TX_SENTINEL } from '../helpers/txSentinel.ts';

const repoSnap = { ...realRepo };
const findByModuleIdMock = mock();
const allocateSequenceMock = mock();
const existsForModuleMock = mock();

mock.module('../../repositories/documentCodeTemplatesRepo.ts', () => ({
  ...repoSnap,
  findByModuleId: findByModuleIdMock,
  allocateSequence: allocateSequenceMock,
  existsForModule: existsForModuleMock,
}));

let allocateDocumentCode: typeof import('../../services/documentCodes.ts').allocateDocumentCode;
let DocumentCodeCollisionError: typeof import('../../services/documentCodes.ts').DocumentCodeCollisionError;

beforeAll(async () => {
  const mod = await import('../../services/documentCodes.ts');
  allocateDocumentCode = mod.allocateDocumentCode;
  DocumentCodeCollisionError = mod.DocumentCodeCollisionError;
});

afterAll(() => {
  mock.module('../../repositories/documentCodeTemplatesRepo.ts', () => repoSnap);
});

beforeEach(() => {
  findByModuleIdMock.mockReset();
  allocateSequenceMock.mockReset();
  existsForModuleMock.mockReset();
  findByModuleIdMock.mockResolvedValue({
    moduleId: 'client_invoice',
    label: 'Client invoices',
    prefix: 'INV',
    template: '{PREFIX}_{YYYY}_{SEQ}',
    sequencePadding: 4,
  });
  existsForModuleMock.mockResolvedValue(false);
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
