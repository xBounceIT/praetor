import { query } from './index.ts';

export async function migrate() {
  console.log('Starting migration: Update default clients with fake info...');
  try {
    await query(
      `
            UPDATE clients SET
                name = 'Acme Corp S.r.l.',
                type = 'company',
                contact_name = 'Marco Bianchi (Ufficio Acquisti)',
                client_code = 'CL-001',
                email = 'info@acmecorp.example.com',
                phone = '+39 012 345 6789',
                address = 'Via delle Industrie 42, 00100 Roma (RM)',
                fiscal_code = 'IT01234567890',
                office_count_range = '6...10',
                billing_code = 'KRRH6B9',
                created_at = '2024-01-15 09:30:00'
            WHERE id = 'c1';

            UPDATE clients SET
                name = 'Mario Rossi',
                type = 'individual',
                contact_name = 'Mario Rossi',
                client_code = 'CL-002',
                email = 'mario.rossi@example.it',
                phone = '+39 333 123 4567',
                address = 'Via Roma 123, 20100 Milano (MI)',
                fiscal_code = 'RSSMRA80A01H501U',
                office_count_range = '1',
                billing_code = '0000000',
                created_at = '2024-03-05 14:15:00'
            WHERE id = 'c2';
        `,
      [],
    );
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}
