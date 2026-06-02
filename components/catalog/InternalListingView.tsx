import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
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
import { calcProductSalePrice, parseNumberInputValue } from '../../utils/numbers';
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

const InternalListingView: React.FC<InternalListingViewProps> = ({
  products,
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
    type: '',
  });
  const defaultProductType = productTypes[0];
  const defaultTypeName = defaultProductType?.name || '';
  const defaultTypeCostUnit = defaultProductType?.costUnit || 'unit';

  // Load product types on mount
  useEffect(() => {
    const loadTypes = async () => {
      setIsLoadingTypes(true);
      try {
        const types = await api.products.listProductTypes();
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
  }, []);

  // Load categories when type changes or category modal opens
  const loadCategories = useCallback(async (type: string) => {
    if (!type) return;
    setIsLoadingCategories(true);
    try {
      const cats = await api.products.listInternalCategories(type);
      setCategories(cats);
    } catch (err) {
      console.error('Failed to load categories:', err);
    } finally {
      setIsLoadingCategories(false);
    }
  }, []);

  // Load subcategories when category changes or subcategory modal opens
  const loadSubcategories = useCallback(async (type: string, category: string) => {
    if (!type || !category) return;
    setIsLoadingSubcategories(true);
    try {
      const subs = await api.products.listInternalSubcategories(type, category);
      setSubcategories(subs);
    } catch (err) {
      console.error('Failed to load subcategories:', err);
    } finally {
      setIsLoadingSubcategories(false);
    }
  }, []);

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
    setFormData({
      name: '',
      productCode: '',
      description: '',
      costo: undefined,
      molPercentage: undefined,
      costUnit: defaultTypeCostUnit,
      category: '',
      subcategory: '',
      type: defaultTypeName,
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
      type: product.type || (productTypes[0]?.name ?? ''),
    });
    setErrors({});
    setServerError(null);
    setIsModalOpen(true);
  };

  const calcMargine = (costo: number, molPercentage: number) => {
    return calcProductSalePrice(costo, molPercentage) - costo;
  };

  const handleNumericValueChange = (field: 'costo' | 'molPercentage') => (value: string) => {
    const parsed = parseNumberInputValue(value, undefined);
    setFormData((prev) => ({ ...prev, [field]: parsed }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
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
    const typeValue = formData.type;
    const isKnownType = productTypes.some((type) => type.name === typeValue);
    if (!typeValue || (productTypes.length > 0 && !isKnownType)) {
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

    const selectedType = formData.type || defaultTypeName;
    if (!selectedType) {
      setCategoryError(t('common:validation.typeRequired'));
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
      const types = await api.products.listProductTypes();
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
      setTypeError(
        t('crm:internalListing.typeDeleteBlocked', {
          productCount: type.productCount,
          categoryCount: type.categoryCount,
          name: type.name,
        }),
      );
      return;
    }

    try {
      setTypeError(null);
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
      const types = await api.products.listProductTypes();
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

    const selectedType = formData.type || defaultTypeName;
    if (!selectedType) {
      setSubcategoryError(t('common:validation.typeRequired'));
      return;
    }

    setIsSavingSubcategory(true);
    setSubcategoryError(null);

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
    const selectedType = formData.type || defaultTypeName;
    if (!selectedType) {
      setSubcategoryError(t('common:validation.typeRequired'));
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
        setFormData((prev) => ({ ...prev, subcategory: '' }));
      }

      // Reload subcategories
      await loadSubcategories(selectedType, formData.category || '');
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
  const typeOptions: Option[] = productTypes.map((t) => ({
    id: t.name,
    name: getDisplayTypeName(t.name),
  }));

  const handleTypeChange = (val: string) => {
    const typeName = val;
    const typeData = productTypes.find((t) => t.name === typeName);
    // Reset category and subcategory - new categories will be loaded by useEffect
    setSubcategories([]);
    setFormData((prev) => ({
      ...prev,
      type: typeName,
      costUnit: typeData?.costUnit || 'unit',
      category: '',
      subcategory: '',
    }));
    if (errors.type) {
      setErrors((prev) => ({ ...prev, type: '' }));
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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Manage Types Modal */}
      <Modal
        isOpen={isManageTypesModalOpen}
        onClose={() => setIsManageTypesModalOpen(false)}
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
            <ModalCloseButton onClick={() => setIsManageTypesModalOpen(false)} />
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
                    onChange={(e) => setNewTypeName(e.target.value)}
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
                    onChange={(val) => setNewTypeCostUnit(val as 'unit' | 'hours')}
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
        onClose={() => setIsManageCategoriesModalOpen(false)}
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
            <ModalCloseButton onClick={() => setIsManageCategoriesModalOpen(false)} />
          </ModalHeader>

          <ModalBody className="max-h-[60vh] space-y-4">
            {/* Add/Edit Category Form */}
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="space-y-1.5">
                <FieldLabel>{t('crm:internalListing.categoryName')}</FieldLabel>
                <Input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
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
        onClose={() => setIsManageSubcategoriesModalOpen(false)}
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
            <ModalCloseButton onClick={() => setIsManageSubcategoriesModalOpen(false)} />
          </ModalHeader>

          <ModalBody className="max-h-[60vh] space-y-4">
            {/* Add/Edit Subcategory Form */}
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="space-y-1.5">
                <FieldLabel>{t('crm:internalListing.subcategoryName')}</FieldLabel>
                <Input
                  type="text"
                  value={newSubcategoryName}
                  onChange={(e) => setNewSubcategoryName(e.target.value)}
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
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
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
              <ModalCloseButton onClick={() => setIsModalOpen(false)} />
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
                    <FieldLabel>{t('crm:internalListing.productName')}</FieldLabel>
                    <Input
                      type="text"
                      value={formData.name}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, name: e.target.value }));
                        if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                      }}
                      placeholder={t('crm:internalListing.productNamePlaceholder')}
                      className={errors.name ? 'border-destructive' : undefined}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.name}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel>{t('crm:internalListing.productCode')}</FieldLabel>
                    <Input
                      type="text"
                      value={formData.productCode}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, productCode: e.target.value }));
                        if (errors.productCode) setErrors((prev) => ({ ...prev, productCode: '' }));
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
                        setFormData((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder={t('crm:internalListing.productDescriptionPlaceholder')}
                      rows={2}
                      className="resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex min-h-6 items-center justify-between gap-2">
                      <FieldLabel>{t('crm:internalListing.type')}</FieldLabel>
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
                        setSubcategories([]);
                        setFormData((prev) => ({
                          ...prev,
                          category: val as string,
                          subcategory: '',
                        }));
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
                        setFormData((prev) => ({ ...prev, subcategory: val as string }))
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
                      {t('crm:internalListing.cost')}
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
                        className={`flex-1 text-sm px-4 py-2.5 bg-zinc-50 border rounded-xl focus:ring-2 outline-none transition-all min-w-0 ${errors.costo ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-zinc-200 focus:ring-praetor'}`}
                      />
                    </div>
                    {errors.costo && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.costo}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel>{t('crm:internalListing.mol')}</FieldLabel>
                    <div className="flex gap-2">
                      <ValidatedNumberInput
                        value={formData.molPercentage ?? ''}
                        formatDecimals={2}
                        onValueChange={handleNumericValueChange('molPercentage')}
                        className={`flex-1 text-sm px-4 py-2.5 bg-zinc-50 border rounded-xl focus:ring-2 outline-none transition-all min-w-0 ${errors.molPercentage ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-zinc-200 focus:ring-praetor'}`}
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
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
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
        onClose={() => setIsDeleteConfirmOpen(false)}
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
            filterFormat: (val) => Number(val).toFixed(2),
            cell: ({ row: p }) => (
              <span className="text-sm font-semibold text-zinc-500">
                {Number(p.molPercentage).toFixed(2)}%
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
