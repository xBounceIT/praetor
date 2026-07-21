import { type SQL, sql } from 'drizzle-orm';

// Mirrors effectiveDurationMultiplier: pricing uses the value shown in the selected unit while the
// database retains canonical months. N/A lines remain one-off even if legacy rows retain months.
const effectiveDurationSql = (
  durationUnit: SQL,
  durationMonths: SQL,
  pricingSemanticsVersion: SQL,
) => sql`
  CASE
    WHEN ${durationUnit} = 'na' THEN 1
    WHEN ${pricingSemanticsVersion} = 1 THEN COALESCE(${durationMonths}, 1)
    WHEN ${durationUnit} = 'years' THEN COALESCE(${durationMonths}, 12) / 12.0
    ELSE COALESCE(${durationMonths}, 1)
  END`;

const lineNetValueSql = (
  quantity: SQL,
  unitPrice: SQL,
  durationUnit: SQL,
  durationMonths: SQL,
  pricingSemanticsVersion: SQL,
  discount: SQL,
  legacyDiscountRounding?: SQL,
) => {
  const discountedUnitPrice = sql`${unitPrice} * (1 - COALESCE(${discount}, 0) / 100.0)`;
  const calculationUnitPrice = legacyDiscountRounding
    ? sql`CASE
        WHEN COALESCE(${legacyDiscountRounding}, FALSE) THEN ROUND(${discountedUnitPrice}, 2)
        ELSE ${discountedUnitPrice}
      END`
    : discountedUnitPrice;

  return sql`
    ${quantity} * ${calculationUnitPrice}
    * ${effectiveDurationSql(durationUnit, durationMonths, pricingSemanticsVersion)}`;
};

const documentNetValueSql = (lineNetValue: SQL, discountType: SQL, discount: SQL) => sql`
  ROUND(GREATEST(
    COALESCE(SUM(${lineNetValue}), 0)
    - CASE
        WHEN ${discountType} = 'currency' THEN COALESCE(${discount}, 0)
        ELSE COALESCE(SUM(${lineNetValue}), 0) * COALESCE(${discount}, 0) / 100.0
      END,
    0
  ), 2)`;

const quoteLineNetValueSql = lineNetValueSql(
  sql`qi.quantity`,
  sql`qi.unit_price`,
  sql`qi.duration_unit`,
  sql`qi.duration_months`,
  sql`qi.pricing_semantics_version`,
  sql`qi.discount`,
);

const orderLineNetValueSql = lineNetValueSql(
  sql`si.quantity`,
  sql`si.unit_price`,
  sql`si.duration_unit`,
  sql`si.duration_months`,
  sql`si.pricing_semantics_version`,
  sql`si.discount`,
);

const clientOfferLineNetValueSql = lineNetValueSql(
  sql`coi.quantity`,
  sql`coi.unit_price`,
  sql`coi.duration_unit`,
  sql`coi.duration_months`,
  sql`coi.pricing_semantics_version`,
  sql`coi.discount`,
);

const supplierOrderLineNetValueSql = lineNetValueSql(
  sql`ssi.quantity`,
  sql`ssi.unit_price`,
  sql`ssi.duration_unit`,
  sql`ssi.duration_months`,
  sql`ssi.pricing_semantics_version`,
  sql`ssi.discount`,
  sql`ssi.legacy_discount_rounding`,
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
  ROUND(COALESCE(SUM(
    sqi.quantity * sqi.unit_price
    * ${effectiveDurationSql(
      sql`sqi.duration_unit`,
      sql`sqi.duration_months`,
      sql`sqi.pricing_semantics_version`,
    )}
  ), 0), 2)`;
