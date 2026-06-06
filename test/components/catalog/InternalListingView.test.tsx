import { afterEach, describe, expect, mock, test } from 'bun:test';
import { screen } from '@testing-library/react';
import type { Product } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

// InternalListingView loads product types / categories on mount; stub the API so
// the view renders without real network calls.
mock.module('../../../services/api', () => ({
  default: {
    products: {
      listProductTypes: () => Promise.resolve([]),
      listInternalCategories: () => Promise.resolve([]),
      listInternalSubcategories: () => Promise.resolve([]),
    },
  },
}));

const InternalListingView = (await import('../../../components/catalog/InternalListingView'))
  .default;

const buildProduct = (overrides: Partial<Product>): Product => ({
  id: 'prod-1',
  name: 'Solar Panel',
  productCode: 'SP-100',
  costo: 50,
  molPercentage: 20,
  costUnit: 'unit',
  type: 'supply',
  ...overrides,
});

const noop = () => Promise.resolve();
const baseProps = {
  onAddProduct: noop,
  onUpdateProduct: noop,
  onDeleteProduct: () => {},
  currency: 'EUR',
  onCreateProductType: noop,
  onUpdateProductType: noop,
  onDeleteProductType: noop,
  onCreateInternalCategory: noop,
  onUpdateInternalCategory: noop,
  onDeleteInternalCategory: noop,
  onCreateInternalSubcategory: noop,
  onRenameInternalSubcategory: noop,
  onDeleteInternalSubcategory: noop,
};

const products: Product[] = [
  buildProduct({ id: 'prod-1', name: 'Solar Panel', productCode: 'SP-100' }),
  buildProduct({ id: 'prod-2', name: 'Wind Turbine', productCode: 'WT-200' }),
];

afterEach(() => {
  document.body.style.overflow = '';
  // StandardTable persists saved views / active view per table title; clear so
  // state set in one test can't leak into the next.
  localStorage.clear();
});

// localStorage keys StandardTable derives from the products table title
// (`t('crm:internalListing.title')` -> identity mock -> slugified).
const PRODUCTS_VIEWS_KEY = 'praetor_table_customviews_crm_internallisting_title';
const PRODUCTS_ACTIVE_VIEW_KEY = 'praetor_table_activeview_crm_internallisting_title';

describe('<InternalListingView /> productFilterId', () => {
  test('shows every product when no filter is supplied', () => {
    render(<InternalListingView {...baseProps} products={products} />);
    expect(screen.getByText('Solar Panel')).toBeInTheDocument();
    expect(screen.getByText('Wind Turbine')).toBeInTheDocument();
  });

  test("pre-filters the table to the linked product's code (visible Codice column)", () => {
    render(<InternalListingView {...baseProps} products={products} productFilterId="prod-2" />);
    // The deep-linked product (resolved to its code) is the only row shown, and
    // the filter lives on the visible "Codice" column so it stays clearable via
    // the native column-filter dropdown.
    expect(screen.getByText('Wind Turbine')).toBeInTheDocument();
    expect(screen.getByText('WT-200')).toBeInTheDocument();
    expect(screen.queryByText('Solar Panel')).not.toBeInTheDocument();
    // The native funnel control for the Codice column is rendered (not hidden).
    expect(
      screen.getByRole('button', { name: /table\.filters .*productCode/i }),
    ).toBeInTheDocument();
  });

  test('falls back to the name column when the linked product has no code', () => {
    const codeless: Product[] = [
      buildProduct({ id: 'prod-1', name: 'Solar Panel', productCode: 'SP-100' }),
      buildProduct({ id: 'prod-3', name: 'Codeless Widget', productCode: '' }),
    ];
    render(<InternalListingView {...baseProps} products={codeless} productFilterId="prod-3" />);
    expect(screen.getByText('Codeless Widget')).toBeInTheDocument();
    expect(screen.queryByText('Solar Panel')).not.toBeInTheDocument();
    // The fallback filter must also land on a VISIBLE column (the name column),
    // so it stays clearable via the native funnel — same invariant as above.
    expect(
      screen.getByRole('button', { name: /table\.filters .*labels\.name/i }),
    ).toBeInTheDocument();
  });

  test('overrides a persisted saved table view (deep-link filter wins)', () => {
    // Regression (PR #766 review): a saved active view that filters to a
    // different product would otherwise overwrite the deep-link filter once
    // views hydrate after mount. The quick-view filter must win.
    localStorage.setItem(
      PRODUCTS_VIEWS_KEY,
      JSON.stringify([
        {
          id: 'saved-1',
          name: 'Only Solar',
          hiddenColIds: [],
          sortState: null,
          filterState: { productCode: ['SP-100'] },
        },
      ]),
    );
    localStorage.setItem(PRODUCTS_ACTIVE_VIEW_KEY, 'saved-1');

    render(<InternalListingView {...baseProps} products={products} productFilterId="prod-2" />);
    // The deep-linked product (WT-200) wins over the saved view's SP-100 filter.
    expect(screen.getByText('Wind Turbine')).toBeInTheDocument();
    expect(screen.queryByText('Solar Panel')).not.toBeInTheDocument();
  });

  test('keeps the Code filter visible when products load after mount (cold open)', () => {
    // Regression (PR #766 review): on a cold open `products` is empty on first
    // render, so the id->code filter can't resolve yet. A saved active view that
    // HIDES the Code column must not slip in before the filter materializes, or
    // the native funnel would be hidden and unclearable. suppressSavedView guards
    // this by forcing deep-link mode from the (stable) productFilterId at mount.
    localStorage.setItem(
      PRODUCTS_VIEWS_KEY,
      JSON.stringify([
        {
          id: 'hide-code',
          name: 'No Code',
          hiddenColIds: ['productCode'],
          sortState: null,
          filterState: {},
        },
      ]),
    );
    localStorage.setItem(PRODUCTS_ACTIVE_VIEW_KEY, 'hide-code');

    const { rerender } = render(
      <InternalListingView {...baseProps} products={[]} productFilterId="prod-2" />,
    );
    // Products arrive asynchronously (App finishes loading them).
    rerender(<InternalListingView {...baseProps} products={products} productFilterId="prod-2" />);

    expect(screen.getByText('Wind Turbine')).toBeInTheDocument();
    expect(screen.queryByText('Solar Panel')).not.toBeInTheDocument();
    // The Code column (and its native funnel) stays visible despite the saved
    // view that hid it — the deep-link filter remains clearable.
    expect(
      screen.getByRole('button', { name: /table\.filters .*productCode/i }),
    ).toBeInTheDocument();
  });
});
