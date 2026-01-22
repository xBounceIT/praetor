import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Product, Supplier } from '../types';
import CustomSelect, { Option } from './CustomSelect';
import StandardTable from './StandardTable';
import ValidatedNumberInput, { parseNumberInputValue } from './ValidatedNumberInput';

interface ProductsViewProps {
    products: Product[];
    suppliers: Supplier[];
    onAddProduct: (productData: Partial<Product>) => void;
    onUpdateProduct: (id: string, updates: Partial<Product>) => void;
    onDeleteProduct: (id: string) => void;
}

const ProductsView: React.FC<ProductsViewProps> = ({ products, suppliers, onAddProduct, onUpdateProduct, onDeleteProduct }) => {
    const { t } = useTranslation(['crm', 'common']);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [productToDelete, setProductToDelete] = useState<Product | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(() => {
        const saved = localStorage.getItem('praetor_products_rowsPerPage');
        return saved ? parseInt(saved, 10) : 5;
    });
    const [disabledCurrentPage, setDisabledCurrentPage] = useState(1);
    const [disabledRowsPerPage, setDisabledRowsPerPage] = useState(() => {
        const saved = localStorage.getItem('praetor_products_disabled_rowsPerPage');
        return saved ? parseInt(saved, 10) : 5;
    });

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterType, setFilterType] = useState('all');
    const [filterSupplierId, setFilterSupplierId] = useState('all');

    const handleRowsPerPageChange = (val: string) => {
        const value = parseInt(val, 10);
        setRowsPerPage(value);
        localStorage.setItem('praetor_products_rowsPerPage', value.toString());
        setCurrentPage(1); // Reset to first page
    };

    const handleDisabledRowsPerPageChange = (val: string) => {
        const value = parseInt(val, 10);
        setDisabledRowsPerPage(value);
        localStorage.setItem('praetor_products_disabled_rowsPerPage', value.toString());
        setDisabledCurrentPage(1);
    };

    // Reset pages on filter change
    React.useEffect(() => {
        setCurrentPage(1);
        setDisabledCurrentPage(1);
    }, [searchTerm, filterCategory, filterType, filterSupplierId]);

    // Category Management State
    const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const defaultCategories = [
        t('crm:products.defaultCategories.electronics'),
        t('crm:products.defaultCategories.software'),
        t('crm:products.defaultCategories.services'),
        t('crm:products.defaultCategories.hardware'),
        t('crm:products.defaultCategories.accessories'),
        t('crm:products.defaultCategories.subscription'),
        t('crm:products.defaultCategories.consulting'),
        t('crm:products.defaultCategories.maintenance'),
        t('crm:products.defaultCategories.supplies'),
        t('crm:products.defaultCategories.other')
    ];
    const [customCategories, setCustomCategories] = useState<string[]>([]);

    // Form State
    const [formData, setFormData] = useState<Partial<Product>>({
        name: '',
        costo: undefined,
        molPercentage: undefined,
        costUnit: 'unit',
        category: '',
        taxRate: 22,
        type: 'item',
        supplierId: ''
    });

    // Calculated values
    const calcSalePrice = (costo: number, molPercentage: number) => {
        if (molPercentage >= 100) return costo;
        return costo / (1 - molPercentage / 100);
    };
    const calcMargine = (costo: number, molPercentage: number) => {
        return calcSalePrice(costo, molPercentage) - costo;
    };

    const handleNumericValueChange = (field: 'taxRate' | 'costo' | 'molPercentage') => (value: string) => {
        const parsed = parseNumberInputValue(value, undefined);
        setFormData({
            ...formData,
            [field]: parsed
        });
        if (errors[field]) {
            setErrors({ ...errors, [field]: '' });
        }
    };

    const openAddModal = () => {
        setEditingProduct(null);
        setFormData({
            name: '',
            costo: undefined,
            molPercentage: undefined,
            costUnit: 'unit',
            category: '',
            taxRate: 22,
            type: 'item',
            supplierId: ''
        });
        setErrors({});
        setIsModalOpen(true);
    };

    const openEditModal = (product: Product) => {
        setEditingProduct(product);
        setFormData({
            name: product.name || '',
            costo: product.costo || 0,
            molPercentage: product.molPercentage || 0,
            costUnit: product.costUnit || 'unit',
            category: product.category || '',
            taxRate: product.taxRate || 0,
            type: product.type || 'item',
            supplierId: product.supplierId || ''
        });
        setErrors({});
        setIsModalOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setErrors({});

        const newErrors: Record<string, string> = {};
        if (!formData.name?.trim()) newErrors.name = t('common:validation.productNameRequired');
        if (formData.costo === undefined || formData.costo === null || Number.isNaN(formData.costo)) {
            newErrors.costo = t('common:validation.costRequired');
        }
        if (formData.molPercentage === undefined || formData.molPercentage === null || Number.isNaN(formData.molPercentage)) {
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
        if (formData.taxRate === undefined || formData.taxRate === null || Number.isNaN(formData.taxRate)) {
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
        if (!typeValue || !['item', 'service'].includes(typeValue)) {
            newErrors.type = t('common:validation.typeRequired');
        }
        const costUnitValue = formData.costUnit;
        if (!costUnitValue || !['unit', 'hours'].includes(costUnitValue)) {
            newErrors.costUnit = t('common:validation.unitOfMeasureRequired');
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        if (editingProduct) {
            onUpdateProduct(editingProduct.id, formData);
        } else {
            onAddProduct(formData);
        }
        setIsModalOpen(false);
    };

    const handleAddCategory = () => {
        if (newCategoryName.trim()) {
            const name = newCategoryName.trim();
            if (!customCategories.includes(name)) {
                setCustomCategories([...customCategories, name]);
            }
            setFormData({ ...formData, category: name });
            setNewCategoryName('');
            setIsAddCategoryModalOpen(false);
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

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const hasActiveFilters =
        normalizedSearch !== '' ||
        filterCategory !== 'all' ||
        filterType !== 'all' ||
        filterSupplierId !== 'all';

    const handleClearFilters = () => {
        setSearchTerm('');
        setFilterCategory('all');
        setFilterType('all');
        setFilterSupplierId('all');
        setCurrentPage(1);
        setDisabledCurrentPage(1);
    };

    const matchesProductFilters = (product: Product) => {
        const matchesSearch =
            normalizedSearch === '' ||
            product.name.toLowerCase().includes(normalizedSearch) ||
            (product.category ?? '').toLowerCase().includes(normalizedSearch) ||
            (product.supplierName ?? '').toLowerCase().includes(normalizedSearch);

        const matchesCategory = filterCategory === 'all' || (product.category ?? '') === filterCategory;
        const matchesType = filterType === 'all' || product.type === (filterType as Product['type']);
        const matchesSupplier =
            filterSupplierId === 'all' ||
            (filterSupplierId === 'none' ? !product.supplierId : product.supplierId === filterSupplierId);

        return matchesSearch && matchesCategory && matchesType && matchesSupplier;
    };

    const filteredActiveProductsTotal = React.useMemo(() => {
        return products.filter(p => !p.isDisabled).filter(matchesProductFilters);
    }, [products, normalizedSearch, filterCategory, filterType, filterSupplierId]);

    const filteredDisabledProductsTotal = React.useMemo(() => {
        return products.filter(p => p.isDisabled).filter(matchesProductFilters);
    }, [products, normalizedSearch, filterCategory, filterType, filterSupplierId]);

    const hasAnyDisabledProducts = products.some(p => p.isDisabled);

    // Pagination Logic
    const totalPages = Math.ceil(filteredActiveProductsTotal.length / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const activeProducts = filteredActiveProductsTotal.slice(startIndex, startIndex + rowsPerPage);
    const disabledTotalPages = Math.ceil(filteredDisabledProductsTotal.length / disabledRowsPerPage);
    const disabledStartIndex = (disabledCurrentPage - 1) * disabledRowsPerPage;
    const disabledProductsPage = filteredDisabledProductsTotal.slice(disabledStartIndex, disabledStartIndex + disabledRowsPerPage);

    // Get unique categories from existing products + custom ones
    const existingCategories = Array.from(new Set(products.map(p => p.category).filter((c): c is string => !!c)));
    const allCategories = Array.from(new Set([...defaultCategories, ...existingCategories, ...customCategories])).sort();

    const categoryOptions: Option[] = allCategories.map(c => ({ id: c, name: c }));

    const unitOptions: Option[] = [
        { id: 'unit', name: t('crm:products.unit') },
        { id: 'hours', name: t('crm:products.hours') }
    ];

    const typeOptions: Option[] = [
        { id: 'item', name: t('crm:products.typeItem') },
        { id: 'service', name: t('crm:products.typeService') }
    ];

    const activeSuppliers = suppliers.filter(s => !s.isDisabled);
    const supplierOptions: Option[] = [
        { id: '', name: t('crm:products.noSupplier') },
        ...activeSuppliers.map(s => ({ id: s.id, name: s.name }))
    ];

    const filterCategoryOptions: Option[] = [{ id: 'all', name: t('crm:products.allCategories') }, ...categoryOptions];
    const filterTypeOptions: Option[] = [{ id: 'all', name: t('common:filters.allTypes') }, ...typeOptions];
    const filterSupplierOptions: Option[] = [
        { id: 'all', name: t('common:filters.allSuppliers') },
        { id: 'none', name: t('crm:products.noSupplier') },
        ...activeSuppliers.map(s => ({ id: s.id, name: s.name }))
    ];

    const handleTypeChange = (val: string) => {
        const type = val as 'item' | 'service';
        const unit = type === 'item' ? 'unit' : 'hours';
        setFormData({
            ...formData,
            type,
            costUnit: unit
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
                                <label className="text-xs font-bold text-slate-500 ml-1">{t('crm:products.categoryName')}</label>
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

            {/* Add/Edit Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-praetor">
                                    <i className={`fa-solid ${editingProduct ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                                </div>
                                {editingProduct ? t('crm:products.editProductTitle') : t('crm:products.addProductTitle')}
                            </h3>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
                            >
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="overflow-y-auto p-8 space-y-8">
                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-praetor uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-praetor"></span>
                                    {t('crm:products.productDetails')}
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="col-span-full space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">{t('crm:products.productName')}</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={(e) => {
                                                setFormData({ ...formData, name: e.target.value });
                                                if (errors.name) setErrors({ ...errors, name: '' });
                                            }}
                                            placeholder={t('crm:products.categoryNamePlaceholder')}
                                            className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all ${errors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                                        />
                                        {errors.name && <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.name}</p>}
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center ml-1 min-h-[16px]">
                                            <label className="text-xs font-bold text-slate-500">{t('crm:products.category')}</label>
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
                                            onChange={(val) => setFormData({ ...formData, category: val })}
                                            placeholder={t('crm:products.selectOption')}
                                            searchable={true}
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="ml-1 space-y-1">
                                            {showTaxRateWarning && (
                                                <p className="text-amber-600 text-[10px] font-bold">{t('crm:products.unusualTaxRate')}</p>
                                            )}
                                            <label className="text-xs font-bold text-slate-500">{t('crm:products.taxRate')} (%)</label>
                                        </div>
                                        <ValidatedNumberInput
                                            value={formData.taxRate ?? ''}
                                            onValueChange={handleNumericValueChange('taxRate')}
                                            className={`w-full text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all ${errors.taxRate ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                                        />
                                        {errors.taxRate && <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.taxRate}</p>}
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center ml-1 min-h-[16px]">
                                            <label className="text-xs font-bold text-slate-500">{t('crm:products.type')}</label>
                                        </div>
                                        <CustomSelect
                                            options={typeOptions}
                                            value={formData.type || 'item'}
                                            onChange={handleTypeChange}
                                            searchable={false}
                                            buttonClassName={errors.type ? 'py-2.5 text-sm border-red-500 bg-red-50 focus:ring-red-200' : 'py-2.5 text-sm'}
                                        />
                                        {errors.type && <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.type}</p>}
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center ml-1 min-h-[16px]">
                                            <label className="text-xs font-bold text-slate-500 font-black">{t('crm:products.unitOfMeasure')}</label>
                                        </div>
                                        <div className={`w-full text-sm px-4 py-2.5 border rounded-xl font-bold flex items-center gap-2 ${errors.costUnit ? 'border-red-500 bg-red-50 text-red-600' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                                            <i className={`fa-solid ${formData.type === 'service' ? 'fa-clock' : 'fa-box-open'}`}></i>
                                            {formData.type === 'service' ? t('crm:products.hours') : t('crm:products.unit')}
                                        </div>
                                        {errors.costUnit && <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.costUnit}</p>}
                                        <p className="text-[10px] text-slate-400 ml-1">{t('crm:products.autoSetBasedOnType')}</p>
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center ml-1 min-h-[16px]">
                                            <label className="text-xs font-bold text-slate-500">{t('crm:products.supplier')}</label>
                                        </div>
                                        <CustomSelect
                                            options={supplierOptions}
                                            value={formData.supplierId || ''}
                                            onChange={(val) => setFormData({ ...formData, supplierId: val })}
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
                                        <label className="text-xs font-bold text-slate-500 ml-1">{t('crm:products.cost')}</label>
                                        <div className="flex gap-2">
                                            <ValidatedNumberInput
                                                value={formData.costo ?? ''}
                                                onValueChange={handleNumericValueChange('costo')}
                                                className={`flex-1 text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all min-w-0 ${errors.costo ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                                            />
                                        </div>
                                        {errors.costo && <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.costo}</p>}
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">{t('crm:products.mol')}</label>
                                        <div className="flex gap-2">
                                            <ValidatedNumberInput
                                                value={formData.molPercentage ?? ''}
                                                onValueChange={handleNumericValueChange('molPercentage')}
                                                className={`flex-1 text-sm px-4 py-2.5 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all min-w-0 ${errors.molPercentage ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                                            />
                                        </div>
                                        {errors.molPercentage && <p className="text-red-500 text-[10px] font-bold ml-1 mt-1">{errors.molPercentage}</p>}
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">{t('crm:products.salePriceCalculated')}</label>
                                        <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-semibold">
                                            {hasPricing ? calcSalePrice(formData.costo!, formData.molPercentage!).toFixed(2) : '--'}
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">{t('crm:products.marginCalculated')}</label>
                                        <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-emerald-600 font-semibold">
                                            {hasPricing ? calcMargine(formData.costo!, formData.molPercentage!).toFixed(2) : '--'}
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
            {
                isDeleteConfirmOpen && (
                    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
                            <div className="p-6 text-center space-y-4">
                                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                                    <i className="fa-solid fa-triangle-exclamation text-xl"></i>
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-800">{t('crm:products.deleteProductTitle')}</h3>
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
                )
            }

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">{t('crm:products.title')}</h2>
                    <p className="text-slate-500 text-sm">{t('crm:products.subtitle')}</p>
                </div>
            </div>

            {/* Search and Filters */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div className="md:col-span-2 relative">
                    <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input
                        type="text"
                        placeholder={t('crm:products.searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-praetor outline-none shadow-sm placeholder:font-normal"
                    />
                </div>
                <div>
                    <CustomSelect
                        options={filterCategoryOptions}
                        value={filterCategory}
                        onChange={setFilterCategory}
                        placeholder={t('crm:products.filterByCategory')}
                        searchable={true}
                        buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
                    />
                </div>
                <div>
                    <CustomSelect
                        options={filterTypeOptions}
                        value={filterType}
                        onChange={setFilterType}
                        placeholder={t('crm:products.filterByType')}
                        searchable={false}
                        buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
                    />
                </div>
                <div>
                    <CustomSelect
                        options={filterSupplierOptions}
                        value={filterSupplierId}
                        onChange={setFilterSupplierId}
                        placeholder={t('crm:products.filterBySupplier')}
                        searchable={true}
                        buttonClassName="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 shadow-sm"
                    />
                </div>
                <div className="flex items-center justify-end">
                    <button
                        type="button"
                        onClick={handleClearFilters}
                        disabled={!hasActiveFilters}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <i className="fa-solid fa-rotate-left"></i>
                        {t('crm:products.clearFilters')}
                    </button>
                </div>
            </div>

            <StandardTable
                title={t('crm:products.activeProducts')}
                totalCount={filteredActiveProductsTotal.length}
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
                            <span className="text-xs font-bold text-slate-500">{t('common:labels.rowsPerPage')}</span>
                            <CustomSelect
                                options={[
                                    { id: '5', name: '5' },
                                    { id: '10', name: '10' },
                                    { id: '20', name: '20' },
                                    { id: '50', name: '50' }
                                ]}
                                value={rowsPerPage.toString()}
                                onChange={(val) => handleRowsPerPageChange(val)}
                                className="w-20"
                                buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                                searchable={false}
                            />
                            <span className="text-xs font-bold text-slate-400 ml-2">
                                {t('crm:products.showing')} {activeProducts.length > 0 ? startIndex + 1 : 0}-{Math.min(startIndex + rowsPerPage, filteredActiveProductsTotal.length)} {t('crm:products.of')} {filteredActiveProductsTotal.length}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                            >
                                <i className="fa-solid fa-chevron-left text-xs"></i>
                            </button>
                            <div className="flex items-center gap-1">
                                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                                    <button
                                        key={page}
                                        onClick={() => setCurrentPage(page)}
                                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${currentPage === page
                                            ? 'bg-praetor text-white shadow-md shadow-slate-200'
                                            : 'text-slate-500 hover:bg-slate-100'
                                            }`}
                                    >
                                        {page}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
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
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('crm:products.productName')} / {t('crm:products.category')} / {t('crm:products.supplier')}</th>
                            <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('crm:products.type')}</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('crm:products.cost')}</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('crm:products.mol')}</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('crm:products.salePrice')}</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('crm:products.margin')}</th>
                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('crm:products.taxRate')}</th>
                            <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">{t('common:labels.actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {activeProducts.map(p => (
                            <tr key={p.id} onClick={() => openEditModal(p)} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                                <td className="px-8 py-5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 flex-shrink-0 bg-slate-100 text-praetor rounded-xl flex items-center justify-center text-sm">
                                            <i className="fa-solid fa-box"></i>
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-bold text-slate-800 truncate">{p.name}</div>
                                            <div className="text-[10px] font-black text-slate-400 uppercase truncate">{p.category || t('crm:products.noCategory')}</div>
                                            <div className="text-[10px] font-semibold text-slate-500 truncate">{p.supplierName || t('crm:products.noSupplier')}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-5">
                                    <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider ${p.type === 'service' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                        {p.type || t('crm:products.typeItem')}
                                    </span>
                                </td>
                                <td className="px-6 py-5 text-sm font-semibold text-slate-500">
                                    {Number(p.costo).toFixed(2)} / {p.costUnit}
                                </td>
                                <td className="px-6 py-5 text-sm font-semibold text-slate-500">
                                    {Number(p.molPercentage).toFixed(2)}%
                                </td>
                                <td className="px-6 py-5 text-sm font-semibold text-slate-700">
                                    {calcSalePrice(Number(p.costo), Number(p.molPercentage)).toFixed(2)} / {p.costUnit}
                                </td>
                                <td className="px-6 py-5 text-sm font-semibold text-emerald-600">
                                    {calcMargine(Number(p.costo), Number(p.molPercentage)).toFixed(2)}
                                </td>
                                <td className="px-6 py-5 text-sm font-bold text-praetor">
                                    {p.taxRate}%
                                </td>
                                <td className="px-8 py-5">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openEditModal(p);
                                            }}
                                            className="p-2 text-slate-400 hover:text-praetor hover:bg-slate-100 rounded-lg transition-all"
                                            title={t('crm:products.editProductTooltip')}
                                        >
                                            <i className="fa-solid fa-pen-to-square"></i>
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onUpdateProduct(p.id, { isDisabled: true });
                                            }}
                                            className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                                            title={t('crm:products.disableProduct')}
                                        >
                                            <i className="fa-solid fa-ban"></i>
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
                        {activeProducts.length === 0 && (
                            <tr>
                                <td colSpan={8} className="p-12 text-center">
                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                                        <i className="fa-solid fa-boxes-stacked text-2xl"></i>
                                    </div>
                                    <p className="text-slate-400 text-sm font-bold">{t('crm:products.noActiveProducts')}</p>
                                    <button onClick={openAddModal} className="mt-4 text-praetor text-sm font-black hover:underline">{t('crm:products.addFirstProduct')}</button>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </StandardTable>

            {hasAnyDisabledProducts && (
                <StandardTable
                    title={t('crm:products.disabledProducts')}
                    totalCount={filteredDisabledProductsTotal.length}
                    totalLabel={t('crm:products.disabled')}
                    containerClassName="border-dashed bg-slate-50"
                    footerClassName="flex flex-col sm:flex-row justify-between items-center gap-4"
                    footer={
                        <>
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-slate-500">{t('common:labels.rowsPerPage')}</span>
                                <CustomSelect
                                    options={[
                                        { id: '5', name: '5' },
                                        { id: '10', name: '10' },
                                        { id: '20', name: '20' },
                                        { id: '50', name: '50' }
                                    ]}
                                    value={disabledRowsPerPage.toString()}
                                    onChange={(val) => handleDisabledRowsPerPageChange(val)}
                                    className="w-20"
                                    buttonClassName="px-2 py-1 bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg"
                                    searchable={false}
                                />
                                <span className="text-xs font-bold text-slate-400 ml-2">
                                    {t('crm:products.showing')} {disabledProductsPage.length > 0 ? disabledStartIndex + 1 : 0}-{Math.min(disabledStartIndex + disabledRowsPerPage, filteredDisabledProductsTotal.length)} {t('crm:products.of')} {filteredDisabledProductsTotal.length}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setDisabledCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={disabledCurrentPage === 1}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                                >
                                    <i className="fa-solid fa-chevron-left text-xs"></i>
                                </button>
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: disabledTotalPages }, (_, i) => i + 1).map(page => (
                                        <button
                                            key={page}
                                            onClick={() => setDisabledCurrentPage(page)}
                                            className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${disabledCurrentPage === page
                                                ? 'bg-praetor text-white shadow-md shadow-slate-200'
                                                : 'text-slate-500 hover:bg-slate-100'
                                                }`}
                                        >
                                            {page}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setDisabledCurrentPage(prev => Math.min(disabledTotalPages, prev + 1))}
                                    disabled={disabledCurrentPage === disabledTotalPages || disabledTotalPages === 0}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                                >
                                    <i className="fa-solid fa-chevron-right text-xs"></i>
                                </button>
                            </div>
                        </>
                    }
                >
                    <div className="divide-y divide-slate-100">
                        {disabledProductsPage.map(p => (
                            <div key={p.id} onClick={() => openEditModal(p)} className="p-6 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 transition-all flex items-center justify-between gap-4 cursor-pointer">
                                <div className="flex gap-4 items-center">
                                    <div className="w-10 h-10 bg-slate-200 text-slate-400 rounded-xl flex items-center justify-center">
                                        <i className="fa-solid fa-box"></i>
                                    </div>
                                    <div>
                                        <h5 className="font-bold text-slate-500 line-through">{p.name}</h5>
                                        <span className="text-[10px] font-black text-amber-500 uppercase">{t('crm:products.disabled')}</span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onUpdateProduct(p.id, { isDisabled: false });
                                        }}
                                        className="p-2 text-praetor hover:bg-slate-100 rounded-lg transition-colors"
                                    >
                                        <i className="fa-solid fa-rotate-left"></i>
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            confirmDelete(p);
                                        }}
                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <i className="fa-solid fa-trash-can"></i>
                                    </button>
                                </div>
                            </div>
                        ))}
                        {disabledProductsPage.length === 0 && (
                            <div className="p-12 text-center">
                                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                                    <i className="fa-solid fa-ban text-2xl"></i>
                                </div>
                                <p className="text-slate-400 text-sm font-bold">{t('crm:products.noDisabledProducts')}</p>
                            </div>
                        )}
                    </div>
                </StandardTable>
            )}
        </div >
    );
};

export default ProductsView;