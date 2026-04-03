import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  InternalProductCategory,
  InternalProductSubcategory,
  InternalProductType,
} from '../../services/api/products';
import type { Product } from '../../types';
import { parseNumberInputValue, roundToTwoDecimals } from '../../utils/numbers';
import CustomSelect, { type Option } from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StandardTable from '../shared/StandardTable';
import StatusBadge, { type StatusType } from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';
import ValidatedNumberInput from '../shared/ValidatedNumberInput';

export interface InternalListingViewProps {
  products: Product[];
  onAddProduct: (productData: Partial<Product>) => Promise<void>;
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  onDeleteProduct: (id: string) => void;
  currency: string;
  // Product Type management
  onListProductTypes: () => Promise<InternalProductType[]>;
  onCreateProductType: (typeData: { name: string; costUnit: 'unit' | 'hours' }) => Promise<void>;
  onUpdateProductType: (
    id: string,
    updates: Partial<{ name: string; costUnit: 'unit' | 'hours' }>,
  ) => Promise<void>;
  onDeleteProductType: (id: string) => Promise<void>;
  // Category/Subcategory management
  onListInternalCategories: (type: string) => Promise<InternalProductCategory[]>;
  onCreateInternalCategory: (categoryData: { name: string; type: string }) => Promise<void>;
  onUpdateInternalCategory: (id: string, updates: Partial<{ name: string }>) => Promise<void>;
  onDeleteInternalCategory: (id: string) => Promise<void>;
  onListInternalSubcategories: (
    type: string,
    category: string,
  ) => Promise<InternalProductSubcategory[]>;
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

const InternalListingView: React.FC<InternalListingViewProps> = ({
  products,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  currency,
  onListProductTypes,
  onCreateProductType,
  onUpdateProductType,
  onDeleteProductType,
  onListInternalCategories,
  onCreateInternalCategory,
  onUpdateInternalCategory,
  onDeleteInternalCategory,
  onListInternalSubcategories,
  onCreateInternalSubcategory,
  onRenameInternalSubcategory,
  onDeleteInternalSubcategory,
}) => {
  const { t } = useTranslation(['crm', 'common']);

  // Product Types State
  const [productTypes, setProductTypes] = useState<InternalProductType[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);

  // Type Management State
  const [isManageTypesModalOpen, setIsManageTypesModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<InternalProductType | null>(null);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeCostUnit, setNewTypeCostUnit] = useState<'unit' | 'hours'>('unit');
  const [typeError, setTypeError] = useState<string | null>(null);
  const [isSavingType, setIsSavingType] = useState(false);

  // Main product modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Category Management State
  const [isManageCategoriesModalOpen, setIsManageCategoriesModalOpen] = useState(false);
  const [categories, setCategories] = useState<InternalProductCategory[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [editingCategory, setEditingCategory] = useState<InternalProductCategory | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  // Subcategory Management State
  const [isManageSubcategoriesModalOpen, setIsManageSubcategoriesModalOpen] = useState(false);
  const [subcategories, setSubcategories] = useState<InternalProductSubcategory[]>([]);
  const [isLoadingSubcategories, setIsLoadingSubcategories] = useState(false);
  const [editingSubcategory, setEditingSubcategory] = useState<InternalProductSubcategory | null>(
    null,
  );
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [subcategoryError, setSubcategoryError] = useState<string | null>(null);
  const [isSavingSubcategory, setIsSavingSubcategory] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    productCode: '',
    description: '',
    costo: undefined,
    molPercentage: undefined,
    costUnit: 'unit',
    category: '',
    subcategory: '',
    taxRate: 22,
    type: '',
  });

  // Load product types on mount
  useEffect(() => {
    const loadTypes = async () => {
      setIsLoadingTypes(true);
      try {
        const types = await onListProductTypes();
        setProductTypes(types);
        if (types.length > 0) {
          const defaultType = types[0];
          setFormData((prev) => {
            if (prev.type) return prev;
            return {
              ...prev,
              type: defaultType.name,
              costUnit: defaultType.costUnit,
            };
          });
        }
      } catch (err) {
        console.error('Failed to load product types:', err);
      } finally {
        setIsLoadingTypes(false);
      }
    };
    loadTypes();
  }, [onListProductTypes]);

  // Load categories when type changes or category modal opens
  const loadCategories = useCallback(
    async (type: string) => {
      if (!type) return;
      setIsLoadingCategories(true);
      try {
        const cats = await onListInternalCategories(type);
        setCategories(cats);
      } catch (err) {
        console.error('Failed to load categories:', err);
      } finally {
        setIsLoadingCategories(false);
      }
    },
    [onListInternalCategories],
  );

  // Load subcategories when category changes or subcategory modal opens
  const loadSubcategories = useCallback(
    async (type: string, category: string) => {
      if (!type || !category) return;
      setIsLoadingSubcategories(true);
      try {
        const subs = await onListInternalSubcategories(type, category);
        setSubcategories(subs);
      } catch (err) {
        console.error('Failed to load subcategories:', err);
      } finally {
        setIsLoadingSubcategories(false);
      }
    },
    [onListInternalSubcategories],
  );

  // Load categories when modal opens and when type changes
  useEffect(() => {
    if (isModalOpen && formData.type) {
      loadCategories(formData.type);
    }
  }, [isModalOpen, formData.type, loadCategories]);

  // Load subcategories when modal opens with a category
  useEffect(() => {
    if (isModalOpen && formData.type && formData.category) {
      loadSubcategories(formData.type, formData.category);
    }
  }, [isModalOpen, formData.type, formData.category, loadSubcategories]);

  // Keep the displayed unit aligned with the selected internal product type.
  useEffect(() => {
    if (!formData.type || productTypes.length === 0) return;

    const typeData = productTypes.find((t) => t.name === formData.type);
    if (!typeData) return;

    const nextCostUnit = typeData.costUnit;
    setFormData((prev) => {
      if (prev.costUnit === nextCostUnit) return prev;
      return { ...prev, costUnit: nextCostUnit };
    });
  }, [formData.type, productTypes]);

  // Auto-select first category when categories load (only for new products, not when editing)
  useEffect(() => {
    if (isModalOpen && !editingProduct && categories.length > 0 && !formData.category) {
      const firstCategory = categories[0];
      setFormData((prev) => ({
        ...prev,
        category: firstCategory.name,
        subcategory: '',
      }));
    }
  }, [isModalOpen, editingProduct, categories, formData.category]);

  const openAddModal = () => {
    setEditingProduct(null);
    // Set initial state with first available type
    const initialType = productTypes[0]?.name || '';
    const initialCostUnit = productTypes[0]?.costUnit || 'unit';
    setFormData({
      name: '',
      productCode: '',
      description: '',
      costo: undefined,
      molPercentage: undefined,
      costUnit: initialCostUnit,
      category: '',
      subcategory: '',
      taxRate: 22,
      type: initialType,
    });
    setErrors({});
    setServerError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    // Look up cost unit from product types, fallback to the product's current value
    const typeData = productTypes.find((t) => t.name === product.type);
    setFormData({
      name: product.name || '',
      productCode: product.productCode || '',
      description: product.description || '',
      costo: product.costo || 0,
      molPercentage: product.molPercentage || 0,
      costUnit: typeData?.costUnit || product.costUnit || 'unit',
      category: product.category || '',
      subcategory: product.subcategory || '',
      taxRate: product.taxRate || 0,
      type: product.type || (productTypes[0]?.name ?? ''),
    });
    setErrors({});
    setServerError(null);
    setIsModalOpen(true);
  };

  const calcSalePrice = (costo: number, molPercentage: number) => {
    if (molPercentage >= 100) return costo;
    return costo / (1 - molPercentage / 100);
  };

  const calcMargine = (costo: number, molPercentage: number) => {
    return calcSalePrice(costo, molPercentage) - costo;
  };

  const handleNumericValueChange =
    (field: 'taxRate' | 'costo' | 'molPercentage') => (value: string) => {
      const parsed = parseNumberInputValue(value, undefined);
      setFormData({
        ...formData,
        [field]: parsed,
      });
      if (errors[field]) {
        setErrors({ ...errors, [field]: '' });
      }
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setServerError(null);

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
    if (
      formData.taxRate === undefined ||
      formData.taxRate === null ||
      Number.isNaN(formData.taxRate)
    ) {
      newErrors.taxRate = t('common:validation.taxRateRequired');
    }
    if (
      !newErrors.taxRate &&
      formData.taxRate !== undefined &&
      formData.taxRate !== null &&
      !Number.isNaN(formData.taxRate)
    ) {
      if (formData.taxRate < 0 || formData.taxRate > 100) {
        newErrors.taxRate = t('common:validation.taxRateRange');
      }
    }
    const typeValue = formData.type;
    if (!typeValue || !['supply', 'service', 'consulting', 'item'].includes(typeValue)) {
      newErrors.type = t('common:validation.typeRequired');
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      const { costUnit: _costUnit, ...productPayload } = formData;
      if (editingProduct) {
        await onUpdateProduct(editingProduct.id, {
          ...productPayload,
          costo: formData.costo !== undefined ? roundToTwoDecimals(formData.costo) : undefined,
          molPercentage:
            formData.molPercentage !== undefined
              ? roundToTwoDecimals(formData.molPercentage)
              : undefined,
        });
      } else {
        await onAddProduct({
          ...productPayload,
          costo: formData.costo !== undefined ? roundToTwoDecimals(formData.costo) : undefined,
          molPercentage:
            formData.molPercentage !== undefined
              ? roundToTwoDecimals(formData.molPercentage)
              : undefined,
        });
      }
      setIsModalOpen(false);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        if (err.message.toLowerCase().includes('product code')) {
          setErrors({ ...newErrors, productCode: t('common:validation.productCodeUnique') });
        } else {
          setErrors({ ...newErrors, name: t('common:validation.productNameUnique') });
        }
      } else {
        setServerError(err instanceof Error ? err.message : 'An error occurred');
      }
    }
  };

  const confirmDelete = (product: Product) => {
    setProductToDelete(product);
    setIsDeleteConfirmOpen(true);
  };

  const handleDelete = () => {
    if (productToDelete) {
      onDeleteProduct(productToDelete.id);
      setIsDeleteConfirmOpen(false);
      setProductToDelete(null);
    }
  };

  // Category Management Handlers
  const handleOpenManageCategories = () => {
    setIsManageCategoriesModalOpen(true);
    setEditingCategory(null);
    setNewCategoryName('');
    setCategoryError(null);
  };

  const handleSaveCategory = async () => {
    if (!newCategoryName.trim()) {
      setCategoryError(t('crm:internalListing.categoryNameRequired'));
      return;
    }

    setIsSavingCategory(true);
    setCategoryError(null);

    try {
      if (editingCategory) {
        await onUpdateInternalCategory(editingCategory.id, {
          name: newCategoryName.trim(),
        });
      } else {
        await onCreateInternalCategory({
          name: newCategoryName.trim(),
          type: formData.type || 'supply',
        });
      }

      // Reload categories
      await loadCategories(formData.type || 'supply');

      // If the renamed category was selected, update formData
      if (
        editingCategory &&
        formData.category === editingCategory.name &&
        formData.type === editingCategory.type
      ) {
        setFormData((prev) => ({ ...prev, category: newCategoryName.trim() }));
      }

      // Reset form
      setEditingCategory(null);
      setNewCategoryName('');
    } catch (err: unknown) {
      setCategoryError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleEditCategory = (category: InternalProductCategory) => {
    setEditingCategory(category);
    setNewCategoryName(category.name);
    setCategoryError(null);
  };

  const handleDeleteCategory = async (category: InternalProductCategory) => {
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
        setFormData((prev) => ({ ...prev, category: '', subcategory: '' }));
      }

      // Reload categories
      await loadCategories(category.type);
    } catch (err: unknown) {
      setCategoryError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleCancelCategoryEdit = () => {
    setEditingCategory(null);
    setNewCategoryName('');
    setCategoryError(null);
  };

  // Product Type Management Handlers
  const handleOpenManageTypes = () => {
    setIsManageTypesModalOpen(true);
    setEditingType(null);
    setNewTypeName('');
    setNewTypeCostUnit('unit');
    setTypeError(null);
  };

  const handleSaveType = async () => {
    if (!newTypeName.trim()) {
      setTypeError(t('crm:internalListing.typeNameRequired'));
      return;
    }

    setIsSavingType(true);
    setTypeError(null);

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
      const types = await onListProductTypes();
      setProductTypes(types);

      // If the renamed type was selected, update formData
      if (editingType && formData.type === editingType.name) {
        setFormData((prev) => ({
          ...prev,
          type: newTypeName.trim(),
          costUnit: newTypeCostUnit,
        }));
      }

      // Reset form
      setEditingType(null);
      setNewTypeName('');
      setNewTypeCostUnit('unit');
    } catch (err: unknown) {
      setTypeError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSavingType(false);
    }
  };

  const handleEditType = (type: InternalProductType) => {
    setEditingType(type);
    setNewTypeName(type.name);
    setNewTypeCostUnit(type.costUnit);
    setTypeError(null);
  };

  const handleDeleteType = async (type: InternalProductType) => {
    if (type.productCount > 0 || type.categoryCount > 0) {
      const confirmed = window.confirm(
        t('crm:internalListing.deleteTypeWithProducts', {
          productCount: type.productCount,
          categoryCount: type.categoryCount,
          name: type.name,
        }),
      );
      if (!confirmed) return;
    }

    try {
      await onDeleteProductType(type.id);

      // If the deleted type was selected, clear it
      if (formData.type === type.name) {
        const remainingTypes = productTypes.filter((t) => t.id !== type.id);
        const nextType = remainingTypes[0]?.name || '';
        const nextCostUnit = remainingTypes[0]?.costUnit || 'unit';
        setFormData((prev) => ({
          ...prev,
          type: nextType,
          costUnit: nextCostUnit,
          category: '',
          subcategory: '',
        }));
      }

      // Reload types
      const types = await onListProductTypes();
      setProductTypes(types);
    } catch (err: unknown) {
      setTypeError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleCancelTypeEdit = () => {
    setEditingType(null);
    setNewTypeName('');
    setNewTypeCostUnit('unit');
    setTypeError(null);
  };

  // Subcategory Management Handlers
  const handleOpenManageSubcategories = () => {
    if (!formData.category) return;
    setIsManageSubcategoriesModalOpen(true);
    setEditingSubcategory(null);
    setNewSubcategoryName('');
    setSubcategoryError(null);
  };

  const handleSaveSubcategory = async () => {
    if (!newSubcategoryName.trim()) {
      setSubcategoryError(t('crm:internalListing.subcategoryNameRequired'));
      return;
    }

    setIsSavingSubcategory(true);
    setSubcategoryError(null);

    try {
      if (editingSubcategory) {
        await onRenameInternalSubcategory(
          editingSubcategory.name,
          newSubcategoryName.trim(),
          formData.type || 'supply',
          formData.category || '',
        );
      } else {
        await onCreateInternalSubcategory({
          name: newSubcategoryName.trim(),
          type: formData.type || 'supply',
          category: formData.category || '',
        });
      }

      // Reload subcategories
      await loadSubcategories(formData.type || 'supply', formData.category || '');

      // If the renamed subcategory was selected, update formData
      if (editingSubcategory && formData.subcategory === editingSubcategory.name) {
        setFormData((prev) => ({ ...prev, subcategory: newSubcategoryName.trim() }));
      }

      // Reset form
      setEditingSubcategory(null);
      setNewSubcategoryName('');
    } catch (err: unknown) {
      setSubcategoryError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSavingSubcategory(false);
    }
  };

  const handleEditSubcategory = (subcategory: InternalProductSubcategory) => {
    setEditingSubcategory(subcategory);
    setNewSubcategoryName(subcategory.name);
    setSubcategoryError(null);
  };

  const handleDeleteSubcategory = async (subcategory: InternalProductSubcategory) => {
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
      await onDeleteInternalSubcategory(
        subcategory.name,
        formData.type || 'supply',
        formData.category || '',
      );

      // If the deleted subcategory was selected, clear it
      if (formData.subcategory === subcategory.name) {
        setFormData((prev) => ({ ...prev, subcategory: '' }));
      }

      // Reload subcategories
      await loadSubcategories(formData.type || 'supply', formData.category || '');
    } catch (err: unknown) {
      setSubcategoryError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleCancelSubcategoryEdit = () => {
    setEditingSubcategory(null);
    setNewSubcategoryName('');
    setSubcategoryError(null);
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

  // Helper to display type name (now just returns the name since types are user-managed)
  const getDisplayTypeName = (typeName: string) => {
    return typeName.charAt(0).toUpperCase() + typeName.slice(1);
  };

  // Build type options from API-loaded product types
  const typeOptions: Option[] = useMemo(() => {
    return productTypes.map((t) => ({ id: t.name, name: getDisplayTypeName(t.name) }));
  }, [productTypes]);

  const handleTypeChange = (val: string) => {
    const typeName = val;
    const typeData = productTypes.find((t) => t.name === typeName);
    // Reset category and subcategory - new categories will be loaded by useEffect
    setFormData({
      ...formData,
      type: typeName,
      costUnit: typeData?.costUnit || 'unit',
      category: '',
      subcategory: '',
    });
    if (errors.type) {
      setErrors({ ...errors, type: '' });
    }
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

  const showTaxRateWarning =
    formData.taxRate !== undefined &&
    formData.taxRate !== null &&
    !Number.isNaN(formData.taxRate) &&
    formData.taxRate > 30 &&
    formData.taxRate <= 100;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Manage Types Modal */}
      <Modal
        isOpen={isManageTypesModalOpen}
        onClose={() => setIsManageTypesModalOpen(false)}
        zIndex={70}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                <i className="fa-solid fa-tags"></i>
              </div>
              {t('crm:internalListing.manageTypes')}
            </h3>
            <button
              onClick={() => setIsManageTypesModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Add/Edit Type Form */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('crm:internalListing.typeName')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    placeholder={t('crm:internalListing.typeNamePlaceholder')}
                    className="flex-1 text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveType()}
                  />
                  <CustomSelect
                    options={[
                      { id: 'unit', name: t('crm:internalListing.unit') },
                      { id: 'hours', name: t('crm:internalListing.hour') },
                    ]}
                    value={newTypeCostUnit}
                    onChange={(val) => setNewTypeCostUnit(val as 'unit' | 'hours')}
                    searchable={false}
                    buttonClassName="py-2 text-sm w-28"
                  />
                </div>
              </div>

              {typeError && <p className="text-red-500 text-xs font-bold">{typeError}</p>}

              <div className="flex justify-end gap-2">
                {editingType && (
                  <button
                    onClick={handleCancelTypeEdit}
                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    {t('common:buttons.cancel')}
                  </button>
                )}
                <button
                  onClick={handleSaveType}
                  disabled={isSavingType || !newTypeName.trim()}
                  className="px-4 py-2 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingType
                    ? t('common:buttons.saving')
                    : editingType
                      ? t('common:buttons.update')
                      : t('common:buttons.add')}
                </button>
              </div>
            </div>

            {/* Types List */}
            <div className="space-y-2">
              {isLoadingTypes ? (
                <div className="flex items-center justify-center py-8">
                  <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
                </div>
              ) : productTypes.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <p>{t('crm:internalListing.noTypes')}</p>
                </div>
              ) : (
                productTypes.map((type) => (
                  <div
                    key={type.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-xl group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-slate-700">
                        {type.name.charAt(0).toUpperCase() + type.name.slice(1)}
                      </span>
                      <span className="text-xs font-medium px-2 py-1 bg-white rounded-lg text-slate-500 border border-slate-200">
                        {type.costUnit === 'hours'
                          ? t('crm:internalListing.hour')
                          : t('crm:internalListing.unit')}
                      </span>
                      <span className="text-xs text-slate-400">
                        {type.productCount} {t('crm:internalListing.products')}
                        {type.categoryCount > 0 && (
                          <>
                            , {type.categoryCount} {t('crm:internalListing.categories')}
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEditType(type)}
                        className="p-1.5 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                        title={t('common:buttons.edit')}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                      <button
                        onClick={() => handleDeleteType(type)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title={t('common:buttons.delete')}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Manage Categories Modal */}
      <Modal
        isOpen={isManageCategoriesModalOpen}
        onClose={() => setIsManageCategoriesModalOpen(false)}
        zIndex={70}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                <i className="fa-solid fa-folder-tree"></i>
              </div>
              {t('crm:internalListing.manageCategories')}
            </h3>
            <button
              onClick={() => setIsManageCategoriesModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Add/Edit Category Form */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('crm:internalListing.categoryName')}
                </label>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={t('crm:internalListing.categoryNamePlaceholder')}
                  className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCategory()}
                />
              </div>

              {categoryError && <p className="text-red-500 text-xs font-bold">{categoryError}</p>}

              <div className="flex justify-end gap-2">
                {editingCategory && (
                  <button
                    onClick={handleCancelCategoryEdit}
                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    {t('common:buttons.cancel')}
                  </button>
                )}
                <button
                  onClick={handleSaveCategory}
                  disabled={isSavingCategory || !newCategoryName.trim()}
                  className="px-4 py-2 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingCategory
                    ? t('common:buttons.saving')
                    : editingCategory
                      ? t('common:buttons.update')
                      : t('common:buttons.add')}
                </button>
              </div>
            </div>

            {/* Categories List */}
            <div className="space-y-2">
              {isLoadingCategories ? (
                <div className="flex items-center justify-center py-8">
                  <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
                </div>
              ) : categories.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <p>{t('crm:internalListing.noCategories')}</p>
                </div>
              ) : (
                categories.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-xl group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-slate-700">{category.name}</span>
                      <span className="text-xs text-slate-400">
                        {category.productCount} {t('crm:internalListing.products')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEditCategory(category)}
                        className="p-1.5 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                        title={t('common:buttons.edit')}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(category)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title={t('common:buttons.delete')}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Manage Subcategories Modal */}
      <Modal
        isOpen={isManageSubcategoriesModalOpen}
        onClose={() => setIsManageSubcategoriesModalOpen(false)}
        zIndex={70}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                <i className="fa-solid fa-folder-open"></i>
              </div>
              {t('crm:internalListing.manageSubcategories')}
              <span className="text-sm font-normal text-slate-500">({formData.category})</span>
            </h3>
            <button
              onClick={() => setIsManageSubcategoriesModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Add/Edit Subcategory Form */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 ml-1">
                  {t('crm:internalListing.subcategoryName')}
                </label>
                <input
                  type="text"
                  value={newSubcategoryName}
                  onChange={(e) => setNewSubcategoryName(e.target.value)}
                  placeholder={t('crm:internalListing.subcategoryNamePlaceholder')}
                  className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveSubcategory()}
                />
              </div>

              {subcategoryError && (
                <p className="text-red-500 text-xs font-bold">{subcategoryError}</p>
              )}

              <div className="flex justify-end gap-2">
                {editingSubcategory && (
                  <button
                    onClick={handleCancelSubcategoryEdit}
                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    {t('common:buttons.cancel')}
                  </button>
                )}
                <button
                  onClick={handleSaveSubcategory}
                  disabled={isSavingSubcategory || !newSubcategoryName.trim()}
                  className="px-4 py-2 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingSubcategory
                    ? t('common:buttons.saving')
                    : editingSubcategory
                      ? t('common:buttons.update')
                      : t('common:buttons.add')}
                </button>
              </div>
            </div>

            {/* Subcategories List */}
            <div className="space-y-2">
              {isLoadingSubcategories ? (
                <div className="flex items-center justify-center py-8">
                  <i className="fa-solid fa-circle-notch fa-spin text-praetor text-2xl"></i>
                </div>
              ) : subcategories.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <p>{t('crm:internalListing.noSubcategories')}</p>
                </div>
              ) : (
                subcategories.map((subcategory) => (
                  <div
                    key={subcategory.name}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-xl group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-slate-700">{subcategory.name}</span>
                      <span className="text-xs text-slate-400">
                        {subcategory.productCount} {t('crm:internalListing.products')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEditSubcategory(subcategory)}
                        className="p-1.5 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                        title={t('common:buttons.edit')}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                      <button
                        onClick={() => handleDeleteSubcategory(subcategory)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title={t('common:buttons.delete')}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Add/Edit Product Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                <i className={`fa-solid ${editingProduct ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
              </div>
              {editingProduct
                ? t('crm:internalListing.editProductTitle')
                : t('crm:internalListing.addProductTitle')}
            </h3>
            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
            {serverError && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-bold border border-red-100 flex items-center gap-3">
                <i className="fa-solid fa-triangle-exclamation"></i>
                {serverError}
              </div>
            )}

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:internalListing.productDetails')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.productName')}
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value });
                      if (errors.name) setErrors({ ...errors, name: '' });
                    }}
                    placeholder={t('crm:internalListing.productNamePlaceholder')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all ${errors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                  />
                  {errors.name && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.name}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.productCode')}
                  </label>
                  <input
                    type="text"
                    value={formData.productCode}
                    onChange={(e) => {
                      setFormData({ ...formData, productCode: e.target.value });
                      if (errors.productCode) setErrors({ ...errors, productCode: '' });
                    }}
                    placeholder={t('common:form.placeholderCode')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all ${errors.productCode ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                  />
                  {errors.productCode && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">
                      {errors.productCode}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 ml-1">
                    {t('crm:internalListing.productCodeHint')}
                  </p>
                </div>

                <div className="col-span-full space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.description')}
                  </label>
                  <textarea
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder={t('crm:internalListing.productDescriptionPlaceholder')}
                    rows={2}
                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-5">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:internalListing.type')}
                    </label>
                    <button
                      type="button"
                      onClick={handleOpenManageTypes}
                      className="text-[10px] font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-1"
                    >
                      <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                    </button>
                  </div>
                  <CustomSelect
                    options={typeOptions}
                    value={formData.type || (productTypes[0]?.name ?? '')}
                    onChange={(val) => handleTypeChange(val as string)}
                    searchable={false}
                    buttonClassName={
                      errors.type
                        ? 'py-2.5 text-sm border-red-500 bg-red-50 focus:ring-red-200'
                        : 'py-2.5 text-sm'
                    }
                  />
                  {errors.type && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.type}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-5">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:internalListing.category')}
                    </label>
                    <button
                      type="button"
                      onClick={handleOpenManageCategories}
                      className="text-[10px] font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-1"
                    >
                      <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                    </button>
                  </div>
                  <CustomSelect
                    options={categoryOptions}
                    value={formData.category || ''}
                    onChange={(val) =>
                      setFormData({ ...formData, category: val as string, subcategory: '' })
                    }
                    placeholder={t('crm:internalListing.selectOption')}
                    searchable={true}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-5">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:internalListing.subcategory')}
                    </label>
                    <button
                      type="button"
                      onClick={handleOpenManageSubcategories}
                      disabled={!formData.category}
                      className={`text-[10px] font-black uppercase tracking-tighter flex items-center gap-1 ${!formData.category ? 'text-slate-300 cursor-not-allowed' : 'text-praetor hover:text-slate-700'}`}
                    >
                      <i className="fa-solid fa-gear"></i> {t('common:buttons.manage')}
                    </button>
                  </div>
                  <CustomSelect
                    options={subcategoryOptions}
                    value={formData.subcategory || ''}
                    onChange={(val) => setFormData({ ...formData, subcategory: val as string })}
                    placeholder={
                      !formData.category
                        ? t('crm:internalListing.selectCategoryFirst')
                        : t('crm:internalListing.selectOption')
                    }
                    searchable={true}
                    disabled={!formData.category}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-5">
                    <div className="flex flex-col">
                      {showTaxRateWarning && (
                        <p className="text-amber-600 text-[10px] font-bold leading-none mb-1">
                          {t('crm:internalListing.unusualTaxRate')}
                        </p>
                      )}
                      <label className="text-xs font-bold text-slate-500">
                        {t('crm:internalListing.taxRate')}
                      </label>
                    </div>
                  </div>
                  <ValidatedNumberInput
                    value={formData.taxRate ?? ''}
                    onValueChange={handleNumericValueChange('taxRate')}
                    className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all ${errors.taxRate ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                  />
                  {errors.taxRate && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.taxRate}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                {t('crm:internalListing.pricingAndUnit')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.cost')}
                    <span className="text-slate-400 font-semibold">
                      /
                      {formData.costUnit === 'hours'
                        ? t('crm:internalListing.hour')
                        : t('crm:internalListing.unit')}
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <ValidatedNumberInput
                      value={formData.costo !== undefined ? Number(formData.costo).toFixed(2) : ''}
                      onValueChange={handleNumericValueChange('costo')}
                      onBlur={() => {
                        if (formData.costo !== undefined) {
                          // Ensure internal state consistency if needed, though toFixed(2) above handles display
                        }
                      }}
                      className={`flex-1 text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all min-w-0 ${errors.costo ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                    />
                  </div>
                  {errors.costo && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.costo}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.mol')}
                  </label>
                  <div className="flex gap-2">
                    <ValidatedNumberInput
                      value={formData.molPercentage ?? ''}
                      onValueChange={handleNumericValueChange('molPercentage')}
                      className={`flex-1 text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all min-w-0 ${errors.molPercentage ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                    />
                  </div>
                  {errors.molPercentage && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">
                      {errors.molPercentage}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.salePriceCalculated')}
                  </label>
                  <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                    {pricing
                      ? `${calcSalePrice(pricing.cost, pricing.mol).toFixed(2)} ${currency}`
                      : '--'}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.marginCalculated')}
                  </label>
                  <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-emerald-600 font-semibold">
                    {pricing
                      ? `${calcMargine(pricing.cost, pricing.mol).toFixed(2)} ${currency}`
                      : '--'}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-8 border-t border-slate-100 mt-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-10 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="submit"
                className="px-12 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
              >
                {editingProduct
                  ? t('crm:internalListing.updateProduct')
                  : t('crm:internalListing.saveProduct')}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('crm:internalListing.deleteProductTitle')}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('crm:internalListing.deleteConfirm', { productName: productToDelete?.name })}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
              >
                {t('crm:internalListing.yesDelete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800">{t('crm:internalListing.title')}</h2>
            <p className="text-slate-500 text-sm">{t('crm:internalListing.subtitle')}</p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-5 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('crm:internalListing.addProduct')}
          </button>
        </div>
      </div>

      <StandardTable<Product>
        title={t('crm:internalListing.title')}
        defaultRowsPerPage={5}
        data={products}
        rowClassName={(p) =>
          p.isDisabled
            ? 'bg-slate-50/50 grayscale opacity-75 hover:bg-slate-100'
            : 'hover:bg-slate-50/50'
        }
        onRowClick={openEditModal}
        columns={[
          {
            header: t('crm:internalListing.productCode'),
            accessorKey: 'productCode',
            cell: ({ row: p }) => (
              <span className="font-bold text-slate-700">{p.productCode || '-'}</span>
            ),
          },
          {
            header: t('common:labels.name'),
            accessorKey: 'name',
            className: 'px-6 py-5 font-bold text-slate-800 min-w-[200px]',
            cell: ({ row: p }) => <div className="font-bold text-slate-800">{p.name}</div>,
          },
          {
            header: t('crm:internalListing.category'),
            accessorKey: 'category',
            cell: ({ row: p }) => (
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-tight whitespace-nowrap">
                {p.category || '-'}
              </span>
            ),
          },
          {
            header: t('crm:internalListing.subcategory'),
            accessorKey: 'subcategory',
            cell: ({ row: p }) => (
              <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
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
                <span className="text-sm font-semibold text-slate-500">
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
            filterFormat: (val) => Number(val).toFixed(2),
            cell: ({ row: p }) => (
              <span className="text-sm font-semibold text-slate-500">
                {Number(p.molPercentage).toFixed(2)}%
              </span>
            ),
          },
          {
            header: t('crm:internalListing.salePrice'),
            align: 'right',
            className: 'px-6 py-5 whitespace-nowrap text-right',
            id: 'salePrice',
            accessorFn: (row) => calcSalePrice(Number(row.costo), Number(row.molPercentage)),
            filterFormat: (val) => Number(val).toFixed(2),
            cell: ({ row: p, value }) => {
              const typeData = productTypes.find((t) => t.name === p.type);
              const costUnit = typeData?.costUnit || p.costUnit || 'unit';
              return (
                <span className="text-sm font-semibold text-slate-700">
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
            header: t('crm:internalListing.taxRate'),
            align: 'right',
            className: 'px-6 py-5 whitespace-nowrap text-right',
            accessorKey: 'taxRate',
            cell: ({ row: p }) => (
              <span className="text-sm font-bold text-praetor">{p.taxRate}%</span>
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
                <Tooltip
                  label={
                    p.isDisabled
                      ? t('crm:internalListing.enableProduct')
                      : t('crm:internalListing.disableProduct')
                  }
                >
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (p.isDisabled) {
                          onUpdateProduct(p.id, { isDisabled: false });
                        } else {
                          onUpdateProduct(p.id, { isDisabled: true });
                        }
                      }}
                      className={`p-2 rounded-lg transition-all ${
                        p.isDisabled
                          ? 'text-praetor hover:bg-emerald-50'
                          : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                      }`}
                    >
                      <i className={`fa-solid ${p.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                    </button>
                  )}
                </Tooltip>
                <Tooltip label={t('crm:internalListing.deleteProductTooltip')}>
                  {() => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(p);
                      }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
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
