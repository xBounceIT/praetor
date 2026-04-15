import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import type {
  Client,
  ClientContact,
  ClientProfileOption,
  ClientProfileOptionCategory,
  ClientProfileOptionsByCategory,
} from '../../types';
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
  onCreateClientProfileOption: (
    category: ClientProfileOptionCategory,
    value: string,
    sortOrder?: number,
  ) => Promise<ClientProfileOption>;
  onUpdateClientProfileOption: (
    category: ClientProfileOptionCategory,
    id: string,
    updates: { value: string; sortOrder?: number },
  ) => Promise<ClientProfileOption>;
  onDeleteClientProfileOption: (category: ClientProfileOptionCategory, id: string) => Promise<void>;
  permissions: string[];
}

const EMPTY_CONTACT: ClientContact = {
  fullName: '',
  role: '',
  email: '',
  phone: '',
};

const INITIAL_FORM_DATA: Partial<Client> = {
  name: '',
  type: 'company',
  contacts: [],
  contactName: '',
  clientCode: '',
  email: '',
  phone: '',
  address: '',
  addressCountry: '',
  addressState: '',
  addressCap: '',
  addressProvince: '',
  addressCivicNumber: '',
  addressLine: '',
  description: '',
  atecoCode: '',
  website: '',
  sector: undefined,
  numberOfEmployees: undefined,
  revenue: undefined,
  fiscalCode: '',
  officeCountRange: undefined,
};

const EMPTY_PROFILE_OPTIONS: ClientProfileOptionsByCategory = {
  sector: [],
  numberOfEmployees: [],
  revenue: [],
  officeCountRange: [],
};

const getPrimaryTaxId = (client: Pick<Client, 'fiscalCode' | 'vatNumber' | 'taxCode'>) =>
  client.fiscalCode || client.vatNumber || client.taxCode || '';

const buildAddress = (formData: Partial<Client>) => {
  const street = [formData.addressLine?.trim(), formData.addressCivicNumber?.trim()]
    .filter(Boolean)
    .join(' ')
    .trim();
  const locality = [formData.addressCap?.trim(), formData.addressState?.trim()]
    .filter(Boolean)
    .join(' ')
    .trim();
  const province = formData.addressProvince?.trim();
  const country = formData.addressCountry?.trim();
  return [
    street,
    [locality, province ? `(${province})` : ''].filter(Boolean).join(' ').trim(),
    country,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(', ');
};

const normalizeContacts = (contacts?: ClientContact[]) => {
  const normalized = (contacts ?? []).map((contact) => ({
    fullName: contact.fullName?.trim() || '',
    role: contact.role?.trim() || '',
    email: contact.email?.trim() || '',
    phone: contact.phone?.trim() || '',
  }));

  return normalized;
};

const getNamedContacts = (contacts?: ClientContact[]) =>
  normalizeContacts(contacts).filter((contact) => contact.fullName.length > 0);

const buildLegacyPrimaryContact = (
  client: Pick<Client, 'contactName' | 'email' | 'phone'>,
): ClientContact | null => {
  const fullName = client.contactName?.trim() || '';
  if (!fullName) return null;

  return {
    fullName,
    role: '',
    email: client.email?.trim() || '',
    phone: client.phone?.trim() || '',
  };
};

const hydrateContactsForEdit = (
  client: Pick<Client, 'contactName' | 'email' | 'phone'>,
  contacts: ClientContact[],
): ClientContact[] => {
  const legacyPrimaryContact = buildLegacyPrimaryContact(client);
  if (!legacyPrimaryContact) {
    return contacts;
  }

  if (!contacts.some((contact) => contact.fullName.trim().length > 0)) {
    return [legacyPrimaryContact];
  }

  const [firstContact, ...otherContacts] = contacts;
  if (!firstContact) {
    return [legacyPrimaryContact];
  }

  return [
    {
      ...firstContact,
      fullName: firstContact.fullName || legacyPrimaryContact.fullName,
      email: firstContact.email || legacyPrimaryContact.email,
      phone: firstContact.phone || legacyPrimaryContact.phone,
    },
    ...otherContacts,
  ];
};

const ClientsView: React.FC<ClientsViewProps> = ({
  clients,
  onAddClient,
  onUpdateClient,
  onDeleteClient,
  onCreateClientProfileOption,
  onUpdateClientProfileOption,
  onDeleteClientProfileOption,
  permissions,
}) => {
  const { t, i18n } = useTranslation(['crm', 'common']);
  const canCreateClients = hasPermission(permissions, buildPermission('crm.clients', 'create'));
  const canUpdateClients = hasPermission(permissions, buildPermission('crm.clients', 'update'));
  const canDeleteClients = hasPermission(permissions, buildPermission('crm.clients', 'delete'));

  const { language } = i18n;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<Client>>(INITIAL_FORM_DATA);
  const [contactsExpanded, setContactsExpanded] = useState(false);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);

  const [profileOptions, setProfileOptions] =
    useState<ClientProfileOptionsByCategory>(EMPTY_PROFILE_OPTIONS);
  const [isLoadingProfileOptions, setIsLoadingProfileOptions] = useState(false);

  const [isManageProfileOptionModalOpen, setIsManageProfileOptionModalOpen] = useState(false);
  const [manageCategory, setManageCategory] = useState<ClientProfileOptionCategory>('sector');
  const [editingProfileOption, setEditingProfileOption] = useState<ClientProfileOption | null>(
    null,
  );
  const [newProfileOptionValue, setNewProfileOptionValue] = useState('');
  const [profileOptionError, setProfileOptionError] = useState<string | null>(null);
  const [isSavingProfileOption, setIsSavingProfileOption] = useState(false);

  const loadProfileOptions = useCallback(async () => {
    setIsLoadingProfileOptions(true);
    try {
      const optionsByCategory = await api.clients.listAllProfileOptions();
      setProfileOptions(optionsByCategory);
    } catch (err) {
      console.error('Failed to load client profile options:', err);
    } finally {
      setIsLoadingProfileOptions(false);
    }
  }, []);

  useEffect(() => {
    void loadProfileOptions();
  }, [loadProfileOptions]);

  const typeOptions = useMemo(
    () => [
      { id: 'company', name: t('crm:clients.typeCompany') },
      { id: 'individual', name: t('crm:clients.typeIndividual') },
    ],
    [t],
  );

  const toOptions = useCallback(
    (category: ClientProfileOptionCategory) =>
      profileOptions[category].map((option) => ({ id: option.value, name: option.value })),
    [profileOptions],
  );

  const sectorOptions = useMemo(() => toOptions('sector'), [toOptions]);
  const numberOfEmployeesOptions = useMemo(() => toOptions('numberOfEmployees'), [toOptions]);
  const revenueOptions = useMemo(() => toOptions('revenue'), [toOptions]);
  const officeCountRangeOptions = useMemo(() => toOptions('officeCountRange'), [toOptions]);

  const openAddModal = () => {
    if (!canCreateClients) return;
    setEditingClient(null);
    setFormData(INITIAL_FORM_DATA);
    setContactsExpanded(false);
    setErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = useCallback(
    (client: Client) => {
      if (!canUpdateClients) return;

      const hydratedContacts = hydrateContactsForEdit(client, normalizeContacts(client.contacts));
      const primaryContact = hydratedContacts[0];
      setEditingClient(client);
      setFormData({
        name: client.name || '',
        type: client.type ?? 'company',
        contacts: hydratedContacts,
        contactName: client.contactName || primaryContact?.fullName || '',
        clientCode: client.clientCode || '',
        email: client.email || primaryContact?.email || '',
        phone: client.phone || primaryContact?.phone || '',
        address: client.address || '',
        addressCountry: client.addressCountry || '',
        addressState: client.addressState || '',
        addressCap: client.addressCap || '',
        addressProvince: client.addressProvince || '',
        addressCivicNumber: client.addressCivicNumber || '',
        addressLine: client.addressLine || client.address || '',
        description: client.description || '',
        atecoCode: client.atecoCode || '',
        website: client.website || '',
        sector: client.sector,
        numberOfEmployees: client.numberOfEmployees,
        revenue: client.revenue,
        fiscalCode: getPrimaryTaxId(client),
        officeCountRange: client.officeCountRange,
      });
      setContactsExpanded(hydratedContacts.length > 1);
      setErrors({});
      setIsModalOpen(true);
    },
    [canUpdateClients],
  );

  const setContacts = useCallback((updater: (prev: ClientContact[]) => ClientContact[]) => {
    setFormData((prev) => {
      const current = normalizeContacts(prev.contacts);
      return { ...prev, contacts: updater(current) };
    });
  }, []);

  const updateContact = useCallback(
    (index: number, field: keyof ClientContact, value: string) => {
      setContacts((prev) =>
        prev.map((contact, currentIndex) =>
          currentIndex === index ? { ...contact, [field]: value } : contact,
        ),
      );
      if (errors.contacts) setErrors((prev) => ({ ...prev, contacts: '' }));
    },
    [errors.contacts, setContacts],
  );

  const addContact = useCallback(() => {
    setContacts((prev) => [...prev, { ...EMPTY_CONTACT }]);
    setContactsExpanded(true);
  }, [setContacts]);

  const removeContact = useCallback(
    (index: number) => {
      setContacts((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    },
    [setContacts],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingClient && !canUpdateClients) return;
    if (!editingClient && !canCreateClients) return;

    const trimmedName = formData.name?.trim() || '';
    const trimmedClientCode = formData.clientCode?.trim() || '';
    const trimmedFiscalCode = formData.fiscalCode?.trim() || '';
    const normalizedContacts = getNamedContacts(formData.contacts);
    const primaryContact = normalizedContacts[0];
    const newErrors: Record<string, string> = {};

    if (!trimmedName) {
      newErrors.name = t('common:validation.required');
    }
    if (!trimmedClientCode) {
      newErrors.clientCode = t('common:validation.required');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(trimmedClientCode)) {
      newErrors.clientCode = t('common:validation.clientCodeInvalid');
    } else {
      const isDuplicate = clients.some(
        (client) =>
          (client.clientCode || '').toLowerCase() === trimmedClientCode.toLowerCase() &&
          (!editingClient || client.id !== editingClient.id),
      );
      if (isDuplicate) {
        newErrors.clientCode = t('common:validation.clientCodeUnique');
      }
    }
    if (!trimmedFiscalCode) {
      newErrors.fiscalCode = t('common:validation.required');
    }

    if (normalizedContacts.length === 0 || !primaryContact) {
      newErrors.contacts = t('common:validation.required');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const payload: Partial<Client> = {
      name: trimmedName,
      type: formData.type,
      contacts: normalizedContacts,
      contactName: primaryContact.fullName,
      clientCode: trimmedClientCode,
      email: primaryContact.email?.trim() || undefined,
      phone: primaryContact.phone?.trim() || '',
      addressCountry: formData.addressCountry?.trim() || '',
      addressState: formData.addressState?.trim() || '',
      addressCap: formData.addressCap?.trim() || '',
      addressProvince: formData.addressProvince?.trim() || '',
      addressCivicNumber: formData.addressCivicNumber?.trim() || '',
      addressLine: formData.addressLine?.trim() || '',
      address: buildAddress(formData),
      description: formData.description?.trim() || undefined,
      atecoCode: formData.atecoCode?.trim() || undefined,
      website: formData.website?.trim() || undefined,
      sector: formData.sector,
      numberOfEmployees: formData.numberOfEmployees,
      revenue: formData.revenue,
      fiscalCode: trimmedFiscalCode,
      officeCountRange: formData.officeCountRange,
    };

    try {
      if (editingClient) {
        await onUpdateClient(editingClient.id, payload);
      } else {
        await onAddClient(payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      const message = (err as Error).message;
      if (
        message.toLowerCase().includes('fiscal code') ||
        message.toLowerCase().includes('vat number')
      ) {
        setErrors({ fiscalCode: message });
      } else if (
        message.toLowerCase().includes('client id') ||
        message.toLowerCase().includes('client code')
      ) {
        setErrors({ clientCode: t('common:validation.clientCodeUnique') });
      } else {
        setErrors({ general: t('common:messages.errorOccurred') });
      }
    }
  };

  const confirmDelete = useCallback((client: Client) => {
    setClientToDelete(client);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleDelete = async () => {
    if (!canDeleteClients || !clientToDelete) return;
    try {
      await onDeleteClient(clientToDelete.id);
    } finally {
      setIsDeleteConfirmOpen(false);
      setClientToDelete(null);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setErrors({});
    setContactsExpanded(false);
  };

  const canSubmit = editingClient ? canUpdateClients : canCreateClients;

  const openManageProfileOptions = (category: ClientProfileOptionCategory) => {
    if (!canUpdateClients) return;
    setManageCategory(category);
    setIsManageProfileOptionModalOpen(true);
    setEditingProfileOption(null);
    setNewProfileOptionValue('');
    setProfileOptionError(null);
  };

  const handleSaveProfileOption = async () => {
    if (!canUpdateClients) return;

    const trimmedValue = newProfileOptionValue.trim();
    if (!trimmedValue) {
      setProfileOptionError(t('common:validation.required'));
      return;
    }

    setIsSavingProfileOption(true);
    setProfileOptionError(null);

    try {
      if (editingProfileOption) {
        await onUpdateClientProfileOption(manageCategory, editingProfileOption.id, {
          value: trimmedValue,
          sortOrder: editingProfileOption.sortOrder,
        });
        if (formData[manageCategory] === editingProfileOption.value) {
          setFormData((prev) => ({ ...prev, [manageCategory]: trimmedValue }));
        }
      } else {
        await onCreateClientProfileOption(manageCategory, trimmedValue);
      }

      await loadProfileOptions();
      setEditingProfileOption(null);
      setNewProfileOptionValue('');
    } catch (err) {
      setProfileOptionError(
        err instanceof Error ? err.message : t('common:messages.errorOccurred'),
      );
    } finally {
      setIsSavingProfileOption(false);
    }
  };

  const handleDeleteProfileOption = async (option: ClientProfileOption) => {
    if (!canUpdateClients) return;

    try {
      await onDeleteClientProfileOption(option.category, option.id);
      await loadProfileOptions();

      if (formData[option.category] === option.value) {
        setFormData((prev) => ({ ...prev, [option.category]: undefined }));
      }
    } catch (err) {
      setProfileOptionError(
        err instanceof Error ? err.message : t('common:messages.errorOccurred'),
      );
    }
  };

  const handleEditProfileOption = (option: ClientProfileOption) => {
    if (!canUpdateClients) return;

    setEditingProfileOption(option);
    setNewProfileOptionValue(option.value);
    setProfileOptionError(null);
  };

  const handleCancelProfileOptionEdit = () => {
    setEditingProfileOption(null);
    setNewProfileOptionValue('');
    setProfileOptionError(null);
  };

  const contactColumns = useMemo<Column<ClientContact>[]>(
    () => [
      {
        header: t('crm:clients.fullName'),
        accessorKey: 'fullName',
        disableFiltering: true,
        cell: ({ row }) => (
          <span className="font-semibold text-slate-700">{row.fullName || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.role'),
        accessorKey: 'role',
        disableFiltering: true,
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.role || '-'}</span>,
      },
      {
        header: t('crm:clients.email'),
        accessorKey: 'email',
        disableFiltering: true,
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.email || '-'}</span>,
      },
      {
        header: t('crm:clients.phone'),
        accessorKey: 'phone',
        disableFiltering: true,
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.phone || '-'}</span>,
      },
      {
        header: t('common:labels.actions'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        sticky: 'right',
        cell: ({ row }) => {
          const contactIndex = normalizeContacts(formData.contacts).findIndex(
            (contact) =>
              contact.fullName === row.fullName &&
              contact.role === row.role &&
              contact.email === row.email &&
              contact.phone === row.phone,
          );
          return (
            <div className="flex justify-end items-center gap-1">
              {contactIndex >= 0 && (
                <Tooltip label={t('common:buttons.delete')}>
                  {() => (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeContact(contactIndex);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  )}
                </Tooltip>
              )}
            </div>
          );
        },
      },
    ],
    [formData.contacts, removeContact, t],
  );

  const columns = useMemo<Column<Client>[]>(() => {
    const eurFormatter = new Intl.NumberFormat(language, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

    return [
      {
        header: t('crm:clients.tableHeaders.name'),
        accessorKey: 'name',
        cell: ({ row }) => (
          <span className="font-semibold whitespace-nowrap text-slate-800">{row.name}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.clientCode'),
        accessorKey: 'clientCode',
        cell: ({ row }) =>
          row.clientCode ? (
            <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">
              {row.clientCode}
            </span>
          ) : null,
      },
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
        accessorFn: (row: Client) =>
          row.type === 'company' ? t('crm:clients.typeCompany') : t('crm:clients.typeIndividual'),
        cell: ({ row }: { row: Client }) => (
          <StatusBadge
            type={row.type === 'company' ? 'company' : 'individual'}
            label={
              row.type === 'company'
                ? t('crm:clients.typeCompany')
                : t('crm:clients.typeIndividual')
            }
          />
        ),
      },
      {
        header: t('crm:clients.tableHeaders.email'),
        accessorKey: 'email',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.email || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.phone'),
        accessorKey: 'phone',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.phone || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.fiscalCode'),
        id: 'fiscalCode',
        accessorFn: (row: Client) => getPrimaryTaxId(row),
        cell: ({ row }: { row: Client }) => (
          <span className="font-mono text-xs text-slate-400">{getPrimaryTaxId(row) || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.officeCountRange'),
        accessorKey: 'officeCountRange',
        cell: ({ row }) => (
          <span className="text-xs text-slate-600">{row.officeCountRange || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.sector'),
        accessorKey: 'sector',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.sector || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.numberOfEmployees'),
        accessorKey: 'numberOfEmployees',
        cell: ({ row }) => (
          <span className="text-xs text-slate-600">{row.numberOfEmployees || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.revenue'),
        accessorKey: 'revenue',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.revenue || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.contactName'),
        accessorKey: 'contactName',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.contactName || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.address'),
        accessorKey: 'address',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.address || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.description'),
        accessorKey: 'description',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.description || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.atecoCode'),
        accessorKey: 'atecoCode',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.atecoCode || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.website'),
        accessorKey: 'website',
        cell: ({ row }) => <span className="text-xs text-slate-600">{row.website || '-'}</span>,
      },
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
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {canUpdateClients && (
              <Tooltip label={t('common:buttons.edit')}>
                {() => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(row);
                    }}
                    className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
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
        ),
      },
    ];
  }, [
    t,
    language,
    canUpdateClients,
    canDeleteClients,
    onUpdateClient,
    confirmDelete,
    openEditModal,
  ]);

  const visibleContacts = normalizeContacts(formData.contacts).filter(
    (contact) => contact.fullName || contact.role || contact.email || contact.phone,
  );

  const manageCategoryLabels: Record<ClientProfileOptionCategory, string> = {
    sector: t('crm:clients.sector'),
    numberOfEmployees: t('crm:clients.numberOfEmployees'),
    revenue: t('crm:clients.revenue'),
    officeCountRange: t('crm:clients.officeCountRange'),
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Modal
        isOpen={isManageProfileOptionModalOpen}
        onClose={() => setIsManageProfileOptionModalOpen(false)}
        zIndex={70}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                <i className="fa-solid fa-gear"></i>
              </div>
              {t('crm:clients.manageValuesTitle', { field: manageCategoryLabels[manageCategory] })}
            </h3>
            <button
              onClick={() => setIsManageProfileOptionModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('crm:clients.value')}
                </label>
                <input
                  type="text"
                  value={newProfileOptionValue}
                  onChange={(e) => setNewProfileOptionValue(e.target.value)}
                  placeholder={t('crm:clients.valuePlaceholder')}
                  className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && void handleSaveProfileOption()}
                />
              </div>

              {profileOptionError && (
                <p className="text-red-500 text-xs font-bold">{profileOptionError}</p>
              )}

              <div className="flex justify-end gap-2">
                {editingProfileOption && (
                  <button
                    onClick={handleCancelProfileOptionEdit}
                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    {t('common:buttons.cancel')}
                  </button>
                )}
                <button
                  onClick={() => void handleSaveProfileOption()}
                  disabled={isSavingProfileOption || !newProfileOptionValue.trim()}
                  className="px-4 py-2 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingProfileOption
                    ? t('common:buttons.saving')
                    : editingProfileOption
                      ? t('common:buttons.update')
                      : t('common:buttons.add')}
                </button>
              </div>
            </div>

            {isLoadingProfileOptions ? (
              <div className="flex items-center justify-center py-8">
                <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
              </div>
            ) : (
              <StandardTable<ClientProfileOption>
                title={t('crm:clients.manageValues')}
                data={profileOptions[manageCategory]}
                defaultRowsPerPage={5}
                containerClassName="shadow-none border-slate-200 rounded-2xl"
                tableContainerClassName="max-h-[35vh] overflow-y-auto"
                emptyState={
                  <div className="text-center py-6 text-slate-500">
                    <p>{t('crm:clients.noValues')}</p>
                  </div>
                }
                columns={[
                  {
                    header: t('crm:clients.value'),
                    accessorKey: 'value',
                    disableFiltering: true,
                    cell: ({ row }) => (
                      <span className="font-bold text-slate-700">{row.value}</span>
                    ),
                  },
                  {
                    header: t('crm:clients.usedByClients'),
                    id: 'usageCount',
                    accessorFn: (row) => row.usageCount,
                    disableFiltering: true,
                    cell: ({ row }) => (
                      <span className="text-xs text-slate-400">{row.usageCount}</span>
                    ),
                  },
                  {
                    header: t('common:labels.actions'),
                    id: 'actions',
                    disableSorting: true,
                    disableFiltering: true,
                    cell: ({ row: option }) => {
                      const isDeleteBlocked = option.usageCount > 0;
                      return (
                        <div className="flex items-center gap-1">
                          <Tooltip label={t('common:buttons.edit')} tooltipClassName="z-[80]">
                            {() => (
                              <button
                                onClick={() => handleEditProfileOption(option)}
                                className="p-1.5 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <i className="fa-solid fa-pen"></i>
                              </button>
                            )}
                          </Tooltip>
                          <Tooltip
                            label={
                              isDeleteBlocked
                                ? t('crm:clients.deleteProfileOptionBlocked', {
                                    count: option.usageCount,
                                  })
                                : ''
                            }
                            disabled={!isDeleteBlocked}
                            tooltipClassName="z-[80]"
                          >
                            {() => (
                              <button
                                onClick={() => void handleDeleteProfileOption(option)}
                                disabled={isDeleteBlocked}
                                className={`p-1.5 rounded-lg transition-colors ${
                                  isDeleteBlocked
                                    ? 'text-slate-300 cursor-not-allowed'
                                    : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                                }`}
                              >
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            )}
                          </Tooltip>
                        </div>
                      );
                    },
                  },
                ]}
              />
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={handleModalClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingClient ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingClient ? t('crm:clients.editClient') : t('crm:clients.addClient')}
            </h3>
            <button
              onClick={handleModalClose}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8" noValidate>
            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:clients.identifyingData')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.clientCode')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.clientCode}
                    onChange={(e) => {
                      setFormData({ ...formData, clientCode: e.target.value });
                      if (errors.clientCode) setErrors((prev) => ({ ...prev, clientCode: '' }));
                    }}
                    placeholder={t('crm:clients.clientCodePlaceholder')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                      errors.clientCode ? 'border-red-500 bg-red-50' : 'border-slate-200'
                    }`}
                  />
                  {errors.clientCode && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientCode}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.name')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value });
                      if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                    }}
                    placeholder={t('crm:clients.namePlaceholder')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                      errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200'
                    }`}
                  />
                  {errors.name && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.clientType')}
                  </label>
                  <CustomSelect
                    options={typeOptions}
                    value={formData.type || 'company'}
                    onChange={(val) =>
                      setFormData({ ...formData, type: (val as Client['type']) || 'company' })
                    }
                    searchable={false}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:clients.contacts')}
              </h4>

              {errors.contacts && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs font-bold">
                  {errors.contacts}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.website')}
                  </label>
                  <input
                    type="text"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    placeholder={t('crm:clients.websitePlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.country')}
                  </label>
                  <input
                    type="text"
                    value={formData.addressCountry}
                    onChange={(e) => setFormData({ ...formData, addressCountry: e.target.value })}
                    placeholder={t('crm:clients.countryPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.state')}
                  </label>
                  <input
                    type="text"
                    value={formData.addressState}
                    onChange={(e) => setFormData({ ...formData, addressState: e.target.value })}
                    placeholder={t('crm:clients.statePlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.cap')}
                  </label>
                  <input
                    type="text"
                    value={formData.addressCap}
                    onChange={(e) => setFormData({ ...formData, addressCap: e.target.value })}
                    placeholder={t('crm:clients.capPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.province')}
                  </label>
                  <input
                    type="text"
                    value={formData.addressProvince}
                    onChange={(e) => setFormData({ ...formData, addressProvince: e.target.value })}
                    placeholder={t('crm:clients.provincePlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.civicNumber')}
                  </label>
                  <input
                    type="text"
                    value={formData.addressCivicNumber}
                    onChange={(e) =>
                      setFormData({ ...formData, addressCivicNumber: e.target.value })
                    }
                    placeholder={t('crm:clients.civicNumberPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
                <div className="col-span-full space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.address')}
                  </label>
                  <input
                    type="text"
                    value={formData.addressLine}
                    onChange={(e) => setFormData({ ...formData, addressLine: e.target.value })}
                    placeholder={t('crm:clients.addressPlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                  <button
                    type="button"
                    onClick={() => setContactsExpanded((prev) => !prev)}
                    className="text-sm font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-2"
                  >
                    <i
                      className={`fa-solid fa-chevron-${contactsExpanded ? 'up' : 'down'} text-[10px]`}
                    ></i>
                    {t('crm:clients.contactsList')} ({visibleContacts.length})
                  </button>

                  <button
                    type="button"
                    onClick={addContact}
                    className="px-3 py-2 text-xs font-bold bg-slate-100 text-praetor rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2"
                  >
                    <i className="fa-solid fa-plus"></i>
                    {t('crm:clients.addContact')}
                  </button>
                </div>

                {contactsExpanded && (
                  <div className="space-y-4">
                    <div className="space-y-4">
                      {normalizeContacts(formData.contacts).map((contact, index) => (
                        <div
                          key={`contact-form-${index}-${contact.fullName}-${contact.email}`}
                          className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200"
                        >
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-500 ml-1">
                              {t('crm:clients.fullName')} <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={contact.fullName}
                              onChange={(e) => updateContact(index, 'fullName', e.target.value)}
                              placeholder={t('crm:clients.fullNamePlaceholder')}
                              className="w-full text-sm px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-500 ml-1">
                              {t('crm:clients.role')}
                            </label>
                            <input
                              type="text"
                              value={contact.role || ''}
                              onChange={(e) => updateContact(index, 'role', e.target.value)}
                              placeholder={t('crm:clients.rolePlaceholder')}
                              className="w-full text-sm px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-500 ml-1">
                              {t('crm:clients.email')}
                            </label>
                            <input
                              type="email"
                              value={contact.email || ''}
                              onChange={(e) => updateContact(index, 'email', e.target.value)}
                              placeholder={t('crm:clients.email')}
                              className="w-full text-sm px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-500 ml-1">
                              {t('crm:clients.phone')}
                            </label>
                            <input
                              type="text"
                              value={contact.phone || ''}
                              onChange={(e) => updateContact(index, 'phone', e.target.value)}
                              placeholder={t('crm:clients.phone')}
                              className="w-full text-sm px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                            />
                          </div>

                          <div className="col-span-full flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeContact(index)}
                              className="text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <i className="fa-solid fa-trash mr-1.5"></i>
                              {t('common:buttons.delete')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <StandardTable<ClientContact>
                      title={t('crm:clients.contactsList')}
                      data={visibleContacts}
                      columns={contactColumns}
                      defaultRowsPerPage={5}
                      containerClassName="shadow-none border-slate-200 rounded-2xl"
                      tableContainerClassName="max-h-[35vh] overflow-y-auto"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:clients.adminFiscal')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.fiscalCode')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.fiscalCode}
                    onChange={(e) => {
                      setFormData({ ...formData, fiscalCode: e.target.value });
                      if (errors.fiscalCode) setErrors((prev) => ({ ...prev, fiscalCode: '' }));
                    }}
                    placeholder={t('crm:clients.fiscalCodePlaceholder')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                      errors.fiscalCode ? 'border-red-500 bg-red-50' : 'border-slate-200'
                    }`}
                  />
                  {errors.fiscalCode && (
                    <p className="text-red-500 text-[10px] font-bold ml-1">{errors.fiscalCode}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.atecoCode')}
                  </label>
                  <input
                    type="text"
                    value={formData.atecoCode}
                    onChange={(e) => setFormData({ ...formData, atecoCode: e.target.value })}
                    placeholder={t('crm:clients.atecoCodePlaceholder')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:clients.companyProfile')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-5">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:clients.sector')}
                    </label>
                    {canUpdateClients && (
                      <button
                        type="button"
                        onClick={() => openManageProfileOptions('sector')}
                        className="text-[10px] font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-1"
                      >
                        <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                      </button>
                    )}
                  </div>
                  <CustomSelect
                    options={sectorOptions}
                    value={formData.sector || ''}
                    onChange={(val) =>
                      setFormData({ ...formData, sector: (val as Client['sector']) || undefined })
                    }
                    placeholder={t('common:form.selectOption')}
                    searchable={false}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-5">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:clients.numberOfEmployees')}
                    </label>
                    {canUpdateClients && (
                      <button
                        type="button"
                        onClick={() => openManageProfileOptions('numberOfEmployees')}
                        className="text-[10px] font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-1"
                      >
                        <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                      </button>
                    )}
                  </div>
                  <CustomSelect
                    options={numberOfEmployeesOptions}
                    value={formData.numberOfEmployees || ''}
                    onChange={(val) =>
                      setFormData({
                        ...formData,
                        numberOfEmployees: (val as Client['numberOfEmployees']) || undefined,
                      })
                    }
                    placeholder={t('common:form.selectOption')}
                    searchable={false}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-5">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:clients.revenue')}
                    </label>
                    {canUpdateClients && (
                      <button
                        type="button"
                        onClick={() => openManageProfileOptions('revenue')}
                        className="text-[10px] font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-1"
                      >
                        <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                      </button>
                    )}
                  </div>
                  <CustomSelect
                    options={revenueOptions}
                    value={formData.revenue || ''}
                    onChange={(val) =>
                      setFormData({ ...formData, revenue: (val as Client['revenue']) || undefined })
                    }
                    placeholder={t('common:form.selectOption')}
                    searchable={false}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-5">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:clients.officeCountRange')}
                    </label>
                    {canUpdateClients && (
                      <button
                        type="button"
                        onClick={() => openManageProfileOptions('officeCountRange')}
                        className="text-[10px] font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-1"
                      >
                        <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                      </button>
                    )}
                  </div>
                  <CustomSelect
                    options={officeCountRangeOptions}
                    value={formData.officeCountRange || ''}
                    onChange={(val) =>
                      setFormData({
                        ...formData,
                        officeCountRange: (val as Client['officeCountRange']) || undefined,
                      })
                    }
                    placeholder={t('common:form.selectOption')}
                    searchable={false}
                  />
                </div>

                <div className="col-span-full space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:clients.description')}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder={t('crm:clients.description')}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
                  />
                </div>
              </div>
            </div>

            {errors.general && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-600">
                <i className="fa-solid fa-circle-exclamation text-lg"></i>
                <p className="text-sm font-bold">{errors.general}</p>
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleModalClose}
                className="px-8 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className={`px-10 py-3 text-white text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 ${
                  canSubmit
                    ? 'bg-praetor shadow-slate-200 hover:bg-slate-700'
                    : 'bg-slate-300 shadow-none cursor-not-allowed'
                }`}
              >
                {editingClient ? t('common:buttons.update') : t('common:buttons.save')}
              </button>
            </div>
          </form>
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
                onClick={() => void handleDelete()}
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
          {canCreateClients && (
            <button
              onClick={openAddModal}
              className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i> {t('crm:clients.addClient')}
            </button>
          )}
        </div>
      </div>

      <StandardTable<Client>
        title={t('crm:clients.clientsDirectory')}
        data={clients}
        columns={columns}
        defaultRowsPerPage={10}
        onRowClick={canUpdateClients ? openEditModal : undefined}
        rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
      />
    </div>
  );
};

export default ClientsView;
