import { Loader2, Search, UserPlus } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../services/api/client';
import { ldapApi } from '../../services/api/ldap';
import type {
  LdapDirectoryUser,
  LdapUserImportResponse,
  LdapUserSearchResponse,
} from '../../types';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Field, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

type ImportState = {
  query: string;
  search: LdapUserSearchResponse | null;
  selected: string[];
  busy: 'search' | 'import' | null;
  error: string | null;
  result: LdapUserImportResponse | null;
};

export default function LdapUserImportCard({
  disabled,
  configured,
  onImported,
}: {
  disabled: boolean;
  configured: boolean;
  onImported?: () => void;
}) {
  const { t } = useTranslation('auth');
  const queryId = useId();
  const [state, setState] = useState<ImportState>({
    query: '',
    search: null,
    selected: [],
    busy: null,
    error: null,
    result: null,
  });
  const locked = disabled || !configured || state.busy !== null;
  const query = state.query.trim();
  const canSearch = Array.from(query).length >= 2;

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locked || !canSearch) return;
    setState((previous) => ({
      ...previous,
      busy: 'search',
      search: null,
      selected: [],
      error: null,
      result: null,
    }));
    try {
      const response = await ldapApi.searchUsers(query);
      setState((previous) => ({ ...previous, search: response, busy: null }));
    } catch {
      setState((previous) => ({
        ...previous,
        error: t('admin.ldap.import.searchError'),
        busy: null,
      }));
    }
  };

  const importSelected = async () => {
    const selected = new Set(state.selected);
    const users = (state.search?.users ?? []).filter(
      (user) => selected.has(user.dn) && !user.existing,
    );
    if (locked || users.length === 0 || !state.search) return;
    setState((previous) => ({ ...previous, busy: 'import', error: null, result: null }));
    try {
      const result = await ldapApi.importUsers(
        users.map(({ dn, username }) => ({ dn, username })),
        state.search.directoryVersion,
      );
      const completed = new Set(
        result.results.filter((user) => user.status !== 'failed').map((user) => user.dn),
      );
      setState((previous) => ({
        ...previous,
        busy: null,
        result,
        selected: previous.selected.filter((dn) => !completed.has(dn)),
        search: previous.search && {
          ...previous.search,
          users: previous.search.users.map((user) => ({
            ...user,
            existing: user.existing || completed.has(user.dn),
          })),
        },
      }));
      if (result.created > 0) onImported?.();
    } catch (error) {
      const changed = error instanceof ApiError && error.errorCode === 'ldap_configuration_changed';
      setState((previous) => ({
        ...previous,
        error: t(
          changed ? 'admin.ldap.import.configurationChanged' : 'admin.ldap.import.importError',
        ),
        search: changed ? null : previous.search,
        selected: changed ? [] : previous.selected,
        busy: null,
      }));
    }
  };

  const toggle = (dn: string, checked: boolean) => {
    setState((previous) => ({
      ...previous,
      selected: checked
        ? [...previous.selected, dn]
        : previous.selected.filter((value) => value !== dn),
    }));
  };

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border bg-background py-0">
      <CardHeader className="border-b border-border bg-muted/40 px-6 py-4 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <UserPlus aria-hidden="true" className="size-4 text-praetor" />
          {t('admin.ldap.import.title')}
        </CardTitle>
        <CardDescription>{t('admin.ldap.import.help')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-6" aria-busy={state.busy !== null}>
        <form onSubmit={search} className="flex flex-col items-end gap-3 sm:flex-row">
          <Field className="flex-1">
            <FieldLabel htmlFor={queryId}>{t('admin.ldap.import.query')}</FieldLabel>
            <Input
              id={queryId}
              value={state.query}
              maxLength={100}
              disabled={locked}
              onChange={(event) =>
                setState((previous) => ({ ...previous, query: event.target.value }))
              }
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={locked || !canSearch}>
            {state.busy === 'search' ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Search aria-hidden="true" />
            )}
            {t('admin.ldap.import.search')}
          </Button>
        </form>
        {disabled && (
          <p className="text-sm text-muted-foreground">{t('admin.ldap.import.saveFirst')}</p>
        )}
        {!configured && (
          <p className="text-sm text-muted-foreground">{t('admin.ldap.import.configureFirst')}</p>
        )}
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        {state.search && <DirectorySearchResults state={state} locked={locked} onToggle={toggle} />}
        {state.result && (
          <p role="status" className="text-sm text-foreground">
            {t('admin.ldap.import.summary', {
              created: state.result.created,
              existing: state.result.existing,
              failed: state.result.failed,
            })}
          </p>
        )}
        <Button
          type="button"
          onClick={importSelected}
          disabled={locked || state.selected.length === 0}
        >
          {state.busy === 'import' ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <UserPlus aria-hidden="true" />
          )}
          {t('admin.ldap.import.selected', { count: state.selected.length })}
        </Button>
      </CardContent>
    </Card>
  );
}

function DirectorySearchResults({
  state,
  locked,
  onToggle,
}: {
  state: ImportState;
  locked: boolean;
  onToggle: (dn: string, checked: boolean) => void;
}) {
  const { t } = useTranslation('auth');
  const users = state.search?.users ?? [];
  const selected = new Set(state.selected);
  const failed = new Set(
    state.result?.results.filter((result) => result.status === 'failed').map((result) => result.dn),
  );
  if (users.length === 0)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('admin.ldap.import.empty')}
      </p>
    );
  return (
    <div className="space-y-3">
      {state.search?.truncated && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('admin.ldap.import.truncated')}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {[
              'admin.ldap.import.select',
              'admin.ldap.import.username',
              'admin.ldap.import.name',
              'admin.ldap.import.email',
              'admin.ldap.import.status',
            ].map((label) => (
              <TableHead key={label}>{t(label)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <DirectoryUserRow
              key={user.dn}
              user={user}
              locked={locked}
              selected={selected.has(user.dn)}
              onToggle={onToggle}
              failed={failed.has(user.dn)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DirectoryUserRow({
  user,
  locked,
  selected,
  failed,
  onToggle,
}: {
  user: LdapDirectoryUser;
  locked: boolean;
  selected: boolean;
  failed: boolean;
  onToggle: (dn: string, checked: boolean) => void;
}) {
  const { t } = useTranslation('auth');
  return (
    <TableRow>
      <TableCell>
        <Checkbox
          checked={selected}
          disabled={locked || user.existing}
          aria-label={t('admin.ldap.import.selectUser', { username: user.username })}
          onCheckedChange={(checked) => onToggle(user.dn, checked === true)}
        />
      </TableCell>
      <TableCell className="font-mono">{user.username}</TableCell>
      <TableCell>{user.name}</TableCell>
      <TableCell>{user.email || '—'}</TableCell>
      <TableCell>
        {user.existing && <Badge variant="secondary">{t('admin.ldap.import.existing')}</Badge>}
        {failed && <span className="text-destructive">{t('admin.ldap.import.failed')}</span>}
      </TableCell>
    </TableRow>
  );
}
