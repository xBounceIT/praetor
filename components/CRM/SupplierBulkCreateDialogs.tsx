import { FileDown, FileSpreadsheet, FolderOpen, Info, Plus, Rows3, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  BulkSupplierCreateInput,
  BulkSupplierCreateResponse,
  BulkSupplierError,
} from '../../types';
import {
  downloadImportWorkbook,
  type ImportWorkbookIssue,
  type ImportWorkbookParseResult,
  loadImportWorkbook,
  MAX_ENTITY_IMPORT_FILE_BYTES,
  MAX_ENTITY_IMPORT_ROWS,
} from '../../utils/entityImportWorkbook';
import {
  buildSupplierImportDefinition,
  parseSupplierImportWorkbook,
  REQUIRED_SUPPLIER_IMPORT_FIELDS,
  SUPPLIER_IMPORT_FILENAME,
} from '../../utils/supplierImportWorkbook';
import { toastError, toastSuccess } from '../../utils/toast';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import StandardTable, { type Column } from '../shared/StandardTable';

export type CreateBulkSuppliers = (
  suppliers: BulkSupplierCreateInput[],
) => Promise<BulkSupplierCreateResponse>;

type Translate = (key: string, options?: Record<string, unknown>) => string;
type SupplierDraftRow = BulkSupplierCreateInput & { _rowId: string };
type DraftErrors = Record<
  string,
  Partial<Record<keyof BulkSupplierCreateInput | 'general', string>>
>;

const createDraftRow = (sequence: number): SupplierDraftRow => ({
  _rowId: `supplier-draft-${sequence}`,
});

const cleanDraft = ({ _rowId: _ignored, ...draft }: SupplierDraftRow) =>
  Object.fromEntries(
    Object.entries(draft).flatMap(([field, rawValue]) => {
      const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
      return value === '' || value === undefined ? [] : [[field, value]];
    }),
  ) as BulkSupplierCreateInput;

const supplierErrorMessage = (error: BulkSupplierError, t: Translate) => {
  if (error.code === 'required') return t('common:validation.required');
  if (error.code === 'duplicate') return t('crm:suppliers.bulk.errors.duplicate');
  if (error.code === 'too_long') return t('crm:suppliers.bulk.errors.tooLong');
  if (error.code === 'creation_failed') {
    return t('crm:suppliers.bulk.errors.creationFailed');
  }
  return t('crm:suppliers.bulk.errors.invalid');
};

const DraftField = ({
  value,
  error,
  placeholder,
  type = 'text',
  disabled,
  onChange,
}: {
  value: string;
  error?: string;
  placeholder: string;
  type?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) => (
  <div className="min-w-44 space-y-1">
    <Input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-invalid={Boolean(error)}
      disabled={disabled}
      className="h-8 text-xs"
    />
    {error && <p className="max-w-52 whitespace-normal text-[10px] text-destructive">{error}</p>}
  </div>
);

export function SupplierBulkCreateDialog({
  onClose,
  onCreateBulk,
}: {
  onClose: () => void;
  onCreateBulk: CreateBulkSuppliers;
}) {
  const { t } = useTranslation(['crm', 'common']);
  const rowSequence = useRef(1);
  const [rows, setRows] = useState<SupplierDraftRow[]>([createDraftRow(0)]);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [summary, setSummary] = useState<{ succeeded: number; failed: number } | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const patchRow = useCallback(
    (rowId: string, field: keyof BulkSupplierCreateInput, value: string) => {
      if (isSubmitting) return;
      setRows((current) =>
        current.map((row) => (row._rowId === rowId ? { ...row, [field]: value } : row)),
      );
      setErrors((current) => {
        const rowErrors = current[rowId];
        if (!rowErrors?.[field]) return current;
        const nextRowErrors = { ...rowErrors };
        delete nextRowErrors[field];
        return { ...current, [rowId]: nextRowErrors };
      });
    },
    [isSubmitting],
  );

  const textColumn = useCallback(
    (
      field: keyof BulkSupplierCreateInput,
      header: string,
      placeholder: string,
      type = 'text',
    ): Column<SupplierDraftRow> => ({
      header,
      accessorKey: field,
      minWidth: field === 'address' || field === 'notes' ? 240 : 190,
      disableSorting: true,
      disableFiltering: true,
      cell: ({ row }) => (
        <DraftField
          value={String(row[field] ?? '')}
          error={errors[row._rowId]?.[field]}
          placeholder={placeholder}
          type={type}
          disabled={isSubmitting}
          onChange={(value) => patchRow(row._rowId, field, value)}
        />
      ),
    }),
    [errors, isSubmitting, patchRow],
  );

  const columns = useMemo<Column<SupplierDraftRow>[]>(
    () => [
      textColumn(
        'supplierCode',
        `${t('crm:suppliers.code')} *`,
        t('crm:suppliers.codePlaceholder'),
      ),
      textColumn('name', `${t('crm:suppliers.name')} *`, t('crm:suppliers.namePlaceholder')),
      textColumn(
        'contactName',
        t('crm:suppliers.fullName'),
        t('crm:suppliers.fullNamePlaceholder'),
      ),
      textColumn('contactRole', t('crm:suppliers.role'), t('crm:suppliers.rolePlaceholder')),
      textColumn('email', t('crm:suppliers.email'), t('crm:suppliers.emailPlaceholder'), 'email'),
      textColumn('phone', t('crm:suppliers.phone'), t('crm:suppliers.phonePlaceholder'), 'tel'),
      textColumn('address', t('crm:suppliers.address'), t('crm:suppliers.addressPlaceholder')),
      textColumn(
        'vatNumber',
        `${t('crm:suppliers.vatNumber')} *`,
        t('crm:suppliers.vatPlaceholder'),
      ),
      textColumn('taxCode', t('crm:suppliers.taxCode'), t('crm:suppliers.taxCodePlaceholder')),
      textColumn(
        'paymentTerms',
        t('crm:suppliers.paymentTerms'),
        t('crm:suppliers.paymentTermsPlaceholder'),
      ),
      textColumn('notes', t('crm:suppliers.notes'), t('crm:suppliers.notesPlaceholder')),
      {
        header: t('common:labels.actions'),
        id: 'actions',
        align: 'right',
        sticky: 'right',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row }) => (
          <div className="flex max-w-52 items-center justify-end gap-2">
            {errors[row._rowId]?.general && (
              <span className="whitespace-normal text-[10px] text-destructive">
                {errors[row._rowId]?.general}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={isSubmitting}
              onClick={() => {
                setRows((current) =>
                  current.filter((candidate) => candidate._rowId !== row._rowId),
                );
                setErrors((current) => {
                  const next = { ...current };
                  delete next[row._rowId];
                  return next;
                });
              }}
              aria-label={t('crm:suppliers.bulk.removeRow')}
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [errors, isSubmitting, t, textColumn],
  );

  const addRow = () => {
    if (rows.length >= MAX_ENTITY_IMPORT_ROWS) return;
    const nextSequence = rowSequence.current;
    rowSequence.current += 1;
    setRows((current) => [...current, createDraftRow(nextSequence)]);
  };

  const submit = async () => {
    if (rows.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setGeneralError(null);
    setSummary(null);
    const submittedRows = rows;
    try {
      const response = await onCreateBulk(submittedRows.map(cleanDraft));
      const nextRows: SupplierDraftRow[] = [];
      const nextErrors: DraftErrors = {};
      for (const result of response.results) {
        if (result.success) continue;
        const row = submittedRows[result.index];
        if (!row) continue;
        nextRows.push(row);
        const rowErrors: DraftErrors[string] = {};
        for (const error of result.errors) {
          rowErrors[error.field ?? 'general'] = supplierErrorMessage(error, t);
        }
        nextErrors[row._rowId] = rowErrors;
      }

      if (response.summary.succeeded > 0) {
        toastSuccess(t('crm:suppliers.bulk.createdCount', { count: response.summary.succeeded }));
      }
      if (response.summary.failed === 0) {
        onClose();
        return;
      }
      setRows(nextRows);
      setErrors(nextErrors);
      setSummary(response.summary);
    } catch {
      setGeneralError(t('crm:suppliers.bulk.errors.requestFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={!isSubmitting}
      closeOnEsc={!isSubmitting}
      ariaLabel={t('crm:suppliers.bulk.title')}
    >
      <ModalContent size="full">
        <ModalHeader>
          <div>
            <ModalTitle>
              <Rows3 className="size-5" />
              {t('crm:suppliers.bulk.title')}
            </ModalTitle>
            <ModalDescription>{t('crm:suppliers.bulk.description')}</ModalDescription>
          </div>
          <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
        </ModalHeader>
        <ModalBody className="space-y-4">
          {summary && (
            <Alert>
              <Info className="size-4" />
              <AlertTitle>{t('crm:suppliers.bulk.partialTitle')}</AlertTitle>
              <AlertDescription>
                {t('crm:suppliers.bulk.partialDescription', summary)}
              </AlertDescription>
            </Alert>
          )}
          {generalError && (
            <Alert variant="destructive">
              <Info className="size-4" />
              <AlertTitle>{t('common:states.error')}</AlertTitle>
              <AlertDescription>{generalError}</AlertDescription>
            </Alert>
          )}
          <StandardTable<SupplierDraftRow>
            title={t('crm:suppliers.bulk.tableTitle')}
            persistenceKey="crm.suppliers.bulk-create"
            data={rows}
            columns={columns}
            allowColumnHiding={false}
            defaultRowsPerPage={5}
            autoRevealNewRows
            minBodyRows={0}
            popupZIndex={90}
            tableContainerClassName="overflow-x-auto"
            headerAction={
              <Button
                type="button"
                size="sm"
                onClick={addRow}
                disabled={rows.length >= MAX_ENTITY_IMPORT_ROWS || isSubmitting}
              >
                <Plus className="size-4" />
                {t('crm:suppliers.bulk.addRow')}
              </Button>
            }
          />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common:buttons.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={rows.length === 0 || isSubmitting}>
            {isSubmitting && (
              <i className="fa-solid fa-circle-notch fa-spin text-xs" aria-hidden="true"></i>
            )}
            {t('crm:suppliers.bulk.createSuppliers')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

type WorkbookReportIssue = { line?: number; messages: string[] };
type WorkbookImportReport = {
  succeeded: number;
  failed: number;
  issues: WorkbookReportIssue[];
};

const ISSUE_KEYS: Record<ImportWorkbookIssue['code'], string> = {
  invalid_workbook: 'crm:suppliers.bulk.excel.errors.invalidWorkbook',
  wrong_template: 'crm:suppliers.bulk.excel.errors.wrongTemplate',
  unsupported_version: 'crm:suppliers.bulk.excel.errors.unsupportedVersion',
  wrong_entity: 'crm:suppliers.bulk.excel.errors.wrongEntity',
  modified_structure: 'crm:suppliers.bulk.excel.errors.modifiedStructure',
  too_many_rows: 'crm:suppliers.bulk.excel.errors.tooManyRows',
  invalid_cell: 'crm:suppliers.bulk.excel.errors.invalidCell',
};

const workbookIssueMessage = (issue: ImportWorkbookIssue, t: Translate) =>
  t(ISSUE_KEYS[issue.code], { field: issue.field, limit: MAX_ENTITY_IMPORT_ROWS });

const groupWorkbookIssues = (issues: ImportWorkbookIssue[], t: Translate) => {
  const grouped = new Map<number | undefined, string[]>();
  for (const issue of issues) {
    grouped.set(issue.line, [...(grouped.get(issue.line) ?? []), workbookIssueMessage(issue, t)]);
  }
  return [...grouped].map(([line, messages]) => ({ line, messages }));
};

const WorkbookIssueList = ({ issues, t }: { issues: WorkbookReportIssue[]; t: Translate }) => {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {issues.map((issue) => (
        <li key={`${issue.line ?? 'file'}-${issue.messages.join('|')}`}>
          {issue.line ? `${t('crm:suppliers.bulk.excel.rowLabel', { row: issue.line })}: ` : ''}
          {issue.messages.join('; ')}
        </li>
      ))}
    </ul>
  );
};

type WorkbookImportState = {
  fileName: string | null;
  parsed: ImportWorkbookParseResult<BulkSupplierCreateInput> | null;
  fileError: string | null;
  isSubmitting: boolean;
  processed: boolean;
  report: WorkbookImportReport | null;
};

const INITIAL_IMPORT_STATE: WorkbookImportState = {
  fileName: null,
  parsed: null,
  fileError: null,
  isSubmitting: false,
  processed: false,
  report: null,
};

type WorkbookImportAction =
  | { type: 'selectFile'; fileName: string | null }
  | { type: 'fileParsed'; parsed: ImportWorkbookParseResult<BulkSupplierCreateInput> }
  | { type: 'fileError'; message: string }
  | { type: 'submitStarted' }
  | {
      type: 'submitCompleted';
      report: WorkbookImportReport;
      retryRows: ImportWorkbookParseResult<BulkSupplierCreateInput>['rows'];
    }
  | { type: 'submitFinished' };

const workbookImportReducer = (
  state: WorkbookImportState,
  action: WorkbookImportAction,
): WorkbookImportState => {
  switch (action.type) {
    case 'selectFile':
      return {
        ...state,
        fileName: action.fileName,
        parsed: null,
        fileError: null,
        processed: false,
        report: null,
      };
    case 'fileParsed':
      return { ...state, parsed: action.parsed };
    case 'fileError':
      return { ...state, fileError: action.message };
    case 'submitStarted':
      return { ...state, isSubmitting: true, fileError: null };
    case 'submitCompleted':
      return {
        ...state,
        parsed: state.parsed ? { ...state.parsed, rows: action.retryRows } : null,
        processed: action.retryRows.length === 0,
        report: action.report,
      };
    case 'submitFinished':
      return { ...state, isSubmitting: false };
    default:
      return state;
  }
};

export function SupplierWorkbookImportDialog({
  onClose,
  onCreateBulk,
}: {
  onClose: () => void;
  onCreateBulk: CreateBulkSuppliers;
}) {
  const { t } = useTranslation(['crm', 'common']);
  const [state, dispatch] = useReducer(workbookImportReducer, INITIAL_IMPORT_STATE);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileReadSequence = useRef(0);
  const { fileName, parsed, fileError, isSubmitting, processed, report } = state;
  const structuralIssues = useMemo(
    () => groupWorkbookIssues(parsed?.rowIssues ?? [], t),
    [parsed, t],
  );
  const definition = useMemo(() => buildSupplierImportDefinition(t), [t]);

  const chooseFile = async (file: File | undefined) => {
    const readSequence = fileReadSequence.current + 1;
    fileReadSequence.current = readSequence;
    dispatch({ type: 'selectFile', fileName: file?.name ?? null });
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      dispatch({ type: 'fileError', message: t('crm:suppliers.bulk.excel.invalidExtension') });
      return;
    }
    if (file.size > MAX_ENTITY_IMPORT_FILE_BYTES) {
      dispatch({ type: 'fileError', message: t('crm:suppliers.bulk.excel.fileTooLarge') });
      return;
    }
    try {
      const workbook = await loadImportWorkbook(await file.arrayBuffer());
      if (readSequence !== fileReadSequence.current) return;
      dispatch({ type: 'fileParsed', parsed: parseSupplierImportWorkbook(workbook) });
    } catch {
      if (readSequence !== fileReadSequence.current) return;
      dispatch({ type: 'fileError', message: t('crm:suppliers.bulk.excel.readFailed') });
    }
  };

  const downloadTemplate = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadImportWorkbook(definition, SUPPLIER_IMPORT_FILENAME);
    } catch {
      toastError(t('crm:suppliers.bulk.excel.downloadFailed'));
    } finally {
      setIsDownloading(false);
    }
  };

  const importWorkbook = async () => {
    if (!parsed || parsed.rows.length === 0 || processed || isSubmitting) return;
    dispatch({ type: 'submitStarted' });
    try {
      const response = await onCreateBulk(parsed.rows.map((row) => row.item));
      const serverIssues: WorkbookReportIssue[] = response.results.flatMap((result) => {
        if (result.success) return [];
        const sourceRow = parsed.rows[result.index];
        return [
          {
            line: sourceRow?.line,
            messages: result.errors.map((error) => supplierErrorMessage(error, t)),
          },
        ];
      });
      const retryRows = response.results.flatMap((result) => {
        if (result.success) return [];
        const sourceRow = parsed.rows[result.index];
        return sourceRow ? [sourceRow] : [];
      });
      const failed = response.summary.failed + structuralIssues.length;
      dispatch({
        type: 'submitCompleted',
        report: {
          succeeded: response.summary.succeeded,
          failed,
          issues: [...structuralIssues, ...serverIssues],
        },
        retryRows,
      });
      if (response.summary.succeeded > 0) {
        toastSuccess(t('crm:suppliers.bulk.importedCount', { count: response.summary.succeeded }));
      }
      if (failed === 0) onClose();
    } catch {
      dispatch({ type: 'fileError', message: t('crm:suppliers.bulk.errors.requestFailed') });
    } finally {
      dispatch({ type: 'submitFinished' });
    }
  };

  const fatalIssues = parsed?.fatalIssues ?? [];
  const canImport = Boolean(
    parsed && fatalIssues.length === 0 && parsed.rows.length > 0 && !processed && !isSubmitting,
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeOnBackdrop={!isSubmitting}
      closeOnEsc={!isSubmitting}
      ariaLabel={t('crm:suppliers.bulk.excel.title')}
    >
      <ModalContent size="6xl">
        <ModalHeader>
          <div>
            <ModalTitle>
              <FileSpreadsheet className="size-5" />
              {t('crm:suppliers.bulk.excel.title')}
            </ModalTitle>
            <ModalDescription>{t('crm:suppliers.bulk.excel.description')}</ModalDescription>
          </div>
          <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
        </ModalHeader>
        <ModalBody className="space-y-5">
          <Alert>
            <Info className="size-4" />
            <AlertTitle>{t('crm:suppliers.bulk.excel.rulesTitle')}</AlertTitle>
            <AlertDescription>{t('crm:suppliers.bulk.excel.rulesDescription')}</AlertDescription>
          </Alert>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-xl space-y-1.5">
              <label htmlFor="supplier-xlsx-file" className="text-sm font-medium">
                {t('crm:suppliers.bulk.excel.fileLabel')}
              </label>
              <Input
                ref={fileInputRef}
                id="supplier-xlsx-file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onClick={(event) => {
                  fileReadSequence.current += 1;
                  event.currentTarget.value = '';
                  dispatch({ type: 'selectFile', fileName: null });
                }}
                onChange={(event) => void chooseFile(event.target.files?.[0])}
                disabled={isSubmitting}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                >
                  <FolderOpen aria-hidden="true" className="size-4" />
                  {t('crm:suppliers.bulk.excel.browseButton')}
                </Button>
                <div
                  className="flex min-h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground shadow-xs"
                  aria-live="polite"
                  title={fileName ?? t('crm:suppliers.bulk.excel.noFileSelected')}
                >
                  <span className="truncate">
                    {fileName ?? t('crm:suppliers.bulk.excel.noFileSelected')}
                  </span>
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void downloadTemplate()}
              disabled={isDownloading || isSubmitting}
            >
              {isDownloading ? (
                <i className="fa-solid fa-circle-notch fa-spin text-xs" aria-hidden="true"></i>
              ) : (
                <FileDown className="size-4" />
              )}
              {t('crm:suppliers.bulk.excel.downloadTemplate')}
            </Button>
          </div>

          {(fileError || fatalIssues.length > 0) && (
            <Alert variant="destructive">
              <Info className="size-4" />
              <AlertTitle>{t('crm:suppliers.bulk.excel.invalidFile')}</AlertTitle>
              <AlertDescription>
                {fileError && <p>{fileError}</p>}
                {fatalIssues.map((issue) => (
                  <p key={`${issue.code}-${issue.line ?? 'file'}-${issue.field ?? ''}`}>
                    {workbookIssueMessage(issue, t)}
                  </p>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {parsed && fatalIssues.length === 0 && !report && (
            <Alert>
              <Info className="size-4" />
              <AlertTitle>{t('crm:suppliers.bulk.excel.readyTitle')}</AlertTitle>
              <AlertDescription>
                {t('crm:suppliers.bulk.excel.readyDescription', {
                  valid: parsed.rows.length,
                  invalid: structuralIssues.length,
                })}
                <WorkbookIssueList issues={structuralIssues} t={t} />
              </AlertDescription>
            </Alert>
          )}

          {report && (
            <Alert variant={report.failed > 0 ? 'destructive' : 'default'}>
              <Info className="size-4" />
              <AlertTitle>{t('crm:suppliers.bulk.excel.resultTitle')}</AlertTitle>
              <AlertDescription>
                <p>
                  {t('crm:suppliers.bulk.excel.resultDescription', {
                    succeeded: report.succeeded,
                    failed: report.failed,
                  })}
                </p>
                <WorkbookIssueList issues={report.issues} t={t} />
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {t('crm:suppliers.bulk.excel.structureTitle')}
              </h3>
              <span className="text-xs text-muted-foreground">
                {t('crm:suppliers.bulk.excel.requiredFields', {
                  fields: REQUIRED_SUPPLIER_IMPORT_FIELDS.join(', '),
                })}
              </span>
            </div>
            <div className="max-h-[42vh] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('crm:suppliers.bulk.excel.keyColumn')}</TableHead>
                    <TableHead>{t('crm:suppliers.bulk.excel.fieldColumn')}</TableHead>
                    <TableHead>{t('crm:suppliers.bulk.excel.requiredColumn')}</TableHead>
                    <TableHead>{t('crm:suppliers.bulk.excel.acceptedColumn')}</TableHead>
                    <TableHead>{t('crm:suppliers.bulk.excel.exampleColumn')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {definition.fields.map((field) => (
                    <TableRow key={field.key}>
                      <TableCell className="font-mono text-xs">{field.key}</TableCell>
                      <TableCell>{field.label}</TableCell>
                      <TableCell>
                        {field.required ? t('common:boolean.yes') : t('common:boolean.no')}
                      </TableCell>
                      <TableCell className="max-w-80 whitespace-normal text-xs text-muted-foreground">
                        {field.accepted}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {field.example || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common:buttons.cancel')}
          </Button>
          <Button type="button" onClick={importWorkbook} disabled={!canImport}>
            {isSubmitting && (
              <i className="fa-solid fa-circle-notch fa-spin text-xs" aria-hidden="true"></i>
            )}
            {t('crm:suppliers.bulk.excel.importButton')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
