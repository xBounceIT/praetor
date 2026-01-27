import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Product, Supplier } from '../types';
import CustomSelect, { Option } from './CustomSelect';
import StandardTable from './StandardTable';
import StatusBadge from './StatusBadge';
import ValidatedNumberInput from './ValidatedNumberInput';
import { parseNumberInputValue } from '../utils/numbers';

interface ProductsViewProps {
  products: Product[];
  suppliers: Supplier[];
  onAddProduct: (productData: Partial<Product>) => Promise<void>; // Updated to Promise for error handling
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>; // Updated to Promise for error handling
  onDeleteProduct: (id: string) => void;
  currency: string;
}

const ProductsView: React.FC<ProductsViewProps> = ({
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

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const saved = localStorage.getItem('praetor_products_rowsPerPage');
    return saved ? parseInt(saved, 10) : 5;
  });

  const handleRowsPerPageChange = (val: string) => {
    const value = parseInt(val, 10);
    setRowsPerPage(value);
    localStorage.setItem('praetor_products_rowsPerPage', value.toString());
    setCurrentPage(1); // Reset to first page
  };

  // Category Management State
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [isAddSubcategoryModalOpen, setIsAddSubcategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSubcategoryName, setNewSubcategoryName] = useState('');

  // Default categories per type
  const defaultCategoriesMap: Record<string, string[]> = {
    supply: [
      t('crm:products.defaultCategories.hardware'),
      t('crm:products.defaultCategories.license'),
      t('crm:products.defaultCategories.subscription'),
    ],
    consulting: [
      t('crm:products.defaultCategories.specialistic'),
      t('crm:products.defaultCategories.technical'),
      t('crm:products.defaultCategories.governance'),
    ],
    service: [
      t('crm:products.defaultCategories.reports'),
      t('crm:products.defaultCategories.monitoring'),
      t('crm:products.defaultCategories.maintenance'),
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
        await onUpdateProduct(editingProduct.id, formData);
      } else {
        await onAddProduct(formData);
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

  // Pagination Logic
  const totalPages = Math.ceil(products.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedProducts = products.slice(startIndex, startIndex + rowsPerPage);

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
    { id: 'supply', name: t('crm:products.typeSupply') },
    { id: 'service', name: t('crm:products.typeService') },
    { id: 'consulting', name: t('crm:products.typeConsulting') },
  ];

  const activeSuppliers = suppliers.filter((s) => !s.isDisabled);
  const supplierOptions: Option[] = [
    { id: '', name: t('crm:products.noSupplier') },
    ...activeSuppliers.map((s) => ({ id: s.id, name: s.name })),
  ];

  // Helper to get localized name for product types
  const getLocalizedTypeName = (type: string) => {
    switch (type) {
      case 'supply':
        return t('crm:products.typeSupply');
      case 'service':
        return t('crm:products.typeService');
      case 'consulting':
        return t('crm:products.typeConsulting');
      case 'item':
        return t('crm:products.typeItem');
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'service':
        return 'bg-blue-100 text-blue-600';
      case 'supply':
        return 'bg-emerald-100 text-emerald-600';
      case 'consulting':
        return 'bg-purple-100 text-purple-600';
      case 'item':
        return 'bg-amber-100 text-amber-600';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  };

  const handleTypeChange = (val: string) => {
    const type = val as Product['type'];
    let unit = 'unit';
    if (type === 'service' || type === 'consulting') {
      // Default to hour or unit? "Service" logic usually hour, Consulting usually days/hour, Supply units.
      // Original logic: type === 'item' ? 'unit' : 'hour';
      // Let's infer: Supply -> unit, Service/Consulting -> hour
      unit = type === 'service' || type === 'consulting' ? 'hour' : 'unit';
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
      {isAddCategoryModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-praetor">
                  <i className="fa-solid fa-plus"></i>
                </div>
                {t('crm:products.addCategoryModalTitle')}
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
                  {t('crm:products.categoryName')}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                  placeholder={t('crm:products.categoryNamePlaceholder')}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                />
              </div>
              <div className="flex justify-between gap-3">
                <button
                  onClick={() => setIsAddCategoryModalOpen(false)}
                  className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
                >
                  {t('crm:products.cancel')}
                </button>
                <button
                  onClick={handleAddCategory}
                  className="px-6 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {t('crm:products.addCategory')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Subcategory Modal */}
      {isAddSubcategoryModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
                {t('crm:products.addSubcategoryModalTitle')}
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
                  {t('crm:products.subcategoryName')}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newSubcategoryName}
                  onChange={(e) => setNewSubcategoryName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSubcategory()}
                  placeholder={t('crm:products.subcategoryNamePlaceholder')}
                  className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all"
                />
              </div>
              <div className="flex justify-between gap-3">
                <button
                  onClick={() => setIsAddSubcategoryModalOpen(false)}
                  className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
                >
                  {t('crm:products.cancel')}
                </button>
                <button
                  onClick={handleAddSubcategory}
                  className="px-6 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                >
                  {t('crm:products.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                  <i className={`fa-solid ${editingProduct ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                </div>
                {editingProduct
                  ? t('crm:products.editProductTitle')
                  : t('crm:products.addProductTitle')}
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
                  {t('crm:products.productDetails')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:products.productName')}
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value });
                        if (errors.name) setErrors({ ...errors, name: '' });
                      }}
                      placeholder={t('crm:products.productNamePlaceholder')}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all ${errors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                    />
                    {errors.name && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.name}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:products.productCode')}
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
                      {t('crm:products.productCodeHint')}
                    </p>
                  </div>

                  <div className="col-span-full space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:products.description')}
                    </label>
                    <textarea
                      value={formData.description || ''}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder={t('crm:products.productDescriptionPlaceholder')}
                      rows={2}
                      className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none transition-all resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-end justify-between ml-1 min-h-[20px]">
                      <label className="text-xs font-bold text-slate-500">
                        {t('crm:products.type')}
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
                        {t('crm:products.category')}
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsAddCategoryModalOpen(true)}
                        className="text-[10px] font-black text-praetor hover:text-slate-700 uppercase tracking-tighter flex items-center gap-1"
                      >
                        <i className="fa-solid fa-plus"></i> {t('crm:products.addCategory')}
                      </button>
                    </div>
                    <CustomSelect
                      options={categoryOptions}
                      value={formData.category || ''}
                      onChange={(val) =>
                        setFormData({ ...formData, category: val as string, subcategory: '' })
                      }
                      placeholder={t('crm:products.selectOption')}
                      searchable={true}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-end justify-between ml-1 min-h-[20px]">
                      <label className="text-xs font-bold text-slate-500">
                        {t('crm:products.subcategory')}
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsAddSubcategoryModalOpen(true)}
                        disabled={!formData.category} // Disable if no category selected
                        className={`text-[10px] font-black uppercase tracking-tighter flex items-center gap-1 ${!formData.category ? 'text-slate-300 cursor-not-allowed' : 'text-praetor hover:text-slate-700'}`}
                      >
                        <i className="fa-solid fa-plus"></i> {t('crm:products.addSubcategory')}
                      </button>
                    </div>
                    <CustomSelect
                      options={subcategoryOptions}
                      value={formData.subcategory || ''}
                      onChange={(val) => setFormData({ ...formData, subcategory: val as string })}
                      placeholder={
                        !formData.category
                          ? t('crm:products.selectCategoryFirst')
                          : t('crm:products.selectOption')
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
                            {t('crm:products.unusualTaxRate')}
                          </p>
                        )}
                        <label className="text-xs font-bold text-slate-500">
                          {t('crm:products.taxRate')}
                        </label>
                      </div>
                    </div>
                    <ValidatedNumberInput
                      value={formData.taxRate ?? ''}
                      onValueChange={handleNumericValueChange('taxRate')}
                      className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all ${errors.taxRate ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                    />
                    {errors.taxRate && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">
                        {errors.taxRate}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-end justify-between ml-1 min-h-[20px]">
                      <label className="text-xs font-bold text-slate-500 font-black">
                        {t('crm:products.unitOfMeasure')}
                      </label>
                    </div>
                    <div
                      className={`w-full text-sm px-4 py-2.5 border rounded-xl font-bold flex items-center gap-2 ${errors.costUnit ? 'border-red-500 bg-red-50 text-red-600' : 'bg-slate-100 border-slate-200 text-slate-500'}`}
                    >
                      <i
                        className={`fa-solid ${formData.type === 'supply' || formData.type === 'item' ? 'fa-box-open' : 'fa-clock'}`}
                      ></i>
                      {formData.costUnit === 'hour'
                        ? t('crm:products.hour')
                        : t('crm:products.unit')}
                    </div>
                    {errors.costUnit && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">
                        {errors.costUnit}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 ml-1">
                      {t('crm:products.autoSetBasedOnType')}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-end justify-between ml-1 min-h-[20px]">
                      <label className="text-xs font-bold text-slate-500">
                        {t('crm:products.supplier')}
                      </label>
                    </div>
                    <CustomSelect
                      options={supplierOptions}
                      value={formData.supplierId || ''}
                      onChange={(val) => setFormData({ ...formData, supplierId: val as string })}
                      placeholder={t('crm:products.selectOption')}
                      searchable={true}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                  {t('crm:products.pricingAndUnit')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:products.cost')}
                    </label>
                    <div className="flex gap-2">
                      <ValidatedNumberInput
                        value={formData.costo ?? ''}
                        onValueChange={handleNumericValueChange('costo')}
                        className={`flex-1 text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all min-w-0 ${errors.costo ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                      />
                    </div>
                    {errors.costo && (
                      <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.costo}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:products.mol')}
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
                      {t('crm:products.salePriceCalculated')}
                    </label>
                    <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                      {hasPricing
                        ? `${calcSalePrice(formData.costo!, formData.molPercentage!).toFixed(2)} ${currency}`
                        : '--'}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 ml-1">
                      {t('crm:products.marginCalculated')}
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
                  {editingProduct ? t('crm:products.updateProduct') : t('crm:products.saveProduct')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {t('crm:products.deleteProductTitle')}
                </h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t('crm:products.deleteConfirm', { productName: productToDelete?.name })}
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
                  {t('crm:products.yesDelete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">{t('crm:products.title')}</h2>
          <p className="text-slate-500 text-sm">{t('crm:products.subtitle')}</p>
        </div>
      </div>

      <StandardTable
        title={t('crm:products.title')}
        totalCount={products.length}
        headerAction={
          <button
            onClick={openAddModal}
            className="bg-praetor text-white px-4 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-slate-200 transition-all hover:bg-slate-700 active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> {t('crm:products.addProduct')}
          </button>
        }
        footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
        footer={
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500">
                {t('common:labels.rowsPerPage')}
              </span>
              <CustomSelect
                options={[
                  { id: '5', name: '5' },
                  { id: '10', name: '10' },
                  { id: '20', name: '20' },
                  { id: '50', name: '50' },
                ]}
                value={rowsPerPage.toString()}
                onChange={(val) => handleRowsPerPageChange(val as string)}
                className="w-20"
                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                searchable={false}
              />
              <span className="text-xs font-bold text-slate-400 ml-2">
                {t('crm:products.showing')} {paginatedProducts.length > 0 ? startIndex + 1 : 0}-
                {Math.min(startIndex + rowsPerPage, products.length)} {t('crm:products.of')}{' '}
                {products.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-left text-xs"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      currentPage === page
                        ? 'bg-praetor text-white shadow-md shadow-slate-200'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
              >
                <i className="fa-solid fa-chevron-right text-xs"></i>
              </button>
            </div>
          </>
        }
      >
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('common:labels.name')} / {t('crm:products.category')} /{' '}
                {t('crm:products.supplier')}
              </th>
              <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('common:status')}
              </th>
              <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:products.type')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:products.cost')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:products.mol')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:products.salePrice')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:products.margin')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {t('crm:products.taxRate')}
              </th>
              <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                {t('common:labels.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedProducts.map((p) => (
              <tr
                key={p.id}
                onClick={() => openEditModal(p)}
                className={`transition-colors group cursor-pointer ${
                  p.isDisabled
                    ? 'bg-slate-50/50 grayscale opacity-75 hover:bg-slate-100 hover:opacity-100 hover:grayscale-0'
                    : 'hover:bg-slate-50/50'
                }`}
              >
                <td className="px-8 py-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 flex-shrink-0 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
                      <i className="fa-solid fa-box"></i>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-slate-800 truncate">{p.name}</div>
                        {p.productCode && (
                          <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase flex-shrink-0">
                            {p.productCode}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-black text-slate-400 uppercase truncate">
                        {p.category || t('crm:products.noCategory')}
                      </div>
                      <div className="text-[10px] font-semibold text-slate-500 truncate">
                        {p.supplierName || t('crm:products.noSupplier')}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-5">
                  <StatusBadge
                    type={p.isDisabled ? 'disabled' : 'active'}
                    label={p.isDisabled ? t('crm:products.disabled') : t('crm:products.active')}
                  />
                </td>
                <td className="px-4 py-5">
                  <span
                    className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider ${getTypeBadgeColor(p.type)}`}
                  >
                    {getLocalizedTypeName(p.type)}
                  </span>
                </td>
                <td className="px-6 py-5 text-sm font-semibold text-slate-500">
                  {Number(p.costo).toFixed(2)} {currency} /{' '}
                  {p.costUnit === 'hour' ? t('crm:products.hour') : t('crm:products.unit')}
                </td>
                <td className="px-6 py-5 text-sm font-semibold text-slate-500">
                  {Number(p.molPercentage).toFixed(2)}%
                </td>
                <td className="px-6 py-5 text-sm font-semibold text-slate-700">
                  {calcSalePrice(Number(p.costo), Number(p.molPercentage)).toFixed(2)} {currency} /{' '}
                  {p.costUnit === 'hour' ? t('crm:products.hour') : t('crm:products.unit')}
                </td>
                <td className="px-6 py-5 text-sm font-semibold text-emerald-600">
                  {calcMargine(Number(p.costo), Number(p.molPercentage)).toFixed(2)} {currency}
                </td>
                <td className="px-6 py-5 text-sm font-bold text-praetor">{p.taxRate}%</td>
                <td className="px-8 py-5">
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
                          ? 'text-praetor hover:bg-slate-100'
                          : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                      }`}
                      title={
                        p.isDisabled
                          ? t('crm:products.enableProduct')
                          : t('crm:products.disableProduct')
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
                      title={t('crm:products.deleteProductTooltip')}
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {paginatedProducts.length === 0 && (
              <tr>
                <td colSpan={9} className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                    <i className="fa-solid fa-boxes-stacked text-2xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-bold">{t('crm:products.noProducts')}</p>
                  <button
                    onClick={openAddModal}
                    className="mt-4 text-praetor text-sm font-black hover:underline"
                  >
                    {t('crm:products.addFirstProduct')}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </StandardTable>
    </div>
  );
};

export default ProductsView;
