import { describe, expect, test } from 'bun:test';
import { generateRilRows } from '../../utils/ril';
import { buildRilWorkbook } from '../../utils/rilExport';

describe('RIL Excel export', () => {
  test('builds a Prospetto Presenze workbook with header, day grid, legend, and summary', () => {
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
      lunchBreakMinutes: 60,
    });
    const worksheet = workbook.getWorksheet('Prospetto Presenze');

    expect(worksheet).toBeDefined();

    // Header block above the day grid.
    expect(worksheet?.getCell('A1').value).toBe('Dipendente:');
    expect(worksheet?.getCell('B1').value).toBe('User Name');
    expect(worksheet?.getCell('A2').value).toBe('Società:');
    expect(worksheet?.getCell('B2').value).toBe('ACME');
    expect(worksheet?.getCell('A4').value).toBe('MESE:');
    expect(String(worksheet?.getCell('B4').value)).toContain('maggio');
    expect(String(worksheet?.getCell('B4').value)).toContain('26');

    // Column headers on row 6 (Note/Cod carry the legend markers).
    expect((worksheet?.getRow(6).values as unknown[]).slice(1, 11)).toEqual([
      'Giorno',
      'Entrata',
      'Uscita',
      'Ore',
      'PICAP',
      'Reperib. Telef.',
      'Note (**)',
      'Trasferta',
      'Cod (***)',
      'Commessa',
    ]);

    // The simplified sheet drops the 17 hidden helper columns: nothing beyond column J.
    expect(worksheet?.columnCount).toBeLessThanOrEqual(10);
    expect(worksheet?.getCell('K6').value ?? null).toBeNull();

    // Day 4 (Monday) sits on row 10 (FIRST_DAY_ROW 7 + offset 3).
    const dayCell = String(worksheet?.getCell('A10').value ?? '');
    expect(dayCell).toContain('4');
    expect(dayCell.toLowerCase()).toContain('lun');
    expect(worksheet?.getCell('B10').value).toBe('09:00');
    expect(worksheet?.getCell('C10').value).toBe('18:00');
    expect(worksheet?.getCell('D10').value).toBe('8:00');
    expect(worksheet?.getCell('E10').value).toBe(8);
    expect(worksheet?.getCell('H10').value).toBe('Remote working');
    expect(worksheet?.getCell('J10').value).toBe('ORD-1');

    // May 1 2026 is a holiday weekday, auto-marked F on the first day row.
    expect(worksheet?.getCell('G7').value).toBe('F');

    // Legend block.
    expect(worksheet?.getCell('A39').value).toBe('**');
    expect(worksheet?.getCell('B39').value).toBe('P');
    expect(worksheet?.getCell('C39').value).toBe('Ferie');
    expect(worksheet?.getCell('A43').value).toBe('***');
    expect(worksheet?.getCell('B43').value).toBe('TR');
    expect(worksheet?.getCell('B44').value).toBe('SD');

    // Summary boxes beside the legend: label merged across F–G, value in H.
    expect(worksheet?.getCell('F39').value).toBe('Giorni Lavorati');
    expect(worksheet?.getCell('H39').value).toBe(20);
    expect(worksheet?.getCell('F40').value).toBe('Ore Extra');
    expect(worksheet?.getCell('H40').value).toBe('0:00');
    expect(worksheet?.getCell('F41').value).toBe('Totale Ore');
    expect(worksheet?.getCell('H41').value).toBe('160:00');
    expect(worksheet?.getCell('F42').value).toBe('Totale PICAP');
    expect(worksheet?.getCell('H42').value).toBe('160,00');
    expect(worksheet?.getCell('F43').value).toBe('Pausa Pranzo');
    expect(worksheet?.getCell('H43').value).toBe('1:00');
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
      lunchBreakMinutes: 60,
    });
    const worksheet = workbook.getWorksheet('Prospetto Presenze');

    // Day 30 does not exist in February, so its row (7 + 29 = 36) stays blank.
    expect(worksheet?.getCell('A36').value).toBe('');
    expect(worksheet?.getCell('B36').value).toBe('');
    expect(worksheet?.getCell('D36').value).toBe('');

    // Totals only reflect the 20 real February workdays.
    expect(worksheet?.getCell('H39').value).toBe(20);
    expect(worksheet?.getCell('H41').value).toBe('160:00');
    expect(worksheet?.getCell('H42').value).toBe('160,00');
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
      lunchBreakMinutes: 60,
    });
    const worksheet = workbook.getWorksheet('Prospetto Presenze');

    // Day 4 marked P: time columns cleared, the note retained.
    expect(worksheet?.getCell('B10').value).toBe('');
    expect(worksheet?.getCell('C10').value).toBe('');
    expect(worksheet?.getCell('D10').value).toBe('');
    expect(worksheet?.getCell('E10').value).toBe('');
    expect(worksheet?.getCell('G10').value).toBe('P');
    expect(worksheet?.getCell('H10').value).toBe('');

    // One absence drops the worked-day count and total hours.
    expect(worksheet?.getCell('H39').value).toBe(19);
    expect(worksheet?.getCell('H41').value).toBe('152:00');
    expect(worksheet?.getCell('H42').value).toBe('152,00');
  });
});
