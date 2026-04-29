import type { QueryResult, QueryResultRow } from 'pg';
import type { QueryExecutor } from '../../db/index.ts';

export type FakeCall = { sql: string; params: unknown[] };

export type FakeResponse = {
  rows: QueryResultRow[];
  rowCount?: number | null;
};

type ResponseFactory = (sql: string, params: unknown[]) => FakeResponse;

export type FakeExecutor = QueryExecutor & {
  readonly calls: readonly FakeCall[];
  enqueue: (response: FakeResponse | ResponseFactory) => void;
};

export const makeFakeExecutor = (): FakeExecutor => {
  const calls: FakeCall[] = [];
  const queue: Array<FakeResponse | ResponseFactory> = [];

  const exec: FakeExecutor = {
    calls,
    enqueue(response) {
      queue.push(response);
    },
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      calls.push({ sql: text, params });
      const next = queue.shift();
      const resp: FakeResponse =
        typeof next === 'function' ? next(text, params) : (next ?? { rows: [] });
      const rows = resp.rows as T[];
      const rowCount: number | null = resp.rowCount === undefined ? rows.length : resp.rowCount;
      return {
        rows,
        rowCount,
        command: '',
        oid: 0,
        fields: [],
      };
    },
  };

  return exec;
};
