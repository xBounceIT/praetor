import { fetchApi } from './client';

// Mirrors the backend DTO serialized by `server/routes/views.ts` (see `savedViewSchema`).
// `kind` distinguishes a StandardTable view from a project-dashboard view; `config` is the
// opaque per-kind payload (table preset or dashboard layout). `access` is computed per-viewer:
// `owner` for rows the caller owns, otherwise the granted share permission.
export type SavedViewKind = 'table' | 'dashboard';
export type SavedViewPermission = 'read' | 'write';
export type SavedViewAccess = 'owner' | SavedViewPermission;

export interface SavedViewDto {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: SavedViewKind;
  scopeKey: string;
  name: string;
  config: Record<string, unknown>;
  access: SavedViewAccess;
  createdAt: number;
  updatedAt: number;
}

export interface ViewShare {
  userId: string;
  permission: SavedViewPermission;
}

// Minimal user shape for the share picker (`GET /views/directory`). Feature-scoped subset of
// the full `User` so any authenticated user can pick recipients without `/users` access.
export interface ViewDirectoryUser {
  id: string;
  name: string;
  username: string;
  avatarInitials: string;
}

export interface CreateViewBody {
  kind: SavedViewKind;
  scopeKey: string;
  name: string;
  config: Record<string, unknown>;
}

export interface UpdateViewPatch {
  name?: string;
  config?: Record<string, unknown>;
}

export const viewsApi = {
  // Own views + views shared with me, for the given kind/scope. Server merges both arms.
  list: (kind: SavedViewKind, scopeKey: string, signal?: AbortSignal): Promise<SavedViewDto[]> => {
    const params = new URLSearchParams({ kind, scopeKey });
    return fetchApi<SavedViewDto[]>(`/views?${params.toString()}`, { signal });
  },

  create: (body: CreateViewBody): Promise<SavedViewDto> =>
    fetchApi<SavedViewDto>('/views', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, patch: UpdateViewPatch): Promise<SavedViewDto> =>
    fetchApi<SavedViewDto>(`/views/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  remove: (id: string): Promise<void> => fetchApi(`/views/${id}`, { method: 'DELETE' }),

  getShares: (id: string, signal?: AbortSignal): Promise<ViewShare[]> =>
    fetchApi<{ shares: ViewShare[] }>(`/views/${id}/shares`, { signal }).then(
      (response) => response.shares,
    ),

  replaceShares: (id: string, shares: ViewShare[]): Promise<ViewShare[]> =>
    fetchApi<{ shares: ViewShare[] }>(`/views/${id}/shares`, {
      method: 'PUT',
      body: JSON.stringify({ shares }),
    }).then((response) => response.shares),

  directory: (signal?: AbortSignal): Promise<ViewDirectoryUser[]> =>
    fetchApi<ViewDirectoryUser[]>('/views/directory', { signal }),
};
