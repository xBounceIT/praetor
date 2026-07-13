import type { Workbook } from 'exceljs';
import excelJsBrowserUrl from 'exceljs/dist/exceljs.min.js?url';

type WorkbookConstructor = new () => Workbook;

declare global {
  interface Window {
    ExcelJS?: { Workbook: WorkbookConstructor };
  }
}

let excelJsLoadPromise: Promise<WorkbookConstructor> | null = null;

const loadExcelJs = (): Promise<WorkbookConstructor> => {
  if (window.ExcelJS?.Workbook) return Promise.resolve(window.ExcelJS.Workbook);
  if (excelJsLoadPromise) return excelJsLoadPromise;

  const loadPromise = new Promise<WorkbookConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = excelJsBrowserUrl;
    script.async = true;
    script.dataset.praetorExcelJs = 'true';
    script.onload = () => {
      if (window.ExcelJS?.Workbook) {
        resolve(window.ExcelJS.Workbook);
        return;
      }
      reject(new Error('ExcelJS did not expose its browser API'));
    };
    script.onerror = () => reject(new Error('Unable to load the Excel export engine'));
    document.head.appendChild(script);
  }).catch((error) => {
    excelJsLoadPromise = null;
    throw error;
  });

  excelJsLoadPromise = loadPromise;
  return loadPromise;
};

export const createExcelWorkbook = async (): Promise<Workbook> => {
  const WorkbookClass = await loadExcelJs();
  return new WorkbookClass();
};
