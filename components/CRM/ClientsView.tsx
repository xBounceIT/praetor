import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client } from '../../types';
import { formatInsertDate } from '../../utils/date';
import { buildPermission, hasPermission } from '../../utils/permissions';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';

export interface ClientsViewProps {
  clients: Client[];
  onAddClient: (clientData: Partial<Client>) => Promise<void>;
  onUpdateClient: (id: string, updates: Partial<Client>) => Promise<void>;
  onDeleteClient: (id: string) => Promise<void>;
  permissions: string[];
}

const OFFICE_COUNT_RANGE_OPTIONS = [
  { id: '1', name: '1' },
  { id: '2...5', name: '2...5' },
  { id: '6...10', name: '6...10' },
  { id: '>10', name: '>10' },
];

const SECTOR_OPTIONS: Array<{ id: NonNullable<Client['sector']>; labelKey: string }> = [
  { id: 'FINANCE', labelKey: 'finance' },
  { id: 'TELCO', labelKey: 'telco' },
  { id: 'UTILITIES', labelKey: 'utilities' },
  { id: 'ENERGY', labelKey: 'energy' },
  { id: 'SERVICES', labelKey: 'services' },
  { id: 'GDO', labelKey: 'gdo' },
  { id: 'HEALTH', labelKey: 'health' },
  { id: 'INDUSTRY', labelKey: 'industry' },
  { id: 'PA', labelKey: 'pa' },
  { id: 'TRASPORTI', labelKey: 'trasporti' },
  { id: 'ALTRO', labelKey: 'altro' },
];

const NUMBER_OF_EMPLOYEES_OPTIONS: Array<{
  id: NonNullable<Client['numberOfEmployees']>;
  labelKey: string;
}> = [
  { id: '< 50', labelKey: 'under50' },
  { id: '50..250', labelKey: 'from50To250' },
  { id: '251..1000', labelKey: 'from251To1000' },
  { id: '> 1000', labelKey: 'over1000' },
];

const REVENUE_OPTIONS: Array<{ id: NonNullable<Client['revenue']>; labelKey: string }> = [
  { id: '< 10', labelKey: 'under10' },
  { id: '11..50', labelKey: 'from11To50' },
  { id: '51..1000', labelKey: 'from51To1000' },
  { id: '> 1000', labelKey: 'over1000' },
];

const REQUIRED_FIELDS: Array<keyof Client> = ['name', 'clientCode', 'fiscalCode'];

type EditingState = {
  rowId: string | 'new' | null;
  isNewRow: boolean;
  data: Partial<Client>;
  touchedFields: Set<string>;
};

const truncateText = (text: string | undefined, maxLength = 30): string => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

interface EditableCellProps {
  field: keyof Client;
  value: unknown;
  isEditing: boolean;
  isRequired: boolean;
  type?: 'text' | 'select';
  options?: Array<{ id: string; name: string }>;
  displayValue?: string;
  className?: string;
  placeholder?: string;
  activeField: keyof Client | undefined;
  touchedFields: Set<string>;
  validationErrors: Record<string, string>;
  onUpdateField: (field: keyof Client, value: unknown) => void;
  onSetActiveCell: (cell: { field: keyof Client } | null) => void;
  t: (key: string) => string;
}

const EditableCell = memo<EditableCellProps>(
  ({
    field,
    value,
    isEditing,
    isRequired,
    type = 'text',
    options,
    displayValue,
    className = '',
    placeholder,
    activeField,
    touchedFields,
    validationErrors,
    onUpdateField,
    onSetActiveCell,
    t,
  }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const isActive = activeField === field;
    const isTouched = touchedFields.has(field as string);
    const hasError = isTouched && validationErrors[field as string];
    const showErrorBorder = isRequired && (!value || (typeof value === 'string' && !value.trim()));
    const showRedBorder = hasError || (showErrorBorder && (isTouched || isEditing));

    useEffect(() => {
      if (isEditing && isActive && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing, isActive]);

    if (!isEditing || !isActive) {
      const display = displayValue || (value as string) || '-';
      const isTruncated = typeof display === 'string' && display.length > 30;
      const truncatedDisplay = isTruncated ? truncateText(display, 30) : display;

      return (
        <Tooltip
          label={
            isRequired && !value ? t('common:validation.required') : isTruncated ? display : ''
          }
          disabled={!isRequired && !isTruncated && !isEditing}
        >
          {() => (
            <div
              className={`h-full w-full flex items-center px-2 py-1 cursor-pointer rounded transition-colors ${
                isEditing ? 'hover:bg-slate-100' : ''
              } ${showRedBorder ? 'border border-red-500 bg-red-50' : ''} ${className}`}
            >
              <span className="text-xs text-slate-600 w-full">{truncatedDisplay}</span>
            </div>
          )}
        </Tooltip>
      );
    }

    if (type === 'select' && options) {
      return (
        <CustomSelect
          options={options}
          value={(value as string) || ''}
          onChange={(val) => {
            onUpdateField(field, val || undefined);
          }}
          placeholder={placeholder || t('common:form.selectOption')}
          searchable={false}
          autoOpen={true}
          buttonClassName={`w-full text-xs py-1 px-2 ${
            showRedBorder ? '!border-red-500 !bg-red-50' : ''
          }`}
        />
      );
    }

    const stringValue = (value as string) || '';

    return (
      <input
        ref={inputRef}
        type="text"
        value={stringValue}
        onChange={(e) => onUpdateField(field, e.target.value)}
        onBlur={() => onSetActiveCell(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSetActiveCell(null);
          }
        }}
        className={`w-full text-xs px-2 py-1 border rounded outline-none focus:ring-2 focus:ring-praetor ${
          showRedBorder ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'
        } ${className}`}
        placeholder={placeholder}
      />
    );
  },
);

const ClientsView: React.FC<ClientsViewProps> = ({
  clients,
  onAddClient,
  onUpdateClient,
  onDeleteClient,
  permissions,
}) => {
  const { t, i18n } = useTranslation(['crm', 'common', 'form']);
  const canCreateClients = hasPermission(permissions, buildPermission('crm.clients', 'create'));
  const canUpdateClients = hasPermission(permissions, buildPermission('crm.clients', 'update'));
  const canDeleteClients = hasPermission(permissions, buildPermission('crm.clients', 'delete'));

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);

  const [editingState, setEditingState] = useState<EditingState>({
    rowId: null,
    isNewRow: false,
    data: {},
    touchedFields: new Set(),
  });

  const [activeCell, setActiveCell] = useState<{ field: keyof Client } | null>(null);

  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const editingStateRef = useRef(editingState);
  editingStateRef.current = editingState;

  const resetEditingState = useCallback(() => {
    setEditingState({ rowId: null, isNewRow: false, data: {}, touchedFields: new Set() });
    setValidationErrors({});
    setActiveCell(null);
  }, []);

  const getEmptyClient = (): Partial<Client> => ({
    name: '',
    type: 'company',
    contactName: '',
    clientCode: '',
    email: '',
    phone: '',
    address: '',
    description: '',
    atecoCode: '',
    website: '',
    sector: undefined,
    numberOfEmployees: undefined,
    revenue: undefined,
    fiscalCode: '',
    officeCountRange: undefined,
  });

  const startNewRow = () => {
    if (!canCreateClients) return;
    setEditingState({
      rowId: 'new',
      isNewRow: true,
      data: getEmptyClient(),
      touchedFields: new Set(),
    });
    setValidationErrors({});
    setActiveCell(null);
  };

  const startEditRow = useCallback(
    (client: Client, initialActiveField?: keyof Client) => {
      if (!canUpdateClients && !editingState.isNewRow) return;
      setEditingState((prev) => {
        const isNew = client.id === 'new';
        const isSameRow = prev.rowId === client.id;
        return {
          rowId: client.id,
          isNewRow: isNew,
          data: isSameRow ? prev.data : { ...client },
          touchedFields: isSameRow ? prev.touchedFields : new Set(),
        };
      });
      setValidationErrors({});
      setActiveCell(initialActiveField ? { field: initialActiveField } : null);
    },
    [canUpdateClients, editingState.isNewRow],
  );

  const validateField = useCallback(
    (field: keyof Client, value: unknown): string | null => {
      if (!REQUIRED_FIELDS.includes(field)) return null;

      const strValue = typeof value === 'string' ? value.trim() : '';
      if (!strValue) {
        return t('common:validation.required');
      }
      return null;
    },
    [t],
  );

  const validateAll = useCallback(
    (data: Partial<Client>): Record<string, string> => {
      const errors: Record<string, string> = {};

      REQUIRED_FIELDS.forEach((field) => {
        const error = validateField(field, data[field]);
        if (error) {
          errors[field] = error;
        }
      });

      if (data.clientCode) {
        const trimmedCode = data.clientCode.trim();
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmedCode)) {
          errors.clientCode = t('common:validation.clientCodeInvalid');
        } else {
          const isDuplicate = clients.some(
            (c) =>
              (c.clientCode || '').toLowerCase() === trimmedCode.toLowerCase() &&
              (editingState.isNewRow || c.id !== editingState.rowId),
          );
          if (isDuplicate) {
            errors.clientCode = t('common:validation.clientCodeUnique');
          }
        }
      }

      return errors;
    },
    [t, validateField, clients, editingState.isNewRow, editingState.rowId],
  );

  const updateField = useCallback(
    (field: keyof Client, value: unknown) => {
      const error = validateField(field, value);
      setValidationErrors((prevErrors) => {
        if (error) {
          if (prevErrors[field as string] === error) return prevErrors;
          return { ...prevErrors, [field]: error };
        }
        if (!((field as string) in prevErrors)) return prevErrors;
        const newErrors = { ...prevErrors };
        delete newErrors[field as string];
        return newErrors;
      });
      setEditingState((prev) => {
        if (prev.data[field] === value && prev.touchedFields.has(field as string)) return prev;
        const newTouched = prev.touchedFields.has(field as string)
          ? prev.touchedFields
          : new Set(prev.touchedFields).add(field as string);
        return {
          ...prev,
          data: { ...prev.data, [field]: value },
          touchedFields: newTouched,
        };
      });
    },
    [validateField],
  );

  const handleSave = useCallback(async () => {
    const { data, isNewRow, rowId } = editingStateRef.current;
    const errors = validateAll(data);
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setEditingState((prev) => ({
        ...prev,
        touchedFields: new Set([...prev.touchedFields, ...REQUIRED_FIELDS]),
      }));
      return;
    }

    const payload = {
      name: data.name?.trim() || '',
      type: data.type,
      contactName: data.contactName?.trim() || '',
      clientCode: data.clientCode?.trim() || '',
      email: data.email?.trim() || undefined,
      phone: data.phone?.trim() || '',
      address: data.address?.trim() || '',
      description: data.description?.trim() || undefined,
      atecoCode: data.atecoCode?.trim() || undefined,
      website: data.website?.trim() || undefined,
      sector: data.sector,
      numberOfEmployees: data.numberOfEmployees,
      revenue: data.revenue,
      fiscalCode: data.fiscalCode?.trim() || '',
      officeCountRange: data.officeCountRange,
    };

    try {
      if (isNewRow) {
        await onAddClient(payload);
      } else if (rowId && typeof rowId === 'string') {
        await onUpdateClient(rowId, payload);
      }

      resetEditingState();
    } catch (err) {
      const message = (err as Error).message;
      if (
        message.toLowerCase().includes('fiscal code') ||
        message.toLowerCase().includes('vat number')
      ) {
        setValidationErrors({ ...errors, fiscalCode: message });
      } else if (
        message.toLowerCase().includes('client id') ||
        message.toLowerCase().includes('client code')
      ) {
        setValidationErrors({ ...errors, clientCode: t('common:validation.clientCodeUnique') });
      } else {
        setValidationErrors({ ...errors, name: t('common:messages.errorOccurred') });
      }
    }
  }, [validateAll, onAddClient, onUpdateClient, t]);

  const handleCancel = useCallback(() => {
    if (editingState.touchedFields.size > 0) {
      setShowUnsavedDialog(true);
      setPendingAction(() => () => {
        resetEditingState();
        setShowUnsavedDialog(false);
      });
    } else {
      resetEditingState();
    }
  }, [editingState.touchedFields.size, resetEditingState]);

  const isValidForSave = useMemo(
    () => Object.keys(validateAll(editingState.data)).length === 0,
    [validateAll, editingState.data],
  );

  const confirmDiscard = () => {
    if (pendingAction) {
      pendingAction();
    }
  };

  const confirmSave = async () => {
    setShowUnsavedDialog(false);
    await handleSave();
  };

  const confirmDismissDialog = () => {
    setShowUnsavedDialog(false);
    setPendingAction(null);
  };

  const confirmDelete = useCallback((client: Client) => {
    setClientToDelete(client);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = () => {
    if (!canDeleteClients) return;
    if (clientToDelete) {
      onDeleteClient(clientToDelete.id).then(() => {
        setIsDeleteConfirmOpen(false);
        setClientToDelete(null);
      });
    }
  };

  const columns = useMemo<Column<Client>[]>(() => {
    const isRowEditing = (row: Client) => {
      if (editingState.isNewRow) {
        return row.id === 'new';
      }
      return editingState.rowId === row.id;
    };

    const ecProps = {
      activeField: activeCell?.field,
      touchedFields: editingState.touchedFields,
      validationErrors,
      onUpdateField: updateField,
      onSetActiveCell: setActiveCell,
      t,
    };

    const dblClick = (field: keyof Client) =>
      canUpdateClients ? { onCellDoubleClick: (row: Client) => startEditRow(row, field) } : {};

    const textColumn = (
      field: keyof Client,
      headerKey: string,
      isRequired = false,
      className = '',
    ) => ({
      header: t(`crm:clients.tableHeaders.${headerKey}`),
      accessorKey: field,
      ...dblClick(field),
      cell: ({ row }: { row: Client }) => {
        const isEditing = isRowEditing(row);
        const value = isEditing ? editingState.data[field] : row[field];
        return (
          <EditableCell
            {...ecProps}
            field={field}
            value={value}
            isEditing={isEditing}
            isRequired={isRequired}
            type="text"
            displayValue={value as string | undefined}
            className={className}
          />
        );
      },
    });

    const labeledSelectColumn = (
      field: keyof Client,
      headerKey: string,
      options: Array<{ id: string; labelKey: string }>,
      i18nPrefix: string,
      isRequired = false,
    ) => ({
      header: t(`crm:clients.tableHeaders.${headerKey}`),
      accessorKey: field,
      ...dblClick(field),
      cell: ({ row }: { row: Client }) => {
        const isEditing = isRowEditing(row);
        const value = (isEditing ? editingState.data[field] : row[field]) as string | undefined;
        const option = options.find((o) => o.id === value);
        return (
          <EditableCell
            {...ecProps}
            field={field}
            value={value}
            isEditing={isEditing}
            isRequired={isRequired}
            type="select"
            options={options.map((o) => ({
              id: o.id,
              name: t(`crm:clients.${i18nPrefix}.${o.labelKey}`),
            }))}
            displayValue={option ? t(`crm:clients.${i18nPrefix}.${option.labelKey}`) : undefined}
          />
        );
      },
    });

    const eurFormatter = new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

    return [
      textColumn('name', 'name', true, 'font-semibold whitespace-nowrap'),
      textColumn('clientCode', 'clientCode', true),
      {
        header: t('crm:clients.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (row: Client) => row.createdAt ?? 0,
        cell: ({ row }: { row: Client }) => {
          if (!row.createdAt) {
            return <span className="text-xs text-slate-400">-</span>;
          }
          return (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatInsertDate(row.createdAt)}
            </span>
          );
        },
        filterFormat: (value: string | number | boolean | null | undefined) => {
          const timestamp = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return '-';
          }
          return formatInsertDate(timestamp);
        },
      },
      {
        header: t('crm:clients.tableHeaders.type'),
        id: 'type',
        accessorFn: (row: Client) =>
          row.type === 'company' ? t('crm:clients.typeCompany') : t('crm:clients.typeIndividual'),
        ...dblClick('type'),
        cell: ({ row }: { row: Client }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing ? editingState.data.type : row.type;

          if (!isEditing) {
            return (
              <StatusBadge
                type={row.type === 'company' ? 'company' : 'individual'}
                label={
                  row.type === 'company'
                    ? t('crm:clients.typeCompany')
                    : t('crm:clients.typeIndividual')
                }
              />
            );
          }

          return (
            <EditableCell
              {...ecProps}
              field="type"
              value={value}
              isEditing={isEditing}
              isRequired={false}
              type="select"
              options={[
                { id: 'company', name: t('crm:clients.typeCompany') },
                { id: 'individual', name: t('crm:clients.typeIndividual') },
              ]}
              displayValue={
                value === 'company' ? t('crm:clients.typeCompany') : t('crm:clients.typeIndividual')
              }
            />
          );
        },
      },
      textColumn('email', 'email'),
      textColumn('phone', 'phone'),
      {
        header: t('crm:clients.tableHeaders.fiscalCode'),
        id: 'fiscalCode',
        accessorFn: (row: Client) => row.fiscalCode || row.vatNumber || row.taxCode || '',
        ...dblClick('fiscalCode'),
        cell: ({ row }: { row: Client }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing
            ? editingState.data.fiscalCode
            : row.fiscalCode || row.vatNumber || row.taxCode;
          return (
            <EditableCell
              {...ecProps}
              field="fiscalCode"
              value={value}
              isEditing={isEditing}
              isRequired={true}
              type="text"
              displayValue={value}
              className="font-mono text-xs text-slate-400"
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.officeCountRange'),
        accessorKey: 'officeCountRange',
        ...dblClick('officeCountRange'),
        cell: ({ row }: { row: Client }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing ? editingState.data.officeCountRange : row.officeCountRange;
          return (
            <EditableCell
              {...ecProps}
              field="officeCountRange"
              value={value}
              isEditing={isEditing}
              isRequired={true}
              type="select"
              options={OFFICE_COUNT_RANGE_OPTIONS}
              displayValue={isEditing ? editingState.data.officeCountRange : row.officeCountRange}
            />
          );
        },
      },
      labeledSelectColumn('sector', 'sector', SECTOR_OPTIONS, 'sectorOptions'),
      labeledSelectColumn(
        'numberOfEmployees',
        'numberOfEmployees',
        NUMBER_OF_EMPLOYEES_OPTIONS,
        'numberOfEmployeesOptions',
      ),
      labeledSelectColumn('revenue', 'revenue', REVENUE_OPTIONS, 'revenueOptions'),
      textColumn('contactName', 'contactName'),
      textColumn('address', 'address'),
      textColumn('description', 'description'),
      textColumn('atecoCode', 'atecoCode'),
      textColumn('website', 'website'),
      {
        header: t('crm:clients.tableHeaders.totalSentQuotes'),
        id: 'totalSentQuotes',
        accessorFn: (row: Client) => row.totalSentQuotes ?? 0,
        cell: ({ row }: { row: Client }) => {
          const value = row.totalSentQuotes;
          if (value == null || value === 0) {
            return <span className="text-xs text-slate-400">-</span>;
          }
          return (
            <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              {eurFormatter.format(value)}
            </span>
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.totalAcceptedOrders'),
        id: 'totalAcceptedOrders',
        accessorFn: (row: Client) => row.totalAcceptedOrders ?? 0,
        cell: ({ row }: { row: Client }) => {
          const value = row.totalAcceptedOrders;
          if (value == null || value === 0) {
            return <span className="text-xs text-slate-400">-</span>;
          }
          return (
            <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap">
              {eurFormatter.format(value)}
            </span>
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.status'),
        id: 'status',
        accessorFn: (row) =>
          row.isDisabled ? t('common:common.disabled') : t('common:common.active'),
        cell: ({ row }) => (
          <StatusBadge
            type={row.isDisabled ? 'disabled' : 'active'}
            label={row.isDisabled ? t('common:common.disabled') : t('common:common.active')}
          />
        ),
      },
      {
        header: t('common:labels.actions'),
        id: 'actions',
        align: 'right',
        disableSorting: true,
        disableFiltering: true,
        sticky: 'right',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);

          if (isEditing) {
            const valid = isValidForSave;
            return (
              <div className="flex items-center justify-end gap-1">
                <Tooltip label={t('common:buttons.save')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSave();
                      }}
                      disabled={!valid}
                      className={`p-2 rounded-lg transition-all ${
                        valid
                          ? 'text-emerald-600 hover:bg-emerald-50'
                          : 'text-slate-300 cursor-not-allowed'
                      }`}
                    >
                      <i className="fa-solid fa-check"></i>
                    </button>
                  )}
                </Tooltip>
                <Tooltip label={t('common:buttons.cancel')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancel();
                      }}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  )}
                </Tooltip>
              </div>
            );
          }

          return (
            <div className="flex items-center justify-end gap-1">
              {canUpdateClients && (
                <Tooltip label={t('common:buttons.edit')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditRow(row);
                      }}
                      disabled={!canUpdateClients}
                      className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <i className="fa-solid fa-pen"></i>
                    </button>
                  )}
                </Tooltip>
              )}
              <Tooltip
                label={row.isDisabled ? t('common:buttons.enable') : t('crm:clients.disableClient')}
              >
                {() => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canUpdateClients) return;
                      onUpdateClient(row.id, { isDisabled: !row.isDisabled });
                    }}
                    disabled={!canUpdateClients}
                    className={`p-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      row.isDisabled
                        ? 'text-praetor hover:bg-slate-100'
                        : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                    }`}
                  >
                    <i className={`fa-solid ${row.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                  </button>
                )}
              </Tooltip>
              {canDeleteClients && (
                <Tooltip label={t('common:buttons.delete')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(row);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
                </Tooltip>
              )}
            </div>
          );
        },
      },
    ];
  }, [
    t,
    i18n,
    editingState.isNewRow,
    editingState.rowId,
    editingState.data,
    editingState.touchedFields,
    canUpdateClients,
    canDeleteClients,
    onUpdateClient,
    confirmDelete,
    validationErrors,
    activeCell,
    handleSave,
    handleCancel,
    updateField,
    startEditRow,
    isValidForSave,
  ]);

  const tableData = useMemo(() => {
    if (editingState.isNewRow) {
      const newRow: Client = {
        id: 'new',
        name: '',
        ...editingState.data,
      } as Client;
      return [newRow, ...clients];
    }
    return clients;
  }, [clients, editingState.isNewRow, editingState.data]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Modal isOpen={showUnsavedDialog} onClose={confirmDismissDialog}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto text-amber-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('common:messages.unsavedChanges')}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('common:messages.unsavedChangesConfirm')}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={confirmDiscard}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.discard')}
              </button>
              <button
                onClick={confirmSave}
                className="flex-1 py-3 bg-emerald-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95"
              >
                {t('common:buttons.save')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">{t('crm:clients.deleteClient')}</h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('common:messages.deleteConfirmNamed', { name: clientToDelete?.name })}
                {t('crm:clients.deleteConfirm')}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('common:buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">{t('crm:clients.title')}</h2>
            <p className="text-slate-500 text-sm">{t('crm:clients.subtitle')}</p>
          </div>
          {canCreateClients && !editingState.isNewRow && (
            <button
              onClick={startNewRow}
              className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i> {t('crm:clients.addClient')}
            </button>
          )}
        </div>
      </div>

      <StandardTable<Client>
        title={t('crm:clients.clientsDirectory')}
        data={tableData}
        columns={columns}
        defaultRowsPerPage={10}
        rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
      />
    </div>
  );
};

export default ClientsView;
