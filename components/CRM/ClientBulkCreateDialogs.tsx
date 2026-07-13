import { FileDown, FileSpreadsheet, Info, Plus, Rows3, Trash2 } from 'lucide-react';
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
  BulkClientCreateInput,
  BulkClientCreateResponse,
  BulkClientError,
  ClientProfileOptionsByCategory,
} from '../../types';
import {
  CLIENT_CSV_HEADERS,
  type ClientCsvParseIssue,
  type ClientCsvParseResult,
  MAX_CLIENT_CSV_FILE_BYTES,
  MAX_CLIENT_IMPORT_ROWS,
  parseClientCsv,
  REQUIRED_CLIENT_CSV_HEADERS,
} from '../../utils/clientCsvImport';
import { downloadCsv } from '../../utils/csv';
import { toastSuccess } from '../../utils/toast';
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
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';

export type CreateBulkClients = (
  clients: BulkClientCreateInput[],
) => Promise<BulkClientCreateResponse>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

type ClientDraftRow = BulkClientCreateInput & { _rowId: string };
type DraftErrors = Record<string, Partial<Record<keyof BulkClientCreateInput | 'general', string>>>;

const createDraftRow = (sequence: number): ClientDraftRow => ({
  _rowId: `client-draft-${sequence}`,
  type: 'company',
});

const cleanClientDraft = ({ _rowId: _ignored, ...draft }: ClientDraftRow) =>
  Object.fromEntries(
    Object.entries(draft).flatMap(([field, rawValue]) => {
      const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
      return value === '' || value === undefined ? [] : [[field, value]];
    }),
  ) as BulkClientCreateInput;

const fieldErrorMessage = (error: BulkClientError, t: Translate) => {
  if (error.code === 'required') return t('common:validation.required');
  if (error.code === 'duplicate') return t('crm:clients.bulk.errors.duplicate');
  if (error.code === 'unknown_option') return t('crm:clients.bulk.errors.unknownOption');
  if (error.code === 'too_long') return t('crm:clients.bulk.errors.tooLong');
  if (error.code === 'creation_failed') return t('crm:clients.bulk.errors.creationFailed');
  return t('crm:clients.bulk.errors.invalid');
};

const DraftField = ({
  value,
  error,
  placeholder,
  type = 'text',
  disabled = false,
  onChange,
}: {
  value: string;
  error?: string;
  placeholder: string;
  type?: string;
  disabled?: boolean;
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

const BulkClientDraftTable = ({
  rows,
  columns,
  summary,
  generalError,
  isSubmitting,
  onAddRow,
  t,
}: {
  rows: ClientDraftRow[];
  columns: Column<ClientDraftRow>[];
  summary: { succeeded: number; failed: number } | null;
  generalError: string | null;
  isSubmitting: boolean;
  onAddRow: () => void;
  t: Translate;
}) => (
  <ModalBody className="space-y-4">
    {summary && (
      <Alert>
        <Info className="size-4" />
        <AlertTitle>{t('crm:clients.bulk.partialTitle')}</AlertTitle>
        <AlertDescription>{t('crm:clients.bulk.partialDescription', summary)}</AlertDescription>
      </Alert>
    )}
    {generalError && (
      <Alert variant="destructive">
        <Info className="size-4" />
        <AlertTitle>{t('common:states.error')}</AlertTitle>
        <AlertDescription>{generalError}</AlertDescription>
      </Alert>
    )}
    <StandardTable<ClientDraftRow>
      title={t('crm:clients.bulk.tableTitle')}
      persistenceKey="crm.clients.bulk-create"
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
          onClick={onAddRow}
          disabled={rows.length >= MAX_CLIENT_IMPORT_ROWS || isSubmitting}
        >
          <Plus className="size-4" />
          {t('crm:clients.bulk.addRow')}
        </Button>
      }
    />
  </ModalBody>
);

export function ClientBulkCreateDialog({
  profileOptions,
  onClose,
  onCreateBulk,
}: {
  profileOptions: ClientProfileOptionsByCategory;
  onClose: () => void;
  onCreateBulk: CreateBulkClients;
}) {
  const { t } = useTranslation(['crm', 'common']);
  const rowSequence = useRef(1);
  const [rows, setRows] = useState<ClientDraftRow[]>([createDraftRow(0)]);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [summary, setSummary] = useState<{ succeeded: number; failed: number } | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const patchRow = useCallback(
    (rowId: string, field: keyof BulkClientCreateInput, value: string) => {
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
      field: keyof BulkClientCreateInput,
      header: string,
      placeholder: string,
      type = 'text',
    ): Column<ClientDraftRow> => ({
      header,
      accessorKey: field,
      minWidth: field === 'description' || field === 'addressLine' ? 240 : 190,
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

  const selectColumn = useCallback(
    (
      field: keyof BulkClientCreateInput,
      header: string,
      options: Array<{ id: string; name: string }>,
      searchable = true,
    ): Column<ClientDraftRow> => ({
      header,
      accessorKey: field,
      minWidth: 210,
      disableSorting: true,
      disableFiltering: true,
      cell: ({ row }) => (
        <div className="min-w-48 space-y-1">
          <SelectControl
            options={options}
            value={String(row[field] ?? '')}
            onChange={(value) => patchRow(row._rowId, field, Array.isArray(value) ? '' : value)}
            searchable={searchable}
            placeholder={t('crm:clients.bulk.optionalValue')}
            disabled={isSubmitting}
          />
          {errors[row._rowId]?.[field] && (
            <p className="max-w-52 whitespace-normal text-[10px] text-destructive">
              {errors[row._rowId]?.[field]}
            </p>
          )}
        </div>
      ),
    }),
    [errors, isSubmitting, patchRow, t],
  );

  const columns = useMemo<Column<ClientDraftRow>[]>(
    () => [
      textColumn(
        'clientCode',
        `${t('crm:clients.clientCode')} *`,
        t('crm:clients.clientCodePlaceholder'),
      ),
      textColumn('name', `${t('crm:clients.name')} *`, t('crm:clients.namePlaceholder')),
      selectColumn(
        'type',
        t('crm:clients.clientType'),
        [
          { id: 'company', name: t('crm:clients.typeCompany') },
          { id: 'individual', name: t('crm:clients.typeIndividual') },
        ],
        false,
      ),
      textColumn(
        'fiscalCode',
        `${t('crm:clients.fiscalCode')} *`,
        t('crm:clients.fiscalCodePlaceholder'),
      ),
      textColumn('contactName', t('crm:clients.fullName'), t('crm:clients.fullNamePlaceholder')),
      textColumn('contactRole', t('crm:clients.role'), t('crm:clients.rolePlaceholder')),
      textColumn('email', t('crm:clients.email'), 'email@example.com', 'email'),
      textColumn('phone', t('crm:clients.phone'), '+39 000 0000000', 'tel'),
      textColumn('website', t('crm:clients.website'), t('crm:clients.websitePlaceholder')),
      textColumn('addressCountry', t('crm:clients.country'), t('crm:clients.countryPlaceholder')),
      textColumn('addressState', t('crm:clients.state'), t('crm:clients.statePlaceholder')),
      textColumn('addressCap', t('crm:clients.cap'), t('crm:clients.capPlaceholder')),
      textColumn(
        'addressProvince',
        t('crm:clients.province'),
        t('crm:clients.provincePlaceholder'),
      ),
      textColumn(
        'addressCivicNumber',
        t('crm:clients.civicNumber'),
        t('crm:clients.civicNumberPlaceholder'),
      ),
      textColumn('addressLine', t('crm:clients.address'), t('crm:clients.addressPlaceholder')),
      textColumn('atecoCode', t('crm:clients.atecoCode'), t('crm:clients.atecoCodePlaceholder')),
      selectColumn(
        'sector',
        t('crm:clients.sector'),
        profileOptions.sector.map((option) => ({ id: option.value, name: option.value })),
      ),
      selectColumn(
        'numberOfEmployees',
        t('crm:clients.numberOfEmployees'),
        profileOptions.numberOfEmployees.map((option) => ({
          id: option.value,
          name: option.value,
        })),
      ),
      selectColumn(
        'revenue',
        t('crm:clients.revenue'),
        profileOptions.revenue.map((option) => ({ id: option.value, name: option.value })),
      ),
      selectColumn(
        'officeCountRange',
        t('crm:clients.officeCountRange'),
        profileOptions.officeCountRange.map((option) => ({ id: option.value, name: option.value })),
      ),
      textColumn('description', t('crm:clients.description'), t('crm:clients.description')),
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
              aria-label={t('crm:clients.bulk.removeRow')}
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [errors, isSubmitting, profileOptions, selectColumn, t, textColumn],
  );

  const addRow = () => {
    if (rows.length >= MAX_CLIENT_IMPORT_ROWS) return;
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
      const response = await onCreateBulk(submittedRows.map(cleanClientDraft));
      const nextRows: ClientDraftRow[] = [];
      const nextErrors: DraftErrors = {};
      for (const result of response.results) {
        if (result.success) continue;
        const row = submittedRows[result.index];
        if (!row) continue;
        nextRows.push(row);
        const rowErrors: DraftErrors[string] = {};
        for (const error of result.errors) {
          rowErrors[error.field ?? 'general'] = fieldErrorMessage(error, t);
        }
        nextErrors[row._rowId] = rowErrors;
      }

      if (response.summary.succeeded > 0) {
        toastSuccess(t('crm:clients.bulk.createdCount', { count: response.summary.succeeded }));
      }
      if (response.summary.failed === 0) {
        onClose();
        return;
      }
      setRows(nextRows);
      setErrors(nextErrors);
      setSummary({
        succeeded: response.summary.succeeded,
        failed: response.summary.failed,
      });
    } catch {
      setGeneralError(t('crm:clients.bulk.errors.requestFailed'));
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
      ariaLabel={t('crm:clients.bulk.title')}
    >
      <ModalContent size="full">
        <ModalHeader>
          <div>
            <ModalTitle>
              <Rows3 className="size-5" />
              {t('crm:clients.bulk.title')}
            </ModalTitle>
            <ModalDescription>{t('crm:clients.bulk.description')}</ModalDescription>
          </div>
          <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
        </ModalHeader>
        <BulkClientDraftTable
          rows={rows}
          columns={columns}
          summary={summary}
          generalError={generalError}
          isSubmitting={isSubmitting}
          onAddRow={addRow}
          t={t}
        />
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common:buttons.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={rows.length === 0 || isSubmitting}>
            {isSubmitting && (
              <i className="fa-solid fa-circle-notch fa-spin text-xs" aria-hidden="true"></i>
            )}
            {t('crm:clients.bulk.createClients')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

type CsvReportIssue = { line?: number; messages: string[] };

type CsvImportReport = {
  succeeded: number;
  failed: number;
  issues: CsvReportIssue[];
};

const CSV_ISSUE_TRANSLATION_KEYS: Record<ClientCsvParseIssue['code'], string> = {
  empty_file: 'crm:clients.bulk.csv.errors.emptyFile',
  missing_header: 'crm:clients.bulk.csv.errors.missingHeader',
  unknown_header: 'crm:clients.bulk.csv.errors.unknownHeader',
  duplicate_header: 'crm:clients.bulk.csv.errors.duplicateHeader',
  invalid_csv: 'crm:clients.bulk.csv.errors.invalidCsv',
  field_mismatch: 'crm:clients.bulk.csv.errors.fieldMismatch',
  too_many_rows: 'crm:clients.bulk.csv.errors.tooManyRows',
};

const csvIssueMessage = (issue: ClientCsvParseIssue, t: Translate) =>
  t(CSV_ISSUE_TRANSLATION_KEYS[issue.code], issue.details);

const groupCsvIssues = (issues: ClientCsvParseIssue[], t: Translate): CsvReportIssue[] => {
  const grouped = new Map<number | undefined, string[]>();
  for (const issue of issues) {
    grouped.set(issue.line, [...(grouped.get(issue.line) ?? []), csvIssueMessage(issue, t)]);
  }
  return [...grouped].map(([line, messages]) => ({ line, messages }));
};

const CsvIssueList = ({ issues, t }: { issues: CsvReportIssue[]; t: Translate }) => {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {issues.map((issue) => (
        <li key={`${issue.line ?? 'file'}-${issue.messages.join('|')}`}>
          {issue.line ? `${t('crm:clients.bulk.csv.rowLabel', { row: issue.line })}: ` : ''}
          {issue.messages.join('; ')}
        </li>
      ))}
    </ul>
  );
};

type CsvImportState = {
  fileName: string | null;
  parsed: ClientCsvParseResult | null;
  fileError: string | null;
  isSubmitting: boolean;
  processed: boolean;
  report: CsvImportReport | null;
};

const INITIAL_CSV_IMPORT_STATE: CsvImportState = {
  fileName: null,
  parsed: null,
  fileError: null,
  isSubmitting: false,
  processed: false,
  report: null,
};

type CsvImportAction =
  | { type: 'selectFile'; fileName: string | null }
  | { type: 'fileParsed'; parsed: ClientCsvParseResult }
  | { type: 'fileError'; message: string }
  | { type: 'submitStarted' }
  | { type: 'submitCompleted'; report: CsvImportReport }
  | { type: 'submitFinished' };

const csvImportReducer = (state: CsvImportState, action: CsvImportAction): CsvImportState => {
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
      return { ...state, processed: true, report: action.report };
    case 'submitFinished':
      return { ...state, isSubmitting: false };
    default:
      return state;
  }
};

type CsvFieldDocumentation = readonly [
  header: (typeof CLIENT_CSV_HEADERS)[number],
  label: string,
  accepted: string,
  example: string,
];

const buildCsvFieldDocumentation = (
  profileOptions: ClientProfileOptionsByCategory,
  t: Translate,
): CsvFieldDocumentation[] => {
  const profileValues = (field: keyof ClientProfileOptionsByCategory) =>
    profileOptions[field].map((option) => option.value).join(' | ') || '—';

  return [
    ['clientCode', t('crm:clients.clientCode'), t('crm:clients.bulk.csv.alphaNumeric'), 'CLI-001'],
    ['name', t('crm:clients.name'), t('crm:clients.bulk.csv.freeText'), 'Acme S.p.A.'],
    ['type', t('crm:clients.clientType'), 'company | individual', 'company'],
    [
      'fiscalCode',
      t('crm:clients.fiscalCode'),
      t('crm:clients.bulk.csv.freeText'),
      'IT12345678901',
    ],
    ['contactName', t('crm:clients.fullName'), t('crm:clients.bulk.csv.freeText'), 'Mario Rossi'],
    ['contactRole', t('crm:clients.role'), t('crm:clients.bulk.csv.freeText'), 'Acquisti'],
    ['email', t('crm:clients.email'), t('crm:clients.bulk.csv.validEmail'), 'mario@example.com'],
    ['phone', t('crm:clients.phone'), t('crm:clients.bulk.csv.freeText'), '+39 000 0000000'],
    [
      'website',
      t('crm:clients.website'),
      t('crm:clients.bulk.csv.freeText'),
      'https://example.com',
    ],
    ['addressCountry', t('crm:clients.country'), t('crm:clients.bulk.csv.freeText'), 'Italia'],
    ['addressState', t('crm:clients.state'), t('crm:clients.bulk.csv.freeText'), 'Roma'],
    ['addressCap', t('crm:clients.cap'), t('crm:clients.bulk.csv.freeText'), '00100'],
    ['addressProvince', t('crm:clients.province'), t('crm:clients.bulk.csv.freeText'), 'RM'],
    ['addressCivicNumber', t('crm:clients.civicNumber'), t('crm:clients.bulk.csv.freeText'), '15A'],
    ['addressLine', t('crm:clients.address'), t('crm:clients.bulk.csv.freeText'), 'Via Esempio'],
    ['atecoCode', t('crm:clients.atecoCode'), t('crm:clients.bulk.csv.freeText'), '62.01'],
    [
      'sector',
      t('crm:clients.sector'),
      profileValues('sector'),
      profileOptions.sector[0]?.value ?? '—',
    ],
    [
      'numberOfEmployees',
      t('crm:clients.numberOfEmployees'),
      profileValues('numberOfEmployees'),
      profileOptions.numberOfEmployees[0]?.value ?? '—',
    ],
    [
      'revenue',
      t('crm:clients.revenue'),
      profileValues('revenue'),
      profileOptions.revenue[0]?.value ?? '—',
    ],
    [
      'officeCountRange',
      t('crm:clients.officeCountRange'),
      profileValues('officeCountRange'),
      profileOptions.officeCountRange[0]?.value ?? '—',
    ],
    [
      'description',
      t('crm:clients.description'),
      t('crm:clients.bulk.csv.freeText'),
      'Cliente strategico',
    ],
  ];
};

const CsvStructureTable = ({ fields, t }: { fields: CsvFieldDocumentation[]; t: Translate }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">{t('crm:clients.bulk.csv.structureTitle')}</h3>
      <span className="text-xs text-muted-foreground">
        {t('crm:clients.bulk.csv.requiredHeaders', {
          headers: REQUIRED_CLIENT_CSV_HEADERS.join(', '),
        })}
      </span>
    </div>
    <div className="max-h-[42vh] overflow-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('crm:clients.bulk.csv.headerColumn')}</TableHead>
            <TableHead>{t('crm:clients.bulk.csv.fieldColumn')}</TableHead>
            <TableHead>{t('crm:clients.bulk.csv.requiredColumn')}</TableHead>
            <TableHead>{t('crm:clients.bulk.csv.acceptedColumn')}</TableHead>
            <TableHead>{t('crm:clients.bulk.csv.exampleColumn')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map(([header, label, accepted, example]) => (
            <TableRow key={header}>
              <TableCell className="font-mono text-xs">{header}</TableCell>
              <TableCell>{label}</TableCell>
              <TableCell>
                {REQUIRED_CLIENT_CSV_HEADERS.includes(
                  header as (typeof REQUIRED_CLIENT_CSV_HEADERS)[number],
                )
                  ? t('common:boolean.yes')
                  : t('common:boolean.no')}
              </TableCell>
              <TableCell className="max-w-80 whitespace-normal text-xs text-muted-foreground">
                {accepted}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">{example}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </div>
);

export function ClientCsvImportDialog({
  profileOptions,
  onClose,
  onCreateBulk,
}: {
  profileOptions: ClientProfileOptionsByCategory;
  onClose: () => void;
  onCreateBulk: CreateBulkClients;
}) {
  const { t } = useTranslation(['crm', 'common']);
  const [state, dispatch] = useReducer(csvImportReducer, INITIAL_CSV_IMPORT_STATE);
  const fileReadSequence = useRef(0);
  const { fileName, parsed, fileError, isSubmitting, processed, report } = state;
  const csvFields = useMemo(
    () => buildCsvFieldDocumentation(profileOptions, t),
    [profileOptions, t],
  );
  const structuralIssues = useMemo(() => groupCsvIssues(parsed?.rowIssues ?? [], t), [parsed, t]);

  const chooseFile = async (file: File | undefined) => {
    const readSequence = fileReadSequence.current + 1;
    fileReadSequence.current = readSequence;
    dispatch({ type: 'selectFile', fileName: file?.name ?? null });
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      dispatch({ type: 'fileError', message: t('crm:clients.bulk.csv.invalidExtension') });
      return;
    }
    if (file.size > MAX_CLIENT_CSV_FILE_BYTES) {
      dispatch({ type: 'fileError', message: t('crm:clients.bulk.csv.fileTooLarge') });
      return;
    }
    try {
      const source = await file.text();
      if (readSequence !== fileReadSequence.current) return;
      dispatch({ type: 'fileParsed', parsed: parseClientCsv(source) });
    } catch {
      if (readSequence !== fileReadSequence.current) return;
      dispatch({ type: 'fileError', message: t('crm:clients.bulk.csv.readFailed') });
    }
  };

  const importCsv = async () => {
    if (!parsed || parsed.rows.length === 0 || processed || isSubmitting) return;
    dispatch({ type: 'submitStarted' });
    try {
      const response = await onCreateBulk(parsed.rows.map((row) => row.client));
      const serverIssues: CsvReportIssue[] = response.results.flatMap((result) => {
        if (result.success) return [];
        const sourceRow = parsed.rows[result.index];
        return [
          {
            line: sourceRow?.line,
            messages: result.errors.map((error) => fieldErrorMessage(error, t)),
          },
        ];
      });
      const failed = response.summary.failed + structuralIssues.length;
      dispatch({
        type: 'submitCompleted',
        report: {
          succeeded: response.summary.succeeded,
          failed,
          issues: [...structuralIssues, ...serverIssues],
        },
      });
      if (response.summary.succeeded > 0) {
        toastSuccess(t('crm:clients.bulk.importedCount', { count: response.summary.succeeded }));
      }
      if (failed === 0) onClose();
    } catch {
      dispatch({ type: 'fileError', message: t('crm:clients.bulk.errors.requestFailed') });
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
      ariaLabel={t('crm:clients.bulk.csv.title')}
    >
      <ModalContent size="6xl">
        <ModalHeader>
          <div>
            <ModalTitle>
              <FileSpreadsheet className="size-5" />
              {t('crm:clients.bulk.csv.title')}
            </ModalTitle>
            <ModalDescription>{t('crm:clients.bulk.csv.description')}</ModalDescription>
          </div>
          <ModalCloseButton onClick={onClose} disabled={isSubmitting} />
        </ModalHeader>
        <ModalBody className="space-y-5">
          <Alert>
            <Info className="size-4" />
            <AlertTitle>{t('crm:clients.bulk.csv.rulesTitle')}</AlertTitle>
            <AlertDescription>{t('crm:clients.bulk.csv.rulesDescription')}</AlertDescription>
          </Alert>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-xl space-y-1.5">
              <label htmlFor="client-csv-file" className="text-sm font-medium">
                {t('crm:clients.bulk.csv.fileLabel')}
              </label>
              <Input
                id="client-csv-file"
                type="file"
                accept=".csv,text/csv"
                onClick={(event) => {
                  fileReadSequence.current += 1;
                  event.currentTarget.value = '';
                  dispatch({ type: 'selectFile', fileName: null });
                }}
                onChange={(event) => void chooseFile(event.target.files?.[0])}
                disabled={isSubmitting}
              />
              {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadCsv([[...CLIENT_CSV_HEADERS]], 'clienti_modello.csv')}
            >
              <FileDown className="size-4" />
              {t('crm:clients.bulk.csv.downloadTemplate')}
            </Button>
          </div>

          {(fileError || fatalIssues.length > 0) && (
            <Alert variant="destructive">
              <Info className="size-4" />
              <AlertTitle>{t('crm:clients.bulk.csv.invalidFile')}</AlertTitle>
              <AlertDescription>
                {fileError && <p>{fileError}</p>}
                {fatalIssues.map((issue) => (
                  <p key={`${issue.code}-${issue.line ?? 'file'}-${issue.message}`}>
                    {csvIssueMessage(issue, t)}
                  </p>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {parsed && fatalIssues.length === 0 && !report && (
            <Alert>
              <Info className="size-4" />
              <AlertTitle>{t('crm:clients.bulk.csv.readyTitle')}</AlertTitle>
              <AlertDescription>
                {t('crm:clients.bulk.csv.readyDescription', {
                  valid: parsed.rows.length,
                  invalid: parsed.rowIssues.length,
                })}
                <CsvIssueList issues={structuralIssues} t={t} />
              </AlertDescription>
            </Alert>
          )}

          {report && (
            <Alert variant={report.failed > 0 ? 'destructive' : 'default'}>
              <Info className="size-4" />
              <AlertTitle>{t('crm:clients.bulk.csv.resultTitle')}</AlertTitle>
              <AlertDescription>
                <p>
                  {t('crm:clients.bulk.csv.resultDescription', {
                    succeeded: report.succeeded,
                    failed: report.failed,
                  })}
                </p>
                <CsvIssueList issues={report.issues} t={t} />
              </AlertDescription>
            </Alert>
          )}

          <CsvStructureTable fields={csvFields} t={t} />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common:buttons.cancel')}
          </Button>
          <Button type="button" onClick={importCsv} disabled={!canImport}>
            {isSubmitting && (
              <i className="fa-solid fa-circle-notch fa-spin text-xs" aria-hidden="true"></i>
            )}
            {t('crm:clients.bulk.csv.importButton')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
