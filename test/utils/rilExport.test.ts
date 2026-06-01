import { describe, expect, test } from 'bun:test';
import { generateRilRows, RIL_VISIBLE_HEADERS } from '../../utils/ril';
import { buildRilWorkbook } from '../../utils/rilExport';

describe('RIL Excel export', () => {
  test('builds a Prospetto Presenze workbook with headers, sample values, and hidden helpers', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      lunchBreakMinutes: 60,
      projects: [{ id: 'p1', name: 'Project', clientId: 'c1', orderId: 'ORD-1' }],
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
      defaultExitTime: '18:00',
      lunchBreakMinutes: 60,
    });
    const worksheet = workbook.getWorksheet('Prospetto Presenze');

    expect(worksheet).toBeDefined();
    expect((worksheet?.getRow(8).values as unknown[]).slice(1, 11)).toEqual([
      ...RIL_VISIBLE_HEADERS,
    ]);
    expect(worksheet?.getCell('A2').value).toBe('Consulente');
    expect(worksheet?.getCell('B2').value).toBe('User Name');
    expect(worksheet?.getCell('A6').value).toBe('Uscita predefinita');
    expect(worksheet?.getCell('B6').value).toBe('18:00');
    expect(worksheet?.getCell('A9').value).toBe(1);
    expect(worksheet?.getCell('G9').value).toBe('F');
    expect(worksheet?.getCell('T9').value).toBe(0);
    expect(worksheet?.getCell('A12').value).toBe(4);
    expect(worksheet?.getCell('B12').value).toBe('09:00');
    expect(worksheet?.getCell('C12').value).toBe('18:00');
    expect(worksheet?.getCell('D12').value).toBe('8:00');
    expect(worksheet?.getCell('E12').value).toBe(8);
    expect(worksheet?.getCell('H12').value).toBe('Remote working');
    expect(worksheet?.getCell('J12').value).toBe('ORD-1');
    expect(worksheet?.getColumn(11).hidden).toBe(true);
    expect(worksheet?.getColumn(27).hidden).toBe(true);
    expect(worksheet?.getCell('A40').value).toBe('Totali');
    expect(worksheet?.getCell('A44').value).toBe('Giorni Lavorativi');
    expect(worksheet?.getCell('B44').value).toBe(20);
    expect(worksheet?.getCell('B42').value).toBe(0);
  });

  test('does not export values from non-month placeholder rows', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 2,
      entries: [],
    }).map((row) =>
      row.day === 30
        ? {
            ...row,
            entrance: '09:00',
            exit: '18:00',
            hours: '8:00',
            hoursDecimal: 8,
            picap: 8,
            transfer: 'Remote working',
            worked: true,
          }
        : row,
    );

    const workbook = buildRilWorkbook({
      rows,
      employeeName: 'User Name',
      companyName: 'ACME',
      year: 2026,
      month: 2,
      defaultStartTime: '09:00',
      defaultExitTime: '18:00',
      lunchBreakMinutes: 60,
    });
    const worksheet = workbook.getWorksheet('Prospetto Presenze');

    expect(worksheet?.getCell('A38').value).toBe('');
    expect(worksheet?.getCell('B38').value).toBe('');
    expect(worksheet?.getCell('D38').value).toBe('');
    expect(worksheet?.getCell('D40').value).toBe(160);
    expect(worksheet?.getCell('E40').value).toBe(160);
  });

  test('exports absence-note rows without worked time', () => {
    const rows = generateRilRows({
      year: 2026,
      month: 5,
      entries: [],
    }).map((row) =>
      row.day === 4
        ? {
            ...row,
            notes: 'P',
            transfer: 'Remote working',
          }
        : row,
    );

    const workbook = buildRilWorkbook({
      rows,
      employeeName: 'User Name',
      companyName: 'ACME',
      year: 2026,
      month: 5,
      defaultStartTime: '09:00',
      defaultExitTime: '18:00',
      lunchBreakMinutes: 60,
    });
    const worksheet = workbook.getWorksheet('Prospetto Presenze');

    expect(worksheet?.getCell('B12').value).toBe('');
    expect(worksheet?.getCell('C12').value).toBe('');
    expect(worksheet?.getCell('D12').value).toBe('');
    expect(worksheet?.getCell('E12').value).toBe('');
    expect(worksheet?.getCell('G12').value).toBe('P');
    expect(worksheet?.getCell('H12').value).toBe('');
    expect(worksheet?.getCell('S12').value).toBe(0);
    expect(worksheet?.getCell('V12').value).toBe(1);
    expect(worksheet?.getCell('D40').value).toBe(152);
    expect(worksheet?.getCell('E40').value).toBe(152);
    expect(worksheet?.getCell('B45').value).toBe(19);
  });
});
