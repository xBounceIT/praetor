import {
  BarChart3,
  Bell,
  BookOpen,
  Calculator,
  Clock,
  FileText,
  FolderTree,
  Handshake,
  type LucideIcon,
  PackageOpen,
  Pen,
  Settings,
  Sliders,
  Trash2,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';
import type React from 'react';
import { useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Role } from '../../types';
import {
  ALWAYS_GRANTED_MODULES,
  buildPermission,
  formatPermissionLabel,
  hasPermission,
  isTopManagerOnlyPermission,
  PERMISSION_DEFINITIONS,
  type PermissionAction,
  ROLE_EDITOR_EXCLUDED_MODULES,
  TOP_MANAGER_ROLE_ID,
  toTitleCase,
} from '../../utils/permissions';
import { toastError } from '../../utils/toast';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import HeaderAddButton from '../shared/HeaderAddButton';
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

export interface RolesViewProps {
  roles: Role[];
  permissions: string[];
  onCreateRole: (name: string, permissions: string[]) => Promise<void>;
  onRenameRole: (id: string, name: string) => Promise<void>;
  onUpdateRolePermissions: (id: string, permissions: string[]) => Promise<void>;
  onDeleteRole: (id: string) => Promise<void>;
}

const MODULE_ICONS: Record<string, LucideIcon> = {
  timesheets: Clock,
  crm: Handshake,
  sales: FileText,
  catalog: PackageOpen,
  projects: FolderTree,
  accounting: Calculator,
  hr: Users,
  reports: BarChart3,
  administration: Settings,
  suppliers: Truck,
  settings: Sliders,
  docs: BookOpen,
  notifications: Bell,
};

const ALWAYS_GRANTED_PERMISSIONS = PERMISSION_DEFINITIONS.flatMap((def) =>
  ALWAYS_GRANTED_MODULES.includes(def.module)
    ? def.actions.map((action) => buildPermission(def.id, action))
    : [],
);
const isAdministrationPermission = (permission: string) =>
  permission.startsWith('administration.') || permission.startsWith('configuration.');
const isPermissionEditableForRole = (permission: string, roleId: string | null = null) =>
  !isAdministrationPermission(permission) &&
  (!isTopManagerOnlyPermission(permission) || roleId === TOP_MANAGER_ROLE_ID);
const sanitizeEditableRolePermissions = (rolePermissions: string[], roleId: string | null = null) =>
  rolePermissions.filter((permission) => isPermissionEditableForRole(permission, roleId));

type PermissionDefinition = (typeof PERMISSION_DEFINITIONS)[number];

interface RoleCardActionProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

const RoleCardAction: React.FC<RoleCardActionProps> = ({
  icon,
  label,
  onClick,
  destructive = false,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        aria-label={label}
        className={
          destructive
            ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
            : undefined
        }
      >
        {icon}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

interface PermissionTabsProps {
  activeModuleTab: string;
  groupedPermissions: Record<string, typeof PERMISSION_DEFINITIONS>;
  moduleOrder: string[];
  selectedPermissionSet: ReadonlySet<string>;
  actionLabel: (action: PermissionAction) => string;
  onActiveModuleTabChange: (module: string) => void;
  onTogglePermission: (permission: string) => void;
  onToggleAllForDefinition: (definition: PermissionDefinition) => void;
  t: ReturnType<typeof useTranslation>['t'];
}

const PermissionTabs = ({
  activeModuleTab,
  groupedPermissions,
  moduleOrder,
  selectedPermissionSet,
  actionLabel,
  onActiveModuleTabChange,
  onTogglePermission,
  onToggleAllForDefinition,
  t,
}: PermissionTabsProps) => (
  <Tabs
    value={activeModuleTab}
    onValueChange={onActiveModuleTabChange}
    orientation="vertical"
    className="flex max-h-[60vh] flex-row gap-0 overflow-hidden rounded-xl border border-border bg-card"
  >
    <div className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/40">
      <TabsList
        variant="line"
        className="w-full min-h-0 flex-1 flex-col items-stretch justify-start gap-1 overflow-y-auto rounded-none bg-transparent p-2"
      >
        {moduleOrder.map((module) => {
          const Icon = MODULE_ICONS[module];
          return (
            <TabsTrigger
              key={module}
              value={module}
              className="justify-start gap-3 px-3 py-2 text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              {Icon ? <Icon className="size-4" /> : null}
              <span className="truncate text-left">
                {t(`layout:modules.${module}`, { defaultValue: toTitleCase(module) })}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </div>

    <div className="flex-1 overflow-y-auto bg-background">
      {moduleOrder.map((module) => {
        const currentDefinitions = groupedPermissions[module] || [];
        const currentActions = getModuleActions(currentDefinitions);
        if (currentDefinitions.length === 0) return null;
        return (
          <TabsContent key={module} value={module} className="mt-0">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[200px] px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('common:labels.name')}
                  </TableHead>
                  {currentActions.map((action) => (
                    <TableHead
                      key={action}
                      className="w-20 px-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {actionLabel(action)}
                    </TableHead>
                  ))}
                  <TableHead className="w-28 px-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('common:table.selectAll')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentDefinitions.map((definition) => {
                  const definitionLabel = t(`administration:permissions.${definition.id}`, {
                    defaultValue: formatPermissionLabel(definition.id),
                  });
                  const isAllSelected = definition.actions.every((action) =>
                    selectedPermissionSet.has(buildPermission(definition.id, action)),
                  );

                  return (
                    <TableRow key={definition.id}>
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {definitionLabel}
                          </span>
                          {definition.isScope && (
                            <Badge
                              variant="secondary"
                              className="px-1.5 py-0 text-[10px] uppercase tracking-wider"
                            >
                              {t('administration:roles.scope')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {currentActions.map((action) => {
                        const permission = buildPermission(definition.id, action);
                        const isAvailable = definition.actions.includes(action);

                        if (!isAvailable) {
                          return (
                            <TableCell
                              key={action}
                              className="px-2 py-3 text-center text-muted-foreground/40"
                            >
                              {t('common:table.empty')}
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell key={action} className="px-2 py-3 text-center">
                            <Checkbox
                              checked={selectedPermissionSet.has(permission)}
                              onCheckedChange={() => onTogglePermission(permission)}
                              aria-label={`${definitionLabel} - ${actionLabel(action)}`}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="px-4 py-3 text-center">
                        <Switch
                          checked={isAllSelected}
                          onCheckedChange={() => onToggleAllForDefinition(definition)}
                          aria-label={`${definitionLabel} - ${t('common:table.selectAll')}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TabsContent>
        );
      })}
    </div>
  </Tabs>
);

const getModuleActions = (definitions: readonly PermissionDefinition[]): PermissionAction[] => {
  const actionsSet = new Set<PermissionAction>();
  definitions.forEach((def) => {
    def.actions.forEach((action) => {
      actionsSet.add(action);
    });
  });
  const canonicalOrder: PermissionAction[] = ['view', 'create', 'update', 'delete'];
  return canonicalOrder.filter((action) => actionsSet.has(action));
};

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

const initialRolesViewState: RolesViewState = {
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

const rolesViewReducer = (state: RolesViewState, action: RolesViewAction): RolesViewState => {
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
  }
};

const RolesGrid: React.FC<{
  roles: Role[];
  canUpdateRoles: boolean;
  canDeleteRoles: boolean;
  onRename: (role: Role) => void;
  onEditPermissions: (role: Role) => void;
  onDelete: (role: Role) => void;
}> = ({ roles, canUpdateRoles, canDeleteRoles, onRename, onEditPermissions, onDelete }) => {
  const { t } = useTranslation(['common', 'administration']);

  if (roles.length === 0) {
    return (
      <Empty className="border border-dashed border-border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserCog />
          </EmptyMedia>
          <EmptyTitle>{t('common:emptyStates.noItems')}</EmptyTitle>
          <EmptyDescription>{t('administration:roles.subtitle')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {roles.map((role) => {
        const canRenameRole = canUpdateRoles && !role.isAdmin && !role.isSystem;
        const canEditPermissions = canUpdateRoles && !role.isAdmin;
        const canRemoveRole = canDeleteRoles && !role.isAdmin && !role.isSystem;
        const hasAnyAction = canRenameRole || canEditPermissions || canRemoveRole;
        const hasBadges = role.isSystem || role.isAdmin;

        return (
          <Card key={role.id} className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-base">
                <UserCog aria-hidden="true" className="size-5 text-muted-foreground" />
                {role.name}
              </CardTitle>
              {hasBadges && (
                <CardDescription className="flex flex-wrap gap-1.5">
                  {role.isSystem && (
                    <Badge variant="secondary">{t('administration:roles.badges.system')}</Badge>
                  )}
                  {role.isAdmin && (
                    <Badge variant="default">{t('administration:roles.badges.admin')}</Badge>
                  )}
                </CardDescription>
              )}
              {hasAnyAction && (
                <CardAction className="flex gap-1">
                  {canRenameRole && (
                    <RoleCardAction
                      icon={<Pen />}
                      label={t('common:buttons.edit')}
                      onClick={() => onRename(role)}
                    />
                  )}
                  {canEditPermissions && (
                    <RoleCardAction
                      icon={<Pen />}
                      label={t('administration:roles.editPermissions')}
                      onClick={() => onEditPermissions(role)}
                    />
                  )}
                  {canRemoveRole && (
                    <RoleCardAction
                      icon={<Trash2 />}
                      label={t('common:buttons.delete')}
                      onClick={() => onDelete(role)}
                      destructive
                    />
                  )}
                </CardAction>
              )}
            </CardHeader>

            <CardFooter className="border-t text-sm text-muted-foreground">
              {t('administration:roles.permissionCount', {
                count: role.permissions?.length || 0,
              })}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
};

type RolePermissionTabsProps = Pick<
  PermissionTabsProps,
  | 'activeModuleTab'
  | 'groupedPermissions'
  | 'moduleOrder'
  | 'selectedPermissionSet'
  | 'actionLabel'
  | 'onActiveModuleTabChange'
  | 'onTogglePermission'
  | 'onToggleAllForDefinition'
>;

const RoleCreateModal: React.FC<
  RolePermissionTabsProps & {
    isOpen: boolean;
    roleName: string;
    formErrors: Record<string, string>;
    onClose: () => void;
    onSubmit: (event: React.FormEvent) => void;
    onRoleNameChange: (roleName: string) => void;
  }
> = ({
  isOpen,
  roleName,
  formErrors,
  activeModuleTab,
  groupedPermissions,
  moduleOrder,
  selectedPermissionSet,
  actionLabel,
  onClose,
  onSubmit,
  onRoleNameChange,
  onActiveModuleTabChange,
  onTogglePermission,
  onToggleAllForDefinition,
}) => {
  const { t } = useTranslation(['common', 'administration', 'layout']);

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="2xl" className="max-w-5xl">
          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <ModalHeader>
              <div>
                <ModalTitle>{t('administration:roles.createRole')}</ModalTitle>
                <ModalDescription>{t('administration:roles.createRoleSubtitle')}</ModalDescription>
              </div>
              <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalBody className="flex-1 space-y-6">
              <Field>
                <FieldLabel htmlFor="role-create-name">{t('common:labels.name')}</FieldLabel>
                <Input
                  id="role-create-name"
                  value={roleName}
                  onChange={(event) => onRoleNameChange(event.target.value)}
                  placeholder={t('common:form.placeholderName')}
                />
                {formErrors.name && <FieldError>{formErrors.name}</FieldError>}
              </Field>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-foreground">
                  {t('administration:roles.permissions')}
                </h4>
                <PermissionTabs
                  activeModuleTab={activeModuleTab}
                  groupedPermissions={groupedPermissions}
                  moduleOrder={moduleOrder}
                  selectedPermissionSet={selectedPermissionSet}
                  actionLabel={actionLabel}
                  onActiveModuleTabChange={onActiveModuleTabChange}
                  onTogglePermission={onTogglePermission}
                  onToggleAllForDefinition={onToggleAllForDefinition}
                  t={t}
                />
              </div>
              {formErrors.general && (
                <p className="text-sm font-medium text-destructive">{formErrors.general}</p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit">{t('common:buttons.create')}</Button>
            </ModalFooter>
          </form>
        </ModalContent>
      )}
    </Modal>
  );
};

const RoleRenameModal: React.FC<{
  isOpen: boolean;
  roleName: string;
  formErrors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onRoleNameChange: (roleName: string) => void;
}> = ({ isOpen, roleName, formErrors, onClose, onSubmit, onRoleNameChange }) => {
  const { t } = useTranslation(['common', 'administration']);

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="lg">
          <form onSubmit={onSubmit}>
            <ModalHeader>
              <div>
                <ModalTitle>{t('administration:roles.renameRole')}</ModalTitle>
                <ModalDescription>{t('administration:roles.renameRoleSubtitle')}</ModalDescription>
              </div>
              <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalBody className="space-y-4">
              <Field>
                <FieldLabel htmlFor="role-rename-name">{t('common:labels.name')}</FieldLabel>
                <Input
                  id="role-rename-name"
                  value={roleName}
                  onChange={(event) => onRoleNameChange(event.target.value)}
                  placeholder={t('common:form.placeholderName')}
                />
                {formErrors.name && <FieldError>{formErrors.name}</FieldError>}
              </Field>
              {formErrors.general && (
                <p className="text-sm font-medium text-destructive">{formErrors.general}</p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit">{t('common:buttons.update')}</Button>
            </ModalFooter>
          </form>
        </ModalContent>
      )}
    </Modal>
  );
};

const RolePermissionsModal: React.FC<
  RolePermissionTabsProps & {
    isOpen: boolean;
    roleName?: string;
    formErrors: Record<string, string>;
    onClose: () => void;
    onSave: () => void;
  }
> = ({
  isOpen,
  roleName,
  formErrors,
  activeModuleTab,
  groupedPermissions,
  moduleOrder,
  selectedPermissionSet,
  actionLabel,
  onClose,
  onSave,
  onActiveModuleTabChange,
  onTogglePermission,
  onToggleAllForDefinition,
}) => {
  const { t } = useTranslation(['common', 'administration', 'layout']);

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={null}>
      {() => (
        <ModalContent size="2xl" className="max-w-5xl">
          <ModalHeader>
            <div>
              <ModalTitle>{t('administration:roles.editPermissions')}</ModalTitle>
              <ModalDescription className="font-medium text-primary">{roleName}</ModalDescription>
            </div>
            <ModalCloseButton onClick={onClose} />
          </ModalHeader>
          <ModalBody className="flex-1 space-y-6">
            <PermissionTabs
              activeModuleTab={activeModuleTab}
              groupedPermissions={groupedPermissions}
              moduleOrder={moduleOrder}
              selectedPermissionSet={selectedPermissionSet}
              actionLabel={actionLabel}
              onActiveModuleTabChange={onActiveModuleTabChange}
              onTogglePermission={onTogglePermission}
              onToggleAllForDefinition={onToggleAllForDefinition}
              t={t}
            />
            {formErrors.general && (
              <p className="text-sm font-medium text-destructive">{formErrors.general}</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="button" onClick={onSave}>
              {t('common:buttons.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

const RolesView: React.FC<RolesViewProps> = ({
  roles,
  permissions,
  onCreateRole,
  onRenameRole,
  onUpdateRolePermissions,
  onDeleteRole,
}) => {
  const { t, i18n } = useTranslation(['common', 'layout', 'administration']);
  const [state, dispatch] = useReducer(rolesViewReducer, initialRolesViewState);
  const {
    isCreateOpen,
    isRenameOpen,
    isPermissionsOpen,
    isDeleteConfirmOpen,
    isDeleting,
    activeRole,
    roleName,
    selectedPermissions,
    formErrors,
    activeModuleTab,
  } = state;

  const selectedPermissionSet = useMemo(() => new Set(selectedPermissions), [selectedPermissions]);

  const editableDefinitions = useMemo(() => {
    return PERMISSION_DEFINITIONS.filter((definition) => {
      if (ROLE_EDITOR_EXCLUDED_MODULES.includes(definition.module)) return false;
      if (definition.id.startsWith('hr.work_units') && activeRole?.id !== TOP_MANAGER_ROLE_ID) {
        return false;
      }
      return true;
    });
  }, [activeRole?.id]);

  const { groupedPermissions, moduleOrder } = useMemo(() => {
    const grouped: Record<string, typeof PERMISSION_DEFINITIONS> = {};
    const order: string[] = [];
    editableDefinitions.forEach((definition) => {
      if (!grouped[definition.module]) {
        grouped[definition.module] = [];
        order.push(definition.module);
      }
      grouped[definition.module].push(definition);
    });
    const sortedOrder = order.toSorted((a, b) =>
      t(`layout:modules.${a}`, { defaultValue: toTitleCase(a) }).localeCompare(
        t(`layout:modules.${b}`, { defaultValue: toTitleCase(b) }),
        i18n.language,
      ),
    );
    return { groupedPermissions: grouped, moduleOrder: sortedOrder };
  }, [editableDefinitions, t, i18n.language]);

  const canCreateRoles = hasPermission(
    permissions,
    buildPermission('administration.roles', 'create'),
  );
  const canUpdateRoles = hasPermission(
    permissions,
    buildPermission('administration.roles', 'update'),
  );
  const canDeleteRoles = hasPermission(
    permissions,
    buildPermission('administration.roles', 'delete'),
  );

  const actionLabel = (action: PermissionAction) => {
    switch (action) {
      case 'create':
        return t('common:buttons.create');
      case 'update':
        return t('common:buttons.update');
      case 'delete':
        return t('common:buttons.delete');
      default:
        return t('common:buttons.view');
    }
  };

  const sortedRoles = useMemo(() => {
    return roles.toSorted((a, b) => a.name.localeCompare(b.name));
  }, [roles]);

  const openCreateModal = () => {
    if (!canCreateRoles) return;
    dispatch({ type: 'openCreate', firstModule: moduleOrder[0] || '' });
  };

  const openRenameModal = (role: Role) => {
    if (!canUpdateRoles || role.isAdmin || role.isSystem) return;
    dispatch({ type: 'openRename', role });
  };

  const openPermissionsModal = (role: Role) => {
    if (!canUpdateRoles || role.isAdmin) return;
    dispatch({
      type: 'openPermissions',
      role,
      permissions: sanitizeEditableRolePermissions(role.permissions || [], role.id),
      firstModule: moduleOrder[0] || '',
    });
  };

  const openDeleteModal = (role: Role) => {
    if (!canDeleteRoles || role.isAdmin || role.isSystem) return;
    dispatch({ type: 'openDelete', role });
  };

  const togglePermission = (permission: string) => {
    dispatch({
      type: 'setSelectedPermissions',
      permissions: selectedPermissions.includes(permission)
        ? selectedPermissions.filter((p) => p !== permission)
        : [...selectedPermissions, permission],
    });
  };

  const toggleAllForDefinition = (definition: (typeof PERMISSION_DEFINITIONS)[0]) => {
    const allPermissions = definition.actions.map((action) =>
      buildPermission(definition.id, action),
    );
    const allSelected = allPermissions.every((p) => selectedPermissionSet.has(p));
    if (allSelected) {
      const removeSet = new Set(allPermissions);
      dispatch({
        type: 'setSelectedPermissions',
        permissions: selectedPermissions.filter((p) => !removeSet.has(p)),
      });
    } else {
      dispatch({
        type: 'setSelectedPermissions',
        permissions: Array.from(new Set([...selectedPermissions, ...allPermissions])),
      });
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    dispatch({ type: 'setFormErrors', errors: {} });
    if (!roleName.trim()) {
      dispatch({ type: 'setFormErrors', errors: { name: t('common:validation.nameRequired') } });
      return;
    }
    try {
      const sanitizedPermissions = sanitizeEditableRolePermissions(selectedPermissions, null);
      const finalPermissions = Array.from(
        new Set([...sanitizedPermissions, ...ALWAYS_GRANTED_PERMISSIONS]),
      );
      await onCreateRole(roleName.trim(), finalPermissions);
      dispatch({ type: 'createSuccess' });
    } catch (err) {
      console.error('Failed to create role', err);
      dispatch({ type: 'setFormErrors', errors: { general: t('common:messages.errorOccurred') } });
    }
  };

  const handleRename = async (event: React.FormEvent) => {
    event.preventDefault();
    dispatch({ type: 'setFormErrors', errors: {} });
    if (!activeRole) return;
    if (!roleName.trim()) {
      dispatch({ type: 'setFormErrors', errors: { name: t('common:validation.nameRequired') } });
      return;
    }
    try {
      await onRenameRole(activeRole.id, roleName.trim());
      dispatch({ type: 'renameSuccess' });
    } catch (err) {
      console.error('Failed to rename role', err);
      dispatch({ type: 'setFormErrors', errors: { general: t('common:messages.errorOccurred') } });
    }
  };

  const handleUpdatePermissions = async () => {
    dispatch({ type: 'setFormErrors', errors: {} });
    if (!activeRole) return;
    try {
      const sanitizedPermissions = sanitizeEditableRolePermissions(
        selectedPermissions,
        activeRole.id,
      );
      const finalPermissions = Array.from(
        new Set([...sanitizedPermissions, ...ALWAYS_GRANTED_PERMISSIONS]),
      );
      await onUpdateRolePermissions(activeRole.id, finalPermissions);
      dispatch({ type: 'permissionsSuccess' });
    } catch (err) {
      console.error('Failed to update role permissions', err);
      dispatch({ type: 'setFormErrors', errors: { general: t('common:messages.errorOccurred') } });
    }
  };

  const handleDelete = async () => {
    if (!activeRole || isDeleting) return;
    dispatch({ type: 'setDeleting', isDeleting: true });
    try {
      await onDeleteRole(activeRole.id);
      dispatch({ type: 'deleteSuccess' });
    } catch (err) {
      console.error('Failed to delete role', err);
      toastError(t('common:messages.errorOccurred'));
    } finally {
      dispatch({ type: 'setDeleting', isDeleting: false });
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('administration:roles.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('administration:roles.subtitle')}</p>
        </div>
        {canCreateRoles && (
          <HeaderAddButton actionSize="wide" onClick={openCreateModal}>
            {t('common:buttons.create')}
          </HeaderAddButton>
        )}
      </div>

      <RolesGrid
        roles={sortedRoles}
        canUpdateRoles={canUpdateRoles}
        canDeleteRoles={canDeleteRoles}
        onRename={openRenameModal}
        onEditPermissions={openPermissionsModal}
        onDelete={openDeleteModal}
      />

      <RoleCreateModal
        isOpen={isCreateOpen}
        roleName={roleName}
        formErrors={formErrors}
        activeModuleTab={activeModuleTab}
        groupedPermissions={groupedPermissions}
        moduleOrder={moduleOrder}
        selectedPermissionSet={selectedPermissionSet}
        actionLabel={actionLabel}
        onClose={() => dispatch({ type: 'setCreateOpen', isOpen: false })}
        onSubmit={handleCreate}
        onRoleNameChange={(value) => dispatch({ type: 'setRoleName', roleName: value })}
        onActiveModuleTabChange={(tab) => dispatch({ type: 'setActiveModuleTab', tab })}
        onTogglePermission={togglePermission}
        onToggleAllForDefinition={toggleAllForDefinition}
      />

      <RoleRenameModal
        isOpen={isRenameOpen && !!activeRole}
        roleName={roleName}
        formErrors={formErrors}
        onClose={() => dispatch({ type: 'setRenameOpen', isOpen: false })}
        onSubmit={handleRename}
        onRoleNameChange={(value) => dispatch({ type: 'setRoleName', roleName: value })}
      />

      <RolePermissionsModal
        isOpen={isPermissionsOpen}
        roleName={activeRole?.name}
        formErrors={formErrors}
        activeModuleTab={activeModuleTab}
        groupedPermissions={groupedPermissions}
        moduleOrder={moduleOrder}
        selectedPermissionSet={selectedPermissionSet}
        actionLabel={actionLabel}
        onClose={() => dispatch({ type: 'setPermissionsOpen', isOpen: false })}
        onSave={handleUpdatePermissions}
        onActiveModuleTabChange={(tab) => dispatch({ type: 'setActiveModuleTab', tab })}
        onTogglePermission={togglePermission}
        onToggleAllForDefinition={toggleAllForDefinition}
      />

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen && !!activeRole}
        onClose={() => {
          if (isDeleting) return;
          dispatch({ type: 'setDeleteConfirmOpen', isOpen: false });
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title={t('administration:roles.deleteRole')}
        description={t('common:messages.deleteConfirmNamed', { name: activeRole?.name })}
      />
    </div>
  );
};

export default RolesView;
