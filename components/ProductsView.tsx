import React, { useState } from 'react';
import { Product } from '../types';
import CustomSelect, { Option } from './CustomSelect';

interface ProductsViewProps {
    products: Product[];
    onAddProduct: (productData: Partial<Product>) => void;
    onUpdateProduct: (id: string, updates: Partial<Product>) => void;
    onDeleteProduct: (id: string) => void;
}

const ProductsView: React.FC<ProductsViewProps> = ({ products, onAddProduct, onUpdateProduct, onDeleteProduct }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [productToDelete, setProductToDelete] = useState<Product | null>(null);

    // Category Management State
    const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [customCategories, setCustomCategories] = useState<string[]>([]);

    // Form State
    const [formData, setFormData] = useState<Partial<Product>>({
        name: '',
        salePrice: 0,
        saleUnit: 'unit',
        cost: 0,
        costUnit: 'unit',
        category: '',
        taxRate: 0,
        type: 'item'
    });

    const openAddModal = () => {
        setEditingProduct(null);
        setFormData({
            name: '',
            salePrice: 0,
            saleUnit: 'unit',
            cost: 0,
            costUnit: 'unit',
            category: '',
            taxRate: 0,
            type: 'item'
        });
        setIsModalOpen(true);
    };

    const openEditModal = (product: Product) => {
        setEditingProduct(product);
        setFormData({
            name: product.name || '',
            salePrice: product.salePrice || 0,
            saleUnit: product.saleUnit || 'unit',
            cost: product.cost || 0,
            costUnit: product.costUnit || 'unit',
            category: product.category || '',
            taxRate: product.taxRate || 0,
            type: product.type || 'item'
        });
        setIsModalOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.name?.trim()) {
            if (editingProduct) {
                onUpdateProduct(editingProduct.id, formData);
            } else {
                onAddProduct(formData);
            }
            setIsModalOpen(false);
        }
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

    const activeProducts = products.filter(p => !p.isDisabled);
    const disabledProducts = products.filter(p => p.isDisabled);

    // Get unique categories from existing products + custom ones
    const existingCategories = Array.from(new Set(products.map(p => p.category).filter((c): c is string => !!c)));
    const allCategories = Array.from(new Set([...existingCategories, ...customCategories])).sort();

    const categoryOptions: Option[] = allCategories.map(c => ({ id: c, name: c }));

    const unitOptions: Option[] = [
        { id: 'unit', name: 'Unit' },
        { id: 'hours', name: 'Hours' }
    ];

    const typeOptions: Option[] = [
        { id: 'item', name: 'Item' },
        { id: 'service', name: 'Service' }
    ];

    const handleTypeChange = (val: string) => {
        const type = val as 'item' | 'service';
        const unit = type === 'item' ? 'unit' : 'hours';
        setFormData({
            ...formData,
            type,
            saleUnit: unit,
            costUnit: unit
        });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Add Category Modal */}
            {isAddCategoryModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="text-lg font-black text-slate-800 flex items-center gap-3">
                                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                                    <i className="fa-solid fa-plus"></i>
                                </div>
                                Add Category
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
                                <label className="text-xs font-bold text-slate-500 ml-1">Category Name</label>
                                <input
                                    type="text"
                                    autoFocus
                                    value={newCategoryName}
                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                                    placeholder="e.g. Software Licenses"
                                    className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                            </div>
                            <div className="flex justify-between gap-3">
                                <button
                                    onClick={() => setIsAddCategoryModalOpen(false)}
                                    className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddCategory}
                                    className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95"
                                >
                                    Add Category
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
                                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                                    <i className={`fa-solid ${editingProduct ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                                </div>
                                {editingProduct ? 'Edit Product' : 'Add New Product'}
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
                                <h4 className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                    Product Details
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="col-span-full space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Product Name</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="e.g. Consulting Services"
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center ml-1 min-h-[16px]">
                                            <label className="text-xs font-bold text-slate-500">Category</label>
                                            <button
                                                type="button"
                                                onClick={() => setIsAddCategoryModalOpen(true)}
                                                className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-tighter flex items-center gap-1"
                                            >
                                                <i className="fa-solid fa-plus"></i> Add Category
                                            </button>
                                        </div>
                                        <CustomSelect
                                            options={categoryOptions}
                                            value={formData.category || ''}
                                            onChange={(val) => setFormData({ ...formData, category: val })}
                                            placeholder="Select category"
                                            searchable={true}
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center ml-1 min-h-[16px]">
                                            <label className="text-xs font-bold text-slate-500">Tax Rate (%)</label>
                                        </div>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.taxRate}
                                            onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) })}
                                            className="w-full text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center ml-1 min-h-[16px]">
                                            <label className="text-xs font-bold text-slate-500">Type</label>
                                        </div>
                                        <CustomSelect
                                            options={typeOptions}
                                            value={formData.type || 'item'}
                                            onChange={handleTypeChange}
                                            searchable={false}
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center ml-1 min-h-[16px]">
                                            <label className="text-xs font-bold text-slate-500 font-black">Unit of Measure</label>
                                        </div>
                                        <div className="w-full text-sm px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 font-bold flex items-center gap-2">
                                            <i className={`fa-solid ${formData.type === 'service' ? 'fa-clock' : 'fa-box-open'}`}></i>
                                            {formData.type === 'service' ? 'Hours' : 'Unit'}
                                        </div>
                                        <p className="text-[10px] text-slate-400 ml-1">Automatically set based on Type</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                    Pricing and Unit
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Sale Price</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={formData.salePrice}
                                                onChange={(e) => setFormData({ ...formData, salePrice: parseFloat(e.target.value) })}
                                                className="flex-1 text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-w-0"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 ml-1">Cost</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={formData.cost}
                                                onChange={(e) => setFormData({ ...formData, cost: parseFloat(e.target.value) })}
                                                className="flex-1 text-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-w-0"
                                            />
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
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-12 py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95"
                                >
                                    {editingProduct ? 'Update Product' : 'Save Product'}
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
                                    <h3 className="text-lg font-black text-slate-800">Delete Product?</h3>
                                    <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                                        Are you sure you want to delete <span className="font-bold text-slate-800">{productToDelete?.name}</span>?
                                        This action cannot be undone.
                                    </p>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setIsDeleteConfirmOpen(false)}
                                        className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleDelete}
                                        className="flex-1 py-3 bg-red-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                                    >
                                        Yes, Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">Products</h2>
                    <p className="text-slate-500 text-sm">Manage products and services for billing</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black shadow-xl shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-95 flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus"></i> Add New Product
                </button>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-8 py-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">Active Products</h4>
                    <span className="bg-indigo-100 text-indigo-600 px-3 py-1 rounded-full text-[10px] font-black">{activeProducts.length} TOTAL</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Name / Category</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Sale Price</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Cost</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Tax Rate</th>
                                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {activeProducts.map(p => (
                                <tr key={p.id} onClick={() => openEditModal(p)} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                                    <td className="px-8 py-5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center text-sm">
                                                <i className="fa-solid fa-box"></i>
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-800">{p.name}</div>
                                                <div className="text-[10px] font-black text-slate-400 uppercase">{p.category || 'No Category'}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-8 py-5">
                                        <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider ${p.type === 'service' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                            {p.type || 'item'}
                                        </span>
                                    </td>
                                    <td className="px-8 py-5 text-sm font-semibold text-slate-700">
                                        {p.salePrice.toFixed(2)} / {p.saleUnit}
                                    </td>
                                    <td className="px-8 py-5 text-sm font-semibold text-slate-500">
                                        {p.cost.toFixed(2)} / {p.costUnit}
                                    </td>
                                    <td className="px-8 py-5 text-sm font-bold text-indigo-600">
                                        {p.taxRate}%
                                    </td>
                                    <td className="px-8 py-5">
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openEditModal(p);
                                                }}
                                                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                                title="Edit Product"
                                            >
                                                <i className="fa-solid fa-pen-to-square"></i>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onUpdateProduct(p.id, { isDisabled: true });
                                                }}
                                                className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                                                title="Disable Product"
                                            >
                                                <i className="fa-solid fa-ban"></i>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    confirmDelete(p);
                                                }}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                title="Delete Product"
                                            >
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {activeProducts.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-12 text-center">
                                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300 mb-4">
                                            <i className="fa-solid fa-boxes-stacked text-2xl"></i>
                                        </div>
                                        <p className="text-slate-400 text-sm font-bold">No active products found.</p>
                                        <button onClick={openAddModal} className="mt-4 text-indigo-600 text-sm font-black hover:underline">Add your first product</button>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {
                disabledProducts.length > 0 && (
                    <div className="bg-slate-50 rounded-3xl border border-slate-200 shadow-sm overflow-hidden border-dashed">
                        <div className="px-8 py-4 bg-slate-100/50 border-b border-slate-200 flex justify-between items-center">
                            <h4 className="font-black text-slate-400 uppercase text-[10px] tracking-widest">Disabled Products</h4>
                            <span className="bg-slate-200 text-slate-500 px-3 py-1 rounded-full text-[10px] font-black">{disabledProducts.length} DISABLED</span>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {disabledProducts.map(p => (
                                <div key={p.id} onClick={() => openEditModal(p)} className="p-6 opacity-60 grayscale hover:grayscale-0 hover:opacity-100 transition-all flex items-center justify-between gap-4 cursor-pointer">
                                    <div className="flex gap-4 items-center">
                                        <div className="w-10 h-10 bg-slate-200 text-slate-400 rounded-xl flex items-center justify-center">
                                            <i className="fa-solid fa-box"></i>
                                        </div>
                                        <div>
                                            <h5 className="font-bold text-slate-500 line-through">{p.name}</h5>
                                            <span className="text-[10px] font-black text-amber-500 uppercase">Disabled</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onUpdateProduct(p.id, { isDisabled: false });
                                            }}
                                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
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
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default ProductsView;
