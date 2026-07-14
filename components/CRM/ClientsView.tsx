import { ChevronDown, FileSpreadsheet, Plus, Rows3 } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useId, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldError, FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import api from '../../services/api';
import type {
  BulkClientCreateInput,
  BulkClientCreateResponse,
  Client,
  ClientContact,
  ClientProfileOption,
  ClientProfileOptionCategory,
  ClientProfileOptionsByCategory,
} from '../../types';
import {
  buildClientImportDefinition,
  CLIENT_IMPORT_FILENAME,
} from '../../utils/clientImportWorkbook';
import { formatInsertDate } from '../../utils/date';
import { downloadImportWorkbook } from '../../utils/entityImportWorkbook';
import { formatNumber } from '../../utils/numbers';
import { hasScopedActionPermission } from '../../utils/permissions';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
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
import { ClientBulkCreateDialog, ClientWorkbookImportDialog } from './ClientBulkCreateDialogs';

export interface ClientsViewProps {
  clients: Client[];
  onAddClient: (clientData: Partial<Client>) => Promise<void>;
  onAddClientsBulk: (clients: BulkClientCreateInput[]) => Promise<BulkClientCreateResponse>;
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

interface ClientsViewState {
  isModalOpen: boolean;
  isBulkCreateModalOpen: boolean;
  isWorkbookImportModalOpen: boolean;
  editingClient: Client | null;
  errors: Record<string, string>;
  formData: Partial<Client>;
  contactsExpanded: boolean;
  contactDraft: ClientContact | null;
  editingContactIndex: number | null;
  contactDraftError: string | null;
  isDeleteConfirmOpen: boolean;
  clientToDelete: Client | null;
  profileOptions: ClientProfileOptionsByCategory;
  isLoadingProfileOptions: boolean;
  isManageProfileOptionModalOpen: boolean;
  manageCategory: ClientProfileOptionCategory;
  editingProfileOption: ClientProfileOption | null;
  newProfileOptionValue: string;
  profileOptionError: string | null;
  isSavingProfileOption: boolean;
}

const INITIAL_CLIENTS_STATE: ClientsViewState = {
  isModalOpen: false,
  isBulkCreateModalOpen: false,
  isWorkbookImportModalOpen: false,
  editingClient: null,
  errors: {},
  formData: INITIAL_FORM_DATA,
  contactsExpanded: false,
  contactDraft: null,
  editingContactIndex: null,
  contactDraftError: null,
  isDeleteConfirmOpen: false,
  clientToDelete: null,
  profileOptions: EMPTY_PROFILE_OPTIONS,
  isLoadingProfileOptions: false,
  isManageProfileOptionModalOpen: false,
  manageCategory: 'sector',
  editingProfileOption: null,
  newProfileOptionValue: '',
  profileOptionError: null,
  isSavingProfileOption: false,
};

type ClientsViewAction =
  | { type: 'setErrors'; value: Record<string, string> }
  | { type: 'patchErrors'; value: Record<string, string> }
  | { type: 'setFormData'; value: Partial<Client> }
  | { type: 'patchFormData'; value: Partial<Client> }
  | { type: 'setContactsExpanded'; value: boolean }
  | { type: 'toggleContactsExpanded' }
  | { type: 'setContactDraft'; value: ClientContact | null }
  | { type: 'patchContactDraft'; field: keyof ClientContact; value: string }
  | { type: 'setEditingContactIndex'; value: number | null }
  | { type: 'setContactDraftError'; value: string | null }
  | { type: 'setProfileOptions'; value: ClientProfileOptionsByCategory }
  | { type: 'setIsLoadingProfileOptions'; value: boolean }
  | { type: 'setIsModalOpen'; value: boolean }
  | { type: 'setIsBulkCreateModalOpen'; value: boolean }
  | { type: 'setIsWorkbookImportModalOpen'; value: boolean }
  | { type: 'setIsManageProfileOptionModalOpen'; value: boolean }
  | { type: 'setEditingProfileOption'; value: ClientProfileOption | null }
  | { type: 'setNewProfileOptionValue'; value: string }
  | { type: 'setProfileOptionError'; value: string | null }
  | { type: 'setIsSavingProfileOption'; value: boolean }
  | { type: 'openAddModal' }
  | { type: 'openEditModal'; client: Client; formData: Partial<Client>; contactsExpanded: boolean }
  | { type: 'closeModal' }
  | { type: 'addContact'; clearContactsError: boolean }
  | { type: 'editContact'; contact: ClientContact; index: number; clearContactsError: boolean }
  | { type: 'cancelContactDraft' }
  | { type: 'confirmDelete'; client: Client }
  | { type: 'setIsDeleteConfirmOpen'; value: boolean }
  | { type: 'closeDeleteConfirm' }
  | { type: 'openManageProfileOptions'; category: ClientProfileOptionCategory };

const clientsViewReducer = (
  state: ClientsViewState,
  action: ClientsViewAction,
): ClientsViewState => {
  switch (action.type) {
    case 'setErrors':
      return { ...state, errors: action.value };
    case 'patchErrors':
      return { ...state, errors: { ...state.errors, ...action.value } };
    case 'setFormData':
      return { ...state, formData: action.value };
    case 'patchFormData':
      return { ...state, formData: { ...state.formData, ...action.value } };
    case 'setContactsExpanded':
      return { ...state, contactsExpanded: action.value };
    case 'toggleContactsExpanded':
      return { ...state, contactsExpanded: !state.contactsExpanded };
    case 'setContactDraft':
      return { ...state, contactDraft: action.value };
    case 'patchContactDraft':
      return {
        ...state,
        contactDraft: {
          ...(state.contactDraft ?? { ...EMPTY_CONTACT }),
          [action.field]: action.value,
        },
      };
    case 'setEditingContactIndex':
      return { ...state, editingContactIndex: action.value };
    case 'setContactDraftError':
      return { ...state, contactDraftError: action.value };
    case 'setProfileOptions':
      return { ...state, profileOptions: action.value };
    case 'setIsLoadingProfileOptions':
      return { ...state, isLoadingProfileOptions: action.value };
    case 'setIsModalOpen':
      return { ...state, isModalOpen: action.value };
    case 'setIsBulkCreateModalOpen':
      return { ...state, isBulkCreateModalOpen: action.value };
    case 'setIsWorkbookImportModalOpen':
      return { ...state, isWorkbookImportModalOpen: action.value };
    case 'setIsManageProfileOptionModalOpen':
      return { ...state, isManageProfileOptionModalOpen: action.value };
    case 'setEditingProfileOption':
      return { ...state, editingProfileOption: action.value };
    case 'setNewProfileOptionValue':
      return { ...state, newProfileOptionValue: action.value };
    case 'setProfileOptionError':
      return { ...state, profileOptionError: action.value };
    case 'setIsSavingProfileOption':
      return { ...state, isSavingProfileOption: action.value };
    case 'openAddModal':
      return {
        ...state,
        editingClient: null,
        formData: INITIAL_FORM_DATA,
        contactsExpanded: false,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
        errors: {},
        isModalOpen: true,
      };
    case 'openEditModal':
      return {
        ...state,
        editingClient: action.client,
        formData: action.formData,
        contactsExpanded: action.contactsExpanded,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
        errors: {},
        isModalOpen: true,
      };
    case 'closeModal':
      return {
        ...state,
        isModalOpen: false,
        errors: {},
        contactsExpanded: false,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
      };
    case 'addContact':
      return {
        ...state,
        contactDraft: { ...EMPTY_CONTACT },
        editingContactIndex: null,
        contactDraftError: null,
        errors: action.clearContactsError ? { ...state.errors, contacts: '' } : state.errors,
        contactsExpanded: true,
      };
    case 'editContact':
      return {
        ...state,
        contactDraft: { ...action.contact },
        editingContactIndex: action.index,
        contactDraftError: null,
        errors: action.clearContactsError ? { ...state.errors, contacts: '' } : state.errors,
        contactsExpanded: true,
      };
    case 'cancelContactDraft':
      return {
        ...state,
        contactDraft: null,
        editingContactIndex: null,
        contactDraftError: null,
      };
    case 'confirmDelete':
      return { ...state, clientToDelete: action.client, isDeleteConfirmOpen: true };
    case 'setIsDeleteConfirmOpen':
      return { ...state, isDeleteConfirmOpen: action.value };
    case 'closeDeleteConfirm':
      return { ...state, isDeleteConfirmOpen: false, clientToDelete: null };
    case 'openManageProfileOptions':
      return {
        ...state,
        manageCategory: action.category,
        isManageProfileOptionModalOpen: true,
        editingProfileOption: null,
        newProfileOptionValue: '',
        profileOptionError: null,
      };
    default:
      return state;
  }
};

const useClientsController = ({
  clients,
  onAddClient,
  onAddClientsBulk,
  onUpdateClient,
  onDeleteClient,
  onCreateClientProfileOption,
  onUpdateClientProfileOption,
  onDeleteClientProfileOption,
  permissions,
}: ClientsViewProps) => {
  const { t, i18n } = useTranslation(['crm', 'common']);
  const canCreateClients = hasScopedActionPermission(permissions, 'crm.clients', 'create');
  const canUpdateClients = hasScopedActionPermission(permissions, 'crm.clients', 'update');
  const canDeleteClients = hasScopedActionPermission(permissions, 'crm.clients', 'delete');

  const { language } = i18n;

  const [state, dispatch] = useReducer(clientsViewReducer, INITIAL_CLIENTS_STATE);
  const {
    isModalOpen,
    isBulkCreateModalOpen,
    isWorkbookImportModalOpen,
    editingClient,
    errors,
    formData,
    contactsExpanded,
    contactDraft,
    editingContactIndex,
    contactDraftError,
    isDeleteConfirmOpen,
    clientToDelete,
    profileOptions,
    isLoadingProfileOptions,
    isManageProfileOptionModalOpen,
    manageCategory,
    editingProfileOption,
    newProfileOptionValue,
    profileOptionError,
    isSavingProfileOption,
  } = state;

  const loadProfileOptions = useCallback(async () => {
    dispatch({ type: 'setIsLoadingProfileOptions', value: true });
    try {
      const optionsByCategory = await api.clients.listAllProfileOptions();
      dispatch({ type: 'setProfileOptions', value: optionsByCategory });
      return optionsByCategory;
    } catch (err) {
      console.error('Failed to load client profile options:', err);
      throw err;
    } finally {
      dispatch({ type: 'setIsLoadingProfileOptions', value: false });
    }
  }, []);

  useEffect(() => {
    void loadProfileOptions().catch(() => undefined);
  }, [loadProfileOptions]);

  const downloadClientImportTemplate = useCallback(async () => {
    const latestProfileOptions = await loadProfileOptions();
    await downloadImportWorkbook(
      buildClientImportDefinition(latestProfileOptions, t),
      CLIENT_IMPORT_FILENAME,
    );
  }, [loadProfileOptions, t]);

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
    dispatch({ type: 'openAddModal' });
  };

  const openEditModal = useCallback(
    (client: Client) => {
      if (!canUpdateClients) return;

      const hydratedContacts = hydrateContactsForEdit(client, normalizeContacts(client.contacts));
      const primaryContact = hydratedContacts[0];
      dispatch({
        type: 'openEditModal',
        client,
        formData: {
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
        },
        contactsExpanded: hydratedContacts.length > 1,
      });
    },
    [canUpdateClients],
  );

  const setContacts = useCallback(
    (updater: (prev: ClientContact[]) => ClientContact[]) => {
      const current = normalizeContacts(formData.contacts);
      dispatch({ type: 'patchFormData', value: { contacts: updater(current) } });
    },
    [formData.contacts],
  );

  const addContact = useCallback(() => {
    dispatch({ type: 'addContact', clearContactsError: Boolean(errors.contacts) });
  }, [errors.contacts]);

  const updateContactDraft = useCallback(
    (field: keyof ClientContact, value: string) => {
      dispatch({ type: 'patchContactDraft', field, value });
      if (contactDraftError) dispatch({ type: 'setContactDraftError', value: null });
      if (errors.contacts) dispatch({ type: 'patchErrors', value: { contacts: '' } });
    },
    [contactDraftError, errors.contacts],
  );

  const saveContactDraft = useCallback(() => {
    if (!contactDraft) return;

    const normalizedDraft = normalizeContact(contactDraft);
    if (!normalizedDraft.fullName) {
      dispatch({ type: 'setContactDraftError', value: t('common:validation.required') });
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

    dispatch({ type: 'setContactDraft', value: null });
    dispatch({ type: 'setEditingContactIndex', value: null });
    dispatch({ type: 'setContactDraftError', value: null });
    if (errors.contacts) dispatch({ type: 'patchErrors', value: { contacts: '' } });
  }, [contactDraft, editingContactIndex, errors.contacts, setContacts, t]);

  const editContact = useCallback(
    (index: number) => {
      const target = normalizeContacts(formData.contacts)[index];
      if (!target) return;
      dispatch({
        type: 'editContact',
        contact: target,
        index,
        clearContactsError: Boolean(errors.contacts),
      });
    },
    [errors.contacts, formData.contacts],
  );

  const cancelContactDraft = useCallback(() => {
    dispatch({ type: 'cancelContactDraft' });
  }, []);

  const removeContact = useCallback(
    (index: number) => {
      setContacts((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
      if (editingContactIndex === index) {
        dispatch({ type: 'setContactDraft', value: null });
        dispatch({ type: 'setEditingContactIndex', value: null });
        dispatch({ type: 'setContactDraftError', value: null });
      } else if (editingContactIndex !== null && editingContactIndex > index) {
        dispatch({ type: 'setEditingContactIndex', value: editingContactIndex - 1 });
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
        dispatch({ type: 'setContactDraftError', value: t('common:validation.required') });
        dispatch({ type: 'setContactsExpanded', value: true });
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

    if (Object.keys(newErrors).length > 0) {
      dispatch({ type: 'setErrors', value: newErrors });
      return;
    }

    // On update, send `null` for empty optional text fields so the server
    // clears the column (clientUpdateBodySchema accepts string|null). On
    // create, send `undefined` so the key is stripped — clientCreateBodySchema
    // only accepts strings, and a missing key correctly defaults the column
    // to NULL.
    const emptySentinel: null | undefined = editingClient ? null : undefined;
    const payload: Partial<Client> = {
      name: trimmedName,
      type: formData.type,
      contacts: normalizedContacts,
      contactName: primaryContact?.fullName || emptySentinel,
      clientCode: trimmedClientCode,
      email: primaryContact?.email?.trim() || emptySentinel,
      phone: primaryContact?.phone?.trim() || emptySentinel,
      addressCountry: formData.addressCountry?.trim() || '',
      addressState: formData.addressState?.trim() || '',
      addressCap: formData.addressCap?.trim() || '',
      addressProvince: formData.addressProvince?.trim() || '',
      addressCivicNumber: formData.addressCivicNumber?.trim() || '',
      addressLine: formData.addressLine?.trim() || '',
      address: buildAddress(formData),
      description: formData.description?.trim() || emptySentinel,
      atecoCode: formData.atecoCode?.trim() || emptySentinel,
      website: formData.website?.trim() || emptySentinel,
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
      dispatch({ type: 'setIsModalOpen', value: false });
    } catch (err) {
      const message = (err as Error).message;
      if (
        message.toLowerCase().includes('fiscal code') ||
        message.toLowerCase().includes('vat number')
      ) {
        dispatch({ type: 'setErrors', value: { fiscalCode: message } });
      } else if (
        message.toLowerCase().includes('client id') ||
        message.toLowerCase().includes('client code')
      ) {
        dispatch({
          type: 'setErrors',
          value: { clientCode: t('common:validation.clientCodeUnique') },
        });
      } else {
        dispatch({ type: 'setErrors', value: { general: t('common:messages.errorOccurred') } });
      }
    }
  };

  const confirmDelete = useCallback((client: Client) => {
    dispatch({ type: 'confirmDelete', client });
  }, []);

  const handleDelete = async () => {
    if (!canDeleteClients || !clientToDelete) return;
    try {
      await onDeleteClient(clientToDelete.id);
    } finally {
      dispatch({ type: 'closeDeleteConfirm' });
    }
  };

  const handleModalClose = () => {
    dispatch({ type: 'closeModal' });
  };

  const canSubmit = editingClient ? canUpdateClients : canCreateClients;

  const openManageProfileOptions = (category: ClientProfileOptionCategory) => {
    if (!canUpdateClients) return;
    dispatch({ type: 'openManageProfileOptions', category });
  };

  const handleSaveProfileOption = async () => {
    if (!canUpdateClients) return;

    const trimmedValue = newProfileOptionValue.trim();
    if (!trimmedValue) {
      dispatch({ type: 'setProfileOptionError', value: t('common:validation.required') });
      return;
    }

    dispatch({ type: 'setIsSavingProfileOption', value: true });
    dispatch({ type: 'setProfileOptionError', value: null });

    try {
      if (editingProfileOption) {
        await onUpdateClientProfileOption(manageCategory, editingProfileOption.id, {
          value: trimmedValue,
          sortOrder: editingProfileOption.sortOrder,
        });
        if (formData[manageCategory] === editingProfileOption.value) {
          dispatch({ type: 'patchFormData', value: { [manageCategory]: trimmedValue } });
        }
      } else {
        await onCreateClientProfileOption(manageCategory, trimmedValue);
      }

      await loadProfileOptions();
      dispatch({ type: 'setEditingProfileOption', value: null });
      dispatch({ type: 'setNewProfileOptionValue', value: '' });
    } catch (err) {
      dispatch({
        type: 'setProfileOptionError',
        value: err instanceof Error ? err.message : t('common:messages.errorOccurred'),
      });
    } finally {
      dispatch({ type: 'setIsSavingProfileOption', value: false });
    }
  };

  const handleDeleteProfileOption = async (option: ClientProfileOption) => {
    if (!canUpdateClients) return;

    try {
      await onDeleteClientProfileOption(option.category, option.id);
      await loadProfileOptions();

      if (formData[option.category] === option.value) {
        dispatch({ type: 'patchFormData', value: { [option.category]: null } });
      }
    } catch (err) {
      dispatch({
        type: 'setProfileOptionError',
        value: err instanceof Error ? err.message : t('common:messages.errorOccurred'),
      });
    }
  };

  const handleEditProfileOption = (option: ClientProfileOption) => {
    if (!canUpdateClients) return;

    dispatch({ type: 'setEditingProfileOption', value: option });
    dispatch({ type: 'setNewProfileOptionValue', value: option.value });
    dispatch({ type: 'setProfileOptionError', value: null });
  };

  const handleCancelProfileOptionEdit = () => {
    dispatch({ type: 'setEditingProfileOption', value: null });
    dispatch({ type: 'setNewProfileOptionValue', value: '' });
    dispatch({ type: 'setProfileOptionError', value: null });
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
                    aria-label={t('common:buttons.edit')}
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
                    aria-label={t('common:buttons.delete')}
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
            <span className="text-xs text-slate-500 whitespace-nowrap">
              {formatInsertDate(row.createdAt, language)}
            </span>
          );
        },
        filterFormat: (value) => {
          const timestamp = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return '-';
          }
          return formatInsertDate(timestamp, language);
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
              {formatNumber(value, {
                style: 'currency',
                currency: 'EUR',
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}
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
              {formatNumber(value, {
                style: 'currency',
                currency: 'EUR',
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}
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
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(row);
                      }}
                      aria-label={t('common:buttons.edit')}
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
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canUpdateClients) return;
                      onUpdateClient(row.id, { isDisabled: !row.isDisabled });
                    }}
                    disabled={!canUpdateClients}
                    aria-label={
                      row.isDisabled ? t('common:buttons.enable') : t('crm:clients.disableClient')
                    }
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
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(row);
                      }}
                      aria-label={t('common:buttons.delete')}
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

  const contactTableRows = allContacts.reduce<
    Array<(typeof allContacts)[number] & { contactIndex: number }>
  >((rows, contact, contactIndex) => {
    if (contact.fullName || contact.role || contact.email || contact.phone) {
      rows.push({ ...contact, contactIndex });
    }
    return rows;
  }, []);

  const manageCategoryLabels: Record<ClientProfileOptionCategory, string> = {
    sector: t('crm:clients.sector'),
    numberOfEmployees: t('crm:clients.numberOfEmployees'),
    revenue: t('crm:clients.revenue'),
    officeCountRange: t('crm:clients.officeCountRange'),
  };

  return {
    canCreateClients,
    canSubmit,
    canUpdateClients,
    clientToDelete,
    clients,
    columns,
    contactColumns,
    contactDraft,
    contactDraftError,
    contactTableRows,
    contactsExpanded,
    dispatch,
    editingClient,
    editingContactIndex,
    editingProfileOption,
    errors,
    formData,
    handleCancelProfileOptionEdit,
    handleDelete,
    handleDeleteProfileOption,
    handleEditProfileOption,
    handleModalClose,
    handleSaveProfileOption,
    handleSubmit,
    isDeleteConfirmOpen,
    isLoadingProfileOptions,
    isManageProfileOptionModalOpen,
    isBulkCreateModalOpen,
    isWorkbookImportModalOpen,
    isModalOpen,
    isSavingProfileOption,
    manageCategory,
    manageCategoryLabels,
    newProfileOptionValue,
    numberOfEmployeesOptions,
    officeCountRangeOptions,
    onAddClientsBulk,
    openAddModal,
    openEditModal,
    openManageProfileOptions,
    profileOptionError,
    profileOptions,
    downloadClientImportTemplate,
    revenueOptions,
    sectorOptions,
    t,
    typeOptions,
    addContact,
    cancelContactDraft,
    saveContactDraft,
    updateContactDraft,
  };
};

type ClientsController = ReturnType<typeof useClientsController>;

const ClientsView: React.FC<ClientsViewProps> = (props) => {
  const controller = useClientsController(props);
  return <ClientsLayout controller={controller} />;
};

const ClientsLayout: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <div className="space-y-8">
    {controller.isBulkCreateModalOpen && (
      <ClientBulkCreateDialog
        profileOptions={controller.profileOptions}
        onCreateBulk={controller.onAddClientsBulk}
        onClose={() => controller.dispatch({ type: 'setIsBulkCreateModalOpen', value: false })}
      />
    )}
    {controller.isWorkbookImportModalOpen && (
      <ClientWorkbookImportDialog
        profileOptions={controller.profileOptions}
        onCreateBulk={controller.onAddClientsBulk}
        onDownloadTemplate={controller.downloadClientImportTemplate}
        onClose={() => controller.dispatch({ type: 'setIsWorkbookImportModalOpen', value: false })}
      />
    )}
    <ClientProfileOptionsModal controller={controller} />
    <ClientFormModal controller={controller} />
    <ClientDeleteDialog controller={controller} />
    <ClientsHeader controller={controller} />
    <StandardTable<Client>
      title={controller.t('crm:clients.clientsDirectory')}
      viewKey="clients.directory"
      data={controller.clients}
      columns={controller.columns}
      defaultRowsPerPage={10}
      onRowClick={controller.canUpdateClients ? controller.openEditModal : undefined}
      rowClassName={(row) => (row.isDisabled ? 'opacity-70 grayscale hover:grayscale-0' : '')}
    />
  </div>
);

const ClientProfileOptionsModal: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <Modal
    isOpen={controller.isManageProfileOptionModalOpen}
    onClose={() => controller.dispatch({ type: 'setIsManageProfileOptionModalOpen', value: false })}
    zIndex={70}
  >
    <ModalContent size="2xl">
      <ModalHeader>
        <ModalTitle className="gap-3">
          <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
            <i className="fa-solid fa-gear" aria-hidden="true"></i>
          </span>
          {controller.t('crm:clients.manageValuesTitle', {
            field: controller.manageCategoryLabels[controller.manageCategory],
          })}
        </ModalTitle>
        <ModalCloseButton
          onClick={() =>
            controller.dispatch({ type: 'setIsManageProfileOptionModalOpen', value: false })
          }
        />
      </ModalHeader>
      <ModalBody className="max-h-[60vh] space-y-4">
        <ClientProfileOptionEditor controller={controller} />
        <ClientProfileOptionsTable controller={controller} />
      </ModalBody>
    </ModalContent>
  </Modal>
);

const ClientProfileOptionEditor: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
    <Field>
      <FieldLabel htmlFor="client-profile-option-value">
        {controller.t('crm:clients.value')}
      </FieldLabel>
      <Input
        id="client-profile-option-value"
        type="text"
        value={controller.newProfileOptionValue}
        onChange={(event) =>
          controller.dispatch({ type: 'setNewProfileOptionValue', value: event.target.value })
        }
        placeholder={controller.t('crm:clients.valuePlaceholder')}
        onKeyDown={(event) => event.key === 'Enter' && void controller.handleSaveProfileOption()}
      />
    </Field>
    {controller.profileOptionError && (
      <FieldError className="text-xs">{controller.profileOptionError}</FieldError>
    )}
    <div className="flex justify-end gap-2">
      {controller.editingProfileOption && (
        <Button type="button" variant="outline" onClick={controller.handleCancelProfileOptionEdit}>
          {controller.t('common:buttons.cancel')}
        </Button>
      )}
      <Button
        type="button"
        onClick={() => void controller.handleSaveProfileOption()}
        disabled={controller.isSavingProfileOption || !controller.newProfileOptionValue.trim()}
      >
        {controller.isSavingProfileOption
          ? controller.t('common:buttons.saving')
          : controller.editingProfileOption
            ? controller.t('common:buttons.update')
            : controller.t('common:buttons.add')}
      </Button>
    </div>
  </div>
);

const ClientProfileOptionsTable: React.FC<{ controller: ClientsController }> = ({ controller }) => {
  const columns = useMemo<Column<ClientProfileOption>[]>(
    () => [
      {
        header: controller.t('crm:clients.value'),
        accessorKey: 'value',
        disableFiltering: true,
        cell: ({ row }) => <span className="font-bold text-zinc-700">{row.value}</span>,
      },
      {
        header: controller.t('crm:clients.usedByClients'),
        id: 'usageCount',
        accessorFn: (row) => row.usageCount,
        disableFiltering: true,
        cell: ({ row }) => <span className="text-xs text-zinc-400">{row.usageCount}</span>,
      },
      {
        header: controller.t('common:labels.actions'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row: option }) => (
          <ClientProfileOptionActions controller={controller} option={option} />
        ),
      },
    ],
    [controller],
  );

  if (controller.isLoadingProfileOptions) {
    return (
      <div className="flex items-center justify-center py-8">
        <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
      </div>
    );
  }

  return (
    <StandardTable<ClientProfileOption>
      title={controller.t('crm:clients.manageValues')}
      data={controller.profileOptions[controller.manageCategory]}
      defaultRowsPerPage={5}
      containerClassName="shadow-none border-border rounded-2xl"
      tableContainerClassName="max-h-[35vh] overflow-y-auto"
      emptyState={
        <div className="text-center py-6 text-muted-foreground">
          <p>{controller.t('crm:clients.noValues')}</p>
        </div>
      }
      columns={columns}
    />
  );
};

const ClientProfileOptionActions: React.FC<{
  controller: ClientsController;
  option: ClientProfileOption;
}> = ({ controller, option }) => {
  const isDeleteBlocked = option.usageCount > 0;
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <button
              type="button"
              onClick={() => controller.handleEditProfileOption(option)}
              aria-label={controller.t('common:buttons.edit')}
              className="p-1.5 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-colors"
            >
              <i className="fa-solid fa-pen"></i>
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{controller.t('common:buttons.edit')}</TooltipContent>
      </Tooltip>
      <Tooltip disabled={!isDeleteBlocked}>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <button
              type="button"
              onClick={() => void controller.handleDeleteProfileOption(option)}
              disabled={isDeleteBlocked}
              aria-label={controller.t('common:buttons.delete')}
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
            ? controller.t('crm:clients.deleteProfileOptionBlocked', {
                count: option.usageCount,
              })
            : ''}
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

const ClientFormModal: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <Modal isOpen={controller.isModalOpen} onClose={controller.handleModalClose}>
    <ModalContent size="6xl" className="max-h-[90vh]">
      <form onSubmit={controller.handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
        <ModalHeader>
          <ModalTitle className="gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
              <i
                className={`fa-solid ${controller.editingClient ? 'fa-pen-to-square' : 'fa-plus'}`}
                aria-hidden="true"
              ></i>
            </span>
            {controller.editingClient
              ? controller.t('crm:clients.editClient')
              : controller.t('crm:clients.addClient')}
          </ModalTitle>
          <ModalCloseButton onClick={controller.handleModalClose} />
        </ModalHeader>
        <ModalBody className="flex-1 space-y-8">
          <ClientIdentifyingSection controller={controller} />
          <ClientContactsSection controller={controller} />
          <ClientFiscalSection controller={controller} />
          <ClientCompanyProfileSection controller={controller} />
          <ClientGeneralError controller={controller} />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={controller.handleModalClose}>
            {controller.t('common:buttons.cancel')}
          </Button>
          <Button type="submit" disabled={!controller.canSubmit}>
            {controller.editingClient
              ? controller.t('common:buttons.update')
              : controller.t('common:buttons.save')}
          </Button>
        </ModalFooter>
      </form>
    </ModalContent>
  </Modal>
);

const ClientSectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-xs font-semibold text-praetor uppercase tracking-widest flex items-center gap-2">
    <span className="size-1.5 rounded-full bg-praetor"></span>
    {children}
  </h4>
);

const ClientTextField: React.FC<{
  controller: ClientsController;
  field: keyof Client;
  label: string;
  placeholder?: string;
  required?: boolean;
  errorKey?: string;
  type?: string;
  value?: string;
}> = ({
  controller,
  field,
  label,
  placeholder,
  required,
  errorKey = String(field),
  type = 'text',
  value,
}) => {
  const inputId = useId();
  const error = controller.errors[errorKey];
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={inputId} className="text-xs font-bold text-muted-foreground ml-1">
        {label} {required && <RequiredMark />}
      </FieldLabel>
      <Input
        id={inputId}
        type={type}
        value={value ?? String(controller.formData[field] ?? '')}
        onChange={(event) => {
          controller.dispatch({ type: 'patchFormData', value: { [field]: event.target.value } });
          if (error) controller.dispatch({ type: 'patchErrors', value: { [errorKey]: '' } });
        }}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
      />
      {error && <p className="text-red-500 text-[10px] font-bold ml-1">{error}</p>}
    </div>
  );
};

const ClientIdentifyingSection: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <div className="space-y-4">
    <ClientSectionTitle>{controller.t('crm:clients.identifyingData')}</ClientSectionTitle>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ClientTextField
        controller={controller}
        field="clientCode"
        label={controller.t('crm:clients.clientCode')}
        placeholder={controller.t('crm:clients.clientCodePlaceholder')}
        required
      />
      <ClientTextField
        controller={controller}
        field="name"
        label={controller.t('crm:clients.name')}
        placeholder={controller.t('crm:clients.namePlaceholder')}
        required
      />
      <div className="space-y-1.5">
        <FieldLabel
          htmlFor="client-identifying-type"
          className="text-xs font-bold text-muted-foreground ml-1"
        >
          {controller.t('crm:clients.clientType')}
        </FieldLabel>
        <SelectControl
          id="client-identifying-type"
          options={controller.typeOptions}
          value={controller.formData.type || 'company'}
          onChange={(value) =>
            controller.dispatch({
              type: 'patchFormData',
              value: { type: (value as Client['type']) || 'company' },
            })
          }
          searchable={false}
        />
      </div>
    </div>
  </div>
);

const ClientContactsSection: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <div className="space-y-4">
    <ClientSectionTitle>{controller.t('crm:clients.contacts')}</ClientSectionTitle>
    {controller.errors.contacts && (
      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-600 dark:text-red-300 text-xs font-bold">
        {controller.errors.contacts}
      </div>
    )}
    <ClientAddressFields controller={controller} />
    <ClientContactsList controller={controller} />
  </div>
);

const ClientAddressFields: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <ClientTextField
      controller={controller}
      field="website"
      label={controller.t('crm:clients.website')}
      placeholder={controller.t('crm:clients.websitePlaceholder')}
    />
    <ClientTextField
      controller={controller}
      field="addressCountry"
      label={controller.t('crm:clients.country')}
      placeholder={controller.t('crm:clients.countryPlaceholder')}
    />
    <ClientTextField
      controller={controller}
      field="addressState"
      label={controller.t('crm:clients.state')}
      placeholder={controller.t('crm:clients.statePlaceholder')}
    />
    <ClientTextField
      controller={controller}
      field="addressCap"
      label={controller.t('crm:clients.cap')}
      placeholder={controller.t('crm:clients.capPlaceholder')}
    />
    <ClientTextField
      controller={controller}
      field="addressProvince"
      label={controller.t('crm:clients.province')}
      placeholder={controller.t('crm:clients.provincePlaceholder')}
    />
    <ClientTextField
      controller={controller}
      field="addressCivicNumber"
      label={controller.t('crm:clients.civicNumber')}
      placeholder={controller.t('crm:clients.civicNumberPlaceholder')}
    />
    <div className="col-span-full">
      <ClientTextField
        controller={controller}
        field="addressLine"
        label={controller.t('crm:clients.address')}
        placeholder={controller.t('crm:clients.addressPlaceholder')}
      />
    </div>
  </div>
);

const ClientContactsList: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <div className="space-y-3 pt-2">
    <div className="flex justify-between items-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => controller.dispatch({ type: 'toggleContactsExpanded' })}
        className="gap-2 text-xs font-semibold uppercase tracking-wide"
      >
        <i
          className={`fa-solid fa-chevron-${controller.contactsExpanded ? 'up' : 'down'} text-[10px]`}
        ></i>
        {controller.t('crm:clients.contactsList')} ({controller.contactTableRows.length})
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={controller.addContact}
        className="gap-2"
      >
        <i className="fa-solid fa-plus"></i>
        {controller.t('crm:clients.addContact')}
      </Button>
    </div>
    {controller.contactsExpanded && (
      <div className="space-y-4">
        {controller.contactDraft && <ClientContactDraftForm controller={controller} />}
        <StandardTable<ContactTableRow>
          title={controller.t('crm:clients.contactsList')}
          data={controller.contactTableRows}
          columns={controller.contactColumns}
          defaultRowsPerPage={5}
          containerClassName="shadow-none border-border rounded-2xl"
          tableContainerClassName="max-h-[35vh] overflow-y-auto"
        />
      </div>
    )}
  </div>
);

const ClientContactDraftForm: React.FC<{ controller: ClientsController }> = ({ controller }) => {
  const draft = controller.contactDraft;
  if (!draft) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-xl border border-border">
      <ClientContactDraftField
        label={controller.t('crm:clients.fullName')}
        value={draft.fullName}
        placeholder={controller.t('crm:clients.fullNamePlaceholder')}
        required
        error={controller.contactDraftError}
        onChange={(value) => controller.updateContactDraft('fullName', value)}
      />
      <ClientContactDraftField
        label={controller.t('crm:clients.role')}
        value={draft.role || ''}
        placeholder={controller.t('crm:clients.rolePlaceholder')}
        onChange={(value) => controller.updateContactDraft('role', value)}
      />
      <ClientContactDraftField
        label={controller.t('crm:clients.email')}
        value={draft.email || ''}
        placeholder={controller.t('crm:clients.email')}
        type="email"
        onChange={(value) => controller.updateContactDraft('email', value)}
      />
      <ClientContactDraftField
        label={controller.t('crm:clients.phone')}
        value={draft.phone || ''}
        placeholder={controller.t('crm:clients.phone')}
        onChange={(value) => controller.updateContactDraft('phone', value)}
      />
      <div className="col-span-full flex items-center justify-between">
        <div>
          {controller.contactDraftError && (
            <p className="text-red-500 text-[10px] font-bold ml-1">
              {controller.contactDraftError}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={controller.cancelContactDraft}>
            {controller.t('common:buttons.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={controller.saveContactDraft}>
            {controller.editingContactIndex !== null
              ? controller.t('common:buttons.update')
              : controller.t('common:buttons.save')}
          </Button>
        </div>
      </div>
    </div>
  );
};

const ClientContactDraftField: React.FC<{
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | null;
  type?: string;
}> = ({ label, value, placeholder, onChange, required, error, type = 'text' }) => {
  const inputId = useId();
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={inputId} className="text-xs font-bold text-muted-foreground ml-1">
        {label} {required && <RequiredMark />}
      </FieldLabel>
      <Input
        id={inputId}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
      />
    </div>
  );
};

const ClientFiscalSection: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <div className="space-y-4">
    <ClientSectionTitle>{controller.t('crm:clients.adminFiscal')}</ClientSectionTitle>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ClientTextField
        controller={controller}
        field="fiscalCode"
        label={controller.t('crm:clients.fiscalCode')}
        placeholder={controller.t('crm:clients.fiscalCodePlaceholder')}
        required
      />
      <ClientTextField
        controller={controller}
        field="atecoCode"
        label={controller.t('crm:clients.atecoCode')}
        placeholder={controller.t('crm:clients.atecoCodePlaceholder')}
      />
    </div>
  </div>
);

const ClientCompanyProfileSection: React.FC<{ controller: ClientsController }> = ({
  controller,
}) => (
  <div className="space-y-4">
    <ClientSectionTitle>{controller.t('crm:clients.companyProfile')}</ClientSectionTitle>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ClientProfileSelectField
        controller={controller}
        field="sector"
        label={controller.t('crm:clients.sector')}
        options={controller.sectorOptions}
      />
      <ClientProfileSelectField
        controller={controller}
        field="numberOfEmployees"
        label={controller.t('crm:clients.numberOfEmployees')}
        options={controller.numberOfEmployeesOptions}
      />
      <ClientProfileSelectField
        controller={controller}
        field="revenue"
        label={controller.t('crm:clients.revenue')}
        options={controller.revenueOptions}
      />
      <ClientProfileSelectField
        controller={controller}
        field="officeCountRange"
        label={controller.t('crm:clients.officeCountRange')}
        options={controller.officeCountRangeOptions}
      />
      <div className="col-span-full space-y-1.5">
        <FieldLabel
          htmlFor="client-profile-description"
          className="text-xs font-bold text-muted-foreground ml-1"
        >
          {controller.t('crm:clients.description')}
        </FieldLabel>
        <Textarea
          id="client-profile-description"
          rows={3}
          value={controller.formData.description ?? ''}
          onChange={(event) =>
            controller.dispatch({
              type: 'patchFormData',
              value: { description: event.target.value },
            })
          }
          placeholder={controller.t('crm:clients.description')}
          className="resize-none"
        />
      </div>
    </div>
  </div>
);

const ClientProfileSelectField: React.FC<{
  controller: ClientsController;
  field: ClientProfileOptionCategory;
  label: string;
  options: Array<{ id: string; name: string }>;
}> = ({ controller, field, label, options }) => (
  <div className="space-y-1.5">
    <div className="flex items-end justify-between ml-1 min-h-5">
      <FieldLabel
        htmlFor={`client-profile-${field}`}
        className="text-xs font-bold text-muted-foreground"
      >
        {label}
      </FieldLabel>
      {controller.canUpdateClients && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => controller.openManageProfileOptions(field)}
          className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          <i className="fa-solid fa-gear"></i> {controller.t('common:buttons.manage')}
        </Button>
      )}
    </div>
    <SelectControl
      id={`client-profile-${field}`}
      options={options}
      value={(controller.formData[field] as string | undefined) || ''}
      onChange={(value) =>
        controller.dispatch({
          type: 'patchFormData',
          value: { [field]: (value as string) || null },
        })
      }
      placeholder={controller.t('common:form.selectOption')}
      searchable={false}
    />
  </div>
);

const ClientGeneralError: React.FC<{ controller: ClientsController }> = ({ controller }) => {
  if (!controller.errors.general) return null;
  return (
    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3 text-red-600 dark:text-red-300">
      <i className="fa-solid fa-circle-exclamation text-lg"></i>
      <p className="text-sm font-bold">{controller.errors.general}</p>
    </div>
  );
};

const ClientDeleteDialog: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <DeleteConfirmModal
    isOpen={controller.isDeleteConfirmOpen}
    onClose={() => controller.dispatch({ type: 'setIsDeleteConfirmOpen', value: false })}
    onConfirm={() => {
      void controller.handleDelete();
    }}
    title={controller.t('crm:clients.deleteClient')}
    description={`${controller.t('common:messages.deleteConfirmNamed', {
      name: controller.clientToDelete?.name,
    })}${controller.t('crm:clients.deleteConfirm')}`}
  />
);

const ClientsHeader: React.FC<{ controller: ClientsController }> = ({ controller }) => (
  <div className="space-y-4">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">
          {controller.t('crm:clients.title')}
        </h2>
        <p className="text-muted-foreground text-sm">{controller.t('crm:clients.subtitle')}</p>
      </div>
      {controller.canCreateClients && (
        <ButtonGroup>
          <Button
            type="button"
            onClick={controller.openAddModal}
            className="h-auto rounded-lg px-5 py-2.5 has-[>svg]:px-5"
          >
            <Plus data-icon="inline-start" />
            {controller.t('crm:clients.addClient')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                aria-label={controller.t('crm:clients.bulk.addOptions')}
                className="h-auto rounded-lg px-3 py-2.5"
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-64">
              <DropdownMenuItem
                onSelect={() =>
                  controller.dispatch({ type: 'setIsBulkCreateModalOpen', value: true })
                }
              >
                <Rows3 aria-hidden="true" />
                {controller.t('crm:clients.bulk.addMultiple')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  controller.dispatch({ type: 'setIsWorkbookImportModalOpen', value: true })
                }
              >
                <FileSpreadsheet aria-hidden="true" />
                {controller.t('crm:clients.bulk.importExcel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      )}
    </div>
  </div>
);

export default ClientsView;
