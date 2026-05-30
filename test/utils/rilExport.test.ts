import { describe, expect, test } from 'bun:test';
import { generateRilRows, RIL_VISIBLE_HEADERS } from '../../utils/ril';
import { buildRilWorkbook } from '../../utils/rilExport';

describe('RIL Excel export', () => {
  test('builds a Prospetto Presenze workbook with headers, sample values, and hidden helpers', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      defaultStartTime: '09:00',
      lunchBreakMinutes: 60,
      entries: [
        {
          id: 'te-1',
          userId: 'u1',
          date: '2026-05-04',
          clientId: 'c1',
          clientName: 'Client',
          projectId: 'p1',
          projectName: 'Project',
          task: 'Dev',
          duration: 8,
          createdAt: 1,
          version: 1,
          location: 'remote',
        },
      ],
    });

    const workbook = buildRilWorkbook({
      rows,
      employeeName: 'User Name',
      companyName: 'ACME',
      year: 2026,
      month: 5,
      defaultStartTime: '09:00',
      lunchBreakMinutes: 60,
    });
    const worksheet = workbook.getWorksheet('Prospetto Presenze');

    expect(worksheet).toBeDefined();
    expect((worksheet?.getRow(8).values as unknown[]).slice(1, 11)).toEqual([
      ...RIL_VISIBLE_HEADERS,
    ]);
    expect(worksheet?.getCell('A2').value).toBe('Consulente');
    expect(worksheet?.getCell('B2').value).toBe('User Name');
    expect(worksheet?.getCell('A9').value).toBe(1);
    expect(worksheet?.getCell('G9').value).toBe('F');
    expect(worksheet?.getCell('A12').value).toBe(4);
    expect(worksheet?.getCell('B12').value).toBe('09:00');
    expect(worksheet?.getCell('C12').value).toBe('18:00');
    expect(worksheet?.getCell('D12').value).toBe('8:00');
    expect(worksheet?.getCell('E12').value).toBe(8);
    expect(worksheet?.getCell('H12').value).toBe('Remote working');
    expect(worksheet?.getColumn(11).hidden).toBe(true);
    expect(worksheet?.getColumn(27).hidden).toBe(true);
    expect(worksheet?.getCell('A40').value).toBe('Totali');
    expect(worksheet?.getCell('A44').value).toBe('Giorni Lavorativi');
    expect(worksheet?.getCell('B44').value).toBe(20);
    expect(worksheet?.getCell('B42').value).toBe(0);
  });
});
