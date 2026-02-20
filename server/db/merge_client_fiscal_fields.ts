import { query } from './index.ts';

const hasColumn = async (tableName: string, columnName: string) => {
  const result = await query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    [tableName, columnName],
  );

  return Boolean(result.rows[0]?.exists);
};

export async function mergeClientFiscalFields() {
  console.log('Starting migration: merge_client_fiscal_fields');

  try {
    await query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS fiscal_code VARCHAR(50)');
    await query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS office_count_range VARCHAR(10)');

    const hasVatNumberColumn = await hasColumn('clients', 'vat_number');
    const hasTaxCodeColumn = await hasColumn('clients', 'tax_code');

    if (hasVatNumberColumn && hasTaxCodeColumn) {
      await query(`
        UPDATE clients
        SET fiscal_code = COALESCE(NULLIF(TRIM(vat_number), ''), NULLIF(TRIM(tax_code), ''))
        WHERE fiscal_code IS NULL OR TRIM(fiscal_code) = ''
      `);
    } else if (hasVatNumberColumn) {
      await query(`
        UPDATE clients
        SET fiscal_code = NULLIF(TRIM(vat_number), '')
        WHERE fiscal_code IS NULL OR TRIM(fiscal_code) = ''
      `);
    } else if (hasTaxCodeColumn) {
      await query(`
        UPDATE clients
        SET fiscal_code = NULLIF(TRIM(tax_code), '')
        WHERE fiscal_code IS NULL OR TRIM(fiscal_code) = ''
      `);
    }

    await query('DROP INDEX IF EXISTS idx_clients_vat_number_unique');

    await query('ALTER TABLE clients DROP CONSTRAINT IF EXISTS chk_clients_office_count_range');
    await query(`
      ALTER TABLE clients
      ADD CONSTRAINT chk_clients_office_count_range
      CHECK (office_count_range IS NULL OR office_count_range IN ('1', '2...5', '6...10', '>10'))
    `);

    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_fiscal_code_unique
      ON clients (LOWER(fiscal_code))
      WHERE fiscal_code IS NOT NULL AND fiscal_code <> ''
    `);

    if (hasVatNumberColumn) {
      await query('ALTER TABLE clients DROP COLUMN IF EXISTS vat_number');
    }

    if (hasTaxCodeColumn) {
      await query('ALTER TABLE clients DROP COLUMN IF EXISTS tax_code');
    }

    console.log('Migration completed successfully: merge_client_fiscal_fields');
  } catch (error) {
    console.error('Migration failed: merge_client_fiscal_fields', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mergeClientFiscalFields()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
