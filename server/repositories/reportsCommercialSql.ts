import { type SQL, sql } from 'drizzle-orm';

// Mirrors effectiveDurationMonths: N/A lines are one-off even if legacy rows retain a month count.
const effectiveDurationSql = (durationUnit: SQL, durationMonths: SQL) => sql`
  CASE
    WHEN ${durationUnit} = 'na' THEN 1
    ELSE COALESCE(${durationMonths}, 1)
  END`;

const lineNetValueSql = (
  quantity: SQL,
  unitPrice: SQL,
  durationUnit: SQL,
  durationMonths: SQL,
  discount: SQL,
) => sql`
  ${quantity} * ${unitPrice} * ${effectiveDurationSql(durationUnit, durationMonths)}
  * (1 - COALESCE(${discount}, 0) / 100.0)`;

const documentNetValueSql = (lineNetValue: SQL, discountType: SQL, discount: SQL) => sql`
  GREATEST(
    COALESCE(SUM(${lineNetValue}), 0)
    - CASE
        WHEN ${discountType} = 'currency' THEN COALESCE(${discount}, 0)
        ELSE COALESCE(SUM(${lineNetValue}), 0) * COALESCE(${discount}, 0) / 100.0
      END,
    0
  )`;

const quoteLineNetValueSql = lineNetValueSql(
  sql`qi.quantity`,
  sql`qi.unit_price`,
  sql`qi.duration_unit`,
  sql`qi.duration_months`,
  sql`qi.discount`,
);

const orderLineNetValueSql = lineNetValueSql(
  sql`si.quantity`,
  sql`si.unit_price`,
  sql`si.duration_unit`,
  sql`si.duration_months`,
  sql`si.discount`,
);

const clientOfferLineNetValueSql = lineNetValueSql(
  sql`coi.quantity`,
  sql`coi.unit_price`,
  sql`coi.duration_unit`,
  sql`coi.duration_months`,
  sql`coi.discount`,
);

const supplierOrderLineNetValueSql = lineNetValueSql(
  sql`ssi.quantity`,
  sql`ssi.unit_price`,
  sql`ssi.duration_unit`,
  sql`ssi.duration_months`,
  sql`ssi.discount`,
);

// Prefer the selected quote candidate, then the first active one. The candidate-id fallback keeps
// rolling-upgrade rows attached to the default candidate until their backfill completes.
export const effectiveQuoteItemsJoin = sql`
  LEFT JOIN LATERAL (
    SELECT qc.id, qc.discount, qc.discount_type
      FROM quote_candidates qc
     WHERE qc.quote_id = q.id
       AND qc.state <> 'discarded'
     ORDER BY CASE WHEN qc.state = 'selected' THEN 0 ELSE 1 END, qc.position, qc.id
     LIMIT 1
  ) reporting_candidate ON TRUE
  JOIN quote_items qi
    ON qi.quote_id = q.id
   AND (
     COALESCE(qi.candidate_id, (
       SELECT default_candidate.id FROM quote_candidates default_candidate
        WHERE default_candidate.quote_id = q.id
        ORDER BY default_candidate.position, default_candidate.id LIMIT 1
     )) = reporting_candidate.id
     OR (reporting_candidate.id IS NULL AND qi.candidate_id IS NULL)
   )
`;

export const quoteNetValueSql = documentNetValueSql(
  quoteLineNetValueSql,
  sql`COALESCE(MAX(reporting_candidate.discount_type), q.discount_type)`,
  sql`COALESCE(MAX(reporting_candidate.discount), q.discount, 0)`,
);

export const orderNetValueSql = documentNetValueSql(
  orderLineNetValueSql,
  sql`s.discount_type`,
  sql`s.discount`,
);

export const clientOfferNetValueSql = documentNetValueSql(
  clientOfferLineNetValueSql,
  sql`co.discount_type`,
  sql`co.discount`,
);

export const supplierOrderNetValueSql = documentNetValueSql(
  supplierOrderLineNetValueSql,
  sql`ss.discount_type`,
  sql`ss.discount`,
);

export const supplierQuoteNetValueSql = sql`
  COALESCE(SUM(
    sqi.quantity * sqi.unit_price
    * ${effectiveDurationSql(sql`sqi.duration_unit`, sql`sqi.duration_months`)}
  ), 0)`;
