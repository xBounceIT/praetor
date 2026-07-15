import type { Cell, Workbook } from 'exceljs';
import { downloadBlob } from './download';
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
  lunchBreakMinutes: number;
}

const DAY_COUNT = 31;
const HEADER_ROW = 6;
const FIRST_DAY_ROW = 7;
const LAST_DAY_ROW = FIRST_DAY_ROW + DAY_COUNT - 1;
// The legend and the summary boxes sit side by side from this row down (see the column
// constants below); their lengths never collide because they occupy non-overlapping columns.
const SUMMARY_START_ROW = LAST_DAY_ROW + 2;
const ORDER_COLUMN_INDEX = RIL_VISIBLE_HEADERS.indexOf('Commessa');
// Legend: cols A–D (label merged across C–D). Summary: cols F–H (label merged across F–G,
// value in H), col E left as a gap. Labels are merged so long Italian terms stay on one line
// instead of wrapping and clipping inside a single narrow day-grid column.
const LEGEND_MARKER_COLUMN = 1;
const LEGEND_CODE_COLUMN = 2;
const LEGEND_LABEL_COLUMN = 3;
const LEGEND_LABEL_COLUMN_END = 4;
const SUMMARY_LABEL_COLUMN = 6;
const SUMMARY_LABEL_COLUMN_END = 7;
const SUMMARY_VALUE_COLUMN = 8;

const YELLOW_FILL = 'FFFFF200';
const HEADER_FILL = 'FFF2F2F2';
const WEEKEND_FILL = 'FFD9D9D9';
const SUMMARY_FILL = 'FFFFC000';
const LUNCH_FILL = 'FF00B0F0';
const SUMMARY_TEXT = 'FF1F4E78';

// Legend markers tying the Note and Cod columns to their legend groups; shared so the header
// decoration and the legend block cannot drift apart.
const NOTE_MARKER = '**';
const CODE_MARKER = '***';

// Column headers shown above the day grid. The reference RIL form tags Note and Cod with the
// legend markers, so we decorate those two headers without mutating the shared constant.
const HEADER_LABELS = RIL_VISIBLE_HEADERS.map((header) => {
  if (header === 'Note') return `Note (${NOTE_MARKER})`;
  if (header === 'Cod') return `Cod (${CODE_MARKER})`;
  return header;
});

const LEGEND_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  [NOTE_MARKER, 'P', 'Ferie'],
  ['', 'P2', '1/2 Permesso'],
  ['', 'M', 'Malattia'],
  ['', 'F', 'Festività'],
  [CODE_MARKER, 'TR', 'Trasferta'],
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

const MONTH_NAME_FORMAT = new Intl.DateTimeFormat('it-IT', { month: 'long' });
const PICAP_FORMAT = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Renders minutes as H:MM with an unpadded hour, to read like the reference form (e.g. 160:00).
const formatMinutesClock = (minutes: number): string => {
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(safeMinutes / 60)}:${String(safeMinutes % 60).padStart(2, '0')}`;
};

const formatHoursClock = (hours: number): string => formatMinutesClock(hours * 60);

const formatMonthLabel = (year: number, month: number) => {
  const monthName = MONTH_NAME_FORMAT.format(new Date(year, month - 1, 1));
  return `${monthName}-${String(year).slice(-2)}`;
};

const formatPicap = (value: number) => PICAP_FORMAT.format(value);

const normalizeRows = (rows: RilRow[]): RilRow[] => {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return Array.from({ length: DAY_COUNT }, (_, index) => {
    const day = index + 1;
    const row = byDay.get(day);
    return row?.date ? row : createEmptyRilRow(day);
  });
};

export const buildRilWorkbook = (input: RilWorkbookInput, workbook: Workbook): Workbook => {
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

  // Writes a styled, optionally merged cell. Merging lets long legend/summary labels stay on a
  // single line instead of wrapping and clipping inside a narrow day-grid column.
  const writeBoxCell = (
    rowNumber: number,
    startColumn: number,
    endColumn: number,
    value: string | number,
    options: {
      bold?: boolean;
      color?: string;
      align?: 'left' | 'center' | 'right';
      fill?: string;
    } = {},
  ) => {
    if (endColumn > startColumn) {
      worksheet.mergeCells(rowNumber, startColumn, rowNumber, endColumn);
    }
    for (let column = startColumn; column <= endColumn; column += 1) {
      const cell = worksheet.getCell(rowNumber, column);
      if (options.fill) setFill(cell, options.fill);
      setThinBorder(cell);
    }
    const master = worksheet.getCell(rowNumber, startColumn);
    master.value = value;
    master.font = {
      bold: options.bold ?? false,
      ...(options.color ? { color: { argb: options.color } } : {}),
    };
    master.alignment = { vertical: 'middle', horizontal: options.align ?? 'left' };
  };

  LEGEND_ROWS.forEach(([marker, code, label], index) => {
    const rowNumber = SUMMARY_START_ROW + index;
    writeBoxCell(rowNumber, LEGEND_MARKER_COLUMN, LEGEND_MARKER_COLUMN, marker, {
      bold: true,
      align: 'center',
    });
    writeBoxCell(rowNumber, LEGEND_CODE_COLUMN, LEGEND_CODE_COLUMN, code, {
      bold: true,
      align: 'center',
    });
    writeBoxCell(rowNumber, LEGEND_LABEL_COLUMN, LEGEND_LABEL_COLUMN_END, label);
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
    writeBoxCell(rowNumber, SUMMARY_LABEL_COLUMN, SUMMARY_LABEL_COLUMN_END, label, {
      bold: true,
      color: SUMMARY_TEXT,
      align: 'left',
      fill: fillArgb,
    });
    writeBoxCell(rowNumber, SUMMARY_VALUE_COLUMN, SUMMARY_VALUE_COLUMN, value, {
      bold: true,
      color: SUMMARY_TEXT,
      align: 'right',
      fill: fillArgb,
    });
  });

  return workbook;
};

const writeRilWorkbookBuffer = async (input: RilWorkbookInput) => {
  const { createExcelWorkbook } = await import('./excelJsBrowser');
  const workbook = buildRilWorkbook(input, await createExcelWorkbook());
  return workbook.xlsx.writeBuffer();
};

export const downloadRilWorkbook = async (input: RilWorkbookInput): Promise<string> => {
  const filename = makeRilDownloadFilename(input.year, input.month, input.employeeName);
  const buffer = await writeRilWorkbookBuffer(input);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(filename, blob);
  return filename;
};
