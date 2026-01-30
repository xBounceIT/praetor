import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Product, Supplier } from '../types';
import CustomSelect, { Option } from './CustomSelect';
import StandardTable from './StandardTable';
import StatusBadge, { StatusType } from './StatusBadge';
import ValidatedNumberInput from './ValidatedNumberInput';
import { parseNumberInputValue, roundToTwoDecimals } from '../utils/numbers';
import Modal from './Modal';

interface InternalListingViewProps {
  products: Product[];
  suppliers: Supplier[];
  onAddProduct: (productData: Partial<Product>) => Promise<void>; // Updated to Promise for error handling
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>; // Updated to Promise for error handling
  onDeleteProduct: (id: string) => void;
  currency: string;
}

const InternalListingView: React.FC<InternalListingViewProps> = ({
  products,
  suppliers,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  currency,
}) => {
  const { t } = useTranslation(['crm', 'common']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Category Management State
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [isAddSubcategoryModalOpen, setIsAddSubcategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSubcategoryName, setNewSubcategoryName] = useState('');

  // Default categories per type
  const defaultCategoriesMap: Record<string, string[]> = {
    supply: [
      t('crm:internalListing.defaultCategories.hardware'),
      t('crm:internalListing.defaultCategories.license'),
      t('crm:internalListing.defaultCategories.subscription'),
    ],
    consulting: [
      t('crm:internalListing.defaultCategories.specialistic'),
      t('crm:internalListing.defaultCategories.technical'),
      t('crm:internalListing.defaultCategories.governance'),
    ],
    service: [
      t('crm:internalListing.defaultCategories.reports'),
      t('crm:internalListing.defaultCategories.monitoring'),
      t('crm:internalListing.defaultCategories.maintenance'),
    ],
  };

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
    type: 'supply',
    supplierId: '',
  });

  // Calculated values
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

  const openAddModal = () => {
    setEditingProduct(null);
    setFormData({
      name: '',
      productCode: '',
      description: '',
      costo: undefined,
      molPercentage: undefined,
      costUnit: 'unit',
      category: '',
      subcategory: '',
      taxRate: 22,
      type: 'supply',
      supplierId: '',
    });
    setErrors({});
    setServerError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name || '',
      productCode: product.productCode || '',
      description: product.description || '',
      costo: product.costo || 0,
      molPercentage: product.molPercentage || 0,
      costUnit: product.costUnit || 'unit',
      category: product.category || '',
      subcategory: product.subcategory || '',
      taxRate: product.taxRate || 0,
      type: product.type || 'supply',
      supplierId: product.supplierId || '',
    });
    setErrors({});
    setServerError(null);
    setIsModalOpen(true);
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

    // Frontend uniqueness check (optional, but good UX)
    // const isDuplicate = products.some(p => p.name.toLowerCase() === formData.name?.trim().toLowerCase() && p.id !== editingProduct?.id);
    // if (isDuplicate) newErrors.name = t('common:validation.productNameUnique');

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
      if (editingProduct) {
        await onUpdateProduct(editingProduct.id, {
          ...formData,
          costo: formData.costo !== undefined ? roundToTwoDecimals(formData.costo) : undefined,
          molPercentage:
            formData.molPercentage !== undefined
              ? roundToTwoDecimals(formData.molPercentage)
              : undefined,
        });
      } else {
        await onAddProduct({
          ...formData,
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

  const handleAddCategory = () => {
    if (newCategoryName.trim()) {
      const name = newCategoryName.trim();
      setFormData({ ...formData, category: name, subcategory: '' });
      setNewCategoryName('');
      setIsAddCategoryModalOpen(false);
    }
  };

  const handleAddSubcategory = () => {
    if (newSubcategoryName.trim()) {
      const name = newSubcategoryName.trim();
      setFormData({ ...formData, subcategory: name });
      setNewSubcategoryName('');
      setIsAddSubcategoryModalOpen(false);
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

  // Get unique categories from existing products + defaults
  const availableCategories = React.useMemo(() => {
    const type = formData.type || 'supply';
    // If type is item, treat as supply for categories
    const normalizedType = type === 'item' ? 'supply' : type;
    const defaults = defaultCategoriesMap[normalizedType] || [];

    // Also include categories currently used by products of this type
    const used = products
      .filter((p) => (p.type === 'item' ? 'supply' : p.type) === normalizedType && p.category)
      .map((p) => p.category!);

    return Array.from(new Set([...defaults, ...used])).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.type, products]);

  const categoryOptions: Option[] = availableCategories.map((c) => ({ id: c, name: c }));

  // Get available subcategories based on category
  const availableSubcategories = React.useMemo(() => {
    const category = formData.category;
    if (!category) return [];

    // Include subcategories currently used by products with this category
    const used = products
      .filter((p) => p.category === category && p.subcategory)
      .map((p) => p.subcategory!);

    return Array.from(new Set(used)).sort();
  }, [formData.category, products]);

  const subcategoryOptions: Option[] = availableSubcategories.map((s) => ({ id: s, name: s }));

  const typeOptions: Option[] = [
    { id: 'supply', name: t('crm:internalListing.typeSupply') },
    { id: 'service', name: t('crm:internalListing.typeService') },
    { id: 'consulting', name: t('crm:internalListing.typeConsulting') },
  ];

  const activeSuppliers = suppliers.filter((s) => !s.isDisabled);
  const supplierOptions: Option[] = [
    { id: '', name: t('crm:internalListing.noSupplier') },
    ...activeSuppliers.map((s) => ({ id: s.id, name: s.name })),
  ];

  // Helper to get localized name for product types
  const getLocalizedTypeName = (type: string) => {
    switch (type) {
      case 'supply':
        return t('crm:internalListing.typeSupply');
      case 'service':
        return t('crm:internalListing.typeService');
      case 'consulting':
        return t('crm:internalListing.typeConsulting');
      case 'item':
        return t('crm:internalListing.typeItem');
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const handleTypeChange = (val: string) => {
    const type = val as Product['type'];
    let unit = 'unit';
    if (type === 'service' || type === 'consulting') {
      unit = 'hours';
    }

    setFormData({
      ...formData,
      type,
      costUnit: unit as Product['costUnit'],
      category: '', // Reset category as it depends on type
      subcategory: '', // Reset subcategory as it depends on category
    });
    if (errors.type || errors.costUnit) {
      setErrors({ ...errors, type: '', costUnit: '' });
    }
  };

  const hasPricing =
    formData.costo !== undefined &&
    formData.costo !== null &&
    !Number.isNaN(formData.costo) &&
    formData.molPercentage !== undefined &&
    formData.molPercentage !== null &&
    !Number.isNaN(formData.molPercentage);

  const showTaxRateWarning =
    formData.taxRate !== undefined &&
    formData.taxRate !== null &&
    !Number.isNaN(formData.taxRate) &&
    formData.taxRate > 30 &&
    formData.taxRate <= 100;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Add Category Modal */}
      <Modal
        isOpen={isAddCategoryModalOpen}
        onClose={() => setIsAddCategoryModalOpen(false)}
        zIndex={70}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                <i className="fa-solid fa-plus"></i>
              </div>
              {t('crm:internalListing.addCategoryModalTitle')}
            </h3>
            <button
              onClick={() => setIsAddCategoryModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('crm:internalListing.categoryName')}
              </label>
              <input
                type="text"
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                placeholder={t('crm:internalListing.categoryNamePlaceholder')}
                className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
              />
            </div>
            <div className="flex justify-between gap-3">
              <button
                onClick={() => setIsAddCategoryModalOpen(false)}
                className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('crm:internalListing.cancel')}
              </button>
              <button
                onClick={handleAddCategory}
                className="px-6 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
              >
                {t('crm:internalListing.addCategory')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Add Subcategory Modal */}
      <Modal
        isOpen={isAddSubcategoryModalOpen}
        onClose={() => setIsAddSubcategoryModalOpen(false)}
        zIndex={70}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
              {t('crm:internalListing.addSubcategoryModalTitle')}
            </h3>
            <button
              onClick={() => setIsAddSubcategoryModalOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 ml-1">
                {t('crm:internalListing.subcategoryName')}
              </label>
              <input
                type="text"
                autoFocus
                value={newSubcategoryName}
                onChange={(e) => setNewSubcategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSubcategory()}
                placeholder={t('crm:internalListing.subcategoryNamePlaceholder')}
                className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
              />
            </div>
            <div className="flex justify-between gap-3">
              <button
                onClick={() => setIsAddSubcategoryModalOpen(false)}
                className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
              >
                {t('crm:internalListing.cancel')}
              </button>
              <button
                onClick={handleAddSubcategory}
                className="px-6 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
              >
                {t('crm:internalListing.add')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Add/Edit Modal */}
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
                  <div className="flex items-end justify-between ml-1 min-h-[20px]">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:internalListing.type')}
                    </label>
                  </div>
                  <CustomSelect
                    options={typeOptions}
                    value={formData.type || 'supply'}
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
                  <div className="flex items-end justify-between ml-1 min-h-[20px]">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:internalListing.category')}
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsAddCategoryModalOpen(true)}
                      className="text-[10px] font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-1"
                    >
                      <i className="fa-solid fa-plus"></i> {t('crm:internalListing.addCategory')}
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
                  <div className="flex items-end justify-between ml-1 min-h-[20px]">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:internalListing.subcategory')}
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsAddSubcategoryModalOpen(true)}
                      disabled={!formData.category} // Disable if no category selected
                      className={`text-[10px] font-black uppercase tracking-tighter flex items-center gap-1 ${!formData.category ? 'text-slate-300 cursor-not-allowed' : 'text-praetor hover:text-slate-700'}`}
                    >
                      <i className="fa-solid fa-plus"></i> {t('crm:internalListing.addSubcategory')}
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
                  <div className="flex items-end justify-between ml-1 min-h-[20px]">
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

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-[20px]">
                    <label className="text-xs font-bold text-slate-500 font-black">
                      {t('crm:internalListing.unitOfMeasure')}
                    </label>
                  </div>
                  <CustomSelect
                    options={[
                      { id: 'unit', name: t('crm:internalListing.unit') },
                      { id: 'hours', name: t('crm:internalListing.hour') },
                    ]}
                    value={formData.costUnit || 'unit'}
                    onChange={(val) =>
                      setFormData({ ...formData, costUnit: val as 'unit' | 'hours' })
                    }
                    placeholder={t('crm:internalListing.selectOption')}
                    searchable={false}
                    buttonClassName={
                      errors.costUnit
                        ? 'py-2.5 text-sm border-red-500 bg-red-50 focus:ring-red-200'
                        : 'py-2.5 text-sm'
                    }
                  />
                  {errors.costUnit && (
                    <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">
                      {errors.costUnit}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-end justify-between ml-1 min-h-[20px]">
                    <label className="text-xs font-bold text-slate-500">
                      {t('crm:internalListing.supplier')}
                    </label>
                  </div>
                  <CustomSelect
                    options={supplierOptions}
                    value={formData.supplierId || ''}
                    onChange={(val) => setFormData({ ...formData, supplierId: val as string })}
                    placeholder={t('crm:internalListing.selectOption')}
                    searchable={true}
                  />
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
                    {hasPricing
                      ? `${calcSalePrice(formData.costo!, formData.molPercentage!).toFixed(2)} ${currency}`
                      : '--'}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 ml-1">
                    {t('crm:internalListing.marginCalculated')}
                  </label>
                  <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-emerald-600 font-semibold">
                    {hasPricing
                      ? `${calcMargine(formData.costo!, formData.molPercentage!).toFixed(2)} ${currency}`
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

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('crm:internalListing.title')}</h2>
          <p className="text-slate-500 text-sm">{t('crm:internalListing.subtitle')}</p>
        </div>
      </div>

      <StandardTable
        title={t('crm:internalListing.title')}
        defaultRowsPerPage={5}
        data={products}
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('crm:internalListing.addProduct')}
          </button>
        }
        rowClassName={(p) =>
          p.isDisabled
            ? 'bg-slate-50/50 grayscale opacity-75 hover:bg-slate-100'
            : 'hover:bg-slate-50/50'
        }
        onRowClick={openEditModal}
        columns={[
          {
            header: t('common:labels.name'),
            accessorKey: 'name',
            className: 'px-6 py-5 font-bold text-slate-800 min-w-[200px]',
            cell: ({ row: p }) => <div className="font-bold text-slate-800">{p.name}</div>,
          },
          {
            header: t('crm:internalListing.productCode'),
            accessorKey: 'productCode',
            cell: ({ row: p }) =>
              p.productCode ? (
                <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase flex-shrink-0 whitespace-nowrap">
                  {p.productCode}
                </span>
              ) : (
                <span className="text-slate-300">-</span>
              ),
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
            header: t('crm:internalListing.supplier'),
            accessorKey: 'supplierName',
            className: 'px-6 py-5 whitespace-nowrap',
            cell: ({ row: p }) => (
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-truck text-slate-300 text-xs"></i>
                <span
                  className="text-xs font-semibold text-slate-600 truncate max-w-[150px]"
                  title={p.supplierName}
                >
                  {p.supplierName || t('crm:internalListing.noSupplier')}
                </span>
              </div>
            ),
          },
          {
            header: t('crm:internalListing.type'),
            accessorKey: 'type',
            cell: ({ row: p }) => (
              <StatusBadge type={p.type as StatusType} label={getLocalizedTypeName(p.type)} />
            ),
            accessorFn: (row) => getLocalizedTypeName(row.type),
          },
          {
            header: t('crm:internalListing.cost'),
            align: 'right',
            className: 'px-6 py-5 whitespace-nowrap text-right',
            accessorFn: (row) => Number(row.costo), // Numeric for sorting
            filterFormat: (val) => Number(val).toFixed(2),
            cell: ({ row: p }) => (
              <span className="text-sm font-semibold text-slate-500">
                {Number(p.costo).toFixed(2)} {currency} /{' '}
                {p.costUnit === 'hours'
                  ? t('crm:internalListing.hour')
                  : t('crm:internalListing.unit')}
              </span>
            ),
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
            id: 'salePrice', // calculated
            accessorFn: (row) => calcSalePrice(Number(row.costo), Number(row.molPercentage)),
            filterFormat: (val) => Number(val).toFixed(2),
            cell: ({ row: p, value }) => (
              <span className="text-sm font-semibold text-slate-700">
                {Number(value).toFixed(2)} {currency} /{' '}
                {p.costUnit === 'hours'
                  ? t('crm:internalListing.hour')
                  : t('crm:internalListing.unit')}
              </span>
            ),
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
            accessorKey: 'isDisabled', // Use as accessor for filtering (true/false)
            id: 'status',
            cell: ({ row: p }) => (
              <StatusBadge
                type={p.isDisabled ? 'disabled' : 'active'}
                label={
                  p.isDisabled ? t('crm:internalListing.disabled') : t('crm:internalListing.active')
                }
              />
            ),
            // We might want to customize filter options for boolean, but string logic 'true'/'false' works basic.
            // Ideally we map true->Disabled, false->Active for filtering value.
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
                  title={
                    p.isDisabled
                      ? t('crm:internalListing.enableProduct')
                      : t('crm:internalListing.disableProduct')
                  }
                >
                  <i className={`fa-solid ${p.isDisabled ? 'fa-rotate-left' : 'fa-ban'}`}></i>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmDelete(p);
                  }}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  title={t('crm:internalListing.deleteProductTooltip')}
                >
                  <i className="fa-solid fa-trash-can"></i>
                </button>
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
