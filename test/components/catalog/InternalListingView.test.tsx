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

  test('pre-filters the table to the deep-linked product id', () => {
    render(<InternalListingView {...baseProps} products={products} productFilterId="prod-2" />);
    // Only the referenced product is shown; the other row is filtered out.
    expect(screen.getByText('Wind Turbine')).toBeInTheDocument();
    expect(screen.queryByText('Solar Panel')).not.toBeInTheDocument();
  });
});
