#!/usr/bin/env bun
// Diagnostic for #606 (and the spawned defense-in-depth follow-up): finds any
// `external_identities` rows where the same Praetor user is bound to more than
// one IdP subject for the same `(provider_id, protocol)`. Pre-fix, the SSO
// resolver could silently merge two distinct IdP accounts that happened to
// share a `preferred_username`; the audit surfaces accounts already affected
// in the wild so admins can manually reconcile them.
//
// Exits 0 when no duplicates exist (safe to chain into CI / pre-migration
// checks); exits 1 when duplicates are found OR the query itself fails.
//
// Read-only: this script never modifies data. Cleanup is intentionally left
// to an admin so the wrong account isn't accidentally merged.
import 'dotenv/config';
import pool from '../db/index.ts';

type DuplicateGroup = {
  user_id: string;
  username: string | null;
  provider_id: string;
  protocol: string;
  row_count: string;
  identities: Array<{
    id: string;
    subject: string;
    issuer: string;
    created_at: string | null;
  }>;
};

const AUDIT_QUERY = `
  SELECT
    ei.user_id,
    u.username,
    ei.provider_id,
    ei.protocol,
    COUNT(*) AS row_count,
    json_agg(
      json_build_object(
        'id', ei.id,
        'subject', ei.subject,
        'issuer', ei.issuer,
        'created_at', ei.created_at
      )
      ORDER BY ei.created_at
    ) AS identities
  FROM external_identities ei
  LEFT JOIN users u ON u.id = ei.user_id
  GROUP BY ei.user_id, u.username, ei.provider_id, ei.protocol
  HAVING COUNT(*) > 1
  ORDER BY ei.user_id, ei.provider_id, ei.protocol;
`;

const formatGroup = (group: DuplicateGroup): string => {
  const header = `user=${group.user_id} (${group.username ?? '<orphan>'}) provider=${group.provider_id} protocol=${group.protocol} rows=${group.row_count}`;
  const lines = group.identities.map(
    (id) =>
      `    - id=${id.id} subject=${id.subject} issuer=${id.issuer} created_at=${id.created_at}`,
  );
  return [header, ...lines].join('\n');
};

try {
  const result = await pool.query<DuplicateGroup>(AUDIT_QUERY);
  if (result.rows.length === 0) {
    console.info(
      'external_identities audit: no duplicate (user_id, provider_id, protocol) bindings found.',
    );
    process.exitCode = 0;
  } else {
    console.error(
      `external_identities audit: found ${result.rows.length} affected (user_id, provider_id, protocol) tuple(s).`,
    );
    console.error(
      'Each group below represents one Praetor user bound to multiple IdP subjects for the same provider.',
    );
    console.error(
      'Manual reconciliation is required (see PR #659 / issue #606). Do NOT auto-delete.',
    );
    console.error('');
    for (const group of result.rows) {
      console.error(formatGroup(group));
      console.error('');
    }
    process.exitCode = 1;
  }
} catch (err) {
  console.error('external_identities audit: query failed');
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
