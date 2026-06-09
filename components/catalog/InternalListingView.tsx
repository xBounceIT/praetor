import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FieldLabel, RequiredMark } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
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

const InternalListingView: React.FC<InternalListingViewProps> = ({
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
}) => {
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
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

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
    [],
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
            productCount: type.productCount,
            categoryCount: type.categoryCount,
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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Manage Types Modal */}
      <Modal
        isOpen={isManageTypesModalOpen}
        onClose={() => dispatch({ type: 'merge', patch: { isManageTypesModalOpen: false } })}
        zIndex={70}
      >
        <ModalContent size="2xl">
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                <i className="fa-solid fa-tags" aria-hidden="true"></i>
              </span>
              {t('crm:internalListing.manageTypes')}
            </ModalTitle>
            <ModalCloseButton
              onClick={() => dispatch({ type: 'merge', patch: { isManageTypesModalOpen: false } })}
            />
          </ModalHeader>

          <ModalBody className="max-h-[60vh] space-y-4">
            {/* Add/Edit Type Form */}
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="space-y-1.5">
                <FieldLabel>{t('crm:internalListing.typeName')}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newTypeName}
                    onChange={(e) =>
                      dispatch({ type: 'merge', patch: { newTypeName: e.target.value } })
                    }
                    placeholder={t('crm:internalListing.typeNamePlaceholder')}
                    className="flex-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveType()}
                  />
                  <SelectControl
                    options={[
                      { id: 'unit', name: t('crm:internalListing.unit') },
                      { id: 'hours', name: t('crm:internalListing.hour') },
                    ]}
                    value={newTypeCostUnit}
                    onChange={(val) =>
                      dispatch({
                        type: 'merge',
                        patch: { newTypeCostUnit: val as 'unit' | 'hours' },
                      })
                    }
                    searchable={false}
                    buttonClassName="py-2 text-sm w-28"
                  />
                </div>
              </div>

              {typeError && <p className="text-red-500 text-xs font-bold">{typeError}</p>}

              <div className="flex justify-end gap-2">
                {editingType && (
                  <Button type="button" variant="outline" onClick={handleCancelTypeEdit}>
                    {t('common:buttons.cancel')}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleSaveType}
                  disabled={isSavingType || !newTypeName.trim()}
                  className="w-28"
                >
                  {isSavingType
                    ? t('common:buttons.saving')
                    : editingType
                      ? t('common:buttons.update')
                      : t('common:buttons.add')}
                </Button>
              </div>
            </div>

            {/* Types List */}
            {isLoadingTypes ? (
              <div className="flex items-center justify-center py-8">
                <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
              </div>
            ) : (
              <StandardTable<InternalProductType>
                title={t('crm:internalListing.manageTypes')}
                data={productTypes}
                defaultRowsPerPage={5}
                containerClassName="shadow-none border-zinc-200 rounded-2xl"
                tableContainerClassName="max-h-[35vh] overflow-y-auto"
                emptyState={
                  <div className="text-center py-6 text-zinc-500">
                    <p>{t('crm:internalListing.noTypes')}</p>
                  </div>
                }
                columns={[
                  {
                    header: t('crm:internalListing.name'),
                    accessorFn: (row) => row.name.charAt(0).toUpperCase() + row.name.slice(1),
                    cell: ({ row }) => (
                      <span className="font-bold text-zinc-700">
                        {row.name.charAt(0).toUpperCase() + row.name.slice(1)}
                      </span>
                    ),
                    disableFiltering: true,
                  },
                  {
                    header: t('crm:internalListing.measurement'),
                    accessorFn: (row) =>
                      row.costUnit === 'hours'
                        ? t('crm:internalListing.hour')
                        : t('crm:internalListing.unit'),
                    disableFiltering: true,
                  },
                  {
                    header: t('crm:internalListing.linkedItems'),
                    accessorFn: (row) => {
                      const parts = [`${row.productCount} ${t('crm:internalListing.products')}`];
                      if (row.categoryCount > 0) {
                        parts.push(`${row.categoryCount} ${t('crm:internalListing.categories')}`);
                      }
                      return parts.join(', ');
                    },
                    cell: ({ row }) => (
                      <span className="text-xs text-zinc-400">
                        {row.productCount} {t('crm:internalListing.products')}
                        {row.categoryCount > 0 && (
                          <>
                            , {row.categoryCount} {t('crm:internalListing.categories')}
                          </>
                        )}
                      </span>
                    ),
                    disableFiltering: true,
                  },
                  {
                    header: t('common:labels.actions'),
                    id: 'actions',
                    disableSorting: true,
                    disableFiltering: true,
                    cell: ({ row: type }) => {
                      const isDeleteBlocked = type.productCount > 0 || type.categoryCount > 0;
                      const deleteBlockedMessage = t('crm:internalListing.typeDeleteBlocked', {
                        productCount: type.productCount,
                        categoryCount: type.categoryCount,
                        name: type.name,
                      });

                      return (
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  type="button"
                                  onClick={() => handleEditType(type)}
                                  aria-label={t('common:buttons.edit')}
                                  className="p-1.5 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-colors"
                                >
                                  <i className="fa-solid fa-pen"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
                          </Tooltip>
                          <Tooltip disabled={!isDeleteBlocked}>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteType(type)}
                                  disabled={isDeleteBlocked}
                                  aria-label={t('common:buttons.delete')}
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    isDeleteBlocked
                                      ? 'text-zinc-300 cursor-not-allowed'
                                      : 'text-red-600 hover:text-red-600 hover:bg-red-50'
                                  }`}
                                >
                                  <i className="fa-solid fa-trash"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isDeleteBlocked ? deleteBlockedMessage : ''}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    },
                  },
                ]}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Manage Categories Modal */}
      <Modal
        isOpen={isManageCategoriesModalOpen}
        onClose={() => dispatch({ type: 'merge', patch: { isManageCategoriesModalOpen: false } })}
        zIndex={70}
      >
        <ModalContent size="2xl">
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                <i className="fa-solid fa-folder-tree" aria-hidden="true"></i>
              </span>
              {t('crm:internalListing.manageCategories')}
            </ModalTitle>
            <ModalCloseButton
              onClick={() =>
                dispatch({ type: 'merge', patch: { isManageCategoriesModalOpen: false } })
              }
            />
          </ModalHeader>

          <ModalBody className="max-h-[60vh] space-y-4">
            {/* Add/Edit Category Form */}
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="space-y-1.5">
                <FieldLabel>{t('crm:internalListing.categoryName')}</FieldLabel>
                <Input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) =>
                    dispatch({ type: 'merge', patch: { newCategoryName: e.target.value } })
                  }
                  placeholder={t('crm:internalListing.categoryNamePlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCategory()}
                />
              </div>

              {categoryError && <p className="text-red-500 text-xs font-bold">{categoryError}</p>}

              <div className="flex justify-end gap-2">
                {editingCategory && (
                  <Button type="button" variant="outline" onClick={handleCancelCategoryEdit}>
                    {t('common:buttons.cancel')}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleSaveCategory}
                  disabled={isSavingCategory || !newCategoryName.trim()}
                >
                  {isSavingCategory
                    ? t('common:buttons.saving')
                    : editingCategory
                      ? t('common:buttons.update')
                      : t('common:buttons.add')}
                </Button>
              </div>
            </div>

            {/* Categories List */}
            {isLoadingCategories ? (
              <div className="flex items-center justify-center py-8">
                <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
              </div>
            ) : (
              <StandardTable<InternalProductCategory>
                title={t('crm:internalListing.manageCategories')}
                data={categories}
                defaultRowsPerPage={5}
                containerClassName="shadow-none border-zinc-200 rounded-2xl"
                tableContainerClassName="max-h-[35vh] overflow-y-auto"
                emptyState={
                  <div className="text-center py-6 text-zinc-500">
                    <p>{t('crm:internalListing.noCategories')}</p>
                  </div>
                }
                columns={[
                  {
                    header: t('crm:internalListing.name'),
                    accessorFn: (row) => row.name,
                    cell: ({ row }) => <span className="font-bold text-zinc-700">{row.name}</span>,
                    disableFiltering: true,
                  },
                  {
                    header: t('crm:internalListing.linkedItems'),
                    accessorFn: (row) => `${row.productCount} ${t('crm:internalListing.products')}`,
                    cell: ({ row }) => (
                      <span className="text-xs text-zinc-400">
                        {row.productCount} {t('crm:internalListing.products')}
                      </span>
                    ),
                    disableFiltering: true,
                  },
                  {
                    header: t('common:labels.actions'),
                    id: 'actions',
                    disableSorting: true,
                    disableFiltering: true,
                    cell: ({ row: category }) => {
                      const isDeleteBlocked = category.hasLinkedProducts;
                      const deleteBlockedMessage = t(
                        'crm:internalListing.deleteCategoryWithLinkedProducts',
                        { count: category.productCount, name: category.name },
                      );

                      return (
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  type="button"
                                  onClick={() => handleEditCategory(category)}
                                  aria-label={t('common:buttons.edit')}
                                  className="p-1.5 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-colors"
                                >
                                  <i className="fa-solid fa-pen"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
                          </Tooltip>
                          <Tooltip disabled={!isDeleteBlocked}>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCategory(category)}
                                  disabled={isDeleteBlocked}
                                  aria-label={t('common:buttons.delete')}
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    isDeleteBlocked
                                      ? 'text-zinc-300 cursor-not-allowed'
                                      : 'text-red-600 hover:text-red-600 hover:bg-red-50'
                                  }`}
                                >
                                  <i className="fa-solid fa-trash"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isDeleteBlocked ? deleteBlockedMessage : ''}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    },
                  },
                ]}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Manage Subcategories Modal */}
      <Modal
        isOpen={isManageSubcategoriesModalOpen}
        onClose={() =>
          dispatch({ type: 'merge', patch: { isManageSubcategoriesModalOpen: false } })
        }
        zIndex={70}
      >
        <ModalContent size="2xl">
          <ModalHeader>
            <ModalTitle className="gap-3">
              <span className="flex size-8 items-center justify-center rounded-md bg-muted text-primary">
                <i className="fa-solid fa-folder-open" aria-hidden="true"></i>
              </span>
              {t('crm:internalListing.manageSubcategories')}
              <span className="text-sm font-normal text-muted-foreground">
                ({formData.category})
              </span>
            </ModalTitle>
            <ModalCloseButton
              onClick={() =>
                dispatch({ type: 'merge', patch: { isManageSubcategoriesModalOpen: false } })
              }
            />
          </ModalHeader>

          <ModalBody className="max-h-[60vh] space-y-4">
            {/* Add/Edit Subcategory Form */}
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="space-y-1.5">
                <FieldLabel>{t('crm:internalListing.subcategoryName')}</FieldLabel>
                <Input
                  type="text"
                  value={newSubcategoryName}
                  onChange={(e) =>
                    dispatch({ type: 'merge', patch: { newSubcategoryName: e.target.value } })
                  }
                  placeholder={t('crm:internalListing.subcategoryNamePlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveSubcategory()}
                />
              </div>

              {subcategoryError && (
                <p className="text-red-500 text-xs font-bold">{subcategoryError}</p>
              )}

              <div className="flex justify-end gap-2">
                {editingSubcategory && (
                  <Button type="button" variant="outline" onClick={handleCancelSubcategoryEdit}>
                    {t('common:buttons.cancel')}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleSaveSubcategory}
                  disabled={isSavingSubcategory || !newSubcategoryName.trim()}
                >
                  {isSavingSubcategory
                    ? t('common:buttons.saving')
                    : editingSubcategory
                      ? t('common:buttons.update')
                      : t('common:buttons.add')}
                </Button>
              </div>
            </div>

            {/* Subcategories List */}
            {isLoadingSubcategories ? (
              <div className="flex items-center justify-center py-8">
                <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
              </div>
            ) : (
              <StandardTable<InternalProductSubcategory>
                title={t('crm:internalListing.manageSubcategories')}
                data={subcategories}
                defaultRowsPerPage={5}
                containerClassName="shadow-none border-zinc-200 rounded-2xl"
                tableContainerClassName="max-h-[35vh] overflow-y-auto"
                emptyState={
                  <div className="text-center py-6 text-zinc-500">
                    <p>{t('crm:internalListing.noSubcategories')}</p>
                  </div>
                }
                columns={[
                  {
                    header: t('crm:internalListing.name'),
                    accessorFn: (row) => row.name,
                    cell: ({ row }) => <span className="font-bold text-zinc-700">{row.name}</span>,
                    disableFiltering: true,
                  },
                  {
                    header: t('crm:internalListing.linkedItems'),
                    accessorFn: (row) => `${row.productCount} ${t('crm:internalListing.products')}`,
                    cell: ({ row }) => (
                      <span className="text-xs text-zinc-400">
                        {row.productCount} {t('crm:internalListing.products')}
                      </span>
                    ),
                    disableFiltering: true,
                  },
                  {
                    header: t('common:labels.actions'),
                    id: 'actions',
                    disableSorting: true,
                    disableFiltering: true,
                    cell: ({ row: subcategory }) => {
                      const isDeleteBlocked = subcategory.hasLinkedProducts;
                      const deleteBlockedMessage = t(
                        'crm:internalListing.deleteSubcategoryWithLinkedProducts',
                        { count: subcategory.productCount, name: subcategory.name },
                      );

                      return (
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  type="button"
                                  onClick={() => handleEditSubcategory(subcategory)}
                                  aria-label={t('common:buttons.edit')}
                                  className="p-1.5 text-zinc-400 hover:text-praetor hover:bg-zinc-100 rounded-lg transition-colors"
                                >
                                  <i className="fa-solid fa-pen"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{t('common:buttons.edit')}</TooltipContent>
                          </Tooltip>
                          <Tooltip disabled={!isDeleteBlocked}>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSubcategory(subcategory)}
                                  disabled={isDeleteBlocked}
                                  aria-label={t('common:buttons.delete')}
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    isDeleteBlocked
                                      ? 'text-zinc-300 cursor-not-allowed'
                                      : 'text-red-600 hover:text-red-600 hover:bg-red-50'
                                  }`}
                                >
                                  <i className="fa-solid fa-trash"></i>
                                </button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isDeleteBlocked ? deleteBlockedMessage : ''}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    },
                  },
                ]}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Add/Edit Product Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => dispatch({ type: 'merge', patch: { isModalOpen: false } })}
      >
        <ModalContent size="2xl" className="max-h-[90vh]">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <ModalHeader>
              <ModalTitle className="gap-3">
                <span className="flex size-10 items-center justify-center rounded-md bg-muted text-primary">
                  <i
                    className={`fa-solid ${editingProduct ? 'fa-pen-to-square' : 'fa-plus'}`}
                    aria-hidden="true"
                  ></i>
                </span>
                {editingProduct
                  ? t('crm:internalListing.editProductTitle')
                  : t('crm:internalListing.addProductTitle')}
              </ModalTitle>
              <ModalCloseButton
                onClick={() => dispatch({ type: 'merge', patch: { isModalOpen: false } })}
              />
            </ModalHeader>

            <ModalBody className="flex-1 space-y-8">
              {serverError && (
                <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                  {serverError}
                </div>
              )}

              <div className="space-y-4">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                  <span className="size-1.5 rounded-full bg-primary"></span>
                  {t('crm:internalListing.productDetails')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <FieldLabel required>{t('crm:internalListing.productName')}</FieldLabel>
                    <Input
                      type="text"
                      value={formData.name}
                      onChange={(e) => {
                        dispatch({ type: 'patchForm', patch: { name: e.target.value } });
                        if (errors.name) dispatch({ type: 'patchErrors', patch: { name: '' } });
                      }}
                      placeholder={t('crm:internalListing.productNamePlaceholder')}
                      className={errors.name ? 'border-destructive' : undefined}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.name}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel required>{t('crm:internalListing.productCode')}</FieldLabel>
                    <Input
                      type="text"
                      value={formData.productCode}
                      onChange={(e) => {
                        dispatch({ type: 'patchForm', patch: { productCode: e.target.value } });
                        if (errors.productCode)
                          dispatch({ type: 'patchErrors', patch: { productCode: '' } });
                      }}
                      placeholder={t('common:form.placeholderCode')}
                      className={errors.productCode ? 'border-destructive' : undefined}
                    />
                    {errors.productCode && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">
                        {errors.productCode}
                      </p>
                    )}
                    <p className="text-[10px] text-zinc-400 ml-1">
                      {t('crm:internalListing.productCodeHint')}
                    </p>
                  </div>

                  <div className="col-span-full space-y-1.5">
                    <FieldLabel>{t('crm:internalListing.description')}</FieldLabel>
                    <Textarea
                      value={formData.description || ''}
                      onChange={(e) =>
                        dispatch({ type: 'patchForm', patch: { description: e.target.value } })
                      }
                      placeholder={t('crm:internalListing.productDescriptionPlaceholder')}
                      rows={2}
                      className="resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex min-h-6 items-center justify-between gap-2">
                      <FieldLabel required>{t('crm:internalListing.type')}</FieldLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={handleOpenManageTypes}
                        className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        <i className="fa-solid fa-gear" aria-hidden="true"></i>
                        {t('common:buttons.manage')}
                      </Button>
                    </div>
                    <SelectControl
                      options={typeOptions}
                      value={formData.type || (productTypes[0]?.name ?? '')}
                      onChange={(val) => handleTypeChange(val as string)}
                      searchable={false}
                      buttonClassName={
                        errors.type ? 'py-2.5 text-sm border-destructive' : 'py-2.5 text-sm'
                      }
                    />
                    {errors.type && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.type}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex min-h-6 items-center justify-between gap-2">
                      <FieldLabel>{t('crm:internalListing.category')}</FieldLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={handleOpenManageCategories}
                        className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        <i className="fa-solid fa-gear" aria-hidden="true"></i>
                        {t('common:buttons.manage')}
                      </Button>
                    </div>
                    <SelectControl
                      options={categoryOptions}
                      value={formData.category || ''}
                      onChange={(val) => {
                        const categoryName = val as string;
                        dispatch({
                          type: 'merge',
                          patch: {
                            subcategories: [],
                            formData: {
                              ...formData,
                              category: categoryName,
                              subcategory: '',
                            },
                          },
                        });
                        if (formData.type && categoryName) {
                          void loadSubcategories(formData.type, categoryName);
                        }
                      }}
                      placeholder={t('crm:internalListing.selectOption')}
                      searchable={true}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex min-h-6 items-center justify-between gap-2">
                      <FieldLabel>{t('crm:internalListing.subcategory')}</FieldLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={handleOpenManageSubcategories}
                        disabled={!formData.category}
                        className="gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        <i className="fa-solid fa-gear" aria-hidden="true"></i>
                        {t('common:buttons.manage')}
                      </Button>
                    </div>
                    <SelectControl
                      options={subcategoryOptions}
                      value={formData.subcategory || ''}
                      onChange={(val) =>
                        dispatch({ type: 'patchForm', patch: { subcategory: val as string } })
                      }
                      placeholder={
                        !formData.category
                          ? t('crm:internalListing.selectCategoryFirst')
                          : t('crm:internalListing.selectOption')
                      }
                      searchable={true}
                      disabled={!formData.category}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                  <span className="size-1.5 rounded-full bg-primary"></span>
                  {t('crm:internalListing.pricingAndUnit')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <FieldLabel>
                      {t('crm:internalListing.cost')} <RequiredMark />
                      <span className="text-zinc-400 font-semibold">
                        /
                        {formData.costUnit === 'hours'
                          ? t('crm:internalListing.hour')
                          : t('crm:internalListing.unit')}
                      </span>
                    </FieldLabel>
                    <div className="flex gap-2">
                      <ValidatedNumberInput
                        value={formData.costo ?? ''}
                        formatDecimals={2}
                        onValueChange={handleNumericValueChange('costo')}
                        className="flex-1 min-w-0"
                        aria-invalid={Boolean(errors.costo)}
                      />
                    </div>
                    {errors.costo && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.costo}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel required>{t('crm:internalListing.mol')}</FieldLabel>
                    <div className="flex gap-2">
                      <ValidatedNumberInput
                        value={formData.molPercentage ?? ''}
                        formatDecimals={MOL_PERCENTAGE_DECIMALS}
                        onValueChange={handleNumericValueChange('molPercentage')}
                        className="flex-1 min-w-0"
                        aria-invalid={Boolean(errors.molPercentage)}
                      />
                    </div>
                    {errors.molPercentage && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">
                        {errors.molPercentage}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel>{t('crm:internalListing.salePriceCalculated')}</FieldLabel>
                    <div className="w-full rounded-md border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground">
                      {pricing
                        ? `${calcProductSalePrice(pricing.cost, pricing.mol).toFixed(2)} ${currency}`
                        : '--'}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel>{t('crm:internalListing.marginCalculated')}</FieldLabel>
                    <div className="w-full rounded-md border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-emerald-600">
                      {pricing
                        ? `${calcMargine(pricing.cost, pricing.mol).toFixed(2)} ${currency}`
                        : '--'}
                    </div>
                  </div>
                </div>
              </div>
            </ModalBody>

            <ModalFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => dispatch({ type: 'merge', patch: { isModalOpen: false } })}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button type="submit">
                {editingProduct
                  ? t('crm:internalListing.updateProduct')
                  : t('crm:internalListing.saveProduct')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => dispatch({ type: 'merge', patch: { isDeleteConfirmOpen: false } })}
        onConfirm={handleDelete}
        title={t('crm:internalListing.deleteProductTitle')}
        description={t('crm:internalListing.deleteConfirm', {
          productName: productToDelete?.name,
        })}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-800">
              {t('crm:internalListing.title')}
            </h2>
            <p className="text-zinc-500 text-sm">{t('crm:internalListing.subtitle')}</p>
          </div>
          <HeaderAddButton onClick={openAddModal}>
            {t('crm:internalListing.addProduct')}
          </HeaderAddButton>
        </div>
      </div>

      <StandardTable<Product>
        title={t('crm:internalListing.title')}
        defaultRowsPerPage={5}
        data={products}
        rowClassName={(p) =>
          p.isDisabled
            ? 'bg-zinc-50/50 grayscale opacity-75 hover:bg-zinc-100'
            : 'hover:bg-zinc-50/50'
        }
        onRowClick={openEditModal}
        initialFilterState={tableInitialFilterState}
        // The deep-linked product id resolves to a column value only once the
        // product list loads; force deep-link mode up front so a saved view that
        // hides the Code/name column can't apply before the filter materializes.
        suppressSavedView={Boolean(productFilterId)}
        columns={[
          {
            header: t('crm:internalListing.productCode'),
            accessorKey: 'productCode',
            cell: ({ row: p }) => (
              <span className="font-bold text-zinc-700">{p.productCode || '-'}</span>
            ),
          },
          {
            header: t('crm:internalListing.insertDate'),
            id: 'createdAt',
            accessorFn: (row) => row.createdAt ?? 0,
            cell: ({ value }) => (
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {formatInsertDate(value as number | null, i18n.language)}
              </span>
            ),
            filterFormat: (value) => formatInsertDate(value as number | null, i18n.language),
          },
          {
            header: t('common:labels.name'),
            accessorKey: 'name',
            className: 'px-6 py-5 font-bold text-zinc-800 min-w-[200px]',
            cell: ({ row: p }) => <div className="font-bold text-zinc-800">{p.name}</div>,
          },
          {
            header: t('crm:internalListing.category'),
            accessorKey: 'category',
            cell: ({ row: p }) => (
              <span className="text-[11px] font-bold text-zinc-600 uppercase tracking-tight whitespace-nowrap">
                {p.category || '-'}
              </span>
            ),
          },
          {
            header: t('crm:internalListing.subcategory'),
            accessorKey: 'subcategory',
            cell: ({ row: p }) => (
              <span className="text-[11px] font-medium text-zinc-500 whitespace-nowrap">
                {p.subcategory || '-'}
              </span>
            ),
          },

          {
            header: t('crm:internalListing.type'),
            accessorKey: 'type',
            cell: ({ row: p }) => {
              const _typeData = productTypes.find((t) => t.name === p.type);
              return <StatusBadge type={p.type as StatusType} label={getDisplayTypeName(p.type)} />;
            },
            accessorFn: (row) => getDisplayTypeName(row.type),
          },
          {
            header: t('crm:internalListing.cost'),
            align: 'right',
            className: 'px-6 py-5 whitespace-nowrap text-right',
            accessorFn: (row) => Number(row.costo),
            filterFormat: (val) => Number(val).toFixed(2),
            cell: ({ row: p }) => {
              const typeData = productTypes.find((t) => t.name === p.type);
              const costUnit = typeData?.costUnit || p.costUnit || 'unit';
              return (
                <span className="text-sm font-semibold text-zinc-500">
                  {Number(p.costo).toFixed(2)} {currency} /{' '}
                  {costUnit === 'hours'
                    ? t('crm:internalListing.hour')
                    : t('crm:internalListing.unit')}
                </span>
              );
            },
          },
          {
            header: t('crm:internalListing.mol'),
            align: 'right',
            className: 'px-6 py-5 whitespace-nowrap text-right',
            accessorKey: 'molPercentage',
            filterFormat: (val) => Number(val).toFixed(MOL_PERCENTAGE_DECIMALS),
            cell: ({ row: p }) => (
              <span className="text-sm font-semibold text-zinc-500">
                {formatMolPercentage(Number(p.molPercentage))}
              </span>
            ),
          },
          {
            header: t('crm:internalListing.salePrice'),
            align: 'right',
            className: 'px-6 py-5 whitespace-nowrap text-right',
            id: 'salePrice',
            accessorFn: (row) => calcProductSalePrice(Number(row.costo), Number(row.molPercentage)),
            filterFormat: (val) => Number(val).toFixed(2),
            cell: ({ row: p, value }) => {
              const typeData = productTypes.find((t) => t.name === p.type);
              const costUnit = typeData?.costUnit || p.costUnit || 'unit';
              return (
                <span className="text-sm font-semibold text-zinc-700">
                  {Number(value).toFixed(2)} {currency} /{' '}
                  {costUnit === 'hours'
                    ? t('crm:internalListing.hour')
                    : t('crm:internalListing.unit')}
                </span>
              );
            },
          },
          {
            header: t('crm:internalListing.margin'),
            align: 'right',
            className: 'px-6 py-5 whitespace-nowrap text-right',
            id: 'margin',
            accessorFn: (row) => calcMargine(Number(row.costo), Number(row.molPercentage)),
            filterFormat: (val) => Number(val).toFixed(2),
            cell: ({ value }) => (
              <span className="text-sm font-semibold text-emerald-600">
                {Number(value).toFixed(2)} {currency}
              </span>
            ),
          },
          {
            header: t('common:labels.status'),
            accessorKey: 'isDisabled',
            id: 'status',
            cell: ({ row: p }) => (
              <StatusBadge
                type={p.isDisabled ? 'disabled' : 'active'}
                label={
                  p.isDisabled ? t('crm:internalListing.disabled') : t('crm:internalListing.active')
                }
              />
            ),
            accessorFn: (row) =>
              row.isDisabled ? t('crm:internalListing.disabled') : t('crm:internalListing.active'),
          },
          {
            header: t('common:labels.actions'),
            id: 'actions',
            align: 'right',
            disableSorting: true,
            disableFiltering: true,
            cell: ({ row: p }) => (
              <div className="flex justify-end gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (p.isDisabled) {
                            onUpdateProduct(p.id, { isDisabled: false });
                          } else {
                            onUpdateProduct(p.id, { isDisabled: true });
                          }
                        }}
                        aria-label={
                          p.isDisabled
                            ? t('crm:internalListing.enableProduct')
                            : t('crm:internalListing.disableProduct')
                        }
                        className={`p-2 rounded-lg transition-all ${
                          p.isDisabled
                            ? 'text-praetor hover:bg-emerald-50'
                            : 'text-amber-700 hover:text-amber-600 hover:bg-amber-50'
                        }`}
                      >
                        <i className={`fa-solid ${p.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {p.isDisabled
                      ? t('crm:internalListing.enableProduct')
                      : t('crm:internalListing.disableProduct')}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmDelete(p);
                        }}
                        aria-label={t('common:buttons.delete')}
                        className="p-2 text-red-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('crm:internalListing.deleteProductTooltip')}</TooltipContent>
                </Tooltip>
              </div>
            ),
            className: 'px-8 py-5',
          },
        ]}
      />
    </div>
  );
};

export default InternalListingView;
