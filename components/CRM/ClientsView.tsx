import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import HeaderAddButton from '../shared/HeaderAddButton';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl from '../shared/SelectControl';
import StandardTable, { type Column } from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';

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

type ContactTableRow = ClientContact & {
  contactIndex: number;
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

const normalizeContact = (contact?: ClientContact | null): ClientContact => ({
  fullName: contact?.fullName?.trim() || '',
  role: contact?.role?.trim() || '',
  email: contact?.email?.trim() || '',
  phone: contact?.phone?.trim() || '',
});

const normalizeContacts = (contacts?: ClientContact[]) =>
  (contacts ?? []).map((contact) => normalizeContact(contact));

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
  const [contactDraft, setContactDraft] = useState<ClientContact | null>(null);
  const [editingContactIndex, setEditingContactIndex] = useState<number | null>(null);
  const [contactDraftError, setContactDraftError] = useState<string | null>(null);

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
    setContactDraft(null);
    setEditingContactIndex(null);
    setContactDraftError(null);
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
      setContactDraft(null);
      setEditingContactIndex(null);
      setContactDraftError(null);
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

  const addContact = useCallback(() => {
    setContactDraft({ ...EMPTY_CONTACT });
    setEditingContactIndex(null);
    setContactDraftError(null);
    if (errors.contacts) setErrors((prev) => ({ ...prev, contacts: '' }));
    setContactsExpanded(true);
  }, [errors.contacts]);

  const updateContactDraft = useCallback(
    (field: keyof ClientContact, value: string) => {
      setContactDraft((prev) => ({ ...(prev ?? { ...EMPTY_CONTACT }), [field]: value }));
      if (contactDraftError) setContactDraftError(null);
      if (errors.contacts) setErrors((prev) => ({ ...prev, contacts: '' }));
    },
    [contactDraftError, errors.contacts],
  );

  const saveContactDraft = useCallback(() => {
    if (!contactDraft) return;

    const normalizedDraft = normalizeContact(contactDraft);
    if (!normalizedDraft.fullName) {
      setContactDraftError(t('common:validation.required'));
      return;
    }

    setContacts((prev) => {
      if (editingContactIndex !== null) {
        return prev.map((contact, currentIndex) =>
          currentIndex === editingContactIndex ? normalizedDraft : contact,
        );
      }
      return [...prev, normalizedDraft];
    });

    setContactDraft(null);
    setEditingContactIndex(null);
    setContactDraftError(null);
    if (errors.contacts) setErrors((prev) => ({ ...prev, contacts: '' }));
  }, [contactDraft, editingContactIndex, errors.contacts, setContacts, t]);

  const editContact = useCallback(
    (index: number) => {
      const target = normalizeContacts(formData.contacts)[index];
      if (!target) return;
      setContactDraft({ ...target });
      setEditingContactIndex(index);
      setContactDraftError(null);
      if (errors.contacts) setErrors((prev) => ({ ...prev, contacts: '' }));
      setContactsExpanded(true);
    },
    [errors.contacts, formData.contacts],
  );

  const cancelContactDraft = useCallback(() => {
    setContactDraft(null);
    setEditingContactIndex(null);
    setContactDraftError(null);
  }, []);

  const removeContact = useCallback(
    (index: number) => {
      setContacts((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
      if (editingContactIndex === index) {
        setContactDraft(null);
        setEditingContactIndex(null);
        setContactDraftError(null);
      } else if (editingContactIndex !== null && editingContactIndex > index) {
        setEditingContactIndex(editingContactIndex - 1);
      }
    },
    [editingContactIndex, setContacts],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingClient && !canUpdateClients) return;
    if (!editingClient && !canCreateClients) return;

    const normalizedDraft = contactDraft ? normalizeContact(contactDraft) : null;
    const hasDraftValues = normalizedDraft
      ? (normalizedDraft.fullName || '').length > 0 ||
        (normalizedDraft.role || '').length > 0 ||
        (normalizedDraft.email || '').length > 0 ||
        (normalizedDraft.phone || '').length > 0
      : false;
    let contactsForSubmit = normalizeContacts(formData.contacts);

    if (normalizedDraft && (editingContactIndex !== null || hasDraftValues)) {
      if (!normalizedDraft.fullName) {
        setContactDraftError(t('common:validation.required'));
        setContactsExpanded(true);
        return;
      }

      contactsForSubmit =
        editingContactIndex !== null
          ? contactsForSubmit.map((contact, currentIndex) =>
              currentIndex === editingContactIndex ? normalizedDraft : contact,
            )
          : [...contactsForSubmit, normalizedDraft];
    }

    const trimmedName = formData.name?.trim() || '';
    const trimmedClientCode = formData.clientCode?.trim() || '';
    const trimmedFiscalCode = formData.fiscalCode?.trim() || '';
    const normalizedContacts = getNamedContacts(contactsForSubmit);
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
    setContactDraft(null);
    setEditingContactIndex(null);
    setContactDraftError(null);
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
        setFormData((prev) => ({ ...prev, [option.category]: null }));
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

  const contactColumns = useMemo<Column<ContactTableRow>[]>(
    () => [
      {
        header: t('crm:clients.fullName'),
        accessorKey: 'fullName',
        disableFiltering: true,
        cell: ({ row }) => (
          <span className="font-semibold text-zinc-700">{row.fullName || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.role'),
        accessorKey: 'role',
        disableFiltering: true,
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.role || '-'}</span>,
      },
      {
        header: t('crm:clients.email'),
        accessorKey: 'email',
        disableFiltering: true,
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.email || '-'}</span>,
      },
      {
        header: t('crm:clients.phone'),
        accessorKey: 'phone',
        disableFiltering: true,
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.phone || '-'}</span>,
      },
      {
        header: t('common:labels.actions'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        sticky: 'right',
        cell: ({ row }) => (
          <div className="flex justify-end items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      editContact(row.contactIndex);
                    }}
                    className="p-2 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-all"
                  >
                    <i className="fa-solid fa-pen"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeContact(row.contactIndex);
                    }}
                    className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [editContact, removeContact, t],
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
          <span className="font-semibold whitespace-nowrap text-zinc-800">{row.name}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.clientCode'),
        accessorKey: 'clientCode',
        cell: ({ row }) =>
          row.clientCode ? (
            <span className="text-[10px] font-black bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded uppercase">
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
            return <span className="text-xs text-zinc-400">-</span>;
          }
          return (
            <span className="text-xs text-zinc-500 whitespace-nowrap">
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
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.email || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.phone'),
        accessorKey: 'phone',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.phone || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.fiscalCode'),
        id: 'fiscalCode',
        accessorFn: (row: Client) => getPrimaryTaxId(row),
        cell: ({ row }: { row: Client }) => (
          <span className="font-mono text-xs text-zinc-400">{getPrimaryTaxId(row) || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.officeCountRange'),
        accessorKey: 'officeCountRange',
        cell: ({ row }) => (
          <span className="text-xs text-zinc-600">{row.officeCountRange || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.sector'),
        accessorKey: 'sector',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.sector || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.numberOfEmployees'),
        accessorKey: 'numberOfEmployees',
        cell: ({ row }) => (
          <span className="text-xs text-zinc-600">{row.numberOfEmployees || '-'}</span>
        ),
      },
      {
        header: t('crm:clients.tableHeaders.revenue'),
        accessorKey: 'revenue',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.revenue || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.contactName'),
        accessorKey: 'contactName',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.contactName || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.address'),
        accessorKey: 'address',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.address || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.description'),
        accessorKey: 'description',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.description || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.atecoCode'),
        accessorKey: 'atecoCode',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.atecoCode || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.website'),
        accessorKey: 'website',
        cell: ({ row }) => <span className="text-xs text-zinc-600">{row.website || '-'}</span>,
      },
      {
        header: t('crm:clients.tableHeaders.totalSentQuotes'),
        id: 'totalSentQuotes',
        accessorFn: (row: Client) => row.totalSentQuotes ?? 0,
        cell: ({ row }: { row: Client }) => {
          const value = row.totalSentQuotes;
          if (value == null || value === 0) {
            return <span className="text-xs text-zinc-400">-</span>;
          }
          return (
            <span className="text-xs font-semibold text-zinc-700 whitespace-nowrap">
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
            return <span className="text-xs text-zinc-400">-</span>;
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(row);
                      }}
                      className="p-2 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-pen"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canUpdateClients) return;
                      onUpdateClient(row.id, { isDisabled: !row.isDisabled });
                    }}
                    disabled={!canUpdateClients}
                    className={`p-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      row.isDisabled
                        ? 'text-praetor hover:bg-zinc-100'
                        : 'text-amber-700 hover:text-amber-600 hover:bg-amber-50'
                    }`}
                  >
                    <i className={`fa-solid ${row.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {row.isDisabled ? t('common:buttons.enable') : t('crm:clients.disableClient')}
              </TooltipContent>
            </Tooltip>
            {canDeleteClients && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(row);
                      }}
                      className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('common:buttons.delete')}</TooltipContent>
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

  const allContacts = normalizeContacts(formData.contacts);

  const contactTableRows = allContacts
    .map((contact, contactIndex) => ({
      ...contact,
      contactIndex,
    }))
    .filter((contact) => contact.fullName || contact.role || contact.email || contact.phone);

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
        <ModalContent size="2xl">
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                <i className="fa-solid fa-gear" aria-hidden="true"></i>
              </span>
              {t('crm:clients.manageValuesTitle', { field: manageCategoryLabels[manageCategory] })}
            </ModalTitle>
            <ModalCloseButton onClick={() => setIsManageProfileOptionModalOpen(false)} />
          </ModalHeader>

          <ModalBody className="max-h-[60vh] space-y-4">
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <Field>
                <FieldLabel htmlFor="client-profile-option-value">
                  {t('crm:clients.value')}
                </FieldLabel>
                <Input
                  id="client-profile-option-value"
                  type="text"
                  value={newProfileOptionValue}
                  onChange={(e) => setNewProfileOptionValue(e.target.value)}
                  placeholder={t('crm:clients.valuePlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && void handleSaveProfileOption()}
                />
              </Field>

              {profileOptionError && (
                <FieldError className="text-xs">{profileOptionError}</FieldError>
              )}

              <div className="flex justify-end gap-2">
                {editingProfileOption && (
                  <Button type="button" variant="outline" onClick={handleCancelProfileOptionEdit}>
                    {t('common:buttons.cancel')}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => void handleSaveProfileOption()}
                  disabled={isSavingProfileOption || !newProfileOptionValue.trim()}
                >
                  {isSavingProfileOption
                    ? t('common:buttons.saving')
                    : editingProfileOption
                      ? t('common:buttons.update')
                      : t('common:buttons.add')}
                </Button>
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
                containerClassName="shadow-none border-zinc-200 rounded-2xl"
                tableContainerClassName="max-h-[35vh] overflow-y-auto"
                emptyState={
                  <div className="text-center py-6 text-zinc-500">
                    <p>{t('crm:clients.noValues')}</p>
                  </div>
                }
                columns={[
                  {
                    header: t('crm:clients.value'),
                    accessorKey: 'value',
                    disableFiltering: true,
                    cell: ({ row }) => <span className="font-bold text-zinc-700">{row.value}</span>,
                  },
                  {
                    header: t('crm:clients.usedByClients'),
                    id: 'usageCount',
                    accessorFn: (row) => row.usageCount,
                    disableFiltering: true,
                    cell: ({ row }) => (
                      <span className="text-xs text-zinc-400">{row.usageCount}</span>
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  onClick={() => handleEditProfileOption(option)}
                                  className="p-1.5 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-colors"
                                >
                                  <i className="fa-solid fa-pen"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
                          </Tooltip>
                          <Tooltip disabled={!isDeleteBlocked}>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  onClick={() => void handleDeleteProfileOption(option)}
                                  disabled={isDeleteBlocked}
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    isDeleteBlocked
                                      ? 'text-zinc-300 cursor-not-allowed'
                                      : 'text-red-600 hover:text-red-600 hover:bg-red-50'
                                  }`}
                                >
                                  <i className="fa-solid fa-trash"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isDeleteBlocked
                                ? t('crm:clients.deleteProfileOptionBlocked', {
                                    count: option.usageCount,
                                  })
                                : ''}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    },
                  },
                ]}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={handleModalClose}>
        <ModalContent size="6xl" className="max-h-[90vh]">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <ModalHeader>
              <ModalTitle className="gap-3">
                <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                  <i
                    className={`fa-solid ${editingClient ? 'fa-pen-to-square' : 'fa-plus'}`}
                    aria-hidden="true"
                  ></i>
                </span>
                {editingClient ? t('crm:clients.editClient') : t('crm:clients.addClient')}
              </ModalTitle>
              <ModalCloseButton onClick={handleModalClose} />
            </ModalHeader>

            <ModalBody className="flex-1 space-y-8">
              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-praetor"></span>
                  {t('crm:clients.identifyingData')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.clientCode')} <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={formData.clientCode}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, clientCode: e.target.value }));
                        if (errors.clientCode) setErrors((prev) => ({ ...prev, clientCode: '' }));
                      }}
                      placeholder={t('crm:clients.clientCodePlaceholder')}
                      className={`w-full text-sm px-4 py-2.5 bg-zinc-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.clientCode ? 'border-red-500 bg-red-50' : 'border-zinc-200'
                      }`}
                    />
                    {errors.clientCode && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.clientCode}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.name')} <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={formData.name}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, name: e.target.value }));
                        if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                      }}
                      placeholder={t('crm:clients.namePlaceholder')}
                      className={`w-full text-sm px-4 py-2.5 bg-zinc-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.name ? 'border-red-500 bg-red-50' : 'border-zinc-200'
                      }`}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.clientType')}
                    </label>
                    <SelectControl
                      options={typeOptions}
                      value={formData.type || 'company'}
                      onChange={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          type: (val as Client['type']) || 'company',
                        }))
                      }
                      searchable={false}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-praetor"></span>
                  {t('crm:clients.contacts')}
                </h4>

                {errors.contacts && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs font-bold">
                    {errors.contacts}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.website')}
                    </label>
                    <Input
                      type="text"
                      value={formData.website}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, website: e.target.value }))
                      }
                      placeholder={t('crm:clients.websitePlaceholder')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.country')}
                    </label>
                    <Input
                      type="text"
                      value={formData.addressCountry}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, addressCountry: e.target.value }))
                      }
                      placeholder={t('crm:clients.countryPlaceholder')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.state')}
                    </label>
                    <Input
                      type="text"
                      value={formData.addressState}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, addressState: e.target.value }))
                      }
                      placeholder={t('crm:clients.statePlaceholder')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.cap')}
                    </label>
                    <Input
                      type="text"
                      value={formData.addressCap}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, addressCap: e.target.value }))
                      }
                      placeholder={t('crm:clients.capPlaceholder')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.province')}
                    </label>
                    <Input
                      type="text"
                      value={formData.addressProvince}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, addressProvince: e.target.value }))
                      }
                      placeholder={t('crm:clients.provincePlaceholder')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.civicNumber')}
                    </label>
                    <Input
                      type="text"
                      value={formData.addressCivicNumber}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, addressCivicNumber: e.target.value }))
                      }
                      placeholder={t('crm:clients.civicNumberPlaceholder')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.address')}
                    </label>
                    <Input
                      type="text"
                      value={formData.addressLine}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, addressLine: e.target.value }))
                      }
                      placeholder={t('crm:clients.addressPlaceholder')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setContactsExpanded((prev) => !prev)}
                      className="gap-2 text-xs font-semibold uppercase tracking-wide"
                    >
                      <i
                        className={`fa-solid fa-chevron-${contactsExpanded ? 'up' : 'down'} text-[10px]`}
                      ></i>
                      {t('crm:clients.contactsList')} ({contactTableRows.length})
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={addContact}
                      className="gap-2"
                    >
                      <i className="fa-solid fa-plus"></i>
                      {t('crm:clients.addContact')}
                    </Button>
                  </div>

                  {contactsExpanded && (
                    <div className="space-y-4">
                      {contactDraft && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-zinc-500 ml-1">
                              {t('crm:clients.fullName')} <span className="text-red-500">*</span>
                            </label>
                            <Input
                              type="text"
                              value={contactDraft.fullName}
                              onChange={(e) => updateContactDraft('fullName', e.target.value)}
                              placeholder={t('crm:clients.fullNamePlaceholder')}
                              className={`w-full text-sm px-4 py-2.5 bg-white border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                                contactDraftError ? 'border-red-500 bg-red-50' : 'border-zinc-200'
                              }`}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-zinc-500 ml-1">
                              {t('crm:clients.role')}
                            </label>
                            <Input
                              type="text"
                              value={contactDraft.role || ''}
                              onChange={(e) => updateContactDraft('role', e.target.value)}
                              placeholder={t('crm:clients.rolePlaceholder')}
                              className="w-full text-sm px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-zinc-500 ml-1">
                              {t('crm:clients.email')}
                            </label>
                            <Input
                              type="email"
                              value={contactDraft.email || ''}
                              onChange={(e) => updateContactDraft('email', e.target.value)}
                              placeholder={t('crm:clients.email')}
                              className="w-full text-sm px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-zinc-500 ml-1">
                              {t('crm:clients.phone')}
                            </label>
                            <Input
                              type="text"
                              value={contactDraft.phone || ''}
                              onChange={(e) => updateContactDraft('phone', e.target.value)}
                              placeholder={t('crm:clients.phone')}
                              className="w-full text-sm px-4 py-2.5 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                            />
                          </div>

                          <div className="col-span-full flex items-center justify-between">
                            <div>
                              {contactDraftError && (
                                <p className="text-red-500 text-[10px] font-bold ml-1">
                                  {contactDraftError}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={cancelContactDraft}
                              >
                                {t('common:buttons.cancel')}
                              </Button>
                              <Button type="button" size="sm" onClick={saveContactDraft}>
                                {editingContactIndex !== null
                                  ? t('common:buttons.update')
                                  : t('common:buttons.save')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      <StandardTable<ContactTableRow>
                        title={t('crm:clients.contactsList')}
                        data={contactTableRows}
                        columns={contactColumns}
                        defaultRowsPerPage={5}
                        containerClassName="shadow-none border-zinc-200 rounded-2xl"
                        tableContainerClassName="max-h-[35vh] overflow-y-auto"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-praetor"></span>
                  {t('crm:clients.adminFiscal')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.fiscalCode')} <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={formData.fiscalCode}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, fiscalCode: e.target.value }));
                        if (errors.fiscalCode) setErrors((prev) => ({ ...prev, fiscalCode: '' }));
                      }}
                      placeholder={t('crm:clients.fiscalCodePlaceholder')}
                      className={`w-full text-sm px-4 py-2.5 bg-zinc-50 border rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all ${
                        errors.fiscalCode ? 'border-red-500 bg-red-50' : 'border-zinc-200'
                      }`}
                    />
                    {errors.fiscalCode && (
                      <p className="text-red-500 text-[10px] font-bold ml-1">{errors.fiscalCode}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.atecoCode')}
                    </label>
                    <Input
                      type="text"
                      value={formData.atecoCode}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, atecoCode: e.target.value }))
                      }
                      placeholder={t('crm:clients.atecoCodePlaceholder')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-praetor"></span>
                  {t('crm:clients.companyProfile')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-end justify-between ml-1 min-h-5">
                      <label className="text-xs font-bold text-zinc-500">
                        {t('crm:clients.sector')}
                      </label>
                      {canUpdateClients && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => openManageProfileOptions('sector')}
                          className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                        </Button>
                      )}
                    </div>
                    <SelectControl
                      options={sectorOptions}
                      value={formData.sector || ''}
                      onChange={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          sector: (val as Client['sector']) || null,
                        }))
                      }
                      placeholder={t('common:form.selectOption')}
                      searchable={false}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-end justify-between ml-1 min-h-5">
                      <label className="text-xs font-bold text-zinc-500">
                        {t('crm:clients.numberOfEmployees')}
                      </label>
                      {canUpdateClients && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => openManageProfileOptions('numberOfEmployees')}
                          className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                        </Button>
                      )}
                    </div>
                    <SelectControl
                      options={numberOfEmployeesOptions}
                      value={formData.numberOfEmployees || ''}
                      onChange={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          numberOfEmployees: (val as Client['numberOfEmployees']) || null,
                        }))
                      }
                      placeholder={t('common:form.selectOption')}
                      searchable={false}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-end justify-between ml-1 min-h-5">
                      <label className="text-xs font-bold text-zinc-500">
                        {t('crm:clients.revenue')}
                      </label>
                      {canUpdateClients && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => openManageProfileOptions('revenue')}
                          className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                        </Button>
                      )}
                    </div>
                    <SelectControl
                      options={revenueOptions}
                      value={formData.revenue || ''}
                      onChange={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          revenue: (val as Client['revenue']) || null,
                        }))
                      }
                      placeholder={t('common:form.selectOption')}
                      searchable={false}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-end justify-between ml-1 min-h-5">
                      <label className="text-xs font-bold text-zinc-500">
                        {t('crm:clients.officeCountRange')}
                      </label>
                      {canUpdateClients && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => openManageProfileOptions('officeCountRange')}
                          className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                        </Button>
                      )}
                    </div>
                    <SelectControl
                      options={officeCountRangeOptions}
                      value={formData.officeCountRange || ''}
                      onChange={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          officeCountRange: (val as Client['officeCountRange']) || null,
                        }))
                      }
                      placeholder={t('common:form.selectOption')}
                      searchable={false}
                    />
                  </div>

                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 ml-1">
                      {t('crm:clients.description')}
                    </label>
                    <Textarea
                      rows={3}
                      value={formData.description}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder={t('crm:clients.description')}
                      className="w-full text-sm px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
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
            </ModalBody>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={handleModalClose}>
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {editingClient ? t('common:buttons.update') : t('common:buttons.save')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={() => {
          void handleDelete();
        }}
        title={t('crm:clients.deleteClient')}
        description={`${t('common:messages.deleteConfirmNamed', {
          name: clientToDelete?.name,
        })}${t('crm:clients.deleteConfirm')}`}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">{t('crm:clients.title')}</h2>
            <p className="text-zinc-500 text-sm">{t('crm:clients.subtitle')}</p>
          </div>
          {canCreateClients && (
            <HeaderAddButton onClick={openAddModal}>{t('crm:clients.addClient')}</HeaderAddButton>
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
