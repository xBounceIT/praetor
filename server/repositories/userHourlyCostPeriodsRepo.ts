import { eq, inArray, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { userHourlyCostPeriods } from '../db/schema/userHourlyCostPeriods.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

export type HourlyCostPeriodInput = {
  effectiveFrom: string | null;
  costPerHour: number;
};

export type HourlyCostPeriod = HourlyCostPeriodInput & {
  id: number;
  effectiveTo: string | null;
};

export const resolveCostForDate = (periods: HourlyCostPeriodInput[], date: string): number => {
  let costPerHour = periods[0]?.costPerHour ?? 0;
  for (const period of periods) {
    if (period.effectiveFrom !== null && period.effectiveFrom <= date) {
      costPerHour = period.costPerHour;
    }
  }
  return costPerHour;
};

const previousDate = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
};

const withEffectiveTo = (
  rows: Array<{ id: number; effectiveFrom: string | null; costPerHour: string | number }>,
): HourlyCostPeriod[] =>
  rows.map((row, index) => ({
    id: row.id,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: rows[index + 1]?.effectiveFrom
      ? previousDate(rows[index + 1].effectiveFrom as string)
      : null,
    costPerHour: parseDbNumber(row.costPerHour, 0),
  }));

export const listForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<HourlyCostPeriod[]> => {
  const rows = await exec
    .select({
      id: userHourlyCostPeriods.id,
      effectiveFrom: userHourlyCostPeriods.effectiveFrom,
      costPerHour: userHourlyCostPeriods.costPerHour,
    })
    .from(userHourlyCostPeriods)
    .where(eq(userHourlyCostPeriods.userId, userId))
    .orderBy(sql`${userHourlyCostPeriods.effectiveFrom} ASC NULLS FIRST`);
  return withEffectiveTo(rows);
};

export const listInputsForUser = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<HourlyCostPeriodInput[]> =>
  (await listForUser(userId, exec)).map(({ effectiveFrom, costPerHour }) => ({
    effectiveFrom,
    costPerHour,
  }));

export const findCostForDate = async (
  userId: string,
  date: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const rows = await exec
    .select({ costPerHour: userHourlyCostPeriods.costPerHour })
    .from(userHourlyCostPeriods)
    .where(
      sql`${userHourlyCostPeriods.userId} = ${userId}
          AND (${userHourlyCostPeriods.effectiveFrom} IS NULL
               OR ${userHourlyCostPeriods.effectiveFrom} <= ${date})`,
    )
    .orderBy(sql`${userHourlyCostPeriods.effectiveFrom} DESC NULLS LAST`)
    .limit(1);
  return parseDbNumber(rows[0]?.costPerHour, 0);
};

export const listCostsForDate = async (
  userIds: string[],
  date: string,
  exec: DbExecutor = db,
): Promise<Map<string, number>> => {
  if (userIds.length === 0) return new Map();
  const rows = await exec
    .select({
      userId: userHourlyCostPeriods.userId,
      effectiveFrom: userHourlyCostPeriods.effectiveFrom,
      costPerHour: userHourlyCostPeriods.costPerHour,
    })
    .from(userHourlyCostPeriods)
    .where(
      sql`${inArray(userHourlyCostPeriods.userId, userIds)}
          AND (${userHourlyCostPeriods.effectiveFrom} IS NULL
               OR ${userHourlyCostPeriods.effectiveFrom} <= ${date})`,
    )
    .orderBy(
      userHourlyCostPeriods.userId,
      sql`${userHourlyCostPeriods.effectiveFrom} DESC NULLS LAST`,
    );
  const result = new Map<string, number>();
  for (const row of rows) {
    if (!result.has(row.userId)) result.set(row.userId, parseDbNumber(row.costPerHour, 0));
  }
  return result;
};

export const replaceForUser = async (
  userId: string,
  periods: HourlyCostPeriodInput[],
  exec: DbExecutor = db,
): Promise<HourlyCostPeriod[]> => {
  await exec.delete(userHourlyCostPeriods).where(eq(userHourlyCostPeriods.userId, userId));
  const rows = await exec
    .insert(userHourlyCostPeriods)
    .values(
      periods.map((period) => ({
        userId,
        effectiveFrom: period.effectiveFrom,
        costPerHour: numericForDb(period.costPerHour),
      })),
    )
    .returning({
      id: userHourlyCostPeriods.id,
      effectiveFrom: userHourlyCostPeriods.effectiveFrom,
      costPerHour: userHourlyCostPeriods.costPerHour,
    });
  rows.sort((left, right) => {
    if (left.effectiveFrom === null) return -1;
    if (right.effectiveFrom === null) return 1;
    return left.effectiveFrom.localeCompare(right.effectiveFrom);
  });
  return withEffectiveTo(rows);
};

export const recalculateTimeEntries = async (
  userId: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const rows = await executeRows<{ id: string }>(
    exec,
    sql`
      WITH resolved_costs AS (
        SELECT te.id, period.cost_per_hour
        FROM time_entries te
        JOIN LATERAL (
          SELECT p.cost_per_hour
          FROM user_hourly_cost_periods p
          WHERE p.user_id = te.user_id
            AND (p.effective_from IS NULL OR p.effective_from <= te.date)
          ORDER BY p.effective_from DESC NULLS LAST
          LIMIT 1
        ) period ON TRUE
        WHERE te.user_id = ${userId}
      )
      UPDATE time_entries te
      SET hourly_cost = resolved_costs.cost_per_hour,
          version = te.version + 1
      FROM resolved_costs
      WHERE te.id = resolved_costs.id
        AND te.hourly_cost IS DISTINCT FROM resolved_costs.cost_per_hour
      RETURNING te.id
    `,
  );
  return rows.length;
};
