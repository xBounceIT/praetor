export type AsyncRowsState<Row> = {
  rows: Row[];
  isLoading: boolean;
  error: string | null;
};

export type AsyncRowsAction<Row> =
  | { type: 'loading' }
  | { type: 'loaded'; rows: Row[] }
  | { type: 'failed'; error: string }
  | { type: 'setError'; error: string | null };

export const createInitialAsyncRowsState = <Row>(): AsyncRowsState<Row> => ({
  rows: [],
  isLoading: true,
  error: null,
});

export const asyncRowsReducer = <Row>(
  state: AsyncRowsState<Row>,
  action: AsyncRowsAction<Row>,
): AsyncRowsState<Row> => {
  switch (action.type) {
    case 'loading':
      return { ...state, isLoading: true, error: null };
    case 'loaded':
      return { rows: action.rows, isLoading: false, error: null };
    case 'failed':
      return { rows: [], isLoading: false, error: action.error };
    case 'setError':
      return { ...state, error: action.error };
  }
};
