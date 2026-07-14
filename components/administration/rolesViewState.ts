import type { Role } from '../../types';

type RolesViewState = {
  isCreateOpen: boolean;
  isRenameOpen: boolean;
  isPermissionsOpen: boolean;
  isDeleteConfirmOpen: boolean;
  isDeleting: boolean;
  activeRole: Role | null;
  roleName: string;
  selectedPermissions: string[];
  formErrors: Record<string, string>;
  activeModuleTab: string;
};

type RolesViewAction =
  | { type: 'openCreate'; firstModule: string }
  | { type: 'openRename'; role: Role }
  | { type: 'openPermissions'; role: Role; permissions: string[]; firstModule: string }
  | { type: 'openDelete'; role: Role }
  | { type: 'setCreateOpen'; isOpen: boolean }
  | { type: 'setRenameOpen'; isOpen: boolean }
  | { type: 'setPermissionsOpen'; isOpen: boolean }
  | { type: 'setDeleteConfirmOpen'; isOpen: boolean }
  | { type: 'setDeleting'; isDeleting: boolean }
  | { type: 'setRoleName'; roleName: string }
  | { type: 'setSelectedPermissions'; permissions: string[] }
  | { type: 'setFormErrors'; errors: Record<string, string> }
  | { type: 'setActiveModuleTab'; tab: string }
  | { type: 'createSuccess' }
  | { type: 'renameSuccess' }
  | { type: 'permissionsSuccess' }
  | { type: 'deleteSuccess' };

export const initialRolesViewState: RolesViewState = {
  isCreateOpen: false,
  isRenameOpen: false,
  isPermissionsOpen: false,
  isDeleteConfirmOpen: false,
  isDeleting: false,
  activeRole: null,
  roleName: '',
  selectedPermissions: [],
  formErrors: {},
  activeModuleTab: '',
};

export const rolesViewReducer = (
  state: RolesViewState,
  action: RolesViewAction,
): RolesViewState => {
  switch (action.type) {
    case 'openCreate':
      return {
        ...state,
        activeRole: null,
        roleName: '',
        selectedPermissions: [],
        formErrors: {},
        activeModuleTab: action.firstModule,
        isCreateOpen: true,
      };
    case 'openRename':
      return {
        ...state,
        activeRole: action.role,
        roleName: action.role.name,
        formErrors: {},
        isRenameOpen: true,
      };
    case 'openPermissions':
      return {
        ...state,
        activeRole: action.role,
        selectedPermissions: action.permissions,
        formErrors: {},
        activeModuleTab: action.firstModule,
        isPermissionsOpen: true,
      };
    case 'openDelete':
      return {
        ...state,
        activeRole: action.role,
        formErrors: {},
        isDeleteConfirmOpen: true,
      };
    case 'setCreateOpen':
      return { ...state, isCreateOpen: action.isOpen };
    case 'setRenameOpen':
      return { ...state, isRenameOpen: action.isOpen };
    case 'setPermissionsOpen':
      return { ...state, isPermissionsOpen: action.isOpen };
    case 'setDeleteConfirmOpen':
      return { ...state, isDeleteConfirmOpen: action.isOpen };
    case 'setDeleting':
      return { ...state, isDeleting: action.isDeleting };
    case 'setRoleName':
      return { ...state, roleName: action.roleName };
    case 'setSelectedPermissions':
      return { ...state, selectedPermissions: action.permissions };
    case 'setFormErrors':
      return { ...state, formErrors: action.errors };
    case 'setActiveModuleTab':
      return { ...state, activeModuleTab: action.tab };
    case 'createSuccess':
      return { ...state, isCreateOpen: false };
    case 'renameSuccess':
      return { ...state, isRenameOpen: false, activeRole: null };
    case 'permissionsSuccess':
      return { ...state, isPermissionsOpen: false, activeRole: null };
    case 'deleteSuccess':
      return { ...state, isDeleteConfirmOpen: false, activeRole: null };
    default:
      return state;
  }
};
