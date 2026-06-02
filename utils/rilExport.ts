import type { Cell } from 'exceljs';
import { Workbook } from 'exceljs';
import type { RilRow } from './ril';
import {
  calculateRilTotals,
  createEmptyRilRow,
  isRilAbsenceRow,
  makeRilDownloadFilename,
  RIL_VISIBLE_HEADERS,
} from './ril';

export interface RilWorkbookInput {
  rows: RilRow[];
  employeeName: string;
  companyName: string;
  year: number;
  month: number;
  defaultStartTime: string;
  defaultExitTime: string;
  lunchBreakMinutes: number;
}

const DAY_COUNT = 31;
const HEADER_ROW = 6;
const FIRST_DAY_ROW = 7;
const LAST_DAY_ROW = FIRST_DAY_ROW + DAY_COUNT - 1;
const SUMMARY_START_ROW = LAST_DAY_ROW + 2;
const ORDER_COLUMN_INDEX = RIL_VISIBLE_HEADERS.indexOf('Commessa');

const YELLOW_FILL = 'FFFFF200';
const HEADER_FILL = 'FFF2F2F2';
const WEEKEND_FILL = 'FFD9D9D9';
const SUMMARY_FILL = 'FFFFC000';
const LUNCH_FILL = 'FF00B0F0';
const SUMMARY_TEXT = 'FF1F4E78';

// Column headers shown above the day grid. The reference RIL form tags Note and Cod with the
// legend markers, so we decorate those two headers without mutating the shared constant.
const HEADER_LABELS = RIL_VISIBLE_HEADERS.map((header) => {
  if (header === 'Note') return 'Note (**)';
  if (header === 'Cod') return 'Cod (***)';
  return header;
});

const LEGEND_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['**', 'P', 'Ferie'],
  ['', 'P2', '1/2 Permesso'],
  ['', 'M', 'Malattia'],
  ['', 'F', 'Festività'],
  ['***', 'TR', 'Trasferta'],
  ['', 'SD', 'Sede Disagiata'],
];

const setThinBorder = (cell: Cell) => {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFD8DEE4' } },
    left: { style: 'thin', color: { argb: 'FFD8DEE4' } },
    bottom: { style: 'thin', color: { argb: 'FFD8DEE4' } },
    right: { style: 'thin', color: { argb: 'FFD8DEE4' } },
  };
};

const setFill = (cell: Cell, argb: string) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
};

// Renders decimal hours as H:MM (no hour padding) to read like the reference form (e.g. 160:00).
const formatHoursClock = (hours: number): string => {
  const safeHours = Math.max(0, hours);
  const totalMinutes = Math.round(safeHours * 60);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
};

const formatMinutesClock = (minutes: number): string => {
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(safeMinutes / 60)}:${String(safeMinutes % 60).padStart(2, '0')}`;
};

const formatMonthLabel = (year: number, month: number) => {
  const monthName = new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(
    new Date(year, month - 1, 1),
  );
  return `${monthName}-${String(year).slice(-2)}`;
};

const formatPicap = (value: number) =>
  new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  );

const normalizeRows = (rows: RilRow[]): RilRow[] => {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return Array.from({ length: DAY_COUNT }, (_, index) => {
    const day = index + 1;
    const row = byDay.get(day);
    return row?.date ? row : createEmptyRilRow(day);
  });
};

export const buildRilWorkbook = (input: RilWorkbookInput): Workbook => {
  const workbook = new Workbook();
  workbook.creator = 'Praetor';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Prospetto Presenze', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
  });
  worksheet.properties.defaultRowHeight = 20;

  worksheet.columns = [
    { key: 'day', width: 12 },
    { key: 'entrance', width: 12 },
    { key: 'exit', width: 12 },
    { key: 'hours', width: 10 },
    { key: 'picap', width: 10 },
    { key: 'phoneAvailability', width: 18 },
    { key: 'notes', width: 16 },
    { key: 'transfer', width: 18 },
    { key: 'code', width: 12 },
    { key: 'order', width: 28 },
  ];

  const setMetaLabel = (rowNumber: number, label: string) => {
    const cell = worksheet.getCell(rowNumber, 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
    setFill(cell, YELLOW_FILL);
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    setThinBorder(cell);
  };

  const setMetaValue = (rowNumber: number, value: string, fillArgb?: string) => {
    worksheet.mergeCells(rowNumber, 2, rowNumber, 5);
    for (let column = 2; column <= 5; column += 1) {
      setThinBorder(worksheet.getCell(rowNumber, column));
    }
    const cell = worksheet.getCell(rowNumber, 2);
    cell.value = value;
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    if (fillArgb) setFill(cell, fillArgb);
  };

  setMetaLabel(1, 'Dipendente:');
  setMetaValue(1, input.employeeName);
  setMetaLabel(2, 'Società:');
  setMetaValue(2, input.companyName);
  setMetaLabel(4, 'MESE:');
  setMetaValue(4, formatMonthLabel(input.year, input.month), YELLOW_FILL);

  const headerRow = worksheet.getRow(HEADER_ROW);
  HEADER_LABELS.forEach((label, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
    setFill(cell, HEADER_FILL);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    setThinBorder(cell);
  });

  const rows = normalizeRows(input.rows);
  rows.forEach((rilRow, index) => {
    const rowNumber = FIRST_DAY_ROW + index;
    const worksheetRow = worksheet.getRow(rowNumber);
    const isAbsenceRow = isRilAbsenceRow(rilRow);
    const isNonWorkingDay = Boolean(rilRow.date) && (!rilRow.isWorkday || rilRow.isHoliday);
    const values: Array<string | number> = [
      rilRow.date ? `${rilRow.weekday} ${rilRow.day}`.trim() : '',
      isAbsenceRow ? '' : rilRow.entrance,
      isAbsenceRow ? '' : rilRow.exit,
      isAbsenceRow ? '' : rilRow.hours,
      isAbsenceRow ? '' : rilRow.picap || '',
      rilRow.phoneAvailability,
      rilRow.notes,
      isAbsenceRow ? '' : rilRow.transfer,
      rilRow.code,
      rilRow.order,
    ];
    values.forEach((value, cellIndex) => {
      const cell = worksheetRow.getCell(cellIndex + 1);
      cell.value = value;
      cell.alignment = {
        vertical: 'middle',
        horizontal: cellIndex === ORDER_COLUMN_INDEX ? 'left' : 'center',
        wrapText: true,
      };
      setThinBorder(cell);
      if (isNonWorkingDay) setFill(cell, WEEKEND_FILL);
    });
  });

  LEGEND_ROWS.forEach(([marker, code, label], index) => {
    const rowNumber = SUMMARY_START_ROW + index;
    const markerCell = worksheet.getCell(rowNumber, 1);
    markerCell.value = marker;
    markerCell.font = { bold: true };
    markerCell.alignment = { vertical: 'middle', horizontal: 'center' };
    setThinBorder(markerCell);
    const codeCell = worksheet.getCell(rowNumber, 2);
    codeCell.value = code;
    codeCell.font = { bold: true };
    codeCell.alignment = { vertical: 'middle', horizontal: 'center' };
    setThinBorder(codeCell);
    const labelCell = worksheet.getCell(rowNumber, 3);
    labelCell.value = label;
    labelCell.alignment = { vertical: 'middle', horizontal: 'left' };
    setThinBorder(labelCell);
  });

  const totals = calculateRilTotals(rows);
  const extraHours = Math.max(0, totals.totalHours - totals.workedDays * 8);
  const summaryRows: ReadonlyArray<readonly [string, string | number, string]> = [
    ['Giorni Lavorati', totals.workedDays, SUMMARY_FILL],
    ['Ore Extra', formatHoursClock(extraHours), SUMMARY_FILL],
    ['Totale Ore', formatHoursClock(totals.totalHours), SUMMARY_FILL],
    ['Totale PICAP', formatPicap(totals.totalPicap), SUMMARY_FILL],
    ['Pausa Pranzo', formatMinutesClock(input.lunchBreakMinutes), LUNCH_FILL],
  ];
  summaryRows.forEach(([label, value, fillArgb], index) => {
    const rowNumber = SUMMARY_START_ROW + index;
    const labelCell = worksheet.getCell(rowNumber, 5);
    labelCell.value = label;
    labelCell.font = { bold: true, color: { argb: SUMMARY_TEXT } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'left' };
    setFill(labelCell, fillArgb);
    setThinBorder(labelCell);
    const valueCell = worksheet.getCell(rowNumber, 6);
    valueCell.value = value;
    valueCell.font = { bold: true, color: { argb: SUMMARY_TEXT } };
    valueCell.alignment = { vertical: 'middle', horizontal: 'right' };
    setFill(valueCell, fillArgb);
    setThinBorder(valueCell);
  });

  return workbook;
};

export const writeRilWorkbookBuffer = async (input: RilWorkbookInput) => {
  const workbook = buildRilWorkbook(input);
  return workbook.xlsx.writeBuffer();
};

export const downloadRilWorkbook = async (input: RilWorkbookInput): Promise<string> => {
  const filename = makeRilDownloadFilename(input.year, input.month, input.employeeName);
  const buffer = await writeRilWorkbookBuffer(input);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
};
