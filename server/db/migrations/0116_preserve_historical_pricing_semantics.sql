DO $$
DECLARE
  target_table text;
  target_constraint text;
  target_tables text[] := ARRAY[
    'customer_offer_items',
    'invoice_items',
    'quote_items',
    'sale_items',
    'supplier_invoice_items',
    'supplier_quote_items',
    'supplier_sale_items'
  ];
  target_constraints text[] := ARRAY[
    'chk_customer_offer_items_pricing_semantics_version',
    'chk_invoice_items_pricing_semantics_version',
    'chk_quote_items_pricing_semantics_version',
    'chk_sale_items_pricing_semantics_version',
    'chk_supplier_invoice_items_pricing_semantics_version',
    'chk_supplier_quote_items_pricing_semantics_version',
    'chk_supplier_sale_items_pricing_semantics_version'
  ];
BEGIN
  FOR item_index IN 1..array_length(target_tables, 1) LOOP
    target_table := target_tables[item_index];
    target_constraint := target_constraints[item_index];

    -- Existing rows retain the legacy economic contract without rewriting duration or prices.
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS pricing_semantics_version integer DEFAULT 1 NOT NULL',
      target_table
    );
    -- Only writes performed after this migration receive the new unit-label semantics.
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN pricing_semantics_version SET DEFAULT 2',
      target_table
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = target_constraint
        AND conrelid = to_regclass(format('public.%I', target_table))
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (pricing_semantics_version IN (1, 2))',
        target_table,
        target_constraint
      );
    END IF;
  END LOOP;
END $$;
