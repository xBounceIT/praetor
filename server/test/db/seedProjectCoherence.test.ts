import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_ITEM_IDS, DEMO_SALES } from '../../db/demoSeedManifest.ts';
import {
  dateOffsetDays,
  parseInsertValuesBlocks,
  parseSelectValuesBlocks,
} from './seedSqlParsing.ts';

// Coherence guard for the demo dataset in seed.sql. The project-creation API
// (server/routes/projects.ts) requires every project to carry an orderId, startDate and
// endDate, and validates that the linked order/optional offer belong to the project's client.
// It also caps time entries to dates the user picks. These assertions keep the seeded showcase
// honest against those rules so a reseed produces data the app itself would accept:
//   - demo delivery projects link to an accepted offer + confirmed order of the same client,
//     and the order's linked_offer_id matches the project's offer_id (full quote→offer→order
//     →project chain),
//   - every project that has time entries declares a start/end window, and
//   - every demo time entry falls inside its project's window.

const SERVER_ROOT = join(import.meta.dirname, '..', '..');
const SEED_SQL = readFileSync(join(SERVER_ROOT, 'db', 'seed.sql'), 'utf-8');

const DEMO_PROJECT_IDS = ['dm_proj_01', 'dm_proj_02'];

const isNullCell = (value: string | undefined) =>
  value === undefined || value.toUpperCase() === 'NULL';

type ProjectRow = {
  id: string;
  clientId: string;
  tipo: string;
  orderId: string | null;
  offerId: string | null;
  startOffset: number | null;
  endOffset: number | null;
  revenue: number | null;
};

const projects = new Map(
  parseInsertValuesBlocks(SEED_SQL, 'projects').map((row): [string, ProjectRow] => [
    row.id,
    {
      id: row.id,
      clientId: row.client_id,
      tipo: row.tipo,
      orderId: isNullCell(row.order_id) ? null : row.order_id,
      offerId: isNullCell(row.offer_id) ? null : row.offer_id,
      startOffset: dateOffsetDays(row.start_date),
      endOffset: dateOffsetDays(row.end_date),
      revenue: row.revenue === undefined ? null : Number(row.revenue),
    },
  ]),
);

const tasks = parseInsertValuesBlocks(SEED_SQL, 'tasks');

const offers = new Map(
  parseInsertValuesBlocks(SEED_SQL, 'customer_offers').map((row) => [
    row.id,
    { clientId: row.client_id, status: row.status },
  ]),
);

const sales = new Map(
  parseInsertValuesBlocks(SEED_SQL, 'sales').map((row) => [
    row.id,
    {
      clientId: row.client_id,
      status: row.status,
      // Order-level discount (percentage; demo sales never set discount_type).
      discount: Number(row.discount),
      linkedOfferId: isNullCell(row.linked_offer_id) ? null : row.linked_offer_id,
    },
  ]),
);

const timeEntries = parseSelectValuesBlocks(SEED_SQL, 'time_entries').flatMap((block) =>
  block.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    dateOffset: dateOffsetDays(row.entry_date),
  })),
);

const saleItems = parseSelectValuesBlocks(SEED_SQL, 'sale_items').flatMap((block) => block.rows);

// Net (discounted) line-item total for an order, so the test derives the expected project
// revenue from the actual order lines instead of hardcoding a figure that could drift.
const orderNetTotal = (saleId: string) =>
  saleItems
    .filter((row) => row.sale_id === saleId)
    .reduce(
      (sum, row) =>
        sum + Number(row.quantity) * Number(row.unit_price) * (1 - Number(row.discount) / 100),
      0,
    );

describe('seed.sql demo projects link to their offer/order chain', () => {
  test.each(
    DEMO_PROJECT_IDS,
  )('%s is linked to an accepted offer and confirmed order', (projectId) => {
    const project = projects.get(projectId);
    expect(project).toBeDefined();
    if (!project) return;

    // Required by the project-creation API: order + dates must be present.
    expect(project.offerId).not.toBeNull();
    expect(project.orderId).not.toBeNull();
    expect(project.startOffset).not.toBeNull();
    expect(project.endOffset).not.toBeNull();

    const offer = project.offerId ? offers.get(project.offerId) : undefined;
    expect(offer).toBeDefined();
    expect(offer?.clientId).toBe(project.clientId);
    expect(offer?.status).toBe('accepted');

    const order = project.orderId ? sales.get(project.orderId) : undefined;
    expect(order).toBeDefined();
    expect(order?.clientId).toBe(project.clientId);
    expect(order?.status).toBe('confirmed');
    // The order the project was generated from must trace back to the same offer.
    expect(order?.linkedOfferId).toBe(project.offerId);
  });

  test('demo project revenue is explicit project data, independent from linked order totals', () => {
    const projectRevenue = DEMO_PROJECT_IDS.reduce(
      (sum, id) => sum + (projects.get(id)?.revenue ?? 0),
      0,
    );
    const orderId = projects.get('dm_proj_01')?.orderId;
    expect(orderId).toBeTruthy();
    const order = orderId ? sales.get(orderId) : undefined;
    const orderTotal = orderNetTotal(orderId as string) * (1 - (order?.discount ?? 0) / 100);
    expect(projectRevenue).toBeGreaterThan(0);
    expect(orderTotal).toBeGreaterThan(0);
  });

  test('Internal Research is internal, keeps activities, and has no commercial links', () => {
    const project = projects.get('p3');
    expect(project).toBeDefined();
    expect(project?.tipo).toBe('interno');
    expect(project?.clientId).toBe('praetor-own-company');
    expect(project?.orderId).toBeNull();
    expect(project?.offerId).toBeNull();

    const projectTasks = tasks.filter((task) => task.project_id === 'p3');
    expect(projectTasks.map((task) => task.id).sort()).toEqual(['t4', 't5']);

    const projectEntries = timeEntries.filter((entry) => entry.projectId === 'p3');
    expect(projectEntries.length).toBeGreaterThan(0);
  });

  test('linked invoice total reconciles with the order total', () => {
    const orderId = projects.get('dm_proj_01')?.orderId;
    const order = orderId ? sales.get(orderId) : undefined;
    const orderTotal = orderNetTotal(orderId as string) * (1 - (order?.discount ?? 0) / 100);
    const invoice = parseInsertValuesBlocks(SEED_SQL, 'invoices').find(
      (row) => row.linked_sale_id === orderId,
    );
    expect(invoice).toBeDefined();
    expect(Number(invoice?.total)).toBeCloseTo(orderTotal, 2);
  });
});

describe('seed.sql demo time entries fall within their project window', () => {
  test('parsed at least the 25 demo time entries', () => {
    expect(timeEntries.length).toBeGreaterThanOrEqual(25);
  });

  test('every project that owns time entries declares a start/end window', () => {
    const projectsWithEntries = new Set(timeEntries.map((entry) => entry.projectId));
    for (const projectId of projectsWithEntries) {
      const project = projects.get(projectId);
      expect(project, `time entries reference unknown project ${projectId}`).toBeDefined();
      expect(project?.startOffset, `${projectId} missing start_date`).not.toBeNull();
      expect(project?.endOffset, `${projectId} missing end_date`).not.toBeNull();
      expect(project?.startOffset ?? 0).toBeLessThanOrEqual(project?.endOffset ?? 0);
    }
  });

  test.each(timeEntries)('time entry $id ($dateOffset d) sits inside project $projectId window', ({
    projectId,
    dateOffset,
  }) => {
    const project = projects.get(projectId);
    expect(project).toBeDefined();
    expect(dateOffset).not.toBeNull();
    if (!project || dateOffset === null) return;
    expect(dateOffset).toBeGreaterThanOrEqual(project.startOffset ?? 0);
    expect(dateOffset).toBeLessThanOrEqual(project.endOffset ?? 0);
  });
});

// Guards against the manual drift that is easy to introduce when adding rows: the manifest
// drives demo cleanup/verification counts, so its id lists and link fields must match seed.sql.
describe('demoSeedManifest stays in sync with seed.sql', () => {
  const itemIdsInSeed = (table: string) =>
    parseSelectValuesBlocks(SEED_SQL, table).flatMap((block) => block.rows.map((row) => row.id));

  test('quote_items ids match DEMO_ITEM_IDS.quoteItems', () => {
    expect(itemIdsInSeed('quote_items').sort()).toEqual([...DEMO_ITEM_IDS.quoteItems].sort());
  });

  test('customer_offer_items ids match DEMO_ITEM_IDS.customerOfferItems', () => {
    expect(itemIdsInSeed('customer_offer_items').sort()).toEqual(
      [...DEMO_ITEM_IDS.customerOfferItems].sort(),
    );
  });

  test('delivery order linked offer matches DEMO_SALES', () => {
    const orderId = projects.get('dm_proj_01')?.orderId;
    expect(orderId).toBeTruthy();
    const manifest = DEMO_SALES.find((sale) => sale.id === orderId);
    expect(orderId ? sales.get(orderId)?.linkedOfferId : null).toBe(
      manifest?.linkedOfferId ?? null,
    );
  });
});
