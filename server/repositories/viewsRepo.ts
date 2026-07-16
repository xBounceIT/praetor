import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows, runAtomically } from '../db/drizzle.ts';
import {
  type SavedViewKind,
  type SavedViewPermission,
  savedViewShares,
  savedViews,
} from '../db/schema/savedViews.ts';

export type { SavedViewKind, SavedViewPermission };

// `owner` is computed in SQL for rows the caller owns; `read`/`write` come from the share row.
export type SavedViewAccess = 'owner' | SavedViewPermission;

// Domain shape returned by the list/CRUD helpers (camelCase, timestamps as epoch ms). Mirrors
// the DTO the routes serialize to the client.
export type SavedView = {
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
};

export type SavedViewShare = {
  userId: string;
  permission: SavedViewPermission;
};

export type CreateSavedViewInput = {
  id: string;
  ownerId: string;
  kind: SavedViewKind;
  scopeKey: string;
  name: string;
  config: Record<string, unknown>;
};

export type UpdateSavedViewInput = {
  name?: string;
  config?: Record<string, unknown>;
};

type SavedViewRow = {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: string;
  scopeKey: string;
  name: string;
  config: Record<string, unknown>;
  access: string;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

const toEpochMs = (value: string | Date | null): number => {
  if (value === null) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
};

const mapViewRow = (row: SavedViewRow): SavedView => ({
  id: row.id,
  ownerId: row.ownerId,
  ownerName: row.ownerName,
  kind: row.kind as SavedViewKind,
  scopeKey: row.scopeKey,
  name: row.name,
  config: row.config,
  access: row.access as SavedViewAccess,
  createdAt: toEpochMs(row.createdAt),
  updatedAt: toEpochMs(row.updatedAt),
});

// Own views (access 'owner') plus views shared with the user (access from the share's permission),
// each joined with the owner's display name. Access is computed in SQL; the two arms are UNIONed
// so a single ordered list comes back. Ordered by name for a stable picker/menu order.
export const listForUser = async (
  userId: string,
  kind: SavedViewKind,
  scopeKey: string,
  exec: DbExecutor = db,
): Promise<SavedView[]> => {
  const rows = await executeRows<SavedViewRow>(
    exec,
    sql`
      SELECT v.id,
             v.owner_id AS "ownerId",
             u.name AS "ownerName",
             v.kind,
             v.scope_key AS "scopeKey",
             v.name,
             v.config,
             'owner' AS access,
             v.created_at AS "createdAt",
             v.updated_at AS "updatedAt"
        FROM saved_views v
        JOIN users u ON u.id = v.owner_id
       WHERE v.owner_id = ${userId}
         AND v.kind = ${kind}
         AND v.scope_key = ${scopeKey}
      UNION ALL
      SELECT v.id,
             v.owner_id AS "ownerId",
             u.name AS "ownerName",
             v.kind,
             v.scope_key AS "scopeKey",
             v.name,
             v.config,
             s.permission AS access,
             v.created_at AS "createdAt",
             v.updated_at AS "updatedAt"
        FROM saved_view_shares s
        JOIN saved_views v ON v.id = s.view_id
        JOIN users u ON u.id = v.owner_id
       WHERE s.user_id = ${userId}
         AND v.owner_id <> ${userId}
         AND v.kind = ${kind}
         AND v.scope_key = ${scopeKey}
      ORDER BY name`,
  );
  return rows.map(mapViewRow);
};

// Permission gate for in-handler checks: the owner sees `owner`, a share recipient sees their
// granted permission, everyone else gets `access: null`. `ownerId` is null only when the view
// does not exist (lets the handler distinguish 404 from 403).
export const findAccess = async (
  viewId: string,
  userId: string,
  exec: DbExecutor = db,
): Promise<{ ownerId: string | null; access: SavedViewAccess | null }> => {
  const rows = await executeRows<{ ownerId: string; permission: string | null }>(
    exec,
    sql`
      SELECT v.owner_id AS "ownerId",
             s.permission AS permission
        FROM saved_views v
        LEFT JOIN saved_view_shares s
          ON s.view_id = v.id AND s.user_id = ${userId}
       WHERE v.id = ${viewId}`,
  );
  const row = rows[0];
  if (!row) return { ownerId: null, access: null };
  if (row.ownerId === userId) return { ownerId: row.ownerId, access: 'owner' };
  if (row.permission === 'read' || row.permission === 'write') {
    return { ownerId: row.ownerId, access: row.permission };
  }
  return { ownerId: row.ownerId, access: null };
};

// Reads a single view from the owner's perspective. Only called right after the owner creates or
// updates the row, so `access` is hard-coded to 'owner' — share recipients never hit this path.
// Returns the view's `kind` (so the route can validate a config patch against the right shape),
// or null when the id doesn't exist.
export const getViewKind = async (
  viewId: string,
  exec: DbExecutor = db,
): Promise<SavedViewKind | null> => {
  const rows = await exec
    .select({ kind: savedViews.kind })
    .from(savedViews)
    .where(eq(savedViews.id, viewId));
  return rows[0]?.kind ?? null;
};

const fetchViewById = async (viewId: string, exec: DbExecutor): Promise<SavedView | null> => {
  const rows = await executeRows<SavedViewRow>(
    exec,
    sql`
      SELECT v.id,
             v.owner_id AS "ownerId",
             u.name AS "ownerName",
             v.kind,
             v.scope_key AS "scopeKey",
             v.name,
             v.config,
             'owner' AS access,
             v.created_at AS "createdAt",
             v.updated_at AS "updatedAt"
        FROM saved_views v
        JOIN users u ON u.id = v.owner_id
       WHERE v.id = ${viewId}`,
  );
  return rows[0] ? mapViewRow(rows[0]) : null;
};

// Returns the created view with `access: 'owner'` (the creator is always the owner).
export const create = async (
  input: CreateSavedViewInput,
  exec: DbExecutor = db,
): Promise<SavedView> => {
  await exec.insert(savedViews).values({
    id: input.id,
    ownerId: input.ownerId,
    kind: input.kind,
    scopeKey: input.scopeKey,
    name: input.name,
    config: input.config,
  });
  const created = await fetchViewById(input.id, exec);
  if (!created) {
    // Unreachable in practice: the INSERT above just committed this row on the same executor.
    throw new Error(`Saved view ${input.id} vanished immediately after insert`);
  }
  return created;
};

// Bumps `updated_at` on every update. Returns the refreshed view (owner perspective) or null
// when the id no longer exists.
export const update = async (
  viewId: string,
  input: UpdateSavedViewInput,
  exec: DbExecutor = db,
): Promise<SavedView | null> => {
  const set: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
  if (input.name !== undefined) set.name = input.name;
  if (input.config !== undefined) set.config = input.config;

  const result = await exec.update(savedViews).set(set).where(eq(savedViews.id, viewId));
  if ((result.rowCount ?? 0) === 0) return null;
  return fetchViewById(viewId, exec);
};

export const reportNameExists = async (
  ownerId: string,
  scopeKey: string,
  name: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await executeRows<{ exists: boolean }>(
    exec,
    sql`SELECT EXISTS (
          SELECT 1
            FROM saved_views
           WHERE owner_id = ${ownerId}
             AND kind = 'report'
             AND scope_key = ${scopeKey}
             AND lower(name) = lower(${name})
        ) AS exists`,
  );
  return rows[0]?.exists === true;
};

export const reportNameExistsForView = async (
  viewId: string,
  name: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await executeRows<{ exists: boolean }>(
    exec,
    sql`SELECT EXISTS (
          SELECT 1
            FROM saved_views target
            JOIN saved_views candidate
              ON candidate.owner_id = target.owner_id
             AND candidate.kind = target.kind
             AND candidate.scope_key = target.scope_key
           WHERE target.id = ${viewId}
             AND target.kind = 'report'
             AND candidate.id <> target.id
             AND lower(candidate.name) = lower(${name})
        ) AS exists`,
  );
  return rows[0]?.exists === true;
};
export const deleteById = async (viewId: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(savedViews).where(eq(savedViews.id, viewId));
  return (result.rowCount ?? 0) > 0;
};

export const getShares = async (
  viewId: string,
  exec: DbExecutor = db,
): Promise<SavedViewShare[]> => {
  const rows = await exec
    .select({
      userId: savedViewShares.userId,
      permission: savedViewShares.permission,
    })
    .from(savedViewShares)
    .where(eq(savedViewShares.viewId, viewId));
  return rows.map((row) => ({ userId: row.userId, permission: row.permission }));
};

// Transactional delete-all-then-insert (mirrors `replaceUserProjects` in userAssignmentsRepo):
// a partial failure (INSERT throws after the DELETE commits) would otherwise wipe the view's
// shares. A FK violation on an unknown userId propagates so the route can translate it to 400.
export const replaceShares = (
  viewId: string,
  shares: SavedViewShare[],
  exec: DbExecutor = db,
): Promise<void> =>
  runAtomically(exec, async (tx) => {
    await tx.delete(savedViewShares).where(eq(savedViewShares.viewId, viewId));
    if (shares.length > 0) {
      // Dedupe on userId so two entries for the same user can't violate the PK; last permission wins.
      const byUser = new Map<string, SavedViewPermission>();
      for (const share of shares) byUser.set(share.userId, share.permission);

      await tx
        .insert(savedViewShares)
        .values(Array.from(byUser, ([userId, permission]) => ({ viewId, userId, permission })));
    }
  });
