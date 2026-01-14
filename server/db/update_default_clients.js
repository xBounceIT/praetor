import { query } from './index.js';

export async function migrate() {
    console.log('Starting migration: Update default clients with fake info...');
    try {
        await query(`
            UPDATE clients SET
                name = 'Acme Corp S.r.l.',
                type = 'company',
                contact_name = 'Marco Bianchi (Ufficio Acquisti)',
                client_code = 'CL-001',
                email = 'info@acmecorp.example.com',
                phone = '+39 012 345 6789',
                address = 'Via delle Industrie 42, 00100 Roma (RM)',
                vat_number = 'IT01234567890',
                tax_code = '01234567890',
                billing_code = 'KRRH6B9',
                payment_terms = '30 gg D.F.F.M.'
            WHERE id = 'c1';

            UPDATE clients SET
                name = 'Mario Rossi',
                type = 'individual',
                contact_name = 'Mario Rossi',
                client_code = 'CL-002',
                email = 'mario.rossi@example.it',
                phone = '+39 333 123 4567',
                address = 'Via Roma 123, 20100 Milano (MI)',
                vat_number = NULL,
                tax_code = 'RSSMRA80A01H501U',
                billing_code = '0000000',
                payment_terms = 'Rimessa Diretta'
            WHERE id = 'c2';
        `);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    }
}
