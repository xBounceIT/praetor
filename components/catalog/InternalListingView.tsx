import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLatestRef } from '../../hooks/useLatestRef';
import api from '../../services/api';
import type {
  InternalProductCategory,
  InternalProductSubcategory,
  InternalProductType,
} from '../../services/api/products';
import type { Product } from '../../types';
import { formatInsertDate } from '../../utils/date';
import {
  calcProductSalePrice,
  formatDecimal,
  formatMolPercentage,
  MOL_PERCENTAGE_DECIMALS,
  parseNumberInputValue,
} from '../../utils/numbers';
import DeleteConfirmModal from '../shared/DeleteConfirmModal';
import HeaderAddButton from '../shared/HeaderAddButton';
import Modal from '../shared/Modal';
import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '../shared/ModalLayout';
import SelectControl, { type Option } from '../shared/SelectControl';
import StandardTable from '../shared/StandardTable';
import StatusBadge from '../shared/StatusBadge';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface InternalListingViewProps {
  products: Product[];
  // When set (via a quick-view deep link), the products table opens pre-filtered
  // to this product id so the referenced record is the only row shown.
  productFilterId?: string | null;
  onAddProduct: (productData: Partial<Product>) => Promise<void>;
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  onDeleteProduct: (id: string) => void;
  currency: string;
  // Product Type management (mutations only - reads use api directly)
  onCreateProductType: (typeData: { name: string; costUnit: 'unit' | 'hours' }) => Promise<void>;
  onUpdateProductType: (
    id: string,
    updates: Partial<{ name: string; costUnit: 'unit' | 'hours' }>,
  ) => Promise<void>;
  onDeleteProductType: (id: string) => Promise<void>;
  // Category/Subcategory management (mutations only - reads use api directly)
  onCreateInternalCategory: (categoryData: { name: string; type: string }) => Promise<void>;
  onUpdateInternalCategory: (id: string, updates: Partial<{ name: string }>) => Promise<void>;
  onDeleteInternalCategory: (id: string) => Promise<void>;
  onCreateInternalSubcategory: (subcategoryData: {
    name: string;
    type: string;
    category: string;
  }) => Promise<void>;
  onRenameInternalSubcategory: (
    oldName: string,
    newName: string,
    type: string,
    category: string,
  ) => Promise<void>;
  onDeleteInternalSubcategory: (name: string, type: string, category: string) => Promise<void>;
}

const calcMargine = (costo: number, molPercentage: number) =>
  calcProductSalePrice(costo, molPercentage) - costo;

const getDisplayTypeName = (typeName: string) =>
  typeName.charAt(0).toUpperCase() + typeName.slice(1);

const EMPTY_FORM_DATA: Partial<Product> = {
  name: '',
  productCode: '',
  description: '',
  costo: undefined,
  molPercentage: undefined,
  costUnit: 'unit',
  category: '',
  subcategory: '',
  type: '',
};

interface ListingState {
  // Product Types State
  productTypes: InternalProductType[];
  isLoadingTypes: boolean;
  // Type Management State
  isManageTypesModalOpen: boolean;
  editingType: InternalProductType | null;
  newTypeName: string;
  newTypeCostUnit: 'unit' | 'hours';
  typeError: string | null;
  isSavingType: boolean;
  // Main product modal state
  isModalOpen: boolean;
  editingProduct: Product | null;
  isDeleteConfirmOpen: boolean;
  productToDelete: Product | null;
  errors: Record<string, string>;
  serverError: string | null;
  // Category Management State
  isManageCategoriesModalOpen: boolean;
  categories: InternalProductCategory[];
  isLoadingCategories: boolean;
  editingCategory: InternalProductCategory | null;
  newCategoryName: string;
  categoryError: string | null;
  isSavingCategory: boolean;
  // Subcategory Management State
  isManageSubcategoriesModalOpen: boolean;
  subcategories: InternalProductSubcategory[];
  isLoadingSubcategories: boolean;
  editingSubcategory: InternalProductSubcategory | null;
  newSubcategoryName: string;
  subcategoryError: string | null;
  isSavingSubcategory: boolean;
  // Form State
  formData: Partial<Product>;
}

const INITIAL_LISTING_STATE: ListingState = {
  productTypes: [],
  isLoadingTypes: true,
  isManageTypesModalOpen: false,
  editingType: null,
  newTypeName: '',
  newTypeCostUnit: 'unit',
  typeError: null,
  isSavingType: false,
  isModalOpen: false,
  editingProduct: null,
  isDeleteConfirmOpen: false,
  productToDelete: null,
  errors: {},
  serverError: null,
  isManageCategoriesModalOpen: false,
  categories: [],
  isLoadingCategories: false,
  editingCategory: null,
  newCategoryName: '',
  categoryError: null,
  isSavingCategory: false,
  isManageSubcategoriesModalOpen: false,
  subcategories: [],
  isLoadingSubcategories: false,
  editingSubcategory: null,
  newSubcategoryName: '',
  subcategoryError: null,
  isSavingSubcategory: false,
  formData: EMPTY_FORM_DATA,
};

type ListingAction =
  | { type: 'merge'; patch: Partial<ListingState> }
  | { type: 'patchForm'; patch: Partial<Product> }
  | { type: 'patchErrors'; patch: Record<string, string> };

const listingReducer = (state: ListingState, action: ListingAction): ListingState => {
  switch (action.type) {
    case 'merge':
      return { ...state, ...action.patch };
    case 'patchForm':
      return { ...state, formData: { ...state.formData, ...action.patch } };
    case 'patchErrors':
      return { ...state, errors: { ...state.errors, ...action.patch } };
    default:
      return state;
  }
};

const useInternalListingController = ({
  products,
  productFilterId,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  currency,
  onCreateProductType,
  onUpdateProductType,
  onDeleteProductType,
  onCreateInternalCategory,
  onUpdateInternalCategory,
  onDeleteInternalCategory,
  onCreateInternalSubcategory,
  onRenameInternalSubcategory,
  onDeleteInternalSubcategory,
}: InternalListingViewProps) => {
  const { t, i18n } = useTranslation(['crm', 'common']);

  // A quick-view deep link arrives as a product id. Resolve it to a *visible*
  // column value — the "Codice" (productCode) column, falling back to the name —
  // so the table opens with the native column filter active (a highlighted,
  // clearable filter chip) instead of an invisible hidden-column filter.
  const tableInitialFilterState = useMemo<Record<string, string[]> | undefined>(() => {
    if (!productFilterId) return undefined;
    const product = products.find((p) => p.id === productFilterId);
    if (!product) return undefined;
    // Prefer the visible "Codice" column; fall back to the name when codeless.
    const column = product.productCode ? 'productCode' : 'name';
    const value = product.productCode || product.name;
    return value ? { [column]: [value] } : undefined;
  }, [productFilterId, products]);

  const [state, dispatch] = useReducer(listingReducer, INITIAL_LISTING_STATE);
  const {
    productTypes,
    isLoadingTypes,
    isManageTypesModalOpen,
    editingType,
    newTypeName,
    newTypeCostUnit,
    typeError,
    isSavingType,
    isModalOpen,
    editingProduct,
    isDeleteConfirmOpen,
    productToDelete,
    errors,
    serverError,
    isManageCategoriesModalOpen,
    categories,
    isLoadingCategories,
    editingCategory,
    newCategoryName,
    categoryError,
    isSavingCategory,
    isManageSubcategoriesModalOpen,
    subcategories,
    isLoadingSubcategories,
    editingSubcategory,
    newSubcategoryName,
    subcategoryError,
    isSavingSubcategory,
    formData,
  } = state;

  // Mirror of formData for stable useCallback closures that previously read the
  // latest value via setFormData((prev) => ...). Keeps callback identities stable
  // while still observing the newest form data.
  const formDataRef = useLatestRef(formData);

  const defaultProductType = productTypes[0];
  const defaultTypeName = defaultProductType?.name || '';
  const defaultTypeCostUnit = defaultProductType?.costUnit || 'unit';

  // Load product types on mount
  useEffect(() => {
    const loadTypes = async () => {
      try {
        const types = await api.products.listProductTypes();
        dispatch({ type: 'merge', patch: { productTypes: types } });
      } catch (err) {
        console.error('Failed to load product types:', err);
      } finally {
        dispatch({ type: 'merge', patch: { isLoadingTypes: false } });
      }
    };
    loadTypes();
  }, []);

  // Load categories when type changes or category modal opens
  const loadCategories = useCallback(async (type: string) => {
    if (!type) {
      dispatch({ type: 'merge', patch: { categories: [] } });
      return [];
    }
    dispatch({ type: 'merge', patch: { isLoadingCategories: true } });
    try {
      const cats = await api.products.listInternalCategories(type);
      dispatch({ type: 'merge', patch: { categories: cats } });
      return cats;
    } catch (err) {
      console.error('Failed to load categories:', err);
      return [];
    } finally {
      dispatch({ type: 'merge', patch: { isLoadingCategories: false } });
    }
  }, []);

  // Load subcategories when category changes or subcategory modal opens
  const loadSubcategories = useCallback(async (type: string, category: string) => {
    if (!type || !category) {
      dispatch({ type: 'merge', patch: { subcategories: [] } });
      return [];
    }
    dispatch({ type: 'merge', patch: { isLoadingSubcategories: true } });
    try {
      const subs = await api.products.listInternalSubcategories(type, category);
      dispatch({ type: 'merge', patch: { subcategories: subs } });
      return subs;
    } catch (err) {
      console.error('Failed to load subcategories:', err);
      return [];
    } finally {
      dispatch({ type: 'merge', patch: { isLoadingSubcategories: false } });
    }
  }, []);

  const selectFirstCategoryForType = useCallback(
    (type: string, nextCategories: InternalProductCategory[]) => {
      const firstCategory = nextCategories[0];
      if (!firstCategory) return;
      // Preserves the original guard: only auto-select when the type still matches
      // and no category is chosen yet.
      if (formDataRef.current.type !== type || formDataRef.current.category) return;
      dispatch({
        type: 'patchForm',
        patch: { category: firstCategory.name, subcategory: '' },
      });
    },
    [formDataRef],
  );

  const openAddModal = () => {
    dispatch({
      type: 'merge',
      patch: {
        editingProduct: null,
        categories: [],
        subcategories: [],
        formData: {
          name: '',
          productCode: '',
          description: '',
          costo: undefined,
          molPercentage: undefined,
          costUnit: defaultTypeCostUnit,
          category: '',
          subcategory: '',
          type: defaultTypeName,
        },
        errors: {},
        serverError: null,
        isModalOpen: true,
      },
    });
    if (defaultTypeName) {
      void loadCategories(defaultTypeName).then((nextCategories) => {
        selectFirstCategoryForType(defaultTypeName, nextCategories);
        const firstCategory = nextCategories[0];
        if (firstCategory) void loadSubcategories(defaultTypeName, firstCategory.name);
      });
    }
  };

  const openEditModal = (product: Product) => {
    // Look up cost unit from product types, fallback to the product's current value
    const typeData = productTypes.find((t) => t.name === product.type);
    const typeName = product.type || (productTypes[0]?.name ?? '');
    const categoryName = product.category || '';
    dispatch({
      type: 'merge',
      patch: {
        editingProduct: product,
        categories: [],
        subcategories: [],
        formData: {
          name: product.name || '',
          productCode: product.productCode || '',
          description: product.description || '',
          costo: product.costo || 0,
          molPercentage: product.molPercentage || 0,
          costUnit: typeData?.costUnit || product.costUnit || 'unit',
          category: categoryName,
          subcategory: product.subcategory || '',
          type: typeName,
        },
        errors: {},
        serverError: null,
        isModalOpen: true,
      },
    });
    if (typeName) void loadCategories(typeName);
    if (typeName && categoryName) void loadSubcategories(typeName, categoryName);
  };

  const handleNumericValueChange = (field: 'costo' | 'molPercentage') => (value: string) => {
    const parsed = parseNumberInputValue(value, undefined);
    dispatch({ type: 'patchForm', patch: { [field]: parsed } });
    if (errors[field]) {
      dispatch({ type: 'patchErrors', patch: { [field]: '' } });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({ type: 'merge', patch: { errors: {}, serverError: null } });

    const newErrors: Record<string, string> = {};
    if (!formData.name?.trim()) newErrors.name = t('common:validation.productNameRequired');

    // Validate product code
    const trimmedProductCode = formData.productCode?.trim() || '';
    if (!trimmedProductCode) {
      newErrors.productCode = t('common:validation.productCodeRequired');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(trimmedProductCode)) {
      newErrors.productCode = t('common:validation.productCodeInvalid');
    }

    if (formData.costo === undefined || formData.costo === null || Number.isNaN(formData.costo)) {
      newErrors.costo = t('common:validation.costRequired');
    }
    if (
      formData.molPercentage === undefined ||
      formData.molPercentage === null ||
      Number.isNaN(formData.molPercentage)
    ) {
      newErrors.molPercentage = t('common:validation.molPercentageRequired');
    }
    if (
      !newErrors.molPercentage &&
      formData.molPercentage !== undefined &&
      formData.molPercentage !== null &&
      !Number.isNaN(formData.molPercentage)
    ) {
      if (formData.molPercentage <= 0 || formData.molPercentage >= 100) {
        newErrors.molPercentage = t('common:validation.molPercentageRange');
      }
    }
    const typeValue = formData.type;
    const isKnownType = productTypes.some((type) => type.name === typeValue);
    if (!typeValue || (productTypes.length > 0 && !isKnownType)) {
      newErrors.type = t('common:validation.typeRequired');
    }

    if (Object.keys(newErrors).length > 0) {
      dispatch({ type: 'merge', patch: { errors: newErrors } });
      return;
    }

    try {
      const { costUnit: _costUnit, ...productPayload } = formData;
      if (editingProduct) {
        await onUpdateProduct(editingProduct.id, {
          ...productPayload,
          costo: formData.costo !== undefined ? formData.costo : undefined,
          molPercentage: formData.molPercentage !== undefined ? formData.molPercentage : undefined,
        });
      } else {
        await onAddProduct({
          ...productPayload,
          costo: formData.costo !== undefined ? formData.costo : undefined,
          molPercentage: formData.molPercentage !== undefined ? formData.molPercentage : undefined,
        });
      }
      dispatch({ type: 'merge', patch: { isModalOpen: false } });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        if (err.message.toLowerCase().includes('product code')) {
          dispatch({
            type: 'merge',
            patch: {
              errors: { ...newErrors, productCode: t('common:validation.productCodeUnique') },
            },
          });
        } else {
          dispatch({
            type: 'merge',
            patch: { errors: { ...newErrors, name: t('common:validation.productNameUnique') } },
          });
        }
      } else {
        dispatch({
          type: 'merge',
          patch: { serverError: err instanceof Error ? err.message : 'An error occurred' },
        });
      }
    }
  };

  const confirmDelete = (product: Product) => {
    dispatch({
      type: 'merge',
      patch: { productToDelete: product, isDeleteConfirmOpen: true },
    });
  };

  const handleDelete = () => {
    if (productToDelete) {
      onDeleteProduct(productToDelete.id);
      dispatch({
        type: 'merge',
        patch: { isDeleteConfirmOpen: false, productToDelete: null },
      });
    }
  };

  // Category Management Handlers
  const handleOpenManageCategories = () => {
    dispatch({
      type: 'merge',
      patch: {
        isManageCategoriesModalOpen: true,
        editingCategory: null,
        newCategoryName: '',
        categoryError: null,
      },
    });
  };

  const handleSaveCategory = async () => {
    if (!newCategoryName.trim()) {
      dispatch({
        type: 'merge',
        patch: { categoryError: t('crm:internalListing.categoryNameRequired') },
      });
      return;
    }

    const selectedType = formData.type || defaultTypeName;
    if (!selectedType) {
      dispatch({ type: 'merge', patch: { categoryError: t('common:validation.typeRequired') } });
      return;
    }

    dispatch({ type: 'merge', patch: { isSavingCategory: true, categoryError: null } });

    try {
      if (editingCategory) {
        await onUpdateInternalCategory(editingCategory.id, {
          name: newCategoryName.trim(),
        });
      } else {
        await onCreateInternalCategory({
          name: newCategoryName.trim(),
          type: selectedType,
        });
      }

      // Reload categories
      await loadCategories(selectedType);

      // If the renamed category was selected, update formData
      if (
        editingCategory &&
        formData.category === editingCategory.name &&
        formData.type === editingCategory.type
      ) {
        dispatch({ type: 'patchForm', patch: { category: newCategoryName.trim() } });
      }

      // Reset form
      dispatch({ type: 'merge', patch: { editingCategory: null, newCategoryName: '' } });
    } catch (err: unknown) {
      dispatch({
        type: 'merge',
        patch: { categoryError: err instanceof Error ? err.message : 'An error occurred' },
      });
    } finally {
      dispatch({ type: 'merge', patch: { isSavingCategory: false } });
    }
  };

  const handleEditCategory = (category: InternalProductCategory) => {
    dispatch({
      type: 'merge',
      patch: { editingCategory: category, newCategoryName: category.name, categoryError: null },
    });
  };

  const handleDeleteCategory = async (category: InternalProductCategory) => {
    if (category.hasLinkedProducts) return;

    if (category.productCount > 0) {
      const confirmed = window.confirm(
        t('crm:internalListing.deleteCategoryWithProducts', {
          count: category.productCount,
          name: category.name,
        }),
      );
      if (!confirmed) return;
    }

    try {
      await onDeleteInternalCategory(category.id);

      // If the deleted category was selected, clear it
      if (formData.category === category.name && formData.type === category.type) {
        dispatch({ type: 'patchForm', patch: { category: '', subcategory: '' } });
      }

      // Reload categories
      await loadCategories(category.type);
    } catch (err: unknown) {
      dispatch({
        type: 'merge',
        patch: { categoryError: err instanceof Error ? err.message : 'An error occurred' },
      });
    }
  };

  const handleCancelCategoryEdit = () => {
    dispatch({
      type: 'merge',
      patch: { editingCategory: null, newCategoryName: '', categoryError: null },
    });
  };

  // Product Type Management Handlers
  const handleOpenManageTypes = () => {
    dispatch({
      type: 'merge',
      patch: {
        isManageTypesModalOpen: true,
        editingType: null,
        newTypeName: '',
        newTypeCostUnit: 'unit',
        typeError: null,
      },
    });
  };

  const handleSaveType = async () => {
    if (!newTypeName.trim()) {
      dispatch({ type: 'merge', patch: { typeError: t('crm:internalListing.typeNameRequired') } });
      return;
    }

    dispatch({ type: 'merge', patch: { isSavingType: true, typeError: null } });

    try {
      if (editingType) {
        await onUpdateProductType(editingType.id, {
          name: newTypeName.trim(),
          costUnit: newTypeCostUnit,
        });
      } else {
        await onCreateProductType({
          name: newTypeName.trim(),
          costUnit: newTypeCostUnit,
        });
      }

      // Reload types
      const types = await api.products.listProductTypes();
      dispatch({ type: 'merge', patch: { productTypes: types } });

      // If the renamed type was selected, update formData
      if (editingType && formData.type === editingType.name) {
        dispatch({
          type: 'patchForm',
          patch: {
            type: newTypeName.trim(),
            costUnit: newTypeCostUnit,
          },
        });
      }

      // Reset form
      dispatch({
        type: 'merge',
        patch: { editingType: null, newTypeName: '', newTypeCostUnit: 'unit' },
      });
    } catch (err: unknown) {
      dispatch({
        type: 'merge',
        patch: { typeError: err instanceof Error ? err.message : 'An error occurred' },
      });
    } finally {
      dispatch({ type: 'merge', patch: { isSavingType: false } });
    }
  };

  const handleEditType = (type: InternalProductType) => {
    dispatch({
      type: 'merge',
      patch: {
        editingType: type,
        newTypeName: type.name,
        newTypeCostUnit: type.costUnit,
        typeError: null,
      },
    });
  };

  const handleDeleteType = async (type: InternalProductType) => {
    if (type.productCount > 0 || type.categoryCount > 0) {
      dispatch({
        type: 'merge',
        patch: {
          typeError: t('crm:internalListing.typeDeleteBlocked', {
            name: type.name,
          }),
        },
      });
      return;
    }

    try {
      dispatch({ type: 'merge', patch: { typeError: null } });
      await onDeleteProductType(type.id);

      // If the deleted type was selected, clear it
      if (formData.type === type.name) {
        const remainingTypes = productTypes.filter((t) => t.id !== type.id);
        const nextType = remainingTypes[0]?.name || '';
        const nextCostUnit = remainingTypes[0]?.costUnit || 'unit';
        dispatch({
          type: 'patchForm',
          patch: {
            type: nextType,
            costUnit: nextCostUnit,
            category: '',
            subcategory: '',
          },
        });
      }

      // Reload types
      const types = await api.products.listProductTypes();
      dispatch({ type: 'merge', patch: { productTypes: types } });
    } catch (err: unknown) {
      dispatch({
        type: 'merge',
        patch: { typeError: err instanceof Error ? err.message : 'An error occurred' },
      });
    }
  };

  const handleCancelTypeEdit = () => {
    dispatch({
      type: 'merge',
      patch: { editingType: null, newTypeName: '', newTypeCostUnit: 'unit', typeError: null },
    });
  };

  // Subcategory Management Handlers
  const handleOpenManageSubcategories = () => {
    if (!formData.category) return;
    dispatch({
      type: 'merge',
      patch: {
        isManageSubcategoriesModalOpen: true,
        editingSubcategory: null,
        newSubcategoryName: '',
        subcategoryError: null,
      },
    });
  };

  const handleSaveSubcategory = async () => {
    if (!newSubcategoryName.trim()) {
      dispatch({
        type: 'merge',
        patch: { subcategoryError: t('crm:internalListing.subcategoryNameRequired') },
      });
      return;
    }

    const selectedType = formData.type || defaultTypeName;
    if (!selectedType) {
      dispatch({ type: 'merge', patch: { subcategoryError: t('common:validation.typeRequired') } });
      return;
    }

    dispatch({ type: 'merge', patch: { isSavingSubcategory: true, subcategoryError: null } });

    try {
      if (editingSubcategory) {
        await onRenameInternalSubcategory(
          editingSubcategory.name,
          newSubcategoryName.trim(),
          selectedType,
          formData.category || '',
        );
      } else {
        await onCreateInternalSubcategory({
          name: newSubcategoryName.trim(),
          type: selectedType,
          category: formData.category || '',
        });
      }

      // Reload subcategories
      await loadSubcategories(selectedType, formData.category || '');

      // If the renamed subcategory was selected, update formData
      if (editingSubcategory && formData.subcategory === editingSubcategory.name) {
        dispatch({ type: 'patchForm', patch: { subcategory: newSubcategoryName.trim() } });
      }

      // Reset form
      dispatch({ type: 'merge', patch: { editingSubcategory: null, newSubcategoryName: '' } });
    } catch (err: unknown) {
      dispatch({
        type: 'merge',
        patch: { subcategoryError: err instanceof Error ? err.message : 'An error occurred' },
      });
    } finally {
      dispatch({ type: 'merge', patch: { isSavingSubcategory: false } });
    }
  };

  const handleEditSubcategory = (subcategory: InternalProductSubcategory) => {
    dispatch({
      type: 'merge',
      patch: {
        editingSubcategory: subcategory,
        newSubcategoryName: subcategory.name,
        subcategoryError: null,
      },
    });
  };

  const handleDeleteSubcategory = async (subcategory: InternalProductSubcategory) => {
    const selectedType = formData.type || defaultTypeName;
    if (!selectedType) {
      dispatch({ type: 'merge', patch: { subcategoryError: t('common:validation.typeRequired') } });
      return;
    }

    if (subcategory.hasLinkedProducts) return;

    if (subcategory.productCount > 0) {
      const confirmed = window.confirm(
        t('crm:internalListing.deleteSubcategoryWithProducts', {
          count: subcategory.productCount,
          name: subcategory.name,
        }),
      );
      if (!confirmed) return;
    }

    try {
      await onDeleteInternalSubcategory(subcategory.name, selectedType, formData.category || '');

      // If the deleted subcategory was selected, clear it
      if (formData.subcategory === subcategory.name) {
        dispatch({ type: 'patchForm', patch: { subcategory: '' } });
      }

      // Reload subcategories
      await loadSubcategories(selectedType, formData.category || '');
    } catch (err: unknown) {
      dispatch({
        type: 'merge',
        patch: { subcategoryError: err instanceof Error ? err.message : 'An error occurred' },
      });
    }
  };

  const handleCancelSubcategoryEdit = () => {
    dispatch({
      type: 'merge',
      patch: { editingSubcategory: null, newSubcategoryName: '', subcategoryError: null },
    });
  };

  // Get unique categories from the API (includes both persisted and product-derived)
  const availableCategories = useMemo(() => {
    return categories.map((c) => c.name).sort();
  }, [categories]);

  const categoryOptions: Option[] = availableCategories.map((c) => ({ id: c, name: c }));

  // Get available subcategories based on category
  const availableSubcategories = useMemo(() => {
    return subcategories.map((s) => s.name).sort();
  }, [subcategories]);

  const subcategoryOptions: Option[] = availableSubcategories.map((s) => ({ id: s, name: s }));

  // Build type options from API-loaded product types
  const typeOptions: Option[] = productTypes.map((t) => ({
    id: t.name,
    name: getDisplayTypeName(t.name),
  }));

  const handleTypeChange = (val: string) => {
    const typeName = val;
    const typeData = productTypes.find((t) => t.name === typeName);
    // Reset category and subcategory, then load the category list for the selected type.
    dispatch({
      type: 'merge',
      patch: {
        categories: [],
        subcategories: [],
        formData: {
          ...formData,
          type: typeName,
          costUnit: typeData?.costUnit || 'unit',
          category: '',
          subcategory: '',
        },
        ...(errors.type ? { errors: { ...errors, type: '' } } : {}),
      },
    });
    void loadCategories(typeName).then((nextCategories) => {
      if (!editingProduct) {
        selectFirstCategoryForType(typeName, nextCategories);
        const firstCategory = nextCategories[0];
        if (firstCategory) void loadSubcategories(typeName, firstCategory.name);
      }
    });
  };

  const hasPricing =
    formData.costo !== undefined &&
    formData.costo !== null &&
    !Number.isNaN(formData.costo) &&
    formData.molPercentage !== undefined &&
    formData.molPercentage !== null &&
    !Number.isNaN(formData.molPercentage);
  const pricing = hasPricing
    ? { cost: Number(formData.costo), mol: Number(formData.molPercentage) }
    : null;

  return {
    categories,
    categoryError,
    categoryOptions,
    confirmDelete,
    currency,
    dispatch,
    editingCategory,
    editingProduct,
    editingSubcategory,
    editingType,
    errors,
    formData,
    handleCancelCategoryEdit,
    handleCancelSubcategoryEdit,
    handleCancelTypeEdit,
    handleDelete,
    handleDeleteCategory,
    handleDeleteSubcategory,
    handleDeleteType,
    handleEditCategory,
    handleEditSubcategory,
    handleEditType,
    handleNumericValueChange,
    handleOpenManageCategories,
    handleOpenManageSubcategories,
    handleOpenManageTypes,
    handleSaveCategory,
    handleSaveSubcategory,
    handleSaveType,
    handleSubmit,
    handleTypeChange,
    i18n,
    isDeleteConfirmOpen,
    isLoadingCategories,
    isLoadingSubcategories,
    isLoadingTypes,
    isManageCategoriesModalOpen,
    isManageSubcategoriesModalOpen,
    isManageTypesModalOpen,
    isModalOpen,
    isSavingCategory,
    isSavingSubcategory,
    isSavingType,
    loadSubcategories,
    newCategoryName,
    newSubcategoryName,
    newTypeCostUnit,
    newTypeName,
    onUpdateProduct,
    openAddModal,
    openEditModal,
    pricing,
    productFilterId,
    productToDelete,
    productTypes,
    products,
    serverError,
    subcategories,
    subcategoryError,
    subcategoryOptions,
    t,
    tableInitialFilterState,
    typeError,
    typeOptions,
  };
};

type InternalListingController = ReturnType<typeof useInternalListingController>;

const InternalListingView: React.FC<InternalListingViewProps> = (props) => {
  const controller = useInternalListingController(props);
  return <InternalListingLayout controller={controller} />;
};

const InternalListingLayout: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <div className="space-y-8">
    <InternalListingTypesModal controller={controller} />
    <InternalListingCategoriesModal controller={controller} />
    <InternalListingSubcategoriesModal controller={controller} />
    <InternalListingProductModal controller={controller} />
    <InternalListingDeleteDialog controller={controller} />
    <InternalListingHeader controller={controller} />
    <InternalListingProductsTable controller={controller} />
  </div>
);

const InternalListingModalTitle: React.FC<{
  icon: string;
  children: React.ReactNode;
}> = ({ icon, children }) => (
  <ModalTitle className="gap-3">
    <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
      <i className={`fa-solid ${icon}`} aria-hidden="true"></i>
    </span>
    {children}
  </ModalTitle>
);

const InternalListingLoading: React.FC = () => (
  <div className="flex items-center justify-center py-8">
    <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
  </div>
);

const InternalListingTypesModal: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <Modal
    isOpen={controller.isManageTypesModalOpen}
    onClose={() => controller.dispatch({ type: 'merge', patch: { isManageTypesModalOpen: false } })}
    zIndex={70}
  >
    <ModalContent size="2xl">
      <ModalHeader>
        <InternalListingModalTitle icon="fa-tags">
          {controller.t('crm:internalListing.manageTypes')}
        </InternalListingModalTitle>
        <ModalCloseButton
          onClick={() =>
            controller.dispatch({ type: 'merge', patch: { isManageTypesModalOpen: false } })
          }
        />
      </ModalHeader>
      <ModalBody className="max-h-[60vh] space-y-4">
        <InternalListingTypeForm controller={controller} />
        {controller.isLoadingTypes ? (
          <InternalListingLoading />
        ) : (
          <InternalListingTypesTable controller={controller} />
        )}
      </ModalBody>
    </ModalContent>
  </Modal>
);

const InternalListingTypeForm: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
    <div className="space-y-1.5">
      <FieldLabel>{controller.t('crm:internalListing.typeName')}</FieldLabel>
      <div className="flex gap-2">
        <Input
          type="text"
          value={controller.newTypeName}
          onChange={(event) =>
            controller.dispatch({ type: 'merge', patch: { newTypeName: event.target.value } })
          }
          placeholder={controller.t('crm:internalListing.typeNamePlaceholder')}
          className="flex-1"
          onKeyDown={(event) => event.key === 'Enter' && controller.handleSaveType()}
        />
        <SelectControl
          options={[
            { id: 'unit', name: controller.t('crm:internalListing.unit') },
            { id: 'hours', name: controller.t('crm:internalListing.hour') },
          ]}
          value={controller.newTypeCostUnit}
          onChange={(value) =>
            controller.dispatch({
              type: 'merge',
              patch: { newTypeCostUnit: value as 'unit' | 'hours' },
            })
          }
          searchable={false}
          buttonClassName="py-2 text-sm w-28"
        />
      </div>
    </div>
    {controller.typeError && (
      <p className="text-red-500 text-xs font-bold">{controller.typeError}</p>
    )}
    <div className="flex justify-end gap-2">
      {controller.editingType && (
        <Button type="button" variant="outline" onClick={controller.handleCancelTypeEdit}>
          {controller.t('common:buttons.cancel')}
        </Button>
      )}
      <Button
        type="button"
        onClick={controller.handleSaveType}
        disabled={controller.isSavingType || !controller.newTypeName.trim()}
        className="w-28"
      >
        {controller.isSavingType
          ? controller.t('common:buttons.saving')
          : controller.editingType
            ? controller.t('common:buttons.update')
            : controller.t('common:buttons.add')}
      </Button>
    </div>
  </div>
);

const InternalListingTypesTable: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <StandardTable<InternalProductType>
    title={controller.t('crm:internalListing.manageTypes')}
    data={controller.productTypes}
    defaultRowsPerPage={5}
    containerClassName="shadow-none border-zinc-200 rounded-2xl"
    tableContainerClassName="max-h-[35vh] overflow-y-auto"
    emptyState={
      <div className="text-center py-6 text-zinc-500">
        <p>{controller.t('crm:internalListing.noTypes')}</p>
      </div>
    }
    columns={[
      {
        header: controller.t('crm:internalListing.name'),
        accessorFn: (row) => row.name.charAt(0).toUpperCase() + row.name.slice(1),
        cell: ({ row }) => (
          <span className="font-bold text-zinc-700">
            {row.name.charAt(0).toUpperCase() + row.name.slice(1)}
          </span>
        ),
        disableFiltering: true,
      },
      {
        header: controller.t('crm:internalListing.measurement'),
        accessorFn: (row) =>
          row.costUnit === 'hours'
            ? controller.t('crm:internalListing.hour')
            : controller.t('crm:internalListing.unit'),
        disableFiltering: true,
      },
      {
        header: controller.t('crm:internalListing.linkedItems'),
        accessorFn: (row) => {
          const parts = [`${row.productCount} ${controller.t('crm:internalListing.products')}`];
          if (row.categoryCount > 0) {
            parts.push(`${row.categoryCount} ${controller.t('crm:internalListing.categories')}`);
          }
          return parts.join(', ');
        },
        cell: ({ row }) => (
          <span className="text-xs text-zinc-400">
            {row.productCount} {controller.t('crm:internalListing.products')}
            {row.categoryCount > 0 && (
              <>
                , {row.categoryCount} {controller.t('crm:internalListing.categories')}
              </>
            )}
          </span>
        ),
        disableFiltering: true,
      },
      {
        header: controller.t('common:labels.actions'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row: type }) => renderInternalListingTypeActions(controller, type),
      },
    ]}
  />
);

const renderInternalListingTypeActions = (
  controller: InternalListingController,
  type: InternalProductType,
) => {
  const isDeleteBlocked = type.productCount > 0 || type.categoryCount > 0;
  const deleteBlockedMessage = controller.t('crm:internalListing.typeDeleteBlocked', {
    name: type.name,
  });

  return renderInternalListingEditDeleteActions({
    controller,
    deleteDisabled: isDeleteBlocked,
    deleteDisabledTooltip: deleteBlockedMessage,
    onDelete: () => controller.handleDeleteType(type),
    onEdit: () => controller.handleEditType(type),
  });
};

const renderInternalListingIconAction = ({
  danger = false,
  disabled = false,
  disabledTooltip,
  icon,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
  icon: string;
  label: string;
  onClick: () => void;
}) => (
  <Tooltip disabled={!disabled || !disabledTooltip}>
    <TooltipTrigger asChild>
      <span className="inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={`p-1.5 rounded-lg transition-colors ${
            disabled
              ? 'text-zinc-300 cursor-not-allowed'
              : danger
                ? 'text-red-600 hover:text-red-600 hover:bg-red-50'
                : 'text-zinc-400 hover:text-praetor hover:bg-zinc-100'
          }`}
        >
          <i className={`fa-solid ${icon}`} aria-hidden="true"></i>
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent>{disabled ? disabledTooltip : label}</TooltipContent>
  </Tooltip>
);

const renderInternalListingEditDeleteActions = ({
  controller,
  deleteDisabled,
  deleteDisabledTooltip,
  onDelete,
  onEdit,
}: {
  controller: InternalListingController;
  deleteDisabled: boolean;
  deleteDisabledTooltip: string;
  onDelete: () => void;
  onEdit: () => void;
}) => (
  <div className="flex items-center gap-1">
    {renderInternalListingIconAction({
      icon: 'fa-pen',
      label: controller.t('common:buttons.edit'),
      onClick: onEdit,
    })}
    {renderInternalListingIconAction({
      icon: 'fa-trash',
      label: controller.t('common:buttons.delete'),
      onClick: onDelete,
      disabled: deleteDisabled,
      disabledTooltip: deleteDisabledTooltip,
      danger: true,
    })}
  </div>
);

const InternalListingCategoriesModal: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <Modal
    isOpen={controller.isManageCategoriesModalOpen}
    onClose={() =>
      controller.dispatch({ type: 'merge', patch: { isManageCategoriesModalOpen: false } })
    }
    zIndex={70}
  >
    <ModalContent size="2xl">
      <ModalHeader>
        <InternalListingModalTitle icon="fa-folder-tree">
          {controller.t('crm:internalListing.manageCategories')}
        </InternalListingModalTitle>
        <ModalCloseButton
          onClick={() =>
            controller.dispatch({ type: 'merge', patch: { isManageCategoriesModalOpen: false } })
          }
        />
      </ModalHeader>
      <ModalBody className="max-h-[60vh] space-y-4">
        <InternalListingCategoryForm controller={controller} />
        {controller.isLoadingCategories ? (
          <InternalListingLoading />
        ) : (
          <InternalListingCategoriesTable controller={controller} />
        )}
      </ModalBody>
    </ModalContent>
  </Modal>
);

const InternalListingCategoryForm: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
    <div className="space-y-1.5">
      <FieldLabel>{controller.t('crm:internalListing.categoryName')}</FieldLabel>
      <Input
        type="text"
        value={controller.newCategoryName}
        onChange={(event) =>
          controller.dispatch({ type: 'merge', patch: { newCategoryName: event.target.value } })
        }
        placeholder={controller.t('crm:internalListing.categoryNamePlaceholder')}
        onKeyDown={(event) => event.key === 'Enter' && controller.handleSaveCategory()}
      />
    </div>
    {controller.categoryError && (
      <p className="text-red-500 text-xs font-bold">{controller.categoryError}</p>
    )}
    <div className="flex justify-end gap-2">
      {controller.editingCategory && (
        <Button type="button" variant="outline" onClick={controller.handleCancelCategoryEdit}>
          {controller.t('common:buttons.cancel')}
        </Button>
      )}
      <Button
        type="button"
        onClick={controller.handleSaveCategory}
        disabled={controller.isSavingCategory || !controller.newCategoryName.trim()}
      >
        {controller.isSavingCategory
          ? controller.t('common:buttons.saving')
          : controller.editingCategory
            ? controller.t('common:buttons.update')
            : controller.t('common:buttons.add')}
      </Button>
    </div>
  </div>
);

const InternalListingCategoriesTable: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <StandardTable<InternalProductCategory>
    title={controller.t('crm:internalListing.manageCategories')}
    data={controller.categories}
    defaultRowsPerPage={5}
    containerClassName="shadow-none border-zinc-200 rounded-2xl"
    tableContainerClassName="max-h-[35vh] overflow-y-auto"
    emptyState={
      <div className="text-center py-6 text-zinc-500">
        <p>{controller.t('crm:internalListing.noCategories')}</p>
      </div>
    }
    columns={[
      {
        header: controller.t('crm:internalListing.name'),
        accessorFn: (row) => row.name,
        cell: ({ row }) => <span className="font-bold text-zinc-700">{row.name}</span>,
        disableFiltering: true,
      },
      {
        header: controller.t('crm:internalListing.linkedItems'),
        accessorFn: (row) => `${row.productCount} ${controller.t('crm:internalListing.products')}`,
        cell: ({ row }) => (
          <span className="text-xs text-zinc-400">
            {row.productCount} {controller.t('crm:internalListing.products')}
          </span>
        ),
        disableFiltering: true,
      },
      {
        header: controller.t('common:labels.actions'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row: category }) => renderInternalListingCategoryActions(controller, category),
      },
    ]}
  />
);

const renderInternalListingCategoryActions = (
  controller: InternalListingController,
  category: InternalProductCategory,
) => {
  const deleteBlockedMessage = controller.t(
    'crm:internalListing.deleteCategoryWithLinkedProducts',
    { name: category.name },
  );

  return renderInternalListingEditDeleteActions({
    controller,
    deleteDisabled: category.hasLinkedProducts,
    deleteDisabledTooltip: deleteBlockedMessage,
    onDelete: () => controller.handleDeleteCategory(category),
    onEdit: () => controller.handleEditCategory(category),
  });
};

const InternalListingSubcategoriesModal: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <Modal
    isOpen={controller.isManageSubcategoriesModalOpen}
    onClose={() =>
      controller.dispatch({ type: 'merge', patch: { isManageSubcategoriesModalOpen: false } })
    }
    zIndex={70}
  >
    <ModalContent size="2xl">
      <ModalHeader>
        <InternalListingModalTitle icon="fa-folder-open">
          {controller.t('crm:internalListing.manageSubcategories')}
          <span className="text-sm font-normal text-muted-foreground">
            ({controller.formData.category})
          </span>
        </InternalListingModalTitle>
        <ModalCloseButton
          onClick={() =>
            controller.dispatch({
              type: 'merge',
              patch: { isManageSubcategoriesModalOpen: false },
            })
          }
        />
      </ModalHeader>
      <ModalBody className="max-h-[60vh] space-y-4">
        <InternalListingSubcategoryForm controller={controller} />
        {controller.isLoadingSubcategories ? (
          <InternalListingLoading />
        ) : (
          <InternalListingSubcategoriesTable controller={controller} />
        )}
      </ModalBody>
    </ModalContent>
  </Modal>
);

const InternalListingSubcategoryForm: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
    <div className="space-y-1.5">
      <FieldLabel>{controller.t('crm:internalListing.subcategoryName')}</FieldLabel>
      <Input
        type="text"
        value={controller.newSubcategoryName}
        onChange={(event) =>
          controller.dispatch({ type: 'merge', patch: { newSubcategoryName: event.target.value } })
        }
        placeholder={controller.t('crm:internalListing.subcategoryNamePlaceholder')}
        onKeyDown={(event) => event.key === 'Enter' && controller.handleSaveSubcategory()}
      />
    </div>
    {controller.subcategoryError && (
      <p className="text-red-500 text-xs font-bold">{controller.subcategoryError}</p>
    )}
    <div className="flex justify-end gap-2">
      {controller.editingSubcategory && (
        <Button type="button" variant="outline" onClick={controller.handleCancelSubcategoryEdit}>
          {controller.t('common:buttons.cancel')}
        </Button>
      )}
      <Button
        type="button"
        onClick={controller.handleSaveSubcategory}
        disabled={controller.isSavingSubcategory || !controller.newSubcategoryName.trim()}
      >
        {controller.isSavingSubcategory
          ? controller.t('common:buttons.saving')
          : controller.editingSubcategory
            ? controller.t('common:buttons.update')
            : controller.t('common:buttons.add')}
      </Button>
    </div>
  </div>
);

const InternalListingSubcategoriesTable: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <StandardTable<InternalProductSubcategory>
    title={controller.t('crm:internalListing.manageSubcategories')}
    data={controller.subcategories}
    defaultRowsPerPage={5}
    containerClassName="shadow-none border-zinc-200 rounded-2xl"
    tableContainerClassName="max-h-[35vh] overflow-y-auto"
    emptyState={
      <div className="text-center py-6 text-zinc-500">
        <p>{controller.t('crm:internalListing.noSubcategories')}</p>
      </div>
    }
    columns={[
      {
        header: controller.t('crm:internalListing.name'),
        accessorFn: (row) => row.name,
        cell: ({ row }) => <span className="font-bold text-zinc-700">{row.name}</span>,
        disableFiltering: true,
      },
      {
        header: controller.t('crm:internalListing.linkedItems'),
        accessorFn: (row) => `${row.productCount} ${controller.t('crm:internalListing.products')}`,
        cell: ({ row }) => (
          <span className="text-xs text-zinc-400">
            {row.productCount} {controller.t('crm:internalListing.products')}
          </span>
        ),
        disableFiltering: true,
      },
      {
        header: controller.t('common:labels.actions'),
        id: 'actions',
        disableSorting: true,
        disableFiltering: true,
        cell: ({ row: subcategory }) =>
          renderInternalListingSubcategoryActions(controller, subcategory),
      },
    ]}
  />
);

const renderInternalListingSubcategoryActions = (
  controller: InternalListingController,
  subcategory: InternalProductSubcategory,
) => {
  const deleteBlockedMessage = controller.t(
    'crm:internalListing.deleteSubcategoryWithLinkedProducts',
    { name: subcategory.name },
  );

  return renderInternalListingEditDeleteActions({
    controller,
    deleteDisabled: subcategory.hasLinkedProducts,
    deleteDisabledTooltip: deleteBlockedMessage,
    onDelete: () => controller.handleDeleteSubcategory(subcategory),
    onEdit: () => controller.handleEditSubcategory(subcategory),
  });
};

const InternalListingProductModal: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <Modal
    isOpen={controller.isModalOpen}
    onClose={() => controller.dispatch({ type: 'merge', patch: { isModalOpen: false } })}
  >
    <ModalContent size="2xl" className="max-h-[90vh]">
      <form onSubmit={controller.handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <ModalHeader>
          <ModalTitle className="gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
              <i
                className={`fa-solid ${controller.editingProduct ? 'fa-pen-to-square' : 'fa-plus'}`}
                aria-hidden="true"
              ></i>
            </span>
            {controller.editingProduct
              ? controller.t('crm:internalListing.editProductTitle')
              : controller.t('crm:internalListing.addProductTitle')}
          </ModalTitle>
          <ModalCloseButton
            onClick={() => controller.dispatch({ type: 'merge', patch: { isModalOpen: false } })}
          />
        </ModalHeader>
        <ModalBody className="flex-1 space-y-8">
          {controller.serverError && (
            <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              {controller.serverError}
            </div>
          )}
          <InternalListingProductDetailsSection controller={controller} />
          <InternalListingProductPricingSection controller={controller} />
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => controller.dispatch({ type: 'merge', patch: { isModalOpen: false } })}
          >
            {controller.t('common:buttons.cancel')}
          </Button>
          <Button type="submit">
            {controller.editingProduct
              ? controller.t('crm:internalListing.updateProduct')
              : controller.t('crm:internalListing.saveProduct')}
          </Button>
        </ModalFooter>
      </form>
    </ModalContent>
  </Modal>
);

const InternalListingSectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
    <span className="size-1.5 rounded-full bg-primary"></span>
    {children}
  </h4>
);

const InternalListingProductDetailsSection: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <div className="space-y-4">
    <InternalListingSectionTitle>
      {controller.t('crm:internalListing.productDetails')}
    </InternalListingSectionTitle>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InternalListingTextField
        label={controller.t('crm:internalListing.productName')}
        value={controller.formData.name || ''}
        error={controller.errors.name}
        placeholder={controller.t('crm:internalListing.productNamePlaceholder')}
        required
        onChange={(value) => {
          controller.dispatch({ type: 'patchForm', patch: { name: value } });
          if (controller.errors.name)
            controller.dispatch({ type: 'patchErrors', patch: { name: '' } });
        }}
      />
      <InternalListingTextField
        label={controller.t('crm:internalListing.productCode')}
        value={controller.formData.productCode || ''}
        error={controller.errors.productCode}
        hint={controller.t('crm:internalListing.productCodeHint')}
        placeholder={controller.t('common:form.placeholderCode')}
        required
        onChange={(value) => {
          controller.dispatch({ type: 'patchForm', patch: { productCode: value } });
          if (controller.errors.productCode) {
            controller.dispatch({ type: 'patchErrors', patch: { productCode: '' } });
          }
        }}
      />
      <div className="col-span-full space-y-1.5">
        <FieldLabel>{controller.t('crm:internalListing.description')}</FieldLabel>
        <Textarea
          value={controller.formData.description || ''}
          onChange={(event) =>
            controller.dispatch({ type: 'patchForm', patch: { description: event.target.value } })
          }
          placeholder={controller.t('crm:internalListing.productDescriptionPlaceholder')}
          rows={2}
          className="resize-none"
        />
      </div>
      <InternalListingTypeSelect controller={controller} />
      <InternalListingCategorySelect controller={controller} />
      <InternalListingSubcategorySelect controller={controller} />
    </div>
  </div>
);

const InternalListingTextField: React.FC<{
  error?: string;
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  value: string;
}> = ({ error, hint, label, onChange, placeholder, required = false, value }) => (
  <div className="space-y-1.5">
    <FieldLabel required={required}>{label}</FieldLabel>
    <Input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={error ? 'border-destructive' : undefined}
    />
    {error && <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{error}</p>}
    {hint && <p className="text-[10px] text-zinc-400 ml-1">{hint}</p>}
  </div>
);

const InternalListingFieldHeader: React.FC<{
  children: React.ReactNode;
  manageLabel: string;
  onClick?: () => void;
  manageDisabled?: boolean;
}> = ({ children, manageLabel, manageDisabled = false, onClick }) => (
  <div className="flex min-h-6 items-center justify-between gap-2">
    <FieldLabel>{children}</FieldLabel>
    {onClick && (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onClick}
        disabled={manageDisabled}
        className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        <i className="fa-solid fa-gear" aria-hidden="true"></i>
        {manageLabel}
      </Button>
    )}
  </div>
);

const InternalListingTypeSelect: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => {
  const { handleOpenManageTypes } = controller;

  return (
    <div className="space-y-1.5">
      <InternalListingFieldHeader
        manageLabel={controller.t('common:buttons.manage')}
        onClick={handleOpenManageTypes}
      >
        {controller.t('crm:internalListing.type')} <RequiredMark />
      </InternalListingFieldHeader>
      <SelectControl
        options={controller.typeOptions}
        value={controller.formData.type || (controller.productTypes[0]?.name ?? '')}
        onChange={(value) => controller.handleTypeChange(value as string)}
        searchable={false}
        buttonClassName={
          controller.errors.type ? 'py-2.5 text-sm border-destructive' : 'py-2.5 text-sm'
        }
      />
      {controller.errors.type && (
        <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{controller.errors.type}</p>
      )}
    </div>
  );
};

const InternalListingCategorySelect: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => {
  const { handleOpenManageCategories } = controller;

  return (
    <div className="space-y-1.5">
      <InternalListingFieldHeader
        manageLabel={controller.t('common:buttons.manage')}
        onClick={handleOpenManageCategories}
      >
        {controller.t('crm:internalListing.category')}
      </InternalListingFieldHeader>
      <SelectControl
        options={controller.categoryOptions}
        value={controller.formData.category || ''}
        onChange={(value) => {
          const categoryName = value as string;
          controller.dispatch({
            type: 'merge',
            patch: {
              subcategories: [],
              formData: {
                ...controller.formData,
                category: categoryName,
                subcategory: '',
              },
            },
          });
          if (controller.formData.type && categoryName) {
            void controller.loadSubcategories(controller.formData.type, categoryName);
          }
        }}
        placeholder={controller.t('crm:internalListing.selectOption')}
        searchable={true}
      />
    </div>
  );
};

const InternalListingSubcategorySelect: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => {
  const { handleOpenManageSubcategories } = controller;

  return (
    <div className="space-y-1.5">
      <InternalListingFieldHeader
        manageLabel={controller.t('common:buttons.manage')}
        onClick={handleOpenManageSubcategories}
        manageDisabled={!controller.formData.category}
      >
        {controller.t('crm:internalListing.subcategory')}
      </InternalListingFieldHeader>
      <SelectControl
        options={controller.subcategoryOptions}
        value={controller.formData.subcategory || ''}
        onChange={(value) =>
          controller.dispatch({ type: 'patchForm', patch: { subcategory: value as string } })
        }
        placeholder={
          !controller.formData.category
            ? controller.t('crm:internalListing.selectCategoryFirst')
            : controller.t('crm:internalListing.selectOption')
        }
        searchable={true}
        disabled={!controller.formData.category}
      />
    </div>
  );
};

const InternalListingProductPricingSection: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => {
  const { errors } = controller;

  return (
    <div className="space-y-4">
      <InternalListingSectionTitle>
        {controller.t('crm:internalListing.pricingAndUnit')}
      </InternalListingSectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InternalListingNumberField
          label={
            <>
              {controller.t('crm:internalListing.cost')} <RequiredMark />
              <span className="text-zinc-400 font-semibold">
                /
                {controller.formData.costUnit === 'hours'
                  ? controller.t('crm:internalListing.hour')
                  : controller.t('crm:internalListing.unit')}
              </span>
            </>
          }
          value={controller.formData.costo ?? ''}
          error={errors.costo}
          onValueChange={controller.handleNumericValueChange('costo')}
          formatDecimals={2}
          aria-invalid={Boolean(errors.costo)}
        />
        <InternalListingNumberField
          label={controller.t('crm:internalListing.mol')}
          value={controller.formData.molPercentage ?? ''}
          error={errors.molPercentage}
          onValueChange={controller.handleNumericValueChange('molPercentage')}
          formatDecimals={MOL_PERCENTAGE_DECIMALS}
          required
          aria-invalid={Boolean(errors.molPercentage)}
        />
        <InternalListingCalculatedValue
          label={controller.t('crm:internalListing.salePriceCalculated')}
          value={
            controller.pricing
              ? `${formatDecimal(calcProductSalePrice(controller.pricing.cost, controller.pricing.mol))} ${
                  controller.currency
                }`
              : '--'
          }
          className="text-muted-foreground"
        />
        <InternalListingCalculatedValue
          label={controller.t('crm:internalListing.marginCalculated')}
          value={
            controller.pricing
              ? `${formatDecimal(calcMargine(controller.pricing.cost, controller.pricing.mol))} ${
                  controller.currency
                }`
              : '--'
          }
          className="text-emerald-600"
        />
      </div>
    </div>
  );
};

const InternalListingNumberField: React.FC<{
  'aria-invalid'?: boolean;
  error?: string;
  formatDecimals: number;
  label: React.ReactNode;
  onValueChange: (value: string) => void;
  required?: boolean;
  value: string | number;
}> = ({
  'aria-invalid': ariaInvalid,
  error,
  formatDecimals,
  label,
  onValueChange,
  required = false,
  value,
}) => (
  <div className="space-y-1.5">
    <FieldLabel required={required}>{label}</FieldLabel>
    <ValidatedNumberInput
      value={value}
      formatDecimals={formatDecimals}
      onValueChange={onValueChange}
      className="flex-1 min-w-0"
      aria-invalid={ariaInvalid ?? Boolean(error)}
    />
    {error && <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{error}</p>}
  </div>
);

const InternalListingCalculatedValue: React.FC<{
  className?: string;
  label: string;
  value: string;
}> = ({ className, label, value }) => (
  <div className="space-y-1.5">
    <FieldLabel>{label}</FieldLabel>
    <div
      className={`w-full rounded-md border border-border bg-muted px-4 py-2.5 text-sm font-semibold ${className ?? ''}`}
    >
      {value}
    </div>
  </div>
);

const InternalListingDeleteDialog: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <DeleteConfirmModal
    isOpen={controller.isDeleteConfirmOpen}
    onClose={() => controller.dispatch({ type: 'merge', patch: { isDeleteConfirmOpen: false } })}
    onConfirm={controller.handleDelete}
    title={controller.t('crm:internalListing.deleteProductTitle')}
    description={controller.t('crm:internalListing.deleteConfirm', {
      productName: controller.productToDelete?.name,
    })}
  />
);

const InternalListingHeader: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <div className="space-y-4">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-800">
          {controller.t('crm:internalListing.title')}
        </h2>
        <p className="text-zinc-500 text-sm">{controller.t('crm:internalListing.subtitle')}</p>
      </div>
      <HeaderAddButton onClick={controller.openAddModal}>
        {controller.t('crm:internalListing.addProduct')}
      </HeaderAddButton>
    </div>
  </div>
);

const InternalListingProductsTable: React.FC<{ controller: InternalListingController }> = ({
  controller,
}) => (
  <StandardTable<Product>
    title={controller.t('crm:internalListing.title')}
    defaultRowsPerPage={5}
    data={controller.products}
    rowClassName={(product) =>
      product.isDisabled
        ? 'bg-zinc-50/50 grayscale opacity-75 hover:bg-zinc-100'
        : 'hover:bg-zinc-50/50'
    }
    onRowClick={controller.openEditModal}
    initialFilterState={controller.tableInitialFilterState}
    suppressSavedView={Boolean(controller.productFilterId)}
    columns={getInternalListingProductColumns(controller)}
  />
);

const getInternalListingProductColumns = (controller: InternalListingController) => [
  {
    header: controller.t('crm:internalListing.productCode'),
    accessorKey: 'productCode' as const,
    cell: ({ row: product }: { row: Product }) => (
      <span className="font-bold text-zinc-700">{product.productCode || '-'}</span>
    ),
  },
  {
    header: controller.t('crm:internalListing.insertDate'),
    id: 'createdAt',
    accessorFn: (row: Product) => row.createdAt ?? 0,
    cell: ({ value }: { value: unknown }) => (
      <span className="text-xs text-slate-500 whitespace-nowrap">
        {formatInsertDate(value as number | null, controller.i18n.language)}
      </span>
    ),
    filterFormat: (value: unknown) =>
      formatInsertDate(value as number | null, controller.i18n.language),
  },
  {
    header: controller.t('common:labels.name'),
    accessorKey: 'name' as const,
    className: 'px-6 py-5 font-bold text-zinc-800 min-w-[200px]',
    cell: ({ row: product }: { row: Product }) => (
      <div className="font-bold text-zinc-800">{product.name}</div>
    ),
  },
  {
    header: controller.t('crm:internalListing.category'),
    accessorKey: 'category' as const,
    cell: ({ row: product }: { row: Product }) => (
      <span className="text-[11px] font-bold text-zinc-600 uppercase tracking-tight whitespace-nowrap">
        {product.category || '-'}
      </span>
    ),
  },
  {
    header: controller.t('crm:internalListing.subcategory'),
    accessorKey: 'subcategory' as const,
    cell: ({ row: product }: { row: Product }) => (
      <span className="text-[11px] font-medium text-zinc-500 whitespace-nowrap">
        {product.subcategory || '-'}
      </span>
    ),
  },
  {
    header: controller.t('crm:internalListing.type'),
    accessorKey: 'type' as const,
    cell: ({ row: product }: { row: Product }) => (
      <Badge variant="secondary" className="text-[10px] font-black uppercase tracking-wider">
        {getDisplayTypeName(product.type)}
      </Badge>
    ),
    accessorFn: (row: Product) => getDisplayTypeName(row.type),
  },
  {
    header: controller.t('crm:internalListing.cost'),
    align: 'right' as const,
    className: 'px-6 py-5 whitespace-nowrap text-right',
    accessorFn: (row: Product) => Number(row.costo),
    filterFormat: (value: unknown) => formatDecimal(Number(value)),
    cell: ({ row: product }: { row: Product }) => (
      <InternalListingCurrencyCell
        controller={controller}
        product={product}
        value={product.costo}
      />
    ),
  },
  {
    header: controller.t('crm:internalListing.mol'),
    align: 'right' as const,
    className: 'px-6 py-5 whitespace-nowrap text-right',
    accessorKey: 'molPercentage' as const,
    filterFormat: (value: unknown) => formatDecimal(Number(value), MOL_PERCENTAGE_DECIMALS),
    cell: ({ row: product }: { row: Product }) => (
      <span className="text-sm font-semibold text-zinc-500">
        {formatMolPercentage(Number(product.molPercentage))}
      </span>
    ),
  },
  {
    header: controller.t('crm:internalListing.salePrice'),
    align: 'right' as const,
    className: 'px-6 py-5 whitespace-nowrap text-right',
    id: 'salePrice',
    accessorFn: (row: Product) =>
      calcProductSalePrice(Number(row.costo), Number(row.molPercentage)),
    filterFormat: (value: unknown) => formatDecimal(Number(value)),
    cell: ({ row: product, value }: { row: Product; value: unknown }) => (
      <InternalListingCurrencyCell controller={controller} product={product} value={value} />
    ),
  },
  {
    header: controller.t('crm:internalListing.margin'),
    align: 'right' as const,
    className: 'px-6 py-5 whitespace-nowrap text-right',
    id: 'margin',
    accessorFn: (row: Product) => calcMargine(Number(row.costo), Number(row.molPercentage)),
    filterFormat: (value: unknown) => formatDecimal(Number(value)),
    cell: ({ value }: { value: unknown }) => (
      <span className="text-sm font-semibold text-emerald-600">
        {formatDecimal(Number(value))} {controller.currency}
      </span>
    ),
  },
  {
    header: controller.t('common:labels.status'),
    accessorKey: 'isDisabled' as const,
    id: 'status',
    cell: ({ row: product }: { row: Product }) => (
      <StatusBadge
        type={product.isDisabled ? 'disabled' : 'active'}
        label={
          product.isDisabled
            ? controller.t('crm:internalListing.disabled')
            : controller.t('crm:internalListing.active')
        }
      />
    ),
    accessorFn: (row: Product) =>
      row.isDisabled
        ? controller.t('crm:internalListing.disabled')
        : controller.t('crm:internalListing.active'),
  },
  {
    header: controller.t('common:labels.actions'),
    id: 'actions',
    align: 'right' as const,
    disableSorting: true,
    disableFiltering: true,
    cell: ({ row: product }: { row: Product }) =>
      renderInternalListingProductActions(controller, product),
    className: 'px-8 py-5',
  },
];

const InternalListingCurrencyCell: React.FC<{
  controller: InternalListingController;
  product: Product;
  value: unknown;
}> = ({ controller, product, value }) => {
  const typeData = controller.productTypes.find((type) => type.name === product.type);
  const costUnit = typeData?.costUnit || product.costUnit || 'unit';

  return (
    <span className="text-sm font-semibold text-zinc-700">
      {formatDecimal(Number(value))} {controller.currency} /{' '}
      {costUnit === 'hours'
        ? controller.t('crm:internalListing.hour')
        : controller.t('crm:internalListing.unit')}
    </span>
  );
};

const renderInternalListingProductActions = (
  controller: InternalListingController,
  product: Product,
) => (
  <div className="flex justify-end gap-2">
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={(event) => {
              event.stopPropagation();
              controller.onUpdateProduct(product.id, { isDisabled: !product.isDisabled });
            }}
            aria-label={
              product.isDisabled
                ? controller.t('crm:internalListing.enableProduct')
                : controller.t('crm:internalListing.disableProduct')
            }
            className={`p-2 rounded-lg transition-all ${
              product.isDisabled
                ? 'text-praetor hover:bg-emerald-50'
                : 'text-amber-700 hover:text-amber-600 hover:bg-amber-50'
            }`}
          >
            <i
              className={`fa-solid ${product.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}
              aria-hidden="true"
            ></i>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {product.isDisabled
          ? controller.t('crm:internalListing.enableProduct')
          : controller.t('crm:internalListing.disableProduct')}
      </TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={(event) => {
              event.stopPropagation();
              controller.confirmDelete(product);
            }}
            aria-label={controller.t('common:buttons.delete')}
            className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
          >
            <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{controller.t('crm:internalListing.deleteProductTooltip')}</TooltipContent>
    </Tooltip>
  </div>
);

export default InternalListingView;
