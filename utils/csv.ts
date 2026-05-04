// Prefix values that spreadsheet apps would interpret as formulas (CSV injection).
// OWASP-recommended trigger set: =, +, -, @, plus the control chars \t and \r —
// some spreadsheet parsers strip leading whitespace before the formula char,
// so we also catch those whitespace-prefixed cases.
const FORMULA_PREFIXES = /^[\t\r]|^\s*[=+\-@]/;

// UTF-8 BOM (U+FEFF), prepended so Excel auto-detects the encoding —
// otherwise non-ASCII characters render as mojibake. Built from the code
// point so the source stays free of invisible characters.
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
