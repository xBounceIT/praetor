// Prefix values that spreadsheet apps would interpret as formulas (CSV injection).
// Allows leading whitespace (incl. tab/CR) before the formula char, since
// Excel/Sheets ignore it before parsing.
const FORMULA_PREFIXES = /^\s*[=+\-@]/;
const UTF8_BOM = String.fromCharCode(0xfeff);

const escapeCsvCell = (val: string) => {
  const safe = FORMULA_PREFIXES.test(val) ? `'${val}` : val;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const downloadCsv = (rows: string[][], filename: string) => {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  const blob = new Blob([UTF8_BOM, csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 0);
};
