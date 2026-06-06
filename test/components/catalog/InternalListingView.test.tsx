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
});

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
});
