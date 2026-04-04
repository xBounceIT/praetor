import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client } from '../../types';
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

// Required fields for validation
const REQUIRED_FIELDS: Array<keyof Client> = [
  'name',
  'clientCode',
  'fiscalCode',
  'officeCountRange',
];

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

  // Delete modal state
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);

  // Inline editing state
  const [editingState, setEditingState] = useState<EditingState>({
    rowId: null,
    isNewRow: false,
    data: {},
    touchedFields: new Set(),
  });

  // Active cell being edited (for double-click)
  const [activeCell, setActiveCell] = useState<{ field: keyof Client } | null>(null);

  // Unsaved changes confirmation
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Validation errors
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const formatInsertDate = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '-';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
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

  const startEditRow = (client: Client) => {
    if (!canUpdateClients) return;
    setEditingState({
      rowId: client.id,
      isNewRow: false,
      data: { ...client },
      touchedFields: new Set(),
    });
    setValidationErrors({});
    setActiveCell(null);
  };

  const validateField = (field: keyof Client, value: unknown): string | null => {
    if (!REQUIRED_FIELDS.includes(field)) return null;

    const strValue = typeof value === 'string' ? value.trim() : '';
    if (!strValue) {
      return t('common:validation.required');
    }
    return null;
  };

  const validateAll = (data: Partial<Client>): Record<string, string> => {
    const errors: Record<string, string> = {};

    REQUIRED_FIELDS.forEach((field) => {
      const error = validateField(field, data[field]);
      if (error) {
        errors[field] = error;
      }
    });

    // Check for duplicate client code
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
  };

  const isValid = (data: Partial<Client> = editingState.data): boolean => {
    const errors = validateAll(data);
    return Object.keys(errors).length === 0;
  };

  const updateField = (field: keyof Client, value: unknown) => {
    setEditingState((prev) => {
      const newData = { ...prev.data, [field]: value };
      const newTouched = new Set(prev.touchedFields).add(field);

      // Validate the field
      const error = validateField(field, value);
      setValidationErrors((prevErrors) => {
        const newErrors = { ...prevErrors };
        if (error) {
          newErrors[field] = error;
        } else {
          delete newErrors[field];
        }
        return newErrors;
      });

      return {
        ...prev,
        data: newData,
        touchedFields: newTouched,
      };
    });
  };

  const handleSave = async () => {
    const errors = validateAll(editingState.data);
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      // Mark all required fields as touched to show errors
      setEditingState((prev) => ({
        ...prev,
        touchedFields: new Set([...prev.touchedFields, ...REQUIRED_FIELDS]),
      }));
      return;
    }

    const payload = {
      name: editingState.data.name?.trim() || '',
      type: editingState.data.type,
      contactName: editingState.data.contactName?.trim() || '',
      clientCode: editingState.data.clientCode?.trim() || '',
      email: editingState.data.email?.trim() || undefined,
      phone: editingState.data.phone?.trim() || '',
      address: editingState.data.address?.trim() || '',
      description: editingState.data.description?.trim() || undefined,
      atecoCode: editingState.data.atecoCode?.trim() || undefined,
      website: editingState.data.website?.trim() || undefined,
      sector: editingState.data.sector,
      numberOfEmployees: editingState.data.numberOfEmployees,
      revenue: editingState.data.revenue,
      fiscalCode: editingState.data.fiscalCode?.trim() || '',
      officeCountRange: editingState.data.officeCountRange,
    };

    try {
      if (editingState.isNewRow) {
        await onAddClient(payload);
      } else if (editingState.rowId && typeof editingState.rowId === 'string') {
        await onUpdateClient(editingState.rowId, payload);
      }

      // Reset editing state
      setEditingState({
        rowId: null,
        isNewRow: false,
        data: {},
        touchedFields: new Set(),
      });
      setValidationErrors({});
      setActiveCell(null);
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
        // Handle unrecognized server errors
        console.error('Failed to save client:', err);
        setValidationErrors({ ...errors, name: t('common:messages.error') });
      }
    }
  };

  const handleCancel = () => {
    if (editingState.touchedFields.size > 0) {
      setShowUnsavedDialog(true);
      setPendingAction(() => () => {
        setEditingState({
          rowId: null,
          isNewRow: false,
          data: {},
          touchedFields: new Set(),
        });
        setValidationErrors({});
        setActiveCell(null);
        setShowUnsavedDialog(false);
      });
    } else {
      setEditingState({
        rowId: null,
        isNewRow: false,
        data: {},
        touchedFields: new Set(),
      });
      setValidationErrors({});
      setActiveCell(null);
    }
  };

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

  // Editable Cell Component
  const EditableCell: React.FC<{
    field: keyof Client;
    value: unknown;
    _rowId: string;
    isEditing: boolean;
    isRequired: boolean;
    type?: 'text' | 'select';
    options?: Array<{ id: string; name: string }>;
    displayValue?: string;
    className?: string;
    placeholder?: string;
  }> = ({
    field,
    value,
    _rowId,
    isEditing,
    isRequired,
    type = 'text',
    options,
    displayValue,
    className = '',
    placeholder,
  }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const isActive = activeCell?.field === field;
    const isTouched = editingState.touchedFields.has(field as string);
    const hasError = isTouched && validationErrors[field as string];
    const showErrorBorder = isRequired && (!value || (typeof value === 'string' && !value.trim()));
    const showRedBorder = hasError || (showErrorBorder && isTouched);

    useEffect(() => {
      if (isEditing && isActive && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing, isActive]);

    if (!isEditing || !isActive) {
      // Display mode
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
              onDoubleClick={() => {
                if (isEditing) {
                  setActiveCell({ field });
                }
              }}
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

    // Edit mode
    if (type === 'select' && options) {
      return (
        <div className="w-full">
          <CustomSelect
            options={options}
            value={(value as string) || ''}
            onChange={(val) => {
              updateField(field, val || undefined);
            }}
            placeholder={placeholder || t('common:form.selectOption')}
            searchable={false}
            autoOpen={true}
            buttonClassName={`w-full text-xs py-1 px-2 ${
              showRedBorder ? '!border-red-500 !bg-red-50' : ''
            }`}
          />
        </div>
      );
    }

    return (
      <input
        ref={inputRef}
        type="text"
        value={(value as string) || ''}
        onChange={(e) => updateField(field, e.target.value)}
        onBlur={() => setActiveCell(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setActiveCell(null);
          }
        }}
        className={`w-full text-xs px-2 py-1 border rounded outline-none focus:ring-2 focus:ring-praetor ${
          showRedBorder ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'
        } ${className}`}
        placeholder={placeholder}
      />
    );
  };

  // Column definitions
  const columns = useMemo<Column<Client>[]>(() => {
    const isRowEditing = (row: Client) => {
      if (editingState.isNewRow) {
        return row.id === 'new';
      }
      return editingState.rowId === row.id;
    };

    return [
      {
        header: t('crm:clients.tableHeaders.name'),
        accessorKey: 'name',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          return (
            <EditableCell
              field="name"
              value={isEditing ? editingState.data.name : row.name}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={true}
              type="text"
              displayValue={row.name}
              className="font-semibold whitespace-nowrap"
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.clientCode'),
        accessorKey: 'clientCode',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing ? editingState.data.clientCode : row.clientCode;
          return (
            <EditableCell
              field="clientCode"
              value={value}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={true}
              type="text"
              displayValue={value || ''}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.insertDate'),
        id: 'createdAt',
        accessorFn: (row) => row.createdAt ?? 0,
        cell: ({ row }) => {
          if (!row.createdAt) {
            return <span className="text-xs text-slate-400">-</span>;
          }
          return (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatInsertDate(row.createdAt)}
            </span>
          );
        },
        filterFormat: (value) => {
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
        accessorFn: (row) =>
          row.type === 'company' ? t('crm:clients.typeCompany') : t('crm:clients.typeIndividual'),
        cell: ({ row }) => {
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
              field="type"
              value={value}
              _rowId={row.id}
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
      {
        header: t('crm:clients.tableHeaders.email'),
        accessorKey: 'email',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          return (
            <EditableCell
              field="email"
              value={isEditing ? editingState.data.email : row.email}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="text"
              displayValue={row.email}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.phone'),
        accessorKey: 'phone',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          return (
            <EditableCell
              field="phone"
              value={isEditing ? editingState.data.phone : row.phone}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="text"
              displayValue={row.phone}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.fiscalCode'),
        id: 'fiscalCode',
        accessorFn: (row) => row.fiscalCode || row.vatNumber || row.taxCode || '',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing
            ? editingState.data.fiscalCode
            : row.fiscalCode || row.vatNumber || row.taxCode;
          return (
            <EditableCell
              field="fiscalCode"
              value={value}
              _rowId={row.id}
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
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing ? editingState.data.officeCountRange : row.officeCountRange;
          return (
            <EditableCell
              field="officeCountRange"
              value={value}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={true}
              type="select"
              options={OFFICE_COUNT_RANGE_OPTIONS}
              displayValue={row.officeCountRange}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.sector'),
        accessorKey: 'sector',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing ? editingState.data.sector : row.sector;
          const displayValue = row.sector
            ? t(
                `crm:clients.sectorOptions.${SECTOR_OPTIONS.find((s) => s.id === row.sector)?.labelKey}`,
              )
            : undefined;
          return (
            <EditableCell
              field="sector"
              value={value}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="select"
              options={SECTOR_OPTIONS.map((option) => ({
                id: option.id,
                name: t(`crm:clients.sectorOptions.${option.labelKey}`),
              }))}
              displayValue={displayValue}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.numberOfEmployees'),
        accessorKey: 'numberOfEmployees',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing ? editingState.data.numberOfEmployees : row.numberOfEmployees;
          const displayValue = row.numberOfEmployees
            ? t(
                `crm:clients.numberOfEmployeesOptions.${NUMBER_OF_EMPLOYEES_OPTIONS.find((e) => e.id === row.numberOfEmployees)?.labelKey}`,
              )
            : undefined;
          return (
            <EditableCell
              field="numberOfEmployees"
              value={value}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="select"
              options={NUMBER_OF_EMPLOYEES_OPTIONS.map((option) => ({
                id: option.id,
                name: t(`crm:clients.numberOfEmployeesOptions.${option.labelKey}`),
              }))}
              displayValue={displayValue}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.revenue'),
        accessorKey: 'revenue',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          const value = isEditing ? editingState.data.revenue : row.revenue;
          const displayValue = row.revenue
            ? t(
                `crm:clients.revenueOptions.${REVENUE_OPTIONS.find((r) => r.id === row.revenue)?.labelKey}`,
              )
            : undefined;
          return (
            <EditableCell
              field="revenue"
              value={value}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="select"
              options={REVENUE_OPTIONS.map((option) => ({
                id: option.id,
                name: t(`crm:clients.revenueOptions.${option.labelKey}`),
              }))}
              displayValue={displayValue}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.contactName'),
        accessorKey: 'contactName',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          return (
            <EditableCell
              field="contactName"
              value={isEditing ? editingState.data.contactName : row.contactName}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="text"
              displayValue={row.contactName}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.address'),
        accessorKey: 'address',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          return (
            <EditableCell
              field="address"
              value={isEditing ? editingState.data.address : row.address}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="text"
              displayValue={row.address}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.description'),
        accessorKey: 'description',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          return (
            <EditableCell
              field="description"
              value={isEditing ? editingState.data.description : row.description}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="text"
              displayValue={row.description}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.atecoCode'),
        accessorKey: 'atecoCode',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          return (
            <EditableCell
              field="atecoCode"
              value={isEditing ? editingState.data.atecoCode : row.atecoCode}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="text"
              displayValue={row.atecoCode}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.website'),
        accessorKey: 'website',
        cell: ({ row }) => {
          const isEditing = isRowEditing(row);
          return (
            <EditableCell
              field="website"
              value={isEditing ? editingState.data.website : row.website}
              _rowId={row.id}
              isEditing={isEditing}
              isRequired={false}
              type="text"
              displayValue={row.website}
            />
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.totalSentQuotes'),
        id: 'totalSentQuotes',
        accessorFn: (row) => row.totalSentQuotes ?? 0,
        cell: ({ row }) => {
          const value = row.totalSentQuotes;
          if (value == null || value === 0) {
            return <span className="text-xs text-slate-400">-</span>;
          }
          const formatted = new Intl.NumberFormat(i18n.language, {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }).format(value);
          return (
            <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              {formatted}
            </span>
          );
        },
      },
      {
        header: t('crm:clients.tableHeaders.totalAcceptedOrders'),
        id: 'totalAcceptedOrders',
        accessorFn: (row) => row.totalAcceptedOrders ?? 0,
        cell: ({ row }) => {
          const value = row.totalAcceptedOrders;
          if (value == null || value === 0) {
            return <span className="text-xs text-slate-400">-</span>;
          }
          const formatted = new Intl.NumberFormat(i18n.language, {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }).format(value);
          return (
            <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap">
              {formatted}
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
            return (
              <div className="flex items-center justify-end gap-1">
                <Tooltip label={t('common:buttons.save')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSave();
                      }}
                      disabled={!isValid()}
                      className={`p-2 rounded-lg transition-all ${
                        isValid()
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
                label={row.isDisabled ? t('common:buttons.enable') : t('crm:clients.isDisabled')}
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
    editingState,
    canUpdateClients,
    canDeleteClients,
    onUpdateClient,
    confirmDelete,
    formatInsertDate,
    validationErrors,
    activeCell,
  ]);

  // Prepare data with new row if editing
  const tableData = useMemo(() => {
    if (editingState.isNewRow) {
      const newRow: Client = {
        id: 'new',
        name: '',
        ...editingState.data,
      } as Client;
      return [...clients, newRow];
    }
    return clients;
  }, [clients, editingState]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Unsaved Changes Dialog */}
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

      {/* Delete Confirmation Modal */}
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
