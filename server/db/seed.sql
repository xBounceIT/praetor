-- Seed data for Praetor demo mode.
-- The canonical demo refresh is orchestrated by server/db/demoSeed.ts.
-- DEMO_SEEDING=true provisions the demo users and demo business data by first cleaning the
-- canonical demo namespace and any demo business-key collisions, then reapplying this file.
-- This flow is intended for demo/test environments and supports reused Docker volumes.

-- Default users (password is 'password' for all, hashed with bcrypt cost 10)
-- To generate: require('bcrypt').hashSync('password', 10)
INSERT INTO users (id, name, username, password_hash, role, avatar_initials) VALUES
    ('u1', 'Admin User', 'admin', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'admin', 'AD'),
    ('u2', 'Manager User', 'manager', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'manager', 'MG'),
    ('u3', 'Standard User', 'user', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'user', 'US'),
    ('u9', 'Top Manager', 'topmanager', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'top_manager', 'TM')
ON CONFLICT DO NOTHING;

-- Ensure default users have matching rows in user_roles
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, u.role
FROM users u
WHERE u.id IN ('u1', 'u2', 'u3', 'u9')
ON CONFLICT DO NOTHING;

-- Compatibility defaults kept for existing frontend constants and fully populated so
-- the CRM directory does not show partial client rows in demo mode.
INSERT INTO clients (
    id,
    name,
    is_disabled,
    created_at,
    type,
    contact_name,
    client_code,
    email,
    phone,
    address,
    description,
    ateco_code,
    website,
    sector,
    number_of_employees,
    revenue,
    fiscal_code,
    vat_number,
    tax_code,
    office_count_range,
    contacts,
    address_country,
    address_state,
    address_cap,
    address_province,
    address_civic_number,
    address_line
) VALUES
    (
        'c1',
        'Acme Corp',
        FALSE,
        '2024-01-15 09:30:00',
        'company',
        'Marta Colombo',
        'ACME-001',
        'operations@acme-corp.demo',
        '+39 02 5550 6101',
        'Via Dante 7, 20121 Milano (MI), Italia',
        'Compatibility client used by the legacy Website Redesign and Mobile App demo projects.',
        '62.01.00',
        'https://acme-corp.demo',
        'SERVICES',
        '50..250',
        '11..50',
        'IT20000000001',
        'IT20000000001',
        NULL,
        '2...5',
        '[{"fullName":"Marta Colombo","role":"Operations Manager","email":"operations@acme-corp.demo","phone":"+39 02 5550 6101"}]'::jsonb,
        'Italia',
        'Milano',
        '20121',
        'MI',
        '7',
        'Via Dante'
    ),
    (
        'c2',
        'Global Tech',
        FALSE,
        '2024-03-05 14:15:00',
        'company',
        'Andrea Bassi',
        'GTECH-001',
        'research@global-tech.demo',
        '+39 011 5550 6202',
        'Corso Vittorio Emanuele II 74, 10121 Torino (TO), Italia',
        'Compatibility client used by the legacy Internal Research demo project.',
        '72.19.09',
        'https://global-tech.demo',
        'SERVICES',
        '< 50',
        '< 10',
        'IT20000000002',
        'IT20000000002',
        NULL,
        '1',
        '[{"fullName":"Andrea Bassi","role":"Innovation Lead","email":"research@global-tech.demo","phone":"+39 011 5550 6202"}]'::jsonb,
        'Italia',
        'Torino',
        '10121',
        'TO',
        '74',
        'Corso Vittorio Emanuele II'
    )
ON CONFLICT (id) DO NOTHING;

-- start_date/end_date bracket the demo time entries logged against each project
-- (see the first time_entries block below) so every entry falls inside its project window.
INSERT INTO projects (id, name, client_id, description, start_date, end_date, tipo, tipo_confirmed) VALUES
    ('p1', 'Website Redesign', 'c1', 'Complete overhaul of the main marketing site.', (CURRENT_DATE - INTERVAL '30 days')::date, (CURRENT_DATE + INTERVAL '30 days')::date, 'attivo', TRUE),
    ('p2', 'Mobile App', 'c1', 'Native iOS and Android application development.', (CURRENT_DATE - INTERVAL '28 days')::date, (CURRENT_DATE + INTERVAL '28 days')::date, 'attivo', TRUE),
    ('p3', 'Internal Research', 'c2', 'Ongoing research into new market trends.', (CURRENT_DATE - INTERVAL '25 days')::date, (CURRENT_DATE + INTERVAL '25 days')::date, 'attivo', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, name, project_id, description) VALUES
    ('t1', 'Initial Design', 'p1', 'Lo-fi wireframes and moodboards.'),
    ('t2', 'Frontend Dev', 'p1', 'React component implementation.'),
    ('t3', 'API Integration', 'p2', 'Connecting the app to the backend services.'),
    ('t4', 'General Support', 'p3', 'Misc administrative tasks and support.'),
    ('t5', 'Market Analysis', 'p3', 'Competitive landscape and pricing research.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (user_id, full_name, email) VALUES
    ('u1', 'Admin User', 'admin@example.com'),
    ('u2', 'Manager User', 'manager@example.com'),
    ('u3', 'Standard User', 'user@example.com'),
    ('u9', 'Top Manager', 'topmanager@example.com')
ON CONFLICT (user_id) DO NOTHING;

-- Refreshable demo dataset.
-- Demo document records use the same default code templates exposed in admin settings
-- (PREV/OFF/FORN/ORD/SORD + YY + padded sequence). Non-document demo records keep dm_* ids.
-- The app-layer orchestrator executes these statements in a controlled refresh workflow after
-- cleanup, verification, manager assignment, and cache invalidation steps are prepared.

DROP TABLE IF EXISTS pg_temp.demo_document_codes;

CREATE TEMP TABLE demo_document_codes (
    module_id text NOT NULL,
    sequence integer NOT NULL,
    code text NOT NULL,
    PRIMARY KEY (module_id, sequence)
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.demo_seed_year()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('praetor.demo_seed_year', true), '')::integer,
        EXTRACT(YEAR FROM CURRENT_DATE)::integer
    )
$$;

INSERT INTO demo_document_codes (module_id, sequence, code)
SELECT
    module_id,
    sequence,
    prefix || '_' || RIGHT(pg_temp.demo_seed_year()::text, 2) || '_' || LPAD(sequence::text, 4, '0')
FROM (
    VALUES
        ('client_quote', 'PREV', 14),
        ('client_offer', 'OFF', 5),
        ('supplier_quote', 'FORN', 14),
        ('client_order', 'ORD', 5),
        ('supplier_order', 'SORD', 5)
) AS modules(module_id, prefix, max_sequence)
CROSS JOIN LATERAL generate_series(1, modules.max_sequence) AS sequence;

CREATE OR REPLACE FUNCTION pg_temp.demo_document_code(_module_id text, _sequence integer)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT codes.code
    FROM pg_temp.demo_document_codes AS codes
    WHERE codes.module_id = _module_id
      AND codes.sequence = _sequence
$$;

-- Document-code collision protection is handled by server/db/demoSeed.ts before cleanup.
-- Keeping the guard in one place avoids drift between the cleanup owner allow-list and this SQL.

INSERT INTO document_code_counters (module_id, year, next_sequence, updated_at)
VALUES
    ('client_quote', pg_temp.demo_seed_year(), 15, CURRENT_TIMESTAMP),
    ('client_offer', pg_temp.demo_seed_year(), 6, CURRENT_TIMESTAMP),
    ('supplier_quote', pg_temp.demo_seed_year(), 15, CURRENT_TIMESTAMP),
    ('client_order', pg_temp.demo_seed_year(), 6, CURRENT_TIMESTAMP),
    ('supplier_order', pg_temp.demo_seed_year(), 6, CURRENT_TIMESTAMP)
ON CONFLICT (module_id, year) DO UPDATE SET
    next_sequence = GREATEST(document_code_counters.next_sequence, EXCLUDED.next_sequence),
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO clients (
    id,
    name,
    is_disabled,
    created_at,
    type,
    contact_name,
    client_code,
    email,
    phone,
    address,
    description,
    ateco_code,
    website,
    sector,
    number_of_employees,
    revenue,
    fiscal_code,
    office_count_range
) VALUES
    (
        'dm_cli_01',
        'Northwind Retail Italia S.p.A.',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '210 days',
        'company',
        'Elena Rinaldi',
        'DM-CLI-001',
        'procurement@northwind-retail.demo',
        '+39 02 5550 1001',
        'Via Torino 18, 20123 Milano (MI)',
        'Retail group used to showcase the full customer commercial flow.',
        '47.19.90',
        'https://northwind-retail.demo',
        'GDO',
        '251..1000',
        '51..1000',
        'IT10000000001',
        '6...10'
    ),
    (
        'dm_cli_02',
        'Helios Energy Services S.r.l.',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '190 days',
        'company',
        'Paolo Greco',
        'DM-CLI-002',
        'tenders@helios-energy.demo',
        '+39 06 5550 2002',
        'Viale Europa 42, 00144 Roma (RM)',
        'Mid-market client with active quotes, denied orders, and draft invoicing examples.',
        '35.11.00',
        'https://helios-energy.demo',
        'ENERGY',
        '50..250',
        '11..50',
        'IT10000000002',
        '2...5'
    ),
    (
        'dm_cli_03',
        'Comune di Verona - Innovazione Digitale',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '170 days',
        'company',
        'Sara Benetti',
        'DM-CLI-003',
        'innovazione@comune-verona.demo',
        '+39 045 555 3003',
        'Piazza Bra 1, 37121 Verona (VR)',
        'Public-sector style account used for framework offers and linked order examples.',
        '84.11.10',
        'https://innovazione.comune-verona.demo',
        'PA',
        '251..1000',
        '51..1000',
        'IT10000000003',
        '>10'
    ),
    (
        'dm_cli_04',
        'Giulia Ferri',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '150 days',
        'individual',
        'Giulia Ferri',
        'DM-CLI-004',
        'giulia.ferri@demo.it',
        '+39 333 555 4004',
        'Via Mazzini 14, 40121 Bologna (BO)',
        'Individual customer used for small-ticket quotes, orders, and cancelled invoices.',
        NULL,
        NULL,
        'ALTRO',
        '< 50',
        '< 10',
        'FRRGLI90A41A944K',
        '1'
    ),
    (
        'dm_cli_05',
        'Atlas Legacy Holdings',
        TRUE,
        CURRENT_TIMESTAMP - INTERVAL '130 days',
        'company',
        'Luca Serra',
        'DM-CLI-005',
        'archive@atlas-legacy.demo',
        '+39 011 555 5005',
        'Corso Francia 99, 10138 Torino (TO)',
        'Disabled CRM record kept to demonstrate inactive state handling.',
        '70.22.09',
        'https://atlas-legacy.demo',
        'SERVICES',
        '50..250',
        '11..50',
        'IT10000000005',
        '2...5'
    )
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    is_disabled = EXCLUDED.is_disabled,
    created_at = EXCLUDED.created_at,
    type = EXCLUDED.type,
    contact_name = EXCLUDED.contact_name,
    client_code = EXCLUDED.client_code,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    description = EXCLUDED.description,
    ateco_code = EXCLUDED.ateco_code,
    website = EXCLUDED.website,
    sector = EXCLUDED.sector,
    number_of_employees = EXCLUDED.number_of_employees,
    revenue = EXCLUDED.revenue,
    fiscal_code = EXCLUDED.fiscal_code,
    office_count_range = EXCLUDED.office_count_range;

INSERT INTO suppliers (
    id,
    name,
    is_disabled,
    supplier_code,
    contact_name,
    email,
    phone,
    address,
    vat_number,
    tax_code,
    payment_terms,
    notes,
    created_at
) VALUES
    (
        'dm_sup_01',
        'TechSource Distribution',
        FALSE,
        'DM-SUP-001',
        'Marta De Santis',
        'sales@techsource.demo',
        '+39 02 7700 1001',
        'Via Mecenate 90, 20138 Milano (MI)',
        'IT20000000001',
        'TSDRAA80A01F205X',
        '30gg',
        'Primary hardware distributor used across quotes, orders, and incoming invoices.',
        CURRENT_TIMESTAMP - INTERVAL '200 days'
    ),
    (
        'dm_sup_02',
        'CloudSeat Licensing',
        FALSE,
        'DM-SUP-002',
        'Andrea Monti',
        'channel@cloudseat.demo',
        '+39 06 7700 2002',
        'Via Appia Nuova 210, 00183 Roma (RM)',
        'IT20000000002',
        'CLSLDR80A02H501Z',
        '45gg',
        'Subscription supplier used for recurring software and partial supplier invoice examples.',
        CURRENT_TIMESTAMP - INTERVAL '180 days'
    ),
    (
        'dm_sup_03',
        'SecureEdge Systems',
        FALSE,
        'DM-SUP-003',
        'Valerio Conti',
        'commerciale@secureedge.demo',
        '+39 051 7700 3003',
        'Via Stalingrado 40, 40128 Bologna (BO)',
        'IT20000000003',
        'SCRVRL80A03A944W',
        '60gg',
        'Security supplier used for sent purchase flow and paid supplier invoice coverage.',
        CURRENT_TIMESTAMP - INTERVAL '160 days'
    ),
    (
        'dm_sup_04',
        'PrintLogistics Hub',
        FALSE,
        'DM-SUP-004',
        'Laura Valli',
        'orders@printlogistics.demo',
        '+39 045 7700 4004',
        'Via Francia 7, 37135 Verona (VR)',
        'IT20000000004',
        'PRTLRA80A04L781T',
        '30gg',
        'Fulfilment and printing partner used for overdue supplier cost scenarios.',
        CURRENT_TIMESTAMP - INTERVAL '140 days'
    ),
    (
        'dm_sup_05',
        'Legacy Components Archive',
        TRUE,
        'DM-SUP-005',
        'Archivio Storico',
        'archive@legacy-components.demo',
        '+39 011 7700 5005',
        'Corso Regio Parco 11, 10152 Torino (TO)',
        'IT20000000005',
        'LGCCRC80A05L219D',
        '90gg',
        'Disabled supplier record kept only for inactive-state coverage.',
        CURRENT_TIMESTAMP - INTERVAL '120 days'
    )
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    is_disabled = EXCLUDED.is_disabled,
    supplier_code = EXCLUDED.supplier_code,
    contact_name = EXCLUDED.contact_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    vat_number = EXCLUDED.vat_number,
    tax_code = EXCLUDED.tax_code,
    payment_terms = EXCLUDED.payment_terms,
    notes = EXCLUDED.notes,
    created_at = EXCLUDED.created_at;

INSERT INTO products (
    id,
    name,
    product_code,
    costo,
    mol_percentage,
    cost_unit,
    category,
    subcategory,
    type,
    description,
    supplier_id,
    is_disabled,
    created_at
) VALUES
    (
        'dm_prd_01',
        'Strategy Assessment',
        'DM-SVC-AUDIT',
        800.00,
        35.00,
        'hours',
        'Advisory',
        'Assessment',
        'consulting',
        'Initial discovery, gap analysis, and action plan.',
        NULL,
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '195 days'
    ),
    (
        'dm_prd_02',
        'Deployment Sprint',
        'DM-SVC-DEPLOY',
        1200.00,
        30.00,
        'hours',
        'Delivery',
        'Implementation',
        'service',
        'Implementation package for rollout and cutover activities.',
        NULL,
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '190 days'
    ),
    (
        'dm_prd_03',
        'Managed Support Retainer',
        'DM-SVC-SUPPORT',
        500.00,
        40.00,
        'hours',
        'Services',
        'Managed Services',
        'service',
        'Recurring managed support package used in open and overdue invoice examples.',
        NULL,
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '185 days'
    ),
    (
        'dm_prd_04',
        'Workshop Training Day',
        'DM-CNS-TRAIN',
        600.00,
        45.00,
        'hours',
        'Advisory',
        'Training',
        'consulting',
        'On-site enablement and training service.',
        NULL,
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '180 days'
    ),
    (
        'dm_prd_05',
        'Business Laptop Bundle',
        'DM-SUP-LAPTOP',
        950.00,
        18.00,
        'unit',
        'Hardware',
        'Endpoint',
        'supply',
        'Corporate laptop bundle with accessories.',
        'dm_sup_01',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '175 days'
    ),
    (
        'dm_prd_06',
        'Microsoft 365 Annual Seat',
        'DM-SUP-M365',
        180.00,
        20.00,
        'unit',
        'Software',
        'Licensing',
        'service',
        'Annual productivity subscription seat.',
        'dm_sup_02',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '170 days'
    ),
    (
        'dm_prd_07',
        'Managed Firewall Appliance',
        'DM-SUP-FW',
        1400.00,
        22.00,
        'unit',
        'Security',
        'Network',
        'supply',
        'Security appliance supplied for edge protection projects.',
        'dm_sup_03',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '165 days'
    ),
    (
        'dm_prd_08',
        'Branded Print Kit',
        'DM-SUP-PRINT',
        120.00,
        25.00,
        'unit',
        'Marketing',
        'Print',
        'supply',
        'Print package for events, launches, and branch communication.',
        'dm_sup_04',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '160 days'
    ),
    (
        'dm_prd_09',
        'Legacy Token Pack',
        'DM-DISABLED-001',
        90.00,
        15.00,
        'unit',
        'Legacy',
        'Archive',
        'supply',
        'Disabled product kept only to demonstrate inactive catalog records.',
        'dm_sup_05',
        TRUE,
        CURRENT_TIMESTAMP - INTERVAL '155 days'
    )
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    product_code = EXCLUDED.product_code,
    costo = EXCLUDED.costo,
    mol_percentage = EXCLUDED.mol_percentage,
    cost_unit = EXCLUDED.cost_unit,
    category = EXCLUDED.category,
    subcategory = EXCLUDED.subcategory,
    type = EXCLUDED.type,
    description = EXCLUDED.description,
    supplier_id = EXCLUDED.supplier_id,
    is_disabled = EXCLUDED.is_disabled,
    created_at = EXCLUDED.created_at;

INSERT INTO quotes (
    id,
    client_id,
    client_name,
    payment_terms,
    discount,
    status,
    expiration_date,
    communication_channel_id,
    notes,
    created_at,
    updated_at
) VALUES
    (pg_temp.demo_document_code('client_quote', 1), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 2.00, 'draft', CURRENT_DATE + INTERVAL '45 days', 'qcc_email', 'Editable draft quote with two services.', CURRENT_TIMESTAMP - INTERVAL '150 days', CURRENT_TIMESTAMP - INTERVAL '149 days'),
    (pg_temp.demo_document_code('client_quote', 2), 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 3.00, 'sent', CURRENT_DATE + INTERVAL '22 days', 'qcc_email', 'Sent quote waiting for customer feedback.', CURRENT_TIMESTAMP - INTERVAL '130 days', CURRENT_TIMESTAMP - INTERVAL '126 days'),
    (pg_temp.demo_document_code('client_quote', 3), 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '28 days', 'qcc_email', 'Accepted quote intentionally left without an offer to expose the CTA.', CURRENT_TIMESTAMP - INTERVAL '112 days', CURRENT_TIMESTAMP - INTERVAL '108 days'),
    (pg_temp.demo_document_code('client_quote', 4), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 4.00, 'accepted', CURRENT_DATE + INTERVAL '30 days', 'qcc_email', 'Accepted quote with a draft offer downstream.', CURRENT_TIMESTAMP - INTERVAL '101 days', CURRENT_TIMESTAMP - INTERVAL '96 days'),
    (pg_temp.demo_document_code('client_quote', 5), 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 1.50, 'accepted', CURRENT_DATE + INTERVAL '26 days', 'qcc_email', 'Accepted quote with a sent offer downstream.', CURRENT_TIMESTAMP - INTERVAL '92 days', CURRENT_TIMESTAMP - INTERVAL '88 days'),
    (pg_temp.demo_document_code('client_quote', 6), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '24 days', 'qcc_email', 'Accepted assessment + deployment quote that flowed into an accepted offer and a confirmed order.', CURRENT_TIMESTAMP - INTERVAL '78 days', CURRENT_TIMESTAMP - INTERVAL '72 days'),
    (pg_temp.demo_document_code('client_quote', 7), 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 2.50, 'accepted', CURRENT_DATE + INTERVAL '20 days', 'qcc_email', 'Accepted quote linked to an accepted offer that already generated an order.', CURRENT_TIMESTAMP - INTERVAL '66 days', CURRENT_TIMESTAMP - INTERVAL '61 days'),
    (pg_temp.demo_document_code('client_quote', 8), 'dm_cli_04', 'Giulia Ferri', 'immediate', 0.00, 'accepted', CURRENT_DATE + INTERVAL '12 days', 'qcc_email', 'Accepted quote linked to a denied offer.', CURRENT_TIMESTAMP - INTERVAL '58 days', CURRENT_TIMESTAMP - INTERVAL '54 days'),
    (pg_temp.demo_document_code('client_quote', 9), 'dm_cli_02', 'Helios Energy Services S.r.l.', '30gg', 5.00, 'denied', CURRENT_DATE + INTERVAL '10 days', 'qcc_email', 'Rejected customer quote kept for history coverage.', CURRENT_TIMESTAMP - INTERVAL '36 days', CURRENT_TIMESTAMP - INTERVAL '34 days'),
    (pg_temp.demo_document_code('client_quote', 10), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 0.00, 'sent', CURRENT_DATE - INTERVAL '5 days', 'qcc_email', 'Expired quote to exercise historical and expired state handling.', CURRENT_TIMESTAMP - INTERVAL '24 days', CURRENT_TIMESTAMP - INTERVAL '20 days'),
    (pg_temp.demo_document_code('client_quote', 11), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '14 days', 'qcc_email', 'Accepted procurement driver: its 1-to-1 link keeps the paired supplier quote in the Accepted state (#779 derived status).', CURRENT_TIMESTAMP - INTERVAL '53 days', CURRENT_TIMESTAMP - INTERVAL '49 days'),
    (pg_temp.demo_document_code('client_quote', 12), 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '11 days', 'qcc_email', 'Accepted procurement driver for the paired supplier quote.', CURRENT_TIMESTAMP - INTERVAL '42 days', CURRENT_TIMESTAMP - INTERVAL '37 days'),
    (pg_temp.demo_document_code('client_quote', 13), 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '8 days', 'qcc_email', 'Accepted procurement driver for the paired supplier quote.', CURRENT_TIMESTAMP - INTERVAL '33 days', CURRENT_TIMESTAMP - INTERVAL '28 days'),
    (pg_temp.demo_document_code('client_quote', 14), 'dm_cli_04', 'Giulia Ferri', '30gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '6 days', 'qcc_email', 'Accepted procurement driver for the paired supplier quote.', CURRENT_TIMESTAMP - INTERVAL '25 days', CURRENT_TIMESTAMP - INTERVAL '21 days')
ON CONFLICT (id) DO UPDATE SET
    client_id = EXCLUDED.client_id,
    client_name = EXCLUDED.client_name,
    payment_terms = EXCLUDED.payment_terms,
    discount = EXCLUDED.discount,
    status = EXCLUDED.status,
    expiration_date = EXCLUDED.expiration_date,
    communication_channel_id = EXCLUDED.communication_channel_id,
    notes = EXCLUDED.notes,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO quote_items (
    id,
    quote_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    product_cost,
    product_mol_percentage,
    discount,
    note
)
SELECT
    v.id,
    v.quote_id,
    p.id,
    p.name,
    v.quantity,
    v.unit_price,
    p.costo,
    p.mol_percentage,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_cqi_01', pg_temp.demo_document_code('client_quote', 1), 'dm_prd_01', 5.00, 1230.00, 0.00, 'Discovery workshops and stakeholder interviews'),
        ('dm_cqi_02', pg_temp.demo_document_code('client_quote', 1), 'dm_prd_02', 2.00, 1715.00, 0.00, 'Deployment sprint for first release wave'),
        ('dm_cqi_03', pg_temp.demo_document_code('client_quote', 2), 'dm_prd_05', 12.00, 1159.00, 3.00, 'Endpoint refresh lot for field technicians'),
        ('dm_cqi_04', pg_temp.demo_document_code('client_quote', 3), 'dm_prd_06', 40.00, 225.00, 0.00, 'Accepted subscription bundle intentionally kept without downstream offer'),
        ('dm_cqi_05', pg_temp.demo_document_code('client_quote', 4), 'dm_prd_01', 3.00, 1230.00, 0.00, 'Strategic assessment package'),
        ('dm_cqi_06', pg_temp.demo_document_code('client_quote', 4), 'dm_prd_04', 1.00, 1090.00, 5.00, 'Executive training day'),
        ('dm_cqi_07', pg_temp.demo_document_code('client_quote', 5), 'dm_prd_07', 2.00, 1795.00, 0.00, 'Firewall appliances for branch perimeter refresh'),
        ('dm_cqi_08', pg_temp.demo_document_code('client_quote', 6), 'dm_prd_01', 4.00, 1230.00, 0.00, 'Strategy assessment lot for the operations engagement'),
        ('dm_cqi_15', pg_temp.demo_document_code('client_quote', 6), 'dm_prd_02', 1.00, 1715.00, 0.00, 'Deployment sprint for the phase-one rollout'),
        ('dm_cqi_09', pg_temp.demo_document_code('client_quote', 7), 'dm_prd_08', 2.00, 160.00, 0.00, 'Print collateral for the public-sector rollout'),
        ('dm_cqi_10', pg_temp.demo_document_code('client_quote', 7), 'dm_prd_02', 1.00, 1715.00, 0.00, 'Deployment sprint for the first implementation lot'),
        ('dm_cqi_11', pg_temp.demo_document_code('client_quote', 8), 'dm_prd_04', 2.00, 1090.00, 0.00, 'Training package for a small customer'),
        ('dm_cqi_12', pg_temp.demo_document_code('client_quote', 9), 'dm_prd_05', 3.00, 1159.00, 0.00, 'Rejected hardware offer kept for reporting'),
        ('dm_cqi_13', pg_temp.demo_document_code('client_quote', 10), 'dm_prd_03', 6.00, 835.00, 0.00, 'Managed support bundle that expired before confirmation'),
        ('dm_cqi_14', pg_temp.demo_document_code('client_quote', 10), 'dm_prd_08', 15.00, 160.00, 0.00, 'Print collateral add-on on the expired quote'),
        ('dm_cqi_16', pg_temp.demo_document_code('client_quote', 11), 'dm_prd_05', 4.00, 1180.00, 0.00, 'Hardware lot driving the editable draft supplier order'),
        ('dm_cqi_17', pg_temp.demo_document_code('client_quote', 12), 'dm_prd_06', 80.00, 225.00, 0.00, 'Licensing lot driving the sent supplier order'),
        ('dm_cqi_18', pg_temp.demo_document_code('client_quote', 13), 'dm_prd_07', 1.00, 1795.00, 0.00, 'Security appliance driving the invoiced supplier order'),
        ('dm_cqi_19', pg_temp.demo_document_code('client_quote', 14), 'dm_prd_05', 2.00, 1180.00, 0.00, 'Hardware lot driving the sent supplier order')
) AS v(id, quote_id, product_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id
ON CONFLICT (id) DO UPDATE SET
    quote_id = EXCLUDED.quote_id,
    product_id = EXCLUDED.product_id,
    product_name = EXCLUDED.product_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    product_cost = EXCLUDED.product_cost,
    product_mol_percentage = EXCLUDED.product_mol_percentage,
    discount = EXCLUDED.discount,
    note = EXCLUDED.note;

INSERT INTO customer_offers (
    id,
    linked_quote_id,
    client_id,
    client_name,
    payment_terms,
    discount,
    status,
    expiration_date,
    notes,
    created_at,
    updated_at
) VALUES
    (pg_temp.demo_document_code('client_offer', 1), pg_temp.demo_document_code('client_quote', 4), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 4.00, 'draft', CURRENT_DATE + INTERVAL '24 days', 'Editable draft offer created from an accepted quote.', CURRENT_TIMESTAMP - INTERVAL '90 days', CURRENT_TIMESTAMP - INTERVAL '88 days'),
    (pg_temp.demo_document_code('client_offer', 2), pg_temp.demo_document_code('client_quote', 5), 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 1.50, 'sent', CURRENT_DATE + INTERVAL '22 days', 'Sent offer waiting for customer reply.', CURRENT_TIMESTAMP - INTERVAL '80 days', CURRENT_TIMESTAMP - INTERVAL '77 days'),
    (pg_temp.demo_document_code('client_offer', 3), pg_temp.demo_document_code('client_quote', 6), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '18 days', 'Accepted offer converted into the confirmed delivery order that spawned the demo projects.', CURRENT_TIMESTAMP - INTERVAL '68 days', CURRENT_TIMESTAMP - INTERVAL '65 days'),
    (pg_temp.demo_document_code('client_offer', 4), pg_temp.demo_document_code('client_quote', 7), 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 2.50, 'accepted', CURRENT_DATE + INTERVAL '16 days', 'Accepted offer already converted into an order.', CURRENT_TIMESTAMP - INTERVAL '56 days', CURRENT_TIMESTAMP - INTERVAL '52 days'),
    (pg_temp.demo_document_code('client_offer', 5), pg_temp.demo_document_code('client_quote', 8), 'dm_cli_04', 'Giulia Ferri', 'immediate', 0.00, 'denied', CURRENT_DATE + INTERVAL '8 days', 'Denied offer for historical state coverage.', CURRENT_TIMESTAMP - INTERVAL '46 days', CURRENT_TIMESTAMP - INTERVAL '43 days')
ON CONFLICT (id) DO UPDATE SET
    linked_quote_id = EXCLUDED.linked_quote_id,
    client_id = EXCLUDED.client_id,
    client_name = EXCLUDED.client_name,
    payment_terms = EXCLUDED.payment_terms,
    discount = EXCLUDED.discount,
    status = EXCLUDED.status,
    expiration_date = EXCLUDED.expiration_date,
    notes = EXCLUDED.notes,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO customer_offer_items (
    id,
    offer_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    product_cost,
    product_mol_percentage,
    discount,
    note
)
SELECT
    v.id,
    v.offer_id,
    p.id,
    p.name,
    v.quantity,
    v.unit_price,
    p.costo,
    p.mol_percentage,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_coi_01', pg_temp.demo_document_code('client_offer', 1), 'dm_prd_01', 3.00, 1230.00, 0.00, 'Draft offer line copied from the accepted quote'),
        ('dm_coi_02', pg_temp.demo_document_code('client_offer', 1), 'dm_prd_04', 1.00, 1090.00, 5.00, 'Editable training line'),
        ('dm_coi_03', pg_temp.demo_document_code('client_offer', 2), 'dm_prd_07', 2.00, 1795.00, 0.00, 'Pending security appliance offer'),
        ('dm_coi_04', pg_temp.demo_document_code('client_offer', 3), 'dm_prd_01', 4.00, 1230.00, 5.00, 'Accepted assessment lot for the operations engagement'),
        ('dm_coi_08', pg_temp.demo_document_code('client_offer', 3), 'dm_prd_02', 1.00, 1715.00, 5.00, 'Accepted deployment sprint for the phase-one rollout'),
        ('dm_coi_05', pg_temp.demo_document_code('client_offer', 4), 'dm_prd_01', 2.00, 1230.00, 0.00, 'Accepted assessment lot'),
        ('dm_coi_06', pg_temp.demo_document_code('client_offer', 4), 'dm_prd_02', 1.00, 1715.00, 0.00, 'Accepted deployment sprint'),
        ('dm_coi_07', pg_temp.demo_document_code('client_offer', 5), 'dm_prd_04', 2.00, 1090.00, 0.00, 'Denied training offer')
) AS v(id, offer_id, product_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id
ON CONFLICT (id) DO UPDATE SET
    offer_id = EXCLUDED.offer_id,
    product_id = EXCLUDED.product_id,
    product_name = EXCLUDED.product_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    product_cost = EXCLUDED.product_cost,
    product_mol_percentage = EXCLUDED.product_mol_percentage,
    discount = EXCLUDED.discount,
    note = EXCLUDED.note;

INSERT INTO sales (
    id,
    linked_quote_id,
    linked_offer_id,
    client_id,
    client_name,
    payment_terms,
    discount,
    status,
    notes,
    created_at,
    updated_at
) VALUES
    (pg_temp.demo_document_code('client_order', 1), NULL, NULL, 'dm_cli_04', 'Giulia Ferri', 'immediate', 0.00, 'draft', 'Editable manual sale order used for direct accounting workflow.', CURRENT_TIMESTAMP - INTERVAL '42 days', CURRENT_TIMESTAMP - INTERVAL '41 days'),
    (pg_temp.demo_document_code('client_order', 2), pg_temp.demo_document_code('client_quote', 7), pg_temp.demo_document_code('client_offer', 4), 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 2.50, 'confirmed', 'Linked order generated from an accepted offer and confirmed.', CURRENT_TIMESTAMP - INTERVAL '33 days', CURRENT_TIMESTAMP - INTERVAL '30 days'),
    (pg_temp.demo_document_code('client_order', 3), NULL, NULL, 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 1.50, 'confirmed', 'Confirmed manual order intentionally left without an invoice.', CURRENT_TIMESTAMP - INTERVAL '28 days', CURRENT_TIMESTAMP - INTERVAL '24 days'),
    (pg_temp.demo_document_code('client_order', 4), pg_temp.demo_document_code('client_quote', 6), pg_temp.demo_document_code('client_offer', 3), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 0.00, 'confirmed', 'Confirmed order generated from the accepted Northwind offer, already invoiced, and used to generate the demo delivery projects. The linked projects keep explicit project revenue instead of importing the order total automatically.', CURRENT_TIMESTAMP - INTERVAL '21 days', CURRENT_TIMESTAMP - INTERVAL '18 days'),
    (pg_temp.demo_document_code('client_order', 5), NULL, NULL, 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 0.00, 'denied', 'Denied order retained for accounting history coverage.', CURRENT_TIMESTAMP - INTERVAL '16 days', CURRENT_TIMESTAMP - INTERVAL '14 days')
ON CONFLICT (id) DO UPDATE SET
    linked_quote_id = EXCLUDED.linked_quote_id,
    linked_offer_id = EXCLUDED.linked_offer_id,
    client_id = EXCLUDED.client_id,
    client_name = EXCLUDED.client_name,
    payment_terms = EXCLUDED.payment_terms,
    discount = EXCLUDED.discount,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO sale_items (
    id,
    sale_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    product_cost,
    product_mol_percentage,
    discount,
    note
)
SELECT
    v.id,
    v.sale_id,
    p.id,
    p.name,
    v.quantity,
    v.unit_price,
    p.costo,
    p.mol_percentage,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_soi_01', pg_temp.demo_document_code('client_order', 1), 'dm_prd_08', 25.00, 160.00, 0.00, 'Draft order for event print materials'),
        ('dm_soi_02', pg_temp.demo_document_code('client_order', 2), 'dm_prd_01', 2.00, 1230.00, 0.00, 'Linked assessment lot on a confirmed order'),
        ('dm_soi_03', pg_temp.demo_document_code('client_order', 2), 'dm_prd_02', 1.00, 1715.00, 0.00, 'Linked deployment lot on a confirmed order'),
        ('dm_soi_04', pg_temp.demo_document_code('client_order', 3), 'dm_prd_03', 6.00, 835.00, 0.00, 'Confirmed support retainer kept open without invoice'),
        ('dm_soi_05', pg_temp.demo_document_code('client_order', 3), 'dm_prd_06', 20.00, 210.00, 0.00, 'Confirmed software add-on still ready for invoicing'),
        ('dm_soi_06', pg_temp.demo_document_code('client_order', 4), 'dm_prd_01', 4.00, 1230.00, 5.00, 'Assessment track for operations'),
        ('dm_soi_07', pg_temp.demo_document_code('client_order', 4), 'dm_prd_02', 1.00, 1715.00, 5.00, 'Deployment wave for phase one'),
        ('dm_soi_08', pg_temp.demo_document_code('client_order', 5), 'dm_prd_05', 3.00, 1159.00, 0.00, 'Denied hardware order')
) AS v(id, sale_id, product_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id
ON CONFLICT (id) DO UPDATE SET
    sale_id = EXCLUDED.sale_id,
    product_id = EXCLUDED.product_id,
    product_name = EXCLUDED.product_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    product_cost = EXCLUDED.product_cost,
    product_mol_percentage = EXCLUDED.product_mol_percentage,
    discount = EXCLUDED.discount,
    note = EXCLUDED.note;

INSERT INTO invoices (
    id,
    linked_sale_id,
    client_id,
    client_name,
    issue_date,
    due_date,
    status,
    subtotal,
    total,
    amount_paid,
    notes,
    created_at,
    updated_at
) VALUES
    ('dm_inv_01', NULL, 'dm_cli_02', 'Helios Energy Services S.r.l.', CURRENT_DATE - INTERVAL '18 days', CURRENT_DATE + INTERVAL '12 days', 'draft', 1090.00, 1090.00, 0.00, 'Editable draft invoice.', CURRENT_TIMESTAMP - INTERVAL '18 days', CURRENT_TIMESTAMP - INTERVAL '17 days'),
    ('dm_inv_02', NULL, 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '5 days', 'sent', 1795.00, 1795.00, 600.00, 'Partially paid invoice with remaining balance.', CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP - INTERVAL '5 days'),
    ('dm_inv_03', pg_temp.demo_document_code('client_order', 4), 'dm_cli_01', 'Northwind Retail Italia S.p.A.', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '10 days', 'paid', 6303.25, 6303.25, 6303.25, 'Fully paid invoice linked to the confirmed demo order.', CURRENT_TIMESTAMP - INTERVAL '20 days', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    ('dm_inv_04', NULL, 'dm_cli_01', 'Northwind Retail Italia S.p.A.', CURRENT_DATE - INTERVAL '45 days', CURRENT_DATE - INTERVAL '15 days', 'overdue', 10020.00, 10020.00, 0.00, 'Outstanding overdue invoice for collections reporting.', CURRENT_TIMESTAMP - INTERVAL '45 days', CURRENT_TIMESTAMP - INTERVAL '14 days'),
    ('dm_inv_05', NULL, 'dm_cli_04', 'Giulia Ferri', CURRENT_DATE - INTERVAL '12 days', CURRENT_DATE + INTERVAL '20 days', 'cancelled', 1600.00, 1600.00, 0.00, 'Cancelled invoice retained for status coverage.', CURRENT_TIMESTAMP - INTERVAL '12 days', CURRENT_TIMESTAMP - INTERVAL '11 days')
ON CONFLICT (id) DO UPDATE SET
    linked_sale_id = EXCLUDED.linked_sale_id,
    client_id = EXCLUDED.client_id,
    client_name = EXCLUDED.client_name,
    issue_date = EXCLUDED.issue_date,
    due_date = EXCLUDED.due_date,
    status = EXCLUDED.status,
    subtotal = EXCLUDED.subtotal,
    total = EXCLUDED.total,
    amount_paid = EXCLUDED.amount_paid,
    notes = EXCLUDED.notes,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO invoice_items (
    id,
    invoice_id,
    product_id,
    description,
    quantity,
    unit_price,
    discount
) VALUES
    ('dm_inv_item_01', 'dm_inv_01', 'dm_prd_04', 'Workshop Training Day', 1.00, 1090.00, 0.00),
    ('dm_inv_item_02', 'dm_inv_02', 'dm_prd_07', 'Managed Firewall Appliance', 1.00, 1795.00, 0.00),
    ('dm_inv_item_03', 'dm_inv_03', 'dm_prd_01', 'Strategy Assessment', 4.00, 1230.00, 5.00),
    ('dm_inv_item_04', 'dm_inv_03', 'dm_prd_02', 'Deployment Sprint', 1.00, 1715.00, 5.00),
    ('dm_inv_item_05', 'dm_inv_04', 'dm_prd_03', 'Managed Support Retainer', 12.00, 835.00, 0.00),
    ('dm_inv_item_06', 'dm_inv_05', 'dm_prd_08', 'Branded Print Kit', 10.00, 160.00, 0.00)
ON CONFLICT (id) DO UPDATE SET
    invoice_id = EXCLUDED.invoice_id,
    product_id = EXCLUDED.product_id,
    description = EXCLUDED.description,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    discount = EXCLUDED.discount;

INSERT INTO supplier_quotes (
    id,
    supplier_id,
    supplier_name,
    client_id,
    client_name,
    payment_terms,
    status,
    expiration_date,
    communication_channel_id,
    notes,
    created_at,
    updated_at
) VALUES
    (pg_temp.demo_document_code('supplier_quote', 1), 'dm_sup_01', 'TechSource Distribution', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 'draft', CURRENT_DATE + INTERVAL '35 days', 'qcc_email', 'Editable supplier quote for hardware procurement.', CURRENT_TIMESTAMP - INTERVAL '145 days', CURRENT_TIMESTAMP - INTERVAL '144 days'),
    (pg_temp.demo_document_code('supplier_quote', 2), 'dm_sup_02', 'CloudSeat Licensing', 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 'draft', CURRENT_DATE + INTERVAL '28 days', 'qcc_email', 'Sent supplier quote pending vendor response.', CURRENT_TIMESTAMP - INTERVAL '132 days', CURRENT_TIMESTAMP - INTERVAL '130 days'),
    (pg_temp.demo_document_code('supplier_quote', 3), 'dm_sup_03', 'SecureEdge Systems', 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 'draft', CURRENT_DATE + INTERVAL '26 days', 'qcc_email', 'Accepted supplier quote intentionally left without an offer.', CURRENT_TIMESTAMP - INTERVAL '118 days', CURRENT_TIMESTAMP - INTERVAL '114 days'),
    (pg_temp.demo_document_code('supplier_quote', 4), 'dm_sup_01', 'TechSource Distribution', 'dm_cli_04', 'Giulia Ferri', '30gg', 'draft', CURRENT_DATE + INTERVAL '24 days', 'qcc_email', 'In offer: driven by the draft offer on the linked client quote (#779 derived status).', CURRENT_TIMESTAMP - INTERVAL '104 days', CURRENT_TIMESTAMP - INTERVAL '100 days'),
    (pg_temp.demo_document_code('supplier_quote', 5), 'dm_sup_02', 'CloudSeat Licensing', 'dm_cli_05', 'Atlas Legacy Holdings', '45gg', 'draft', CURRENT_DATE + INTERVAL '20 days', 'qcc_email', 'In offer: driven by the sent offer on the linked client quote.', CURRENT_TIMESTAMP - INTERVAL '94 days', CURRENT_TIMESTAMP - INTERVAL '89 days'),
    (pg_temp.demo_document_code('supplier_quote', 6), 'dm_sup_03', 'SecureEdge Systems', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '60gg', 'draft', CURRENT_DATE + INTERVAL '18 days', 'qcc_email', 'Accepted supplier quote linked to an accepted offer ready for order creation.', CURRENT_TIMESTAMP - INTERVAL '82 days', CURRENT_TIMESTAMP - INTERVAL '78 days'),
    (pg_temp.demo_document_code('supplier_quote', 7), 'dm_sup_04', 'PrintLogistics Hub', 'dm_cli_02', 'Helios Energy Services S.r.l.', '30gg', 'draft', CURRENT_DATE + INTERVAL '16 days', 'qcc_email', 'Accepted supplier quote linked to an order already in progress.', CURRENT_TIMESTAMP - INTERVAL '70 days', CURRENT_TIMESTAMP - INTERVAL '66 days'),
    (pg_temp.demo_document_code('supplier_quote', 8), 'dm_sup_01', 'TechSource Distribution', 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '30gg', 'draft', CURRENT_DATE + INTERVAL '12 days', 'qcc_email', 'Denied: driven by the denied offer on the linked client quote.', CURRENT_TIMESTAMP - INTERVAL '60 days', CURRENT_TIMESTAMP - INTERVAL '57 days'),
    (pg_temp.demo_document_code('supplier_quote', 9), 'dm_sup_02', 'CloudSeat Licensing', 'dm_cli_04', 'Giulia Ferri', '45gg', 'draft', CURRENT_DATE + INTERVAL '9 days', 'qcc_email', 'Denied supplier quote kept for history coverage.', CURRENT_TIMESTAMP - INTERVAL '39 days', CURRENT_TIMESTAMP - INTERVAL '37 days'),
    (pg_temp.demo_document_code('supplier_quote', 10), 'dm_sup_04', 'PrintLogistics Hub', 'dm_cli_05', 'Atlas Legacy Holdings', '30gg', 'draft', CURRENT_DATE - INTERVAL '6 days', 'qcc_email', 'Expired supplier quote.', CURRENT_TIMESTAMP - INTERVAL '22 days', CURRENT_TIMESTAMP - INTERVAL '19 days'),
    (pg_temp.demo_document_code('supplier_quote', 11), 'dm_sup_01', 'TechSource Distribution', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 'draft', CURRENT_DATE + INTERVAL '14 days', 'qcc_email', 'Accepted supplier quote linked to a draft order for editable procurement flow.', CURRENT_TIMESTAMP - INTERVAL '52 days', CURRENT_TIMESTAMP - INTERVAL '48 days'),
    (pg_temp.demo_document_code('supplier_quote', 12), 'dm_sup_02', 'CloudSeat Licensing', 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 'draft', CURRENT_DATE + INTERVAL '11 days', 'qcc_email', 'Accepted supplier quote linked to a sent licensing order without an invoice.', CURRENT_TIMESTAMP - INTERVAL '41 days', CURRENT_TIMESTAMP - INTERVAL '36 days'),
    (pg_temp.demo_document_code('supplier_quote', 13), 'dm_sup_03', 'SecureEdge Systems', 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 'draft', CURRENT_DATE + INTERVAL '8 days', 'qcc_email', 'Accepted supplier quote linked to a sent order already invoiced.', CURRENT_TIMESTAMP - INTERVAL '32 days', CURRENT_TIMESTAMP - INTERVAL '27 days'),
    (pg_temp.demo_document_code('supplier_quote', 14), 'dm_sup_01', 'TechSource Distribution', 'dm_cli_04', 'Giulia Ferri', '30gg', 'draft', CURRENT_DATE + INTERVAL '6 days', 'qcc_email', 'Accepted supplier quote linked to a sent supplier order for history coverage.', CURRENT_TIMESTAMP - INTERVAL '24 days', CURRENT_TIMESTAMP - INTERVAL '20 days')
ON CONFLICT (id) DO UPDATE SET
    supplier_id = EXCLUDED.supplier_id,
    supplier_name = EXCLUDED.supplier_name,
    payment_terms = EXCLUDED.payment_terms,
    status = EXCLUDED.status,
    expiration_date = EXCLUDED.expiration_date,
    communication_channel_id = EXCLUDED.communication_channel_id,
    notes = EXCLUDED.notes,
    created_at = EXCLUDED.created_at,
    client_id = EXCLUDED.client_id,
    client_name = EXCLUDED.client_name,
    updated_at = EXCLUDED.updated_at;

INSERT INTO supplier_quote_items (
    id,
    quote_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    note
)
SELECT
    v.id,
    v.quote_id,
    p.id,
    p.name,
    v.quantity,
    v.unit_price,
    v.note
FROM (
    VALUES
        ('dm_sqi_01', pg_temp.demo_document_code('supplier_quote', 1), 'dm_prd_05', 8.00, 960.00, 'Draft laptop procurement lot'),
        ('dm_sqi_02', pg_temp.demo_document_code('supplier_quote', 2), 'dm_prd_05', 12.00, 960.00, 'Hardware refresh quote pending vendor response'),
        ('dm_sqi_03', pg_temp.demo_document_code('supplier_quote', 3), 'dm_prd_06', 40.00, 180.00, 'Subscription bundle quote, accepted, no downstream order'),
        ('dm_sqi_04', pg_temp.demo_document_code('supplier_quote', 4), 'dm_prd_01', 3.00, 980.00, 'Strategic assessment quote pending supplier order creation'),
        ('dm_sqi_05', pg_temp.demo_document_code('supplier_quote', 5), 'dm_prd_07', 2.00, 1435.00, 'Firewall appliance quote pending supplier order creation'),
        ('dm_sqi_06', pg_temp.demo_document_code('supplier_quote', 6), 'dm_prd_02', 1.00, 1370.00, 'Deployment sprint quote linked to an accepted offer'),
        ('dm_sqi_07', pg_temp.demo_document_code('supplier_quote', 7), 'dm_prd_08', 200.00, 118.00, 'Accepted quote feeding an order already in progress'),
        ('dm_sqi_08', pg_temp.demo_document_code('supplier_quote', 8), 'dm_prd_04', 2.00, 870.00, 'Training package quote, denied via its offer'),
        ('dm_sqi_09', pg_temp.demo_document_code('supplier_quote', 9), 'dm_prd_05', 3.00, 925.00, 'Denied hardware quote kept for history coverage'),
        ('dm_sqi_10', pg_temp.demo_document_code('supplier_quote', 10), 'dm_prd_08', 150.00, 119.00, 'Expired print procurement request'),
        ('dm_sqi_11', pg_temp.demo_document_code('supplier_quote', 11), 'dm_prd_05', 4.00, 960.00, 'Accepted quote feeding the editable draft procurement order'),
        ('dm_sqi_12', pg_temp.demo_document_code('supplier_quote', 12), 'dm_prd_06', 80.00, 182.00, 'Accepted quote feeding the sent licensing order'),
        ('dm_sqi_13', pg_temp.demo_document_code('supplier_quote', 13), 'dm_prd_07', 1.00, 1410.00, 'Accepted quote feeding the invoiced security order'),
        ('dm_sqi_14', pg_temp.demo_document_code('supplier_quote', 13), 'dm_prd_08', 40.00, 118.00, 'Accepted quote feeding the invoiced print materials order'),
        ('dm_sqi_15', pg_temp.demo_document_code('supplier_quote', 14), 'dm_prd_05', 2.00, 965.00, 'Accepted quote feeding the sent supplier order')
) AS v(id, quote_id, product_id, quantity, unit_price, note)
JOIN products p ON p.id = v.product_id
ON CONFLICT (id) DO UPDATE SET
    quote_id = EXCLUDED.quote_id,
    product_id = EXCLUDED.product_id,
    product_name = EXCLUDED.product_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    note = EXCLUDED.note;


-- #779 fully derived supplier-quote statuses, LINE-SOURCED (no header link): a supplier
-- quote's visible state follows the most-advanced client quote whose LINES source it
-- (quote_items.supplier_quote_id) and that quote's offer chain. The status mapping is the
-- same as the old 1-to-1 header link; only the mechanism moved to per-line sourcing.
--   FORN #01 sourced by nobody              -> Draft (selectable in the client-quote dialog)
--   FORN #02 <- PREV #02 line (sent)        -> Sent
--   FORN #03 <- PREV #03 line (accepted)    -> Accepted (no offer downstream)
--   FORN #04 <- PREV #04 line (draft offer)    -> Offer
--   FORN #05 <- PREV #05 line (sent offer)     -> Offer
--   FORN #06 <- PREV #06 line (accepted offer) -> Accepted
--   FORN #07 <- PREV #07 line (accepted offer) -> Accepted (supplier order in progress)
--   FORN #08 <- PREV #08 line (denied offer)   -> Denied
--   FORN #09 <- PREV #09 line (denied quote)   -> Denied
--   FORN #10 sourced by nobody              -> Expired (own past expiration date)
--   FORN #11..14 <- PREV #11..14 lines      -> Accepted (drivers for the seeded supplier orders)
-- The header column is vestigial under line sourcing; null it so nothing reads a stale link.
UPDATE quotes
SET linked_supplier_quote_id = NULL
WHERE id IN (SELECT code FROM pg_temp.demo_document_codes WHERE module_id = 'client_quote');

-- One representative line of each demo client quote sources its supplier quote. The stored
-- supplier_quote_unit_price is the supplier item's net cost and stays BELOW the line's sale
-- price, so every sourced line shows a healthy margin. Accepted/denied client quotes are
-- read-only, so their lines never surface the "Data drifted - sync?" chip even though the seeded
-- snapshot is a point-in-time copy; the one editable exception is PREV #02 below.
UPDATE quote_items AS qi SET
    supplier_quote_id = v.sq_id,
    supplier_quote_item_id = v.sqi_id,
    supplier_quote_supplier_name = v.supplier_name,
    supplier_quote_unit_price = v.unit_price
FROM (VALUES
    ('dm_cqi_04', pg_temp.demo_document_code('supplier_quote', 3), 'dm_sqi_03', 'SecureEdge Systems', 180.00),
    ('dm_cqi_05', pg_temp.demo_document_code('supplier_quote', 4), 'dm_sqi_04', 'TechSource Distribution', 980.00),
    ('dm_cqi_07', pg_temp.demo_document_code('supplier_quote', 5), 'dm_sqi_05', 'CloudSeat Licensing', 1435.00),
    ('dm_cqi_15', pg_temp.demo_document_code('supplier_quote', 6), 'dm_sqi_06', 'SecureEdge Systems', 1370.00),
    ('dm_cqi_09', pg_temp.demo_document_code('supplier_quote', 7), 'dm_sqi_07', 'PrintLogistics Hub', 118.00),
    ('dm_cqi_11', pg_temp.demo_document_code('supplier_quote', 8), 'dm_sqi_08', 'TechSource Distribution', 870.00),
    ('dm_cqi_12', pg_temp.demo_document_code('supplier_quote', 9), 'dm_sqi_09', 'CloudSeat Licensing', 925.00),
    ('dm_cqi_16', pg_temp.demo_document_code('supplier_quote', 11), 'dm_sqi_11', 'TechSource Distribution', 960.00),
    ('dm_cqi_17', pg_temp.demo_document_code('supplier_quote', 12), 'dm_sqi_12', 'CloudSeat Licensing', 182.00),
    ('dm_cqi_18', pg_temp.demo_document_code('supplier_quote', 13), 'dm_sqi_13', 'SecureEdge Systems', 1410.00),
    ('dm_cqi_19', pg_temp.demo_document_code('supplier_quote', 14), 'dm_sqi_15', 'TechSource Distribution', 965.00)
) AS v(cqi_id, sq_id, sqi_id, supplier_name, unit_price)
WHERE qi.id = v.cqi_id;

-- Editable stale-data demo (#779 reverse sync): PREV #02 is sent (still editable), so its
-- sourced line surfaces the "Data drifted - sync?" chip because the stored snapshot price (940)
-- sits behind dm_sqi_02's current net cost (960). Refreshing pulls the live supplier values.
UPDATE quote_items SET
    supplier_quote_id = pg_temp.demo_document_code('supplier_quote', 2),
    supplier_quote_item_id = 'dm_sqi_02',
    supplier_quote_supplier_name = 'CloudSeat Licensing',
    supplier_quote_unit_price = 940.00
WHERE id = 'dm_cqi_03';

INSERT INTO supplier_sales (
    id,
    linked_quote_id,
    supplier_id,
    supplier_name,
    payment_terms,
    discount,
    status,
    notes,
    created_at,
    updated_at
) VALUES
    (pg_temp.demo_document_code('supplier_order', 1), pg_temp.demo_document_code('supplier_quote', 11), 'dm_sup_01', 'TechSource Distribution', '30gg', 0.00, 'draft', 'Editable supplier order generated from an accepted hardware quote.', CURRENT_TIMESTAMP - INTERVAL '40 days', CURRENT_TIMESTAMP - INTERVAL '39 days'),
    (pg_temp.demo_document_code('supplier_order', 2), pg_temp.demo_document_code('supplier_quote', 7), 'dm_sup_04', 'PrintLogistics Hub', '30gg', 2.00, 'sent', 'Linked supplier order already in progress.', CURRENT_TIMESTAMP - INTERVAL '31 days', CURRENT_TIMESTAMP - INTERVAL '29 days'),
    (pg_temp.demo_document_code('supplier_order', 3), pg_temp.demo_document_code('supplier_quote', 12), 'dm_sup_02', 'CloudSeat Licensing', '45gg', 0.00, 'sent', 'Sent supplier order generated from an accepted licensing quote and intentionally left without an invoice.', CURRENT_TIMESTAMP - INTERVAL '27 days', CURRENT_TIMESTAMP - INTERVAL '24 days'),
    (pg_temp.demo_document_code('supplier_order', 4), pg_temp.demo_document_code('supplier_quote', 13), 'dm_sup_03', 'SecureEdge Systems', '60gg', 0.00, 'sent', 'Sent supplier order generated from an accepted security quote and already invoiced.', CURRENT_TIMESTAMP - INTERVAL '20 days', CURRENT_TIMESTAMP - INTERVAL '17 days'),
    (pg_temp.demo_document_code('supplier_order', 5), pg_temp.demo_document_code('supplier_quote', 14), 'dm_sup_01', 'TechSource Distribution', '30gg', 0.00, 'sent', 'Sent supplier order generated from an accepted quote for history coverage.', CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP - INTERVAL '13 days')
ON CONFLICT (id) DO UPDATE SET
    linked_quote_id = EXCLUDED.linked_quote_id,
    supplier_id = EXCLUDED.supplier_id,
    supplier_name = EXCLUDED.supplier_name,
    payment_terms = EXCLUDED.payment_terms,
    discount = EXCLUDED.discount,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO supplier_sale_items (
    id,
    sale_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    discount,
    note
)
SELECT
    v.id,
    v.sale_id,
    p.id,
    p.name,
    v.quantity,
    v.unit_price,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_ssi_01', pg_temp.demo_document_code('supplier_order', 1), 'dm_prd_05', 4.00, 960.00, 0.00, 'Draft hardware procurement order'),
        ('dm_ssi_02', pg_temp.demo_document_code('supplier_order', 2), 'dm_prd_08', 200.00, 118.00, 2.00, 'Linked print procurement order in sent status'),
        ('dm_ssi_03', pg_temp.demo_document_code('supplier_order', 3), 'dm_prd_06', 80.00, 182.00, 0.00, 'Sent licensing order without invoice'),
        ('dm_ssi_04', pg_temp.demo_document_code('supplier_order', 4), 'dm_prd_07', 1.00, 1410.00, 0.00, 'Sent security appliance order'),
        ('dm_ssi_05', pg_temp.demo_document_code('supplier_order', 4), 'dm_prd_08', 40.00, 118.00, 0.00, 'Sent print materials order'),
        ('dm_ssi_06', pg_temp.demo_document_code('supplier_order', 5), 'dm_prd_05', 2.00, 965.00, 0.00, 'Sent supplier hardware order')
) AS v(id, sale_id, product_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id
ON CONFLICT (id) DO UPDATE SET
    sale_id = EXCLUDED.sale_id,
    product_id = EXCLUDED.product_id,
    product_name = EXCLUDED.product_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    discount = EXCLUDED.discount,
    note = EXCLUDED.note;

INSERT INTO supplier_invoices (
    id,
    linked_sale_id,
    supplier_id,
    supplier_name,
    issue_date,
    due_date,
    status,
    subtotal,
    total,
    amount_paid,
    notes,
    created_at,
    updated_at
) VALUES
    ('dm_sinv_01', NULL, 'dm_sup_01', 'TechSource Distribution', CURRENT_DATE - INTERVAL '18 days', CURRENT_DATE + INTERVAL '12 days', 'draft', 1920.00, 1920.00, 0.00, 'Editable draft supplier invoice.', CURRENT_TIMESTAMP - INTERVAL '18 days', CURRENT_TIMESTAMP - INTERVAL '17 days'),
    ('dm_sinv_02', NULL, 'dm_sup_02', 'CloudSeat Licensing', CURRENT_DATE - INTERVAL '32 days', CURRENT_DATE + INTERVAL '3 days', 'sent', 14560.00, 14560.00, 4000.00, 'Partially settled supplier invoice kept in sent state.', CURRENT_TIMESTAMP - INTERVAL '32 days', CURRENT_TIMESTAMP - INTERVAL '6 days'),
    ('dm_sinv_03', pg_temp.demo_document_code('supplier_order', 4), 'dm_sup_03', 'SecureEdge Systems', CURRENT_DATE - INTERVAL '19 days', CURRENT_DATE + INTERVAL '11 days', 'paid', 6130.00, 6130.00, 6130.00, 'Paid supplier invoice linked to a sent order.', CURRENT_TIMESTAMP - INTERVAL '19 days', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    ('dm_sinv_04', NULL, 'dm_sup_04', 'PrintLogistics Hub', CURRENT_DATE - INTERVAL '48 days', CURRENT_DATE - INTERVAL '12 days', 'overdue', 23600.00, 23600.00, 0.00, 'Overdue supplier invoice kept for state coverage.', CURRENT_TIMESTAMP - INTERVAL '48 days', CURRENT_TIMESTAMP - INTERVAL '10 days'),
    ('dm_sinv_05', NULL, 'dm_sup_01', 'TechSource Distribution', CURRENT_DATE - INTERVAL '11 days', CURRENT_DATE + INTERVAL '18 days', 'cancelled', 960.00, 960.00, 0.00, 'Cancelled supplier invoice kept for state coverage.', CURRENT_TIMESTAMP - INTERVAL '11 days', CURRENT_TIMESTAMP - INTERVAL '10 days')
ON CONFLICT (id) DO UPDATE SET
    linked_sale_id = EXCLUDED.linked_sale_id,
    supplier_id = EXCLUDED.supplier_id,
    supplier_name = EXCLUDED.supplier_name,
    issue_date = EXCLUDED.issue_date,
    due_date = EXCLUDED.due_date,
    status = EXCLUDED.status,
    subtotal = EXCLUDED.subtotal,
    total = EXCLUDED.total,
    amount_paid = EXCLUDED.amount_paid,
    notes = EXCLUDED.notes,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

INSERT INTO supplier_invoice_items (
    id,
    invoice_id,
    product_id,
    description,
    quantity,
    unit_price,
    discount
) VALUES
    ('dm_sinv_item_01', 'dm_sinv_01', 'dm_prd_05', 'Business Laptop Bundle', 2.00, 960.00, 0.00),
    ('dm_sinv_item_02', 'dm_sinv_02', 'dm_prd_06', 'Microsoft 365 Annual Seat', 80.00, 182.00, 0.00),
    ('dm_sinv_item_03', 'dm_sinv_03', 'dm_prd_07', 'Managed Firewall Appliance', 1.00, 1410.00, 0.00),
    ('dm_sinv_item_04', 'dm_sinv_03', 'dm_prd_08', 'Branded Print Kit', 40.00, 118.00, 0.00),
    ('dm_sinv_item_05', 'dm_sinv_04', 'dm_prd_08', 'Branded Print Kit', 200.00, 118.00, 0.00),
    ('dm_sinv_item_06', 'dm_sinv_05', 'dm_prd_05', 'Business Laptop Bundle', 1.00, 960.00, 0.00)
ON CONFLICT (id) DO UPDATE SET
    invoice_id = EXCLUDED.invoice_id,
    product_id = EXCLUDED.product_id,
    description = EXCLUDED.description,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    discount = EXCLUDED.discount;

-- Demo delivery projects generated from the confirmed client order #04 (offer #03 <-
-- quote #06), all for client dm_cli_01. order_id/offer_id mirror the chain the app
-- enforces when a project is created (offer + client must match). start_date/end_date wrap
-- the dm_te_21..dm_te_25 time entries below, and revenue splits the order/invoice total of
-- 6303.25 across the two product lines (assessment 4674.00 + deployment 1629.25).
INSERT INTO projects (
    id,
    name,
    client_id,
    description,
    is_disabled,
    created_at,
    order_id,
    offer_id,
    start_date,
    end_date,
    revenue,
    tipo,
    tipo_confirmed
) VALUES
    (
        'dm_proj_01',
        'DM-CLI-001_DM-SVC-AUDIT_' || TO_CHAR(CURRENT_DATE, 'YYYY'),
        'dm_cli_01',
        'Assessment track for operations',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '18 days',
        pg_temp.demo_document_code('client_order', 4),
        pg_temp.demo_document_code('client_offer', 3),
        (CURRENT_DATE - INTERVAL '18 days')::date,
        (CURRENT_DATE + INTERVAL '30 days')::date,
        4674.00, 'attivo', TRUE
    ),
    (
        'dm_proj_02',
        'DM-CLI-001_DM-SVC-DEPLOY_' || TO_CHAR(CURRENT_DATE, 'YYYY'),
        'dm_cli_01',
        'Deployment wave for phase one',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '18 days',
        pg_temp.demo_document_code('client_order', 4),
        pg_temp.demo_document_code('client_offer', 3),
        (CURRENT_DATE - INTERVAL '18 days')::date,
        (CURRENT_DATE + INTERVAL '60 days')::date,
        1629.25, 'attivo', TRUE
    )
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    client_id = EXCLUDED.client_id,
    description = EXCLUDED.description,
    is_disabled = EXCLUDED.is_disabled,
    created_at = EXCLUDED.created_at,
    order_id = EXCLUDED.order_id,
    offer_id = EXCLUDED.offer_id,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    revenue = EXCLUDED.revenue,
    tipo = EXCLUDED.tipo,
    tipo_confirmed = EXCLUDED.tipo_confirmed;

-- Tasks for the demo projects above. Without these rows the second time_entries block
-- below resolves task_id to NULL because it looks up tasks by (project_id, name). See
-- GitHub issue #423.
INSERT INTO tasks (id, name, project_id, description) VALUES
    ('dm_task_01', 'Security audit review',    'dm_proj_01', 'Pen-test findings walkthrough with the client.'),
    ('dm_task_02', 'Assessment report draft',  'dm_proj_01', 'Executive summary and remediation roadmap.'),
    ('dm_task_03', 'Final review sign-off',    'dm_proj_01', 'Client sign-off and deliverable handoff.'),
    ('dm_task_04', 'Deployment configuration', 'dm_proj_02', 'CI pipeline and staging environment setup.'),
    ('dm_task_05', 'Infra provisioning',       'dm_proj_02', 'Cloud resources for the first deployment wave.')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    project_id = EXCLUDED.project_id,
    description = EXCLUDED.description;

INSERT INTO notifications (
    id,
    user_id,
    type,
    title,
    message,
    data,
    is_read,
    created_at
) VALUES
    (
        'dm_notif_01',
        'u2',
        'new_projects',
        '2 new projects available',
        'Projects generated from confirmed demo order.',
        jsonb_build_object(
            'projectNames',
            jsonb_build_array(
                'DM-CLI-001_DM-SVC-AUDIT_' || TO_CHAR(CURRENT_DATE, 'YYYY'),
                'DM-CLI-001_DM-SVC-DEPLOY_' || TO_CHAR(CURRENT_DATE, 'YYYY')
            ),
            'orderId',
            pg_temp.demo_document_code('client_order', 4),
            'clientName',
            'Northwind Retail Italia S.p.A.'
        ),
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '17 days'
    ),
    (
        'dm_notif_02',
        'u1',
        'new_projects',
        '2 new projects available',
        'Projects generated from confirmed demo order.',
        jsonb_build_object(
            'projectNames',
            jsonb_build_array(
                'DM-CLI-001_DM-SVC-AUDIT_' || TO_CHAR(CURRENT_DATE, 'YYYY'),
                'DM-CLI-001_DM-SVC-DEPLOY_' || TO_CHAR(CURRENT_DATE, 'YYYY')
            ),
            'orderId',
            pg_temp.demo_document_code('client_order', 4),
            'clientName',
            'Northwind Retail Italia S.p.A.'
        ),
        TRUE,
        CURRENT_TIMESTAMP - INTERVAL '16 days'
    )
ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    type = EXCLUDED.type,
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    data = EXCLUDED.data,
    is_read = EXCLUDED.is_read,
    created_at = EXCLUDED.created_at;

INSERT INTO work_units (id, name, description, is_disabled, created_at) VALUES
    ('dm_wu_01', 'Development Team', 'Frontend and backend engineering.', FALSE, CURRENT_TIMESTAMP - INTERVAL '180 days'),
    ('dm_wu_02', 'Sales & Marketing', 'Customer acquisition and brand management.', FALSE, CURRENT_TIMESTAMP - INTERVAL '160 days'),
    ('dm_wu_03', 'IT Operations', 'Infrastructure, support, and cross-team ops.', FALSE, CURRENT_TIMESTAMP - INTERVAL '140 days')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_disabled = EXCLUDED.is_disabled,
    created_at = EXCLUDED.created_at;

INSERT INTO work_unit_managers (work_unit_id, user_id) VALUES
    ('dm_wu_01', 'u2'),
    ('dm_wu_02', 'u4'),
    ('dm_wu_03', 'u2'),
    ('dm_wu_03', 'u4'),
    ('dm_wu_01', 'u9'),
    ('dm_wu_02', 'u9'),
    ('dm_wu_03', 'u9')
ON CONFLICT (work_unit_id, user_id) DO NOTHING;

INSERT INTO user_work_units (user_id, work_unit_id) VALUES
    ('u2', 'dm_wu_01'),
    ('u3', 'dm_wu_01'),
    ('u5', 'dm_wu_01'),
    ('u6', 'dm_wu_01'),
    ('u4', 'dm_wu_02'),
    ('u7', 'dm_wu_02'),
    ('u8', 'dm_wu_02'),
    ('u2', 'dm_wu_03'),
    ('u4', 'dm_wu_03'),
    ('u5', 'dm_wu_03'),
    ('u7', 'dm_wu_03'),
    ('u9', 'dm_wu_01'),
    ('u9', 'dm_wu_02'),
    ('u9', 'dm_wu_03')
ON CONFLICT (user_id, work_unit_id) DO NOTHING;

INSERT INTO user_clients (user_id, client_id, assignment_source) VALUES
    ('u2', 'c1',        'manual'),
    ('u2', 'c2',        'manual'),
    ('u2', 'dm_cli_01', 'manual'),
    ('u3', 'c1',        'manual'),
    ('u3', 'dm_cli_01', 'manual'),
    ('u4', 'c1',        'manual'),
    ('u4', 'c2',        'manual'),
    ('u4', 'dm_cli_01', 'manual'),
    ('u5', 'c1',        'manual'),
    ('u5', 'dm_cli_01', 'manual'),
    ('u6', 'c1',        'manual'),
    ('u6', 'dm_cli_01', 'manual'),
    ('u7', 'c2',        'manual'),
    ('u8', 'c2',        'manual')
ON CONFLICT (user_id, client_id) DO NOTHING;

INSERT INTO user_projects (user_id, project_id, assignment_source) VALUES
    ('u2', 'p1',        'manual'),
    ('u2', 'p2',        'manual'),
    ('u2', 'p3',        'manual'),
    ('u2', 'dm_proj_01','manual'),
    ('u2', 'dm_proj_02','manual'),
    ('u3', 'p1',        'manual'),
    ('u3', 'p2',        'manual'),
    ('u3', 'dm_proj_02','manual'),
    ('u4', 'p1',        'manual'),
    ('u4', 'p2',        'manual'),
    ('u4', 'p3',        'manual'),
    ('u4', 'dm_proj_01','manual'),
    ('u4', 'dm_proj_02','manual'),
    ('u5', 'p1',        'manual'),
    ('u5', 'p2',        'manual'),
    ('u5', 'dm_proj_02','manual'),
    ('u6', 'p1',        'manual'),
    ('u6', 'p2',        'manual'),
    ('u6', 'dm_proj_01','manual'),
    ('u7', 'p3',        'manual'),
    ('u8', 'p3',        'manual')
ON CONFLICT (user_id, project_id) DO NOTHING;

INSERT INTO user_tasks (user_id, task_id, assignment_source) VALUES
    ('u2', 't1', 'manual'),
    ('u2', 't2', 'manual'),
    ('u2', 't3', 'manual'),
    ('u2', 't4', 'manual'),
    ('u3', 't1', 'manual'),
    ('u3', 't2', 'manual'),
    ('u3', 't3', 'manual'),
    ('u4', 't1', 'manual'),
    ('u4', 't2', 'manual'),
    ('u4', 't3', 'manual'),
    ('u4', 't4', 'manual'),
    ('u5', 't1', 'manual'),
    ('u5', 't2', 'manual'),
    ('u5', 't3', 'manual'),
    ('u6', 't1', 'manual'),
    ('u6', 't2', 'manual'),
    ('u6', 't3', 'manual'),
    ('u7', 't4', 'manual'),
    ('u8', 't4', 'manual'),
    ('u2', 't5', 'manual'),
    ('u3', 't5', 'manual'),
    ('u4', 't5', 'manual'),
    ('u7', 't5', 'manual'),
    ('u8', 't5', 'manual'),
    ('u2', 'dm_task_01', 'manual'),
    ('u6', 'dm_task_02', 'manual'),
    ('u2', 'dm_task_03', 'manual'),
    ('u5', 'dm_task_04', 'manual'),
    ('u3', 'dm_task_05', 'manual')
ON CONFLICT (user_id, task_id) DO NOTHING;

INSERT INTO time_entries (
    id, user_id, date, client_id, client_name, project_id, project_name,
    task, task_id, notes, duration, hourly_cost, is_placeholder, location
)
SELECT
    v.id, v.user_id, v.entry_date, v.client_id, v.client_name, v.project_id, v.project_name,
    v.task,
    (SELECT t.id FROM tasks t WHERE t.project_id = v.project_id AND t.name = v.task ORDER BY t.id LIMIT 1),
    v.notes, v.duration, v.hourly_cost, v.is_placeholder, v.location
FROM (VALUES
    ('dm_te_01', 'u3',  CURRENT_DATE - INTERVAL '28 days', 'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Initial Design',       'Wireframe sketches for homepage',          6.00, 45.00, FALSE, 'office'),
    ('dm_te_02', 'u3',  CURRENT_DATE - INTERVAL '27 days', 'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Frontend Dev',         'Implement header and nav components',      7.50, 45.00, FALSE, 'office'),
    ('dm_te_03', 'u5',  CURRENT_DATE - INTERVAL '26 days', 'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Frontend Dev',         'Build hero section and CTA blocks',        8.00, 50.00, FALSE, 'remote'),
    ('dm_te_04', 'u5',  CURRENT_DATE - INTERVAL '25 days', 'c1', 'Acme Corp',    'p2', 'Mobile App',         'API Integration',      'Wire up authentication endpoints',         4.00, 50.00, FALSE, 'remote'),
    ('dm_te_05', 'u6',  CURRENT_DATE - INTERVAL '24 days', 'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Frontend Dev',         'Responsive layout for mobile breakpoints', 7.00, 40.00, FALSE, 'office'),
    ('dm_te_06', 'u6',  CURRENT_DATE - INTERVAL '23 days', 'c1', 'Acme Corp',    'p2', 'Mobile App',         'API Integration',      'Connect product listing to backend',       5.50, 40.00, FALSE, 'remote'),
    ('dm_te_07', 'u2',  CURRENT_DATE - INTERVAL '22 days', 'c2', 'Global Tech',  'p3', 'Internal Research',  'General Support',      'Sprint kickoff and backlog grooming',      3.00, 65.00, FALSE, 'office'),
    ('dm_te_08', 'u7',  CURRENT_DATE - INTERVAL '21 days', 'c2', 'Global Tech',  'p3', 'Internal Research',  'Market Analysis',      'Competitive landscape research',           6.00, 55.00, FALSE, 'remote'),
    ('dm_te_09', 'u3',  CURRENT_DATE - INTERVAL '20 days', 'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Frontend Dev',         'Code review and refactor pass',            4.50, 45.00, FALSE, 'remote'),
    ('dm_te_10', 'u5',  CURRENT_DATE - INTERVAL '19 days', 'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Frontend Dev',         'Accessibility audit and fixes',            3.50, 50.00, FALSE, 'remote'),
    ('dm_te_11', 'u6',  CURRENT_DATE - INTERVAL '18 days', 'c1', 'Acme Corp',    'p2', 'Mobile App',         'API Integration',      'UI polish on product detail screen',       6.00, 40.00, FALSE, 'office'),
    ('dm_te_12', 'u2',  CURRENT_DATE - INTERVAL '17 days', 'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Initial Design',       'Sprint planning and story pointing',       2.00, 65.00, FALSE, 'office'),
    ('dm_te_13', 'u7',  CURRENT_DATE - INTERVAL '15 days', 'c2', 'Global Tech',  'p3', 'Internal Research',  'Market Analysis',      'Competitor pricing analysis report',       7.00, 55.00, FALSE, 'remote'),
    ('dm_te_14', 'u3',  CURRENT_DATE - INTERVAL '14 days', 'c1', 'Acme Corp',    'p2', 'Mobile App',         'API Integration',      'Integration testing against staging env',  5.00, 45.00, FALSE, 'office'),
    ('dm_te_15', 'u5',  CURRENT_DATE - INTERVAL '12 days', 'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Frontend Dev',         'Performance profiling and bundle tuning',  4.00, 50.00, FALSE, 'remote'),
    ('dm_te_16', 'u6',  CURRENT_DATE - INTERVAL '10 days', 'c1', 'Acme Corp',    'p2', 'Mobile App',         'API Integration',      'Bug fixes from QA round two',              6.50, 40.00, FALSE, 'office'),
    ('dm_te_17', 'u2',  CURRENT_DATE - INTERVAL '8 days',  'c2', 'Global Tech',  'p3', 'Internal Research',  'General Support',      'Status report for stakeholders',           1.50, 65.00, FALSE, 'remote'),
    ('dm_te_18', 'u7',  CURRENT_DATE - INTERVAL '6 days',  'c2', 'Global Tech',  'p3', 'Internal Research',  'Market Analysis',      'On-site data collection interviews',       5.00, 55.00, FALSE, 'customer_premise'),
    ('dm_te_19', 'u3',  CURRENT_DATE - INTERVAL '4 days',  'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Frontend Dev',         'Final QA pass before handoff',             8.00, 45.00, FALSE, 'office'),
    ('dm_te_20', 'u5',  CURRENT_DATE - INTERVAL '2 days',  'c1', 'Acme Corp',    'p1', 'Website Redesign',   'Frontend Dev',         'Deployment preparation and smoke test',    3.00, 50.00, FALSE, 'remote')
) AS v(id, user_id, entry_date, client_id, client_name, project_id, project_name, task, notes, duration, hourly_cost, is_placeholder, location)
ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    date = EXCLUDED.date,
    client_id = EXCLUDED.client_id,
    client_name = EXCLUDED.client_name,
    project_id = EXCLUDED.project_id,
    project_name = EXCLUDED.project_name,
    task = EXCLUDED.task,
    task_id = EXCLUDED.task_id,
    notes = EXCLUDED.notes,
    duration = EXCLUDED.duration,
    hourly_cost = EXCLUDED.hourly_cost,
    is_placeholder = EXCLUDED.is_placeholder,
    location = EXCLUDED.location;

INSERT INTO time_entries (
    id, user_id, date, client_id, client_name, project_id, project_name,
    task, task_id, notes, duration, hourly_cost, is_placeholder, location
)
SELECT
    v.id, v.user_id, v.entry_date::date,
    v.client_id, v.client_name, v.project_id,
    p.name,
    v.task,
    (SELECT t.id FROM tasks t WHERE t.project_id = v.project_id AND t.name = v.task ORDER BY t.id LIMIT 1),
    v.notes, v.duration, v.hourly_cost, v.is_placeholder, v.location
FROM (VALUES
    ('dm_te_21', 'u2',  CURRENT_DATE - INTERVAL '16 days', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', 'dm_proj_01', 'Security audit review',         'Reviewed pen-test findings with client',          3.00, 65.00, FALSE, 'office'),
    ('dm_te_22', 'u5',  CURRENT_DATE - INTERVAL '13 days', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', 'dm_proj_02', 'Deployment configuration',      'Set up CI pipeline and staging environment',      5.00, 50.00, FALSE, 'remote'),
    ('dm_te_23', 'u6',  CURRENT_DATE - INTERVAL '9 days',  'dm_cli_01', 'Northwind Retail Italia S.p.A.', 'dm_proj_01', 'Assessment report draft',       'Drafted executive summary and findings',          4.50, 40.00, FALSE, 'office'),
    ('dm_te_24', 'u3',  CURRENT_DATE - INTERVAL '7 days',  'dm_cli_01', 'Northwind Retail Italia S.p.A.', 'dm_proj_02', 'Infra provisioning',            'Provisioned cloud resources for first wave',      6.00, 45.00, FALSE, 'remote'),
    ('dm_te_25', 'u2',  CURRENT_DATE - INTERVAL '3 days',  'dm_cli_01', 'Northwind Retail Italia S.p.A.', 'dm_proj_01', 'Final review sign-off',         'Client sign-off meeting and deliverable handoff', 2.00, 65.00, FALSE, 'customer_premise')
) AS v(id, user_id, entry_date, client_id, client_name, project_id, task, notes, duration, hourly_cost, is_placeholder, location)
JOIN projects p ON p.id = v.project_id
ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    date = EXCLUDED.date,
    client_id = EXCLUDED.client_id,
    client_name = EXCLUDED.client_name,
    project_id = EXCLUDED.project_id,
    project_name = EXCLUDED.project_name,
    task = EXCLUDED.task,
    task_id = EXCLUDED.task_id,
    notes = EXCLUDED.notes,
    duration = EXCLUDED.duration,
    hourly_cost = EXCLUDED.hourly_cost,
    is_placeholder = EXCLUDED.is_placeholder,
    location = EXCLUDED.location;
