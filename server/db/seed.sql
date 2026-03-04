-- Seed data for Praetor

-- Default users (password is 'password' for all, hashed with bcrypt cost 10)
-- To generate: require('bcrypt').hashSync('password', 10)
INSERT INTO users (id, name, username, password_hash, role, avatar_initials) VALUES
    ('u1', 'Admin User', 'admin', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'admin', 'AD'),
    ('u2', 'Manager User', 'manager', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'manager', 'MG'),
    ('u3', 'Standard User', 'user', '$2a$12$z5H7VrzTpLImYWSH3xufKufCiGB0n9CSlNMOrRBRIxq.6mvuVS7uy', 'user', 'US')
ON CONFLICT DO NOTHING;

-- Ensure default users have matching rows in user_roles
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, u.role
FROM users u
WHERE u.id IN ('u1', 'u2', 'u3')
ON CONFLICT DO NOTHING;

-- Lightweight defaults kept for compatibility with existing frontend constants
INSERT INTO clients (id, name, created_at) VALUES
    ('c1', 'Acme Corp', '2024-01-15 09:30:00'),
    ('c2', 'Global Tech', '2024-03-05 14:15:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (id, name, client_id, color, description) VALUES
    ('p1', 'Website Redesign', 'c1', '#3b82f6', 'Complete overhaul of the main marketing site.'),
    ('p2', 'Mobile App', 'c1', '#10b981', 'Native iOS and Android application development.'),
    ('p3', 'Internal Research', 'c2', '#8b5cf6', 'Ongoing research into new market trends.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, name, project_id, description) VALUES
    ('t1', 'Initial Design', 'p1', 'Lo-fi wireframes and moodboards.'),
    ('t2', 'Frontend Dev', 'p1', 'React component implementation.'),
    ('t3', 'API Integration', 'p2', 'Connecting the app to the backend services.'),
    ('t4', 'General Support', 'p3', 'Misc administrative tasks and support.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (user_id, full_name, email) VALUES
    ('u1', 'Admin User', 'admin@example.com'),
    ('u2', 'Manager User', 'manager@example.com'),
    ('u3', 'Standard User', 'user@example.com')
ON CONFLICT (user_id) DO NOTHING;

-- Refreshable demo dataset.
-- Demo records intentionally use dm_* ids and DM-* business codes so reseeding can refresh only
-- the curated showcase data without touching user-entered records.
BEGIN;

DELETE FROM notifications
WHERE id LIKE 'dm_%';

DELETE FROM expenses
WHERE id LIKE 'dm_%'
   OR supplier_invoice_id LIKE 'dm_%';

DELETE FROM payments
WHERE id LIKE 'dm_%';

DELETE FROM supplier_invoices
WHERE id LIKE 'dm_%'
   OR invoice_number LIKE 'DM-%';

DELETE FROM supplier_sales
WHERE id LIKE 'dm_%';

DELETE FROM supplier_offers
WHERE id LIKE 'dm_%'
   OR offer_code LIKE 'DM-%';

DELETE FROM supplier_quotes
WHERE id LIKE 'dm_%'
   OR quote_code LIKE 'DM-%'
   OR purchase_order_number LIKE 'DM-%';

DELETE FROM invoices
WHERE id LIKE 'dm_%'
   OR invoice_number LIKE 'DM-%';

DELETE FROM sales
WHERE id LIKE 'dm_%';

DELETE FROM customer_offers
WHERE id LIKE 'dm_%'
   OR offer_code LIKE 'DM-%';

DELETE FROM quotes
WHERE id LIKE 'dm_%'
   OR quote_code LIKE 'DM-%';

DELETE FROM special_bids
WHERE id LIKE 'dm_%';

DELETE FROM projects
WHERE id LIKE 'dm_%';

DELETE FROM products
WHERE id LIKE 'dm_%';

DELETE FROM clients
WHERE id LIKE 'dm_%';

DELETE FROM suppliers
WHERE id LIKE 'dm_%';

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
    );

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
        'Security supplier used for confirmed purchase flow and paid supplier invoice coverage.',
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
    );

INSERT INTO products (
    id,
    name,
    product_code,
    costo,
    mol_percentage,
    cost_unit,
    category,
    subcategory,
    tax_rate,
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
        22.00,
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
        22.00,
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
        'unit',
        'Services',
        'Managed Services',
        22.00,
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
        'unit',
        'Advisory',
        'Training',
        22.00,
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
        22.00,
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
        22.00,
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
        22.00,
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
        22.00,
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
        22.00,
        'supply',
        'Disabled product kept only to demonstrate inactive catalog records.',
        'dm_sup_05',
        TRUE,
        CURRENT_TIMESTAMP - INTERVAL '155 days'
    );

INSERT INTO special_bids (
    id,
    client_id,
    client_name,
    product_id,
    product_name,
    unit_price,
    mol_percentage,
    start_date,
    end_date,
    created_at,
    updated_at
) VALUES
    (
        'dm_bid_01',
        'dm_cli_01',
        'Northwind Retail Italia S.p.A.',
        'dm_prd_06',
        'Microsoft 365 Annual Seat',
        210.00,
        14.29,
        CURRENT_DATE - INTERVAL '20 days',
        CURRENT_DATE + INTERVAL '40 days',
        CURRENT_TIMESTAMP - INTERVAL '45 days',
        CURRENT_TIMESTAMP - INTERVAL '7 days'
    ),
    (
        'dm_bid_02',
        'dm_cli_02',
        'Helios Energy Services S.r.l.',
        'dm_prd_05',
        'Business Laptop Bundle',
        1085.00,
        12.44,
        CURRENT_DATE - INTERVAL '80 days',
        CURRENT_DATE - INTERVAL '10 days',
        CURRENT_TIMESTAMP - INTERVAL '90 days',
        CURRENT_TIMESTAMP - INTERVAL '12 days'
    ),
    (
        'dm_bid_03',
        'dm_cli_03',
        'Comune di Verona - Innovazione Digitale',
        'dm_prd_08',
        'Branded Print Kit',
        145.00,
        17.24,
        CURRENT_DATE + INTERVAL '15 days',
        CURRENT_DATE + INTERVAL '75 days',
        CURRENT_TIMESTAMP - INTERVAL '15 days',
        CURRENT_TIMESTAMP - INTERVAL '2 days'
    );

INSERT INTO quotes (
    id,
    quote_code,
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
    ('dm_cq_01', 'DM-Q-2601', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 2.00, 'draft', CURRENT_DATE + INTERVAL '45 days', 'Editable draft quote with two services.', CURRENT_TIMESTAMP - INTERVAL '150 days', CURRENT_TIMESTAMP - INTERVAL '149 days'),
    ('dm_cq_02', 'DM-Q-2602', 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 3.00, 'sent', CURRENT_DATE + INTERVAL '22 days', 'Sent quote waiting for customer feedback.', CURRENT_TIMESTAMP - INTERVAL '130 days', CURRENT_TIMESTAMP - INTERVAL '126 days'),
    ('dm_cq_03', 'DM-Q-2603', 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '28 days', 'Accepted quote intentionally left without an offer to expose the CTA.', CURRENT_TIMESTAMP - INTERVAL '112 days', CURRENT_TIMESTAMP - INTERVAL '108 days'),
    ('dm_cq_04', 'DM-Q-2604', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 4.00, 'accepted', CURRENT_DATE + INTERVAL '30 days', 'Accepted quote with a draft offer downstream.', CURRENT_TIMESTAMP - INTERVAL '101 days', CURRENT_TIMESTAMP - INTERVAL '96 days'),
    ('dm_cq_05', 'DM-Q-2605', 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 1.50, 'accepted', CURRENT_DATE + INTERVAL '26 days', 'Accepted quote with a sent offer downstream.', CURRENT_TIMESTAMP - INTERVAL '92 days', CURRENT_TIMESTAMP - INTERVAL '88 days'),
    ('dm_cq_06', 'DM-Q-2606', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '24 days', 'Accepted quote linked to an accepted offer that is ready to become an order.', CURRENT_TIMESTAMP - INTERVAL '78 days', CURRENT_TIMESTAMP - INTERVAL '72 days'),
    ('dm_cq_07', 'DM-Q-2607', 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 2.50, 'accepted', CURRENT_DATE + INTERVAL '20 days', 'Accepted quote linked to an accepted offer that already generated an order.', CURRENT_TIMESTAMP - INTERVAL '66 days', CURRENT_TIMESTAMP - INTERVAL '61 days'),
    ('dm_cq_08', 'DM-Q-2608', 'dm_cli_04', 'Giulia Ferri', 'immediate', 0.00, 'accepted', CURRENT_DATE + INTERVAL '12 days', 'Accepted quote linked to a denied offer.', CURRENT_TIMESTAMP - INTERVAL '58 days', CURRENT_TIMESTAMP - INTERVAL '54 days'),
    ('dm_cq_09', 'DM-Q-2609', 'dm_cli_02', 'Helios Energy Services S.r.l.', '30gg', 5.00, 'denied', CURRENT_DATE + INTERVAL '10 days', 'Rejected customer quote kept for history coverage.', CURRENT_TIMESTAMP - INTERVAL '36 days', CURRENT_TIMESTAMP - INTERVAL '34 days'),
    ('dm_cq_10', 'DM-Q-2610', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 0.00, 'sent', CURRENT_DATE - INTERVAL '5 days', 'Expired quote to exercise historical and expired state handling.', CURRENT_TIMESTAMP - INTERVAL '24 days', CURRENT_TIMESTAMP - INTERVAL '20 days');

INSERT INTO quote_items (
    id,
    quote_id,
    product_id,
    product_name,
    special_bid_id,
    quantity,
    unit_price,
    product_cost,
    product_tax_rate,
    product_mol_percentage,
    special_bid_unit_price,
    special_bid_mol_percentage,
    discount,
    note
)
SELECT
    v.id,
    v.quote_id,
    p.id,
    p.name,
    v.special_bid_id,
    v.quantity,
    v.unit_price,
    p.costo,
    p.tax_rate,
    p.mol_percentage,
    sb.unit_price,
    sb.mol_percentage,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_cqi_01', 'dm_cq_01', 'dm_prd_01', NULL::varchar(50), 5.00, 1230.00, 0.00, 'Discovery workshops and stakeholder interviews'),
        ('dm_cqi_02', 'dm_cq_01', 'dm_prd_02', NULL::varchar(50), 2.00, 1715.00, 0.00, 'Deployment sprint for first release wave'),
        ('dm_cqi_03', 'dm_cq_02', 'dm_prd_05', NULL::varchar(50), 12.00, 1159.00, 3.00, 'Endpoint refresh lot for field technicians'),
        ('dm_cqi_04', 'dm_cq_03', 'dm_prd_06', NULL::varchar(50), 40.00, 225.00, 0.00, 'Accepted subscription bundle intentionally kept without downstream offer'),
        ('dm_cqi_05', 'dm_cq_04', 'dm_prd_01', NULL::varchar(50), 3.00, 1230.00, 0.00, 'Strategic assessment package'),
        ('dm_cqi_06', 'dm_cq_04', 'dm_prd_04', NULL::varchar(50), 1.00, 1090.00, 5.00, 'Executive training day'),
        ('dm_cqi_07', 'dm_cq_05', 'dm_prd_07', NULL::varchar(50), 2.00, 1795.00, 0.00, 'Firewall appliances for branch perimeter refresh'),
        ('dm_cqi_08', 'dm_cq_06', 'dm_prd_06', 'dm_bid_01', 25.00, 210.00, 0.00, 'Accepted subscription bundle ready for offer creation'),
        ('dm_cqi_09', 'dm_cq_07', 'dm_prd_01', NULL::varchar(50), 2.00, 1230.00, 0.00, 'Assessment for public-sector rollout'),
        ('dm_cqi_10', 'dm_cq_07', 'dm_prd_02', NULL::varchar(50), 1.00, 1715.00, 0.00, 'Deployment sprint for the first implementation lot'),
        ('dm_cqi_11', 'dm_cq_08', 'dm_prd_04', NULL::varchar(50), 2.00, 1090.00, 0.00, 'Training package for a small customer'),
        ('dm_cqi_12', 'dm_cq_09', 'dm_prd_05', NULL::varchar(50), 3.00, 1159.00, 0.00, 'Rejected hardware offer kept for reporting'),
        ('dm_cqi_13', 'dm_cq_10', 'dm_prd_03', NULL::varchar(50), 6.00, 835.00, 0.00, 'Managed support bundle that expired before confirmation'),
        ('dm_cqi_14', 'dm_cq_10', 'dm_prd_08', NULL::varchar(50), 15.00, 160.00, 0.00, 'Print collateral add-on on the expired quote')
) AS v(id, quote_id, product_id, special_bid_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id
LEFT JOIN special_bids sb ON sb.id = v.special_bid_id;

INSERT INTO customer_offers (
    id,
    offer_code,
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
    ('dm_co_01', 'DM-OFF-2601', 'dm_cq_04', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 4.00, 'draft', CURRENT_DATE + INTERVAL '24 days', 'Editable draft offer created from an accepted quote.', CURRENT_TIMESTAMP - INTERVAL '90 days', CURRENT_TIMESTAMP - INTERVAL '88 days'),
    ('dm_co_02', 'DM-OFF-2602', 'dm_cq_05', 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 1.50, 'sent', CURRENT_DATE + INTERVAL '22 days', 'Sent offer waiting for customer reply.', CURRENT_TIMESTAMP - INTERVAL '80 days', CURRENT_TIMESTAMP - INTERVAL '77 days'),
    ('dm_co_03', 'DM-OFF-2603', 'dm_cq_06', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '18 days', 'Accepted offer intentionally left without an order.', CURRENT_TIMESTAMP - INTERVAL '68 days', CURRENT_TIMESTAMP - INTERVAL '65 days'),
    ('dm_co_04', 'DM-OFF-2604', 'dm_cq_07', 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 2.50, 'accepted', CURRENT_DATE + INTERVAL '16 days', 'Accepted offer already converted into an order.', CURRENT_TIMESTAMP - INTERVAL '56 days', CURRENT_TIMESTAMP - INTERVAL '52 days'),
    ('dm_co_05', 'DM-OFF-2605', 'dm_cq_08', 'dm_cli_04', 'Giulia Ferri', 'immediate', 0.00, 'denied', CURRENT_DATE + INTERVAL '8 days', 'Denied offer for historical state coverage.', CURRENT_TIMESTAMP - INTERVAL '46 days', CURRENT_TIMESTAMP - INTERVAL '43 days');

INSERT INTO customer_offer_items (
    id,
    offer_id,
    product_id,
    product_name,
    special_bid_id,
    quantity,
    unit_price,
    product_cost,
    product_tax_rate,
    product_mol_percentage,
    special_bid_unit_price,
    special_bid_mol_percentage,
    discount,
    note
)
SELECT
    v.id,
    v.offer_id,
    p.id,
    p.name,
    v.special_bid_id,
    v.quantity,
    v.unit_price,
    p.costo,
    p.tax_rate,
    p.mol_percentage,
    sb.unit_price,
    sb.mol_percentage,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_coi_01', 'dm_co_01', 'dm_prd_01', NULL::varchar(50), 3.00, 1230.00, 0.00, 'Draft offer line copied from the accepted quote'),
        ('dm_coi_02', 'dm_co_01', 'dm_prd_04', NULL::varchar(50), 1.00, 1090.00, 5.00, 'Editable training line'),
        ('dm_coi_03', 'dm_co_02', 'dm_prd_07', NULL::varchar(50), 2.00, 1795.00, 0.00, 'Pending security appliance offer'),
        ('dm_coi_04', 'dm_co_03', 'dm_prd_06', 'dm_bid_01', 25.00, 210.00, 0.00, 'Accepted software bundle without downstream order'),
        ('dm_coi_05', 'dm_co_04', 'dm_prd_01', NULL::varchar(50), 2.00, 1230.00, 0.00, 'Accepted assessment lot'),
        ('dm_coi_06', 'dm_co_04', 'dm_prd_02', NULL::varchar(50), 1.00, 1715.00, 0.00, 'Accepted deployment sprint'),
        ('dm_coi_07', 'dm_co_05', 'dm_prd_04', NULL::varchar(50), 2.00, 1090.00, 0.00, 'Denied training offer')
) AS v(id, offer_id, product_id, special_bid_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id
LEFT JOIN special_bids sb ON sb.id = v.special_bid_id;

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
    ('dm_so_01', NULL, NULL, 'dm_cli_04', 'Giulia Ferri', 'immediate', 0.00, 'draft', 'Editable manual sale order used for direct accounting workflow.', CURRENT_TIMESTAMP - INTERVAL '42 days', CURRENT_TIMESTAMP - INTERVAL '41 days'),
    ('dm_so_02', 'dm_cq_07', 'dm_co_04', 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', '60gg', 2.50, 'sent', 'Linked order generated from an accepted offer and now pending confirmation.', CURRENT_TIMESTAMP - INTERVAL '33 days', CURRENT_TIMESTAMP - INTERVAL '30 days'),
    ('dm_so_03', NULL, NULL, 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 1.50, 'confirmed', 'Confirmed manual order intentionally left without an invoice.', CURRENT_TIMESTAMP - INTERVAL '28 days', CURRENT_TIMESTAMP - INTERVAL '24 days'),
    ('dm_so_04', NULL, NULL, 'dm_cli_01', 'Northwind Retail Italia S.p.A.', '30gg', 5.00, 'confirmed', 'Confirmed order already invoiced and mirrored into demo projects.', CURRENT_TIMESTAMP - INTERVAL '21 days', CURRENT_TIMESTAMP - INTERVAL '18 days'),
    ('dm_so_05', NULL, NULL, 'dm_cli_02', 'Helios Energy Services S.r.l.', '45gg', 0.00, 'denied', 'Denied order retained for accounting history coverage.', CURRENT_TIMESTAMP - INTERVAL '16 days', CURRENT_TIMESTAMP - INTERVAL '14 days');

INSERT INTO sale_items (
    id,
    sale_id,
    product_id,
    product_name,
    special_bid_id,
    quantity,
    unit_price,
    product_cost,
    product_tax_rate,
    product_mol_percentage,
    special_bid_unit_price,
    special_bid_mol_percentage,
    discount,
    note
)
SELECT
    v.id,
    v.sale_id,
    p.id,
    p.name,
    v.special_bid_id,
    v.quantity,
    v.unit_price,
    p.costo,
    p.tax_rate,
    p.mol_percentage,
    sb.unit_price,
    sb.mol_percentage,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_soi_01', 'dm_so_01', 'dm_prd_08', NULL::varchar(50), 25.00, 160.00, 0.00, 'Draft order for event print materials'),
        ('dm_soi_02', 'dm_so_02', 'dm_prd_01', NULL::varchar(50), 2.00, 1230.00, 0.00, 'Linked assessment lot pending customer confirmation'),
        ('dm_soi_03', 'dm_so_02', 'dm_prd_02', NULL::varchar(50), 1.00, 1715.00, 0.00, 'Linked deployment lot pending customer confirmation'),
        ('dm_soi_04', 'dm_so_03', 'dm_prd_03', NULL::varchar(50), 6.00, 835.00, 0.00, 'Confirmed support retainer kept open without invoice'),
        ('dm_soi_05', 'dm_so_03', 'dm_prd_06', 'dm_bid_01', 20.00, 210.00, 0.00, 'Confirmed software add-on still ready for invoicing'),
        ('dm_soi_06', 'dm_so_04', 'dm_prd_01', NULL::varchar(50), 4.00, 1230.00, 5.00, 'Assessment track for operations'),
        ('dm_soi_07', 'dm_so_04', 'dm_prd_02', NULL::varchar(50), 1.00, 1715.00, 5.00, 'Deployment wave for phase one'),
        ('dm_soi_08', 'dm_so_05', 'dm_prd_05', NULL::varchar(50), 3.00, 1159.00, 0.00, 'Denied hardware order')
) AS v(id, sale_id, product_id, special_bid_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id
LEFT JOIN special_bids sb ON sb.id = v.special_bid_id;

INSERT INTO invoices (
    id,
    linked_sale_id,
    client_id,
    client_name,
    invoice_number,
    issue_date,
    due_date,
    status,
    subtotal,
    tax_amount,
    total,
    amount_paid,
    notes,
    created_at,
    updated_at
) VALUES
    ('dm_inv_01', NULL, 'dm_cli_02', 'Helios Energy Services S.r.l.', 'DM-INV-2601', CURRENT_DATE - INTERVAL '18 days', CURRENT_DATE + INTERVAL '12 days', 'draft', 1090.00, 239.80, 1329.80, 0.00, 'Editable draft invoice.', CURRENT_TIMESTAMP - INTERVAL '18 days', CURRENT_TIMESTAMP - INTERVAL '17 days'),
    ('dm_inv_02', NULL, 'dm_cli_03', 'Comune di Verona - Innovazione Digitale', 'DM-INV-2602', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '5 days', 'sent', 1795.00, 394.90, 2189.90, 600.00, 'Partially paid invoice with remaining balance.', CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP - INTERVAL '5 days'),
    ('dm_inv_03', 'dm_so_04', 'dm_cli_01', 'Northwind Retail Italia S.p.A.', 'DM-INV-2603', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '10 days', 'paid', 6303.25, 1386.72, 7689.97, 7689.97, 'Fully paid invoice linked to the confirmed demo order.', CURRENT_TIMESTAMP - INTERVAL '20 days', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    ('dm_inv_04', NULL, 'dm_cli_01', 'Northwind Retail Italia S.p.A.', 'DM-INV-2604', CURRENT_DATE - INTERVAL '45 days', CURRENT_DATE - INTERVAL '15 days', 'overdue', 10020.00, 2204.40, 12224.40, 0.00, 'Outstanding overdue invoice for collections reporting.', CURRENT_TIMESTAMP - INTERVAL '45 days', CURRENT_TIMESTAMP - INTERVAL '14 days'),
    ('dm_inv_05', NULL, 'dm_cli_04', 'Giulia Ferri', 'DM-INV-2605', CURRENT_DATE - INTERVAL '12 days', CURRENT_DATE + INTERVAL '20 days', 'cancelled', 1600.00, 352.00, 1952.00, 0.00, 'Cancelled invoice retained for status coverage.', CURRENT_TIMESTAMP - INTERVAL '12 days', CURRENT_TIMESTAMP - INTERVAL '11 days');

INSERT INTO invoice_items (
    id,
    invoice_id,
    product_id,
    description,
    quantity,
    unit_price,
    tax_rate,
    discount
) VALUES
    ('dm_inv_item_01', 'dm_inv_01', 'dm_prd_04', 'Workshop Training Day', 1.00, 1090.00, 22.00, 0.00),
    ('dm_inv_item_02', 'dm_inv_02', 'dm_prd_07', 'Managed Firewall Appliance', 1.00, 1795.00, 22.00, 0.00),
    ('dm_inv_item_03', 'dm_inv_03', 'dm_prd_01', 'Strategy Assessment', 4.00, 1230.00, 22.00, 5.00),
    ('dm_inv_item_04', 'dm_inv_03', 'dm_prd_02', 'Deployment Sprint', 1.00, 1715.00, 22.00, 5.00),
    ('dm_inv_item_05', 'dm_inv_04', 'dm_prd_03', 'Managed Support Retainer', 12.00, 835.00, 22.00, 0.00),
    ('dm_inv_item_06', 'dm_inv_05', 'dm_prd_08', 'Branded Print Kit', 10.00, 160.00, 22.00, 0.00);

INSERT INTO payments (
    id,
    invoice_id,
    client_id,
    amount,
    payment_date,
    payment_method,
    reference,
    notes,
    created_at
) VALUES
    ('dm_pay_01', 'dm_inv_03', 'dm_cli_01', 4000.00, CURRENT_DATE - INTERVAL '7 days', 'bank_transfer', 'DM-PAY-2601', 'First installment for fully paid invoice.', CURRENT_TIMESTAMP - INTERVAL '7 days'),
    ('dm_pay_02', 'dm_inv_03', 'dm_cli_01', 3689.97, CURRENT_DATE - INTERVAL '2 days', 'credit_card', 'DM-PAY-2602', 'Closing payment for the invoiced confirmed order.', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    ('dm_pay_03', 'dm_inv_02', 'dm_cli_03', 600.00, CURRENT_DATE - INTERVAL '5 days', 'cash', 'DM-PAY-2603', 'Partial payment leaving the invoice in sent status.', CURRENT_TIMESTAMP - INTERVAL '5 days');

INSERT INTO supplier_quotes (
    id,
    supplier_id,
    supplier_name,
    purchase_order_number,
    quote_code,
    payment_terms,
    discount,
    status,
    expiration_date,
    notes,
    created_at,
    updated_at
) VALUES
    ('dm_sq_01', 'dm_sup_01', 'TechSource Distribution', 'DM-SQ-2601', 'DM-SQ-2601', '30gg', 0.00, 'draft', CURRENT_DATE + INTERVAL '35 days', 'Editable supplier quote for hardware procurement.', CURRENT_TIMESTAMP - INTERVAL '145 days', CURRENT_TIMESTAMP - INTERVAL '144 days'),
    ('dm_sq_02', 'dm_sup_02', 'CloudSeat Licensing', 'DM-SQ-2602', 'DM-SQ-2602', '45gg', 1.00, 'sent', CURRENT_DATE + INTERVAL '28 days', 'Sent supplier quote pending vendor response.', CURRENT_TIMESTAMP - INTERVAL '132 days', CURRENT_TIMESTAMP - INTERVAL '130 days'),
    ('dm_sq_03', 'dm_sup_03', 'SecureEdge Systems', 'DM-SQ-2603', 'DM-SQ-2603', '60gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '26 days', 'Accepted supplier quote intentionally left without an offer.', CURRENT_TIMESTAMP - INTERVAL '118 days', CURRENT_TIMESTAMP - INTERVAL '114 days'),
    ('dm_sq_04', 'dm_sup_01', 'TechSource Distribution', 'DM-SQ-2604', 'DM-SQ-2604', '30gg', 1.50, 'accepted', CURRENT_DATE + INTERVAL '24 days', 'Accepted supplier quote with a draft offer.', CURRENT_TIMESTAMP - INTERVAL '104 days', CURRENT_TIMESTAMP - INTERVAL '100 days'),
    ('dm_sq_05', 'dm_sup_02', 'CloudSeat Licensing', 'DM-SQ-2605', 'DM-SQ-2605', '45gg', 0.50, 'accepted', CURRENT_DATE + INTERVAL '20 days', 'Accepted supplier quote with a sent offer.', CURRENT_TIMESTAMP - INTERVAL '94 days', CURRENT_TIMESTAMP - INTERVAL '89 days'),
    ('dm_sq_06', 'dm_sup_03', 'SecureEdge Systems', 'DM-SQ-2606', 'DM-SQ-2606', '60gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '18 days', 'Accepted supplier quote linked to an accepted offer ready for order creation.', CURRENT_TIMESTAMP - INTERVAL '82 days', CURRENT_TIMESTAMP - INTERVAL '78 days'),
    ('dm_sq_07', 'dm_sup_04', 'PrintLogistics Hub', 'DM-SQ-2607', 'DM-SQ-2607', '30gg', 2.00, 'accepted', CURRENT_DATE + INTERVAL '16 days', 'Accepted supplier quote linked to an order already in progress.', CURRENT_TIMESTAMP - INTERVAL '70 days', CURRENT_TIMESTAMP - INTERVAL '66 days'),
    ('dm_sq_08', 'dm_sup_01', 'TechSource Distribution', 'DM-SQ-2608', 'DM-SQ-2608', '30gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '12 days', 'Accepted supplier quote linked to a denied offer.', CURRENT_TIMESTAMP - INTERVAL '60 days', CURRENT_TIMESTAMP - INTERVAL '57 days'),
    ('dm_sq_09', 'dm_sup_02', 'CloudSeat Licensing', 'DM-SQ-2609', 'DM-SQ-2609', '45gg', 0.00, 'denied', CURRENT_DATE + INTERVAL '9 days', 'Denied supplier quote kept for history coverage.', CURRENT_TIMESTAMP - INTERVAL '39 days', CURRENT_TIMESTAMP - INTERVAL '37 days'),
    ('dm_sq_10', 'dm_sup_04', 'PrintLogistics Hub', 'DM-SQ-2610', 'DM-SQ-2610', '30gg', 0.00, 'sent', CURRENT_DATE - INTERVAL '6 days', 'Expired supplier quote.', CURRENT_TIMESTAMP - INTERVAL '22 days', CURRENT_TIMESTAMP - INTERVAL '19 days');

INSERT INTO supplier_quote_items (
    id,
    quote_id,
    product_id,
    product_name,
    quantity,
    unit_price,
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
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_sqi_01', 'dm_sq_01', 'dm_prd_05', 8.00, 960.00, 0.00, 'Draft laptop procurement lot'),
        ('dm_sqi_02', 'dm_sq_02', 'dm_prd_06', 120.00, 182.00, 0.00, 'Pending licensing quote'),
        ('dm_sqi_03', 'dm_sq_03', 'dm_prd_07', 1.00, 1410.00, 0.00, 'Accepted security appliance quote without downstream offer'),
        ('dm_sqi_04', 'dm_sq_04', 'dm_prd_05', 10.00, 958.00, 1.00, 'Accepted quote feeding a draft offer'),
        ('dm_sqi_05', 'dm_sq_05', 'dm_prd_06', 80.00, 182.00, 0.00, 'Accepted quote feeding a sent offer'),
        ('dm_sqi_06', 'dm_sq_06', 'dm_prd_07', 1.00, 1410.00, 0.00, 'Accepted quote feeding an accepted offer without order'),
        ('dm_sqi_07', 'dm_sq_07', 'dm_prd_08', 200.00, 118.00, 2.00, 'Accepted quote feeding an order already in progress'),
        ('dm_sqi_08', 'dm_sq_08', 'dm_prd_05', 2.00, 965.00, 0.00, 'Accepted quote feeding a denied offer'),
        ('dm_sqi_09', 'dm_sq_09', 'dm_prd_06', 40.00, 183.00, 0.00, 'Denied supplier licensing quote'),
        ('dm_sqi_10', 'dm_sq_10', 'dm_prd_08', 150.00, 119.00, 0.00, 'Expired print procurement request')
) AS v(id, quote_id, product_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id;

INSERT INTO supplier_offers (
    id,
    offer_code,
    linked_quote_id,
    supplier_id,
    supplier_name,
    payment_terms,
    discount,
    status,
    expiration_date,
    notes,
    created_at,
    updated_at
) VALUES
    ('dm_sfo_01', 'DM-SOF-2601', 'dm_sq_04', 'dm_sup_01', 'TechSource Distribution', '30gg', 1.50, 'draft', CURRENT_DATE + INTERVAL '20 days', 'Editable supplier offer.', CURRENT_TIMESTAMP - INTERVAL '92 days', CURRENT_TIMESTAMP - INTERVAL '90 days'),
    ('dm_sfo_02', 'DM-SOF-2602', 'dm_sq_05', 'dm_sup_02', 'CloudSeat Licensing', '45gg', 0.50, 'sent', CURRENT_DATE + INTERVAL '18 days', 'Sent supplier offer awaiting confirmation.', CURRENT_TIMESTAMP - INTERVAL '80 days', CURRENT_TIMESTAMP - INTERVAL '77 days'),
    ('dm_sfo_03', 'DM-SOF-2603', 'dm_sq_06', 'dm_sup_03', 'SecureEdge Systems', '60gg', 0.00, 'accepted', CURRENT_DATE + INTERVAL '15 days', 'Accepted supplier offer intentionally left without an order.', CURRENT_TIMESTAMP - INTERVAL '68 days', CURRENT_TIMESTAMP - INTERVAL '65 days'),
    ('dm_sfo_04', 'DM-SOF-2604', 'dm_sq_07', 'dm_sup_04', 'PrintLogistics Hub', '30gg', 2.00, 'accepted', CURRENT_DATE + INTERVAL '12 days', 'Accepted supplier offer already converted into a supplier order.', CURRENT_TIMESTAMP - INTERVAL '56 days', CURRENT_TIMESTAMP - INTERVAL '52 days'),
    ('dm_sfo_05', 'DM-SOF-2605', 'dm_sq_08', 'dm_sup_01', 'TechSource Distribution', '30gg', 0.00, 'denied', CURRENT_DATE + INTERVAL '9 days', 'Denied supplier offer for historical coverage.', CURRENT_TIMESTAMP - INTERVAL '44 days', CURRENT_TIMESTAMP - INTERVAL '42 days');

INSERT INTO supplier_offer_items (
    id,
    offer_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    product_tax_rate,
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
    p.tax_rate,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_sfoi_01', 'dm_sfo_01', 'dm_prd_05', 10.00, 958.00, 1.00, 'Draft hardware offer'),
        ('dm_sfoi_02', 'dm_sfo_02', 'dm_prd_06', 80.00, 182.00, 0.00, 'Sent licensing offer'),
        ('dm_sfoi_03', 'dm_sfo_03', 'dm_prd_07', 1.00, 1410.00, 0.00, 'Accepted security offer without order'),
        ('dm_sfoi_04', 'dm_sfo_04', 'dm_prd_08', 200.00, 118.00, 2.00, 'Accepted print offer already linked to an order'),
        ('dm_sfoi_05', 'dm_sfo_05', 'dm_prd_05', 2.00, 965.00, 0.00, 'Denied hardware offer')
) AS v(id, offer_id, product_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id;

INSERT INTO supplier_sales (
    id,
    linked_quote_id,
    linked_offer_id,
    supplier_id,
    supplier_name,
    payment_terms,
    discount,
    status,
    notes,
    created_at,
    updated_at
) VALUES
    ('dm_ss_01', NULL, NULL, 'dm_sup_01', 'TechSource Distribution', '30gg', 0.00, 'draft', 'Editable manual supplier order.', CURRENT_TIMESTAMP - INTERVAL '40 days', CURRENT_TIMESTAMP - INTERVAL '39 days'),
    ('dm_ss_02', 'dm_sq_07', 'dm_sfo_04', 'dm_sup_04', 'PrintLogistics Hub', '30gg', 2.00, 'sent', 'Linked supplier order already in progress.', CURRENT_TIMESTAMP - INTERVAL '31 days', CURRENT_TIMESTAMP - INTERVAL '29 days'),
    ('dm_ss_03', NULL, NULL, 'dm_sup_02', 'CloudSeat Licensing', '45gg', 0.00, 'confirmed', 'Confirmed supplier order intentionally left without an invoice.', CURRENT_TIMESTAMP - INTERVAL '27 days', CURRENT_TIMESTAMP - INTERVAL '24 days'),
    ('dm_ss_04', NULL, NULL, 'dm_sup_03', 'SecureEdge Systems', '60gg', 0.00, 'confirmed', 'Confirmed supplier order already invoiced and mirrored into expenses.', CURRENT_TIMESTAMP - INTERVAL '20 days', CURRENT_TIMESTAMP - INTERVAL '17 days'),
    ('dm_ss_05', NULL, NULL, 'dm_sup_01', 'TechSource Distribution', '30gg', 0.00, 'denied', 'Denied supplier order for history coverage.', CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP - INTERVAL '13 days');

INSERT INTO supplier_sale_items (
    id,
    sale_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    product_tax_rate,
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
    p.tax_rate,
    v.discount,
    v.note
FROM (
    VALUES
        ('dm_ssi_01', 'dm_ss_01', 'dm_prd_05', 4.00, 960.00, 0.00, 'Draft hardware procurement order'),
        ('dm_ssi_02', 'dm_ss_02', 'dm_prd_08', 200.00, 118.00, 2.00, 'Linked print procurement order in sent status'),
        ('dm_ssi_03', 'dm_ss_03', 'dm_prd_06', 80.00, 182.00, 0.00, 'Confirmed licensing order without invoice'),
        ('dm_ssi_04', 'dm_ss_04', 'dm_prd_07', 1.00, 1410.00, 0.00, 'Confirmed security appliance order'),
        ('dm_ssi_05', 'dm_ss_04', 'dm_prd_08', 40.00, 118.00, 0.00, 'Confirmed print materials order'),
        ('dm_ssi_06', 'dm_ss_05', 'dm_prd_05', 2.00, 965.00, 0.00, 'Denied supplier hardware order')
) AS v(id, sale_id, product_id, quantity, unit_price, discount, note)
JOIN products p ON p.id = v.product_id;

INSERT INTO supplier_invoices (
    id,
    linked_sale_id,
    supplier_id,
    supplier_name,
    invoice_number,
    issue_date,
    due_date,
    status,
    subtotal,
    tax_amount,
    total,
    amount_paid,
    notes,
    created_at,
    updated_at
) VALUES
    ('dm_sinv_01', NULL, 'dm_sup_01', 'TechSource Distribution', 'DM-SINV-2601', CURRENT_DATE - INTERVAL '18 days', CURRENT_DATE + INTERVAL '12 days', 'draft', 1920.00, 422.40, 2342.40, 0.00, 'Editable draft supplier invoice.', CURRENT_TIMESTAMP - INTERVAL '18 days', CURRENT_TIMESTAMP - INTERVAL '17 days'),
    ('dm_sinv_02', NULL, 'dm_sup_02', 'CloudSeat Licensing', 'DM-SINV-2602', CURRENT_DATE - INTERVAL '32 days', CURRENT_DATE + INTERVAL '3 days', 'sent', 14560.00, 3203.20, 17763.20, 4000.00, 'Partially settled supplier invoice kept in sent state.', CURRENT_TIMESTAMP - INTERVAL '32 days', CURRENT_TIMESTAMP - INTERVAL '6 days'),
    ('dm_sinv_03', 'dm_ss_04', 'dm_sup_03', 'SecureEdge Systems', 'DM-SINV-2603', CURRENT_DATE - INTERVAL '19 days', CURRENT_DATE + INTERVAL '11 days', 'paid', 6130.00, 1348.60, 7478.60, 7478.60, 'Paid supplier invoice linked to a confirmed order.', CURRENT_TIMESTAMP - INTERVAL '19 days', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    ('dm_sinv_04', NULL, 'dm_sup_04', 'PrintLogistics Hub', 'DM-SINV-2604', CURRENT_DATE - INTERVAL '48 days', CURRENT_DATE - INTERVAL '12 days', 'overdue', 23600.00, 5192.00, 28792.00, 0.00, 'Overdue supplier invoice mirrored as an expense.', CURRENT_TIMESTAMP - INTERVAL '48 days', CURRENT_TIMESTAMP - INTERVAL '10 days'),
    ('dm_sinv_05', NULL, 'dm_sup_01', 'TechSource Distribution', 'DM-SINV-2605', CURRENT_DATE - INTERVAL '11 days', CURRENT_DATE + INTERVAL '18 days', 'cancelled', 960.00, 211.20, 1171.20, 0.00, 'Cancelled supplier invoice kept for state coverage.', CURRENT_TIMESTAMP - INTERVAL '11 days', CURRENT_TIMESTAMP - INTERVAL '10 days');

INSERT INTO supplier_invoice_items (
    id,
    invoice_id,
    product_id,
    description,
    quantity,
    unit_price,
    tax_rate,
    discount
) VALUES
    ('dm_sinv_item_01', 'dm_sinv_01', 'dm_prd_05', 'Business Laptop Bundle', 2.00, 960.00, 22.00, 0.00),
    ('dm_sinv_item_02', 'dm_sinv_02', 'dm_prd_06', 'Microsoft 365 Annual Seat', 80.00, 182.00, 22.00, 0.00),
    ('dm_sinv_item_03', 'dm_sinv_03', 'dm_prd_07', 'Managed Firewall Appliance', 1.00, 1410.00, 22.00, 0.00),
    ('dm_sinv_item_04', 'dm_sinv_03', 'dm_prd_08', 'Branded Print Kit', 40.00, 118.00, 22.00, 0.00),
    ('dm_sinv_item_05', 'dm_sinv_04', 'dm_prd_08', 'Branded Print Kit', 200.00, 118.00, 22.00, 0.00),
    ('dm_sinv_item_06', 'dm_sinv_05', 'dm_prd_05', 'Business Laptop Bundle', 1.00, 960.00, 22.00, 0.00);

INSERT INTO expenses (
    id,
    description,
    amount,
    expense_date,
    category,
    vendor,
    receipt_reference,
    source_type,
    supplier_invoice_id,
    notes,
    created_at
) VALUES
    ('dm_exp_si_01', 'Supplier invoice DM-SINV-2601', 2342.40, CURRENT_DATE - INTERVAL '18 days', 'other', 'TechSource Distribution', 'DM-SINV-2601', 'supplier_invoice', 'dm_sinv_01', 'Mirrored from draft supplier invoice.', CURRENT_TIMESTAMP - INTERVAL '18 days'),
    ('dm_exp_si_02', 'Supplier invoice DM-SINV-2602', 17763.20, CURRENT_DATE - INTERVAL '32 days', 'other', 'CloudSeat Licensing', 'DM-SINV-2602', 'supplier_invoice', 'dm_sinv_02', 'Mirrored from partially settled supplier invoice.', CURRENT_TIMESTAMP - INTERVAL '32 days'),
    ('dm_exp_si_03', 'Supplier invoice DM-SINV-2603', 7478.60, CURRENT_DATE - INTERVAL '19 days', 'other', 'SecureEdge Systems', 'DM-SINV-2603', 'supplier_invoice', 'dm_sinv_03', 'Mirrored from paid supplier invoice.', CURRENT_TIMESTAMP - INTERVAL '19 days'),
    ('dm_exp_si_04', 'Supplier invoice DM-SINV-2604', 28792.00, CURRENT_DATE - INTERVAL '48 days', 'other', 'PrintLogistics Hub', 'DM-SINV-2604', 'supplier_invoice', 'dm_sinv_04', 'Mirrored from overdue supplier invoice.', CURRENT_TIMESTAMP - INTERVAL '48 days'),
    ('dm_exp_si_05', 'Supplier invoice DM-SINV-2605', 1171.20, CURRENT_DATE - INTERVAL '11 days', 'other', 'TechSource Distribution', 'DM-SINV-2605', 'supplier_invoice', 'dm_sinv_05', 'Mirrored from cancelled supplier invoice.', CURRENT_TIMESTAMP - INTERVAL '11 days'),
    ('dm_exp_m_01', 'Demo travel for customer workshop', 820.00, CURRENT_DATE - INTERVAL '12 days', 'travel', 'Trenitalia Business', NULL, 'manual', NULL, 'Manual expense used for editable finance coverage.', CURRENT_TIMESTAMP - INTERVAL '12 days'),
    ('dm_exp_m_02', 'Demo software monitoring renewal', 1299.00, CURRENT_DATE - INTERVAL '4 days', 'software', 'Observa Cloud', 'OBS-RENEW-2026', 'manual', NULL, 'Manual expense kept editable in the UI.', CURRENT_TIMESTAMP - INTERVAL '4 days');

INSERT INTO projects (
    id,
    name,
    client_id,
    color,
    description,
    is_disabled,
    created_at
) VALUES
    (
        'dm_proj_01',
        'DM-CLI-001_DM-SVC-AUDIT_' || TO_CHAR(CURRENT_DATE, 'YYYY'),
        'dm_cli_01',
        '#0f766e',
        'Assessment track for operations',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '18 days'
    ),
    (
        'dm_proj_02',
        'DM-CLI-001_DM-SVC-DEPLOY_' || TO_CHAR(CURRENT_DATE, 'YYYY'),
        'dm_cli_01',
        '#1d4ed8',
        'Deployment wave for phase one',
        FALSE,
        CURRENT_TIMESTAMP - INTERVAL '18 days'
    );

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
            'dm_so_04',
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
            'dm_so_04',
            'clientName',
            'Northwind Retail Italia S.p.A.'
        ),
        TRUE,
        CURRENT_TIMESTAMP - INTERVAL '16 days'
    );

COMMIT;
