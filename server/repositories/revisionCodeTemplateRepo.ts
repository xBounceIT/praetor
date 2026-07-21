import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { revisionCodeTemplate } from '../db/schema/revisions.ts';
import {
  DEFAULT_REVISION_CODE_TEMPLATE,
  type RevisionCodeTemplate,
} from '../utils/revision-codes.ts';

export const get = async (exec: DbExecutor = db): Promise<RevisionCodeTemplate> => {
  const rows = await exec
    .select()
    .from(revisionCodeTemplate)
    .where(eq(revisionCodeTemplate.id, 'default'))
    .limit(1);
  return rows[0]
    ? {
        prefix: rows[0].prefix,
        template: rows[0].template,
        sequencePadding: rows[0].sequencePadding,
      }
    : DEFAULT_REVISION_CODE_TEMPLATE;
};

export const upsert = async (
  config: RevisionCodeTemplate,
  exec: DbExecutor = db,
): Promise<RevisionCodeTemplate> => {
  await exec
    .insert(revisionCodeTemplate)
    .values({ id: 'default', ...config })
    .onConflictDoUpdate({
      target: revisionCodeTemplate.id,
      set: {
        prefix: config.prefix,
        template: config.template,
        sequencePadding: config.sequencePadding,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
  return get(exec);
};
