import type { Cell, Worksheet } from 'exceljs';
import { Workbook } from 'exceljs';
import type { RilRow } from './ril';
import {
  calculateRilTotals,
  createEmptyRilRow,
  isRequiredRilWorkday,
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
  lunchBreakMinutes: number;
}

const VISIBLE_COLUMN_COUNT = RIL_VISIBLE_HEADERS.length;
const FIRST_DAY_ROW = 9;
const HELPER_HEADERS = [
  '+',
  'Ore',
  'Min',
  '-',
  'Ore',
  'Min',
  'Ore',
  'Min',
  'Giorni Lavorati',
  'Giorni Lavorativi',
  'Malattia',
  'Permessi',
  'Invest',
  'Festa',
  'Trasf',
  'Disag',
  'Rep fatta',
] as const;
const NOTE_HELPER_PATTERNS = {
  sick: /(^|\s)M($|\s)/i,
  permit: /(^|\s)P($|\s)|P2/i,
  investment: /(^|\s)I($|\s)|I2/i,
  holiday: /(^|\s)F(N)?($|\s)/i,
  hardship: /(^|\s)(D|SD)($|\s)/i,
} as const;

const splitDecimalHours = (hours: number): [number, number] => [
  Math.floor(hours),
  Math.round((hours % 1) * 60),
];

const setThinBorder = (cell: Cell) => {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFD8DEE4' } },
    left: { style: 'thin', color: { argb: 'FFD8DEE4' } },
    bottom: { style: 'thin', color: { argb: 'FFD8DEE4' } },
    right: { style: 'thin', color: { argb: 'FFD8DEE4' } },
  };
};

const styleLabel = (cell: Cell) => {
  cell.font = { bold: true, color: { argb: 'FF1F2937' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
  setThinBorder(cell);
};

const styleInput = (cell: Cell) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  setThinBorder(cell);
};

const setMetadataRow = (worksheet: Worksheet, rowNumber: number, label: string, value: string) => {
  worksheet.getCell(rowNumber, 1).value = label;
  worksheet.getCell(rowNumber, 2).value = value;
  styleLabel(worksheet.getCell(rowNumber, 1));
  styleInput(worksheet.getCell(rowNumber, 2));
};

const formatMonthLabel = (year: number, month: number) =>
  new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1),
  );

const normalizeRows = (rows: RilRow[]): RilRow[] => {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    return byDay.get(day) ?? createEmptyRilRow(day);
  });
};

export const buildRilWorkbook = (input: RilWorkbookInput): Workbook => {
  const workbook = new Workbook();
  workbook.creator = 'Praetor';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Prospetto Presenze', {
    views: [{ state: 'frozen', ySplit: 8 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
  });
  worksheet.properties.defaultRowHeight = 20;

  worksheet.columns = [
    { key: 'day', width: 10 },
    { key: 'entrance', width: 12 },
    { key: 'exit', width: 12 },
    { key: 'hours', width: 10 },
    { key: 'picap', width: 10 },
    { key: 'phoneAvailability', width: 18 },
    { key: 'notes', width: 16 },
    { key: 'transfer', width: 18 },
    { key: 'code', width: 12 },
    { key: 'order', width: 28 },
    ...HELPER_HEADERS.map((_, index) => ({
      key: `helper${index + 1}`,
      width: 12,
      hidden: true,
    })),
  ];

  worksheet.mergeCells(1, 1, 1, VISIBLE_COLUMN_COUNT);
  const title = worksheet.getCell(1, 1);
  title.value = 'Prospetto Presenze';
  title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

  setMetadataRow(worksheet, 2, 'Consulente', input.employeeName);
  setMetadataRow(worksheet, 3, 'Azienda', input.companyName);
  setMetadataRow(worksheet, 4, 'Mese', formatMonthLabel(input.year, input.month));
  setMetadataRow(worksheet, 5, 'Entrata predefinita', input.defaultStartTime);
  setMetadataRow(worksheet, 6, 'Pausa pranzo', `${input.lunchBreakMinutes} min`);

  const headerRow = worksheet.getRow(8);
  RIL_VISIBLE_HEADERS.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    cell.alignment = { horizontal: 'center' };
    setThinBorder(cell);
  });
  HELPER_HEADERS.forEach((header, index) => {
    const cell = headerRow.getCell(VISIBLE_COLUMN_COUNT + index + 1);
    cell.value = header;
    cell.font = { bold: true };
    setThinBorder(cell);
  });

  const rows = normalizeRows(input.rows);
  rows.forEach((rilRow, index) => {
    const rowNumber = FIRST_DAY_ROW + index;
    const worksheetRow = worksheet.getRow(rowNumber);
    const isRequiredWorkday = isRequiredRilWorkday(rilRow);
    const extraHours = Math.max(rilRow.hoursDecimal - 8, 0);
    const shortfallHours =
      isRequiredWorkday && rilRow.hoursDecimal > 0 && rilRow.hoursDecimal < 8
        ? 8 - rilRow.hoursDecimal
        : 0;
    const [extraWholeHours, extraMinutes] = splitDecimalHours(extraHours);
    const [shortfallWholeHours, shortfallMinutes] = splitDecimalHours(shortfallHours);
    const [workedWholeHours, workedMinutes] = splitDecimalHours(rilRow.hoursDecimal);
    const normalizedCode = rilRow.code.trim().toUpperCase();
    const values = [
      rilRow.date ? rilRow.day : '',
      rilRow.entrance,
      rilRow.exit,
      rilRow.hours,
      rilRow.picap || '',
      rilRow.phoneAvailability,
      rilRow.notes,
      rilRow.transfer,
      rilRow.code,
      rilRow.order,
      extraHours,
      extraWholeHours,
      extraMinutes,
      shortfallHours,
      shortfallWholeHours,
      shortfallMinutes,
      workedWholeHours,
      workedMinutes,
      rilRow.worked && isRequiredWorkday ? 1 : 0,
      isRequiredWorkday ? 1 : 0,
      NOTE_HELPER_PATTERNS.sick.test(rilRow.notes) ? 1 : 0,
      NOTE_HELPER_PATTERNS.permit.test(rilRow.notes) ? 1 : 0,
      NOTE_HELPER_PATTERNS.investment.test(rilRow.notes) ? 1 : 0,
      NOTE_HELPER_PATTERNS.holiday.test(rilRow.notes) ? 1 : 0,
      normalizedCode === 'TR' ? 1 : 0,
      normalizedCode === 'SD' || NOTE_HELPER_PATTERNS.hardship.test(rilRow.notes) ? 1 : 0,
      rilRow.phoneAvailability ? 1 : 0,
    ];
    values.forEach((value, cellIndex) => {
      const cell = worksheetRow.getCell(cellIndex + 1);
      cell.value = value;
      cell.alignment = { vertical: 'middle', horizontal: cellIndex === 9 ? 'left' : 'center' };
      setThinBorder(cell);
    });
  });

  const totals = calculateRilTotals(rows);
  const totalRow = worksheet.getRow(40);
  totalRow.getCell(1).value = 'Totali';
  totalRow.getCell(4).value = totals.totalHours;
  totalRow.getCell(5).value = totals.totalPicap;
  for (let column = 1; column <= VISIBLE_COLUMN_COUNT + HELPER_HEADERS.length; column += 1) {
    const cell = totalRow.getCell(column);
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    setThinBorder(cell);
  }

  const summaryRows: Array<[number, string, string | number]> = [
    [42, 'Extra', Math.max(totals.totalPicap - totals.workdays * 8, 0)],
    [44, 'Giorni Lavorativi', totals.workdays],
    [45, 'Giorni Lavorati', totals.workedDays],
    [46, 'Tipo Calcolo', 3],
    [49, 'Pausa Pranzo', `${input.lunchBreakMinutes} min`],
    [51, 'Festivi feriali', totals.holidayWeekdays],
  ];
  summaryRows.forEach(([rowNumber, label, value]) => {
    worksheet.getCell(rowNumber, 1).value = label;
    worksheet.getCell(rowNumber, 2).value = value;
    styleLabel(worksheet.getCell(rowNumber, 1));
    styleInput(worksheet.getCell(rowNumber, 2));
  });

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: true };
    });
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
