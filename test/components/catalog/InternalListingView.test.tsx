import { afterEach, describe, expect, mock } from 'bun:test';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  InternalProductCategory,
  InternalProductSubcategory,
  InternalProductType,
} from '../../../services/api/products';
import type { Product } from '../../../types';
import { installI18nMock } from '../../helpers/i18n';
import { reactTest as test } from '../../helpers/reactTest';
import { render } from '../../helpers/render';

installI18nMock();

// InternalListingView loads product types / categories on mount; stub the API so
// the view renders without real network calls.
let productTypes: InternalProductType[] = [];
let categories: InternalProductCategory[] = [];
let subcategories: InternalProductSubcategory[] = [];

mock.module('../../../services/api', () => ({
  default: {
    products: {
      listProductTypes: () => Promise.resolve(productTypes),
      listInternalCategories: () => Promise.resolve(categories),
      listInternalSubcategories: () => Promise.resolve(subcategories),
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
  productTypes = [];
  categories = [];
  subcategories = [];
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
  const settleCatalogLoad = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  test('shows every product when no filter is supplied', async () => {
    render(<InternalListingView {...baseProps} products={products} />);
    await settleCatalogLoad();
    expect(screen.getByText('Solar Panel')).toBeInTheDocument();
    expect(screen.getByText('Wind Turbine')).toBeInTheDocument();
    expect(screen.getAllByLabelText('table.rowActions')).toHaveLength(products.length);
  });

  test("pre-filters the table to the linked product's code (visible Codice column)", async () => {
    render(<InternalListingView {...baseProps} products={products} productFilterId="prod-2" />);
    await settleCatalogLoad();
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

  test('falls back to the name column when the linked product has no code', async () => {
    const codeless: Product[] = [
      buildProduct({ id: 'prod-1', name: 'Solar Panel', productCode: 'SP-100' }),
      buildProduct({ id: 'prod-3', name: 'Codeless Widget', productCode: '' }),
    ];
    render(<InternalListingView {...baseProps} products={codeless} productFilterId="prod-3" />);
    await settleCatalogLoad();
    expect(screen.getByText('Codeless Widget')).toBeInTheDocument();
    expect(screen.queryByText('Solar Panel')).not.toBeInTheDocument();
    // The fallback filter must also land on a VISIBLE column (the name column),
    // so it stays clearable via the native funnel — same invariant as above.
    expect(
      screen.getByRole('button', { name: /table\.filters .*labels\.name/i }),
    ).toBeInTheDocument();
  });

  test('overrides a persisted saved table view (deep-link filter wins)', async () => {
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
    await settleCatalogLoad();
    // The deep-linked product (WT-200) wins over the saved view's SP-100 filter.
    expect(screen.getByText('Wind Turbine')).toBeInTheDocument();
    expect(screen.queryByText('Solar Panel')).not.toBeInTheDocument();
  });

  test('keeps the Code filter visible when products load after mount (cold open)', async () => {
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
    await settleCatalogLoad();
    // Products arrive asynchronously (App finishes loading them).
    await act(async () => {
      rerender(<InternalListingView {...baseProps} products={products} productFilterId="prod-2" />);
      await Promise.resolve();
    });

    expect(screen.getByText('Wind Turbine')).toBeInTheDocument();
    expect(screen.queryByText('Solar Panel')).not.toBeInTheDocument();
    // The Code column (and its native funnel) stays visible despite the saved
    // view that hid it — the deep-link filter remains clearable.
    expect(
      screen.getByRole('button', { name: /table\.filters .*productCode/i }),
    ).toBeInTheDocument();
  });
});

describe('<InternalListingView /> managed catalog values', () => {
  const setupManagedCatalogValues = async (
    overrides: Partial<Parameters<typeof InternalListingView>[0]> = {},
  ) => {
    productTypes = [
      {
        id: 'type-consulting',
        name: 'consulting',
        costUnit: 'hours',
        productCount: 0,
        categoryCount: 0,
      },
      {
        id: 'type-supply',
        name: 'supply',
        costUnit: 'unit',
        productCount: 0,
        categoryCount: 0,
      },
    ];
    categories = [
      {
        id: 'category-governance',
        name: 'Governance',
        type: 'supply',
        costUnit: 'unit',
        productCount: 0,
        hasLinkedProducts: false,
      },
      {
        id: 'category-operations',
        name: 'Operations',
        type: 'supply',
        costUnit: 'unit',
        productCount: 0,
        hasLinkedProducts: false,
      },
    ];
    subcategories = [
      { name: 'Network', productCount: 0, hasLinkedProducts: false },
      { name: 'Security', productCount: 0, hasLinkedProducts: false },
    ];

    const user = userEvent.setup();

    render(<InternalListingView {...baseProps} {...overrides} products={[]} />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'crm:internalListing.addProduct' }));

    const typeSelect = await screen.findByRole('combobox');
    await waitFor(() => expect(typeSelect).toHaveTextContent('Consulting'));
    fireEvent.click(typeSelect);
    fireEvent.click(await screen.findByRole('option', { name: 'Supply' }));
    await screen.findByText('Governance');

    const manageButtons = screen.getAllByRole('button', { name: 'common:buttons.manage' });
    expect(manageButtons).toHaveLength(3);

    return { manageButtons, user };
  };

  const openActionsFor = async (name: string) => {
    let actionButton: HTMLElement | null = null;
    await waitFor(() => {
      const row = screen
        .getAllByText(name)
        .map((element) => element.closest('tr'))
        .find((element): element is HTMLTableRowElement => element !== null);
      expect(row).toBeDefined();
      actionButton = within(row as HTMLTableRowElement).getByRole('button', {
        name: 'table.rowActions',
      });
    });
    if (!actionButton) throw new Error('Missing row actions for ' + name);
    fireEvent.pointerDown(actionButton, { button: 0, ctrlKey: false });
  };

  const deleteCurrentValue = async (user: ReturnType<typeof userEvent.setup>) => {
    expect(await screen.findByRole('button', { name: 'common:buttons.edit' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
  };

  test('localizes Manage and exposes type edit/delete actions', async () => {
    const onDeleteProductType = mock((_id: string) => Promise.resolve());
    const { manageButtons, user } = await setupManagedCatalogValues({ onDeleteProductType });

    fireEvent.click(manageButtons[0]);
    await openActionsFor('Consulting');
    await deleteCurrentValue(user);
    await waitFor(() => expect(onDeleteProductType).toHaveBeenCalledWith('type-consulting'));
  });

  test('exposes category edit/delete actions', async () => {
    const onDeleteInternalCategory = mock((_id: string) => Promise.resolve());
    const { manageButtons, user } = await setupManagedCatalogValues({
      onDeleteInternalCategory,
    });

    fireEvent.click(manageButtons[1]);
    await openActionsFor('Operations');
    await deleteCurrentValue(user);
    await waitFor(() =>
      expect(onDeleteInternalCategory).toHaveBeenCalledWith('category-operations'),
    );
  });

  test('exposes subcategory edit/delete actions', async () => {
    const onDeleteInternalSubcategory = mock((_name: string, _type: string, _category: string) =>
      Promise.resolve(),
    );
    const { manageButtons, user } = await setupManagedCatalogValues({
      onDeleteInternalSubcategory,
    });

    fireEvent.click(manageButtons[2]);
    await openActionsFor('Security');
    await deleteCurrentValue(user);
    await waitFor(() =>
      expect(onDeleteInternalSubcategory).toHaveBeenCalledWith('Security', 'supply', 'Governance'),
    );
  });
});
