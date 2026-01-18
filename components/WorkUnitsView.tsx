import React, { useState, useMemo } from 'react';
import { User, WorkUnit } from '../types';
import CustomSelect from './CustomSelect'; // Ensure CustomSelect is compatible or use local logic
import { workUnitsApi } from '../services/api';

interface WorkUnitsViewProps {
    workUnits: WorkUnit[];
    users: User[];
    userRole: string; // Added userRole
    onAddWorkUnit: (data: any) => Promise<void>;
    onUpdateWorkUnit: (id: string, updates: any) => Promise<void>;
    onDeleteWorkUnit: (id: string) => Promise<void>;
    refreshWorkUnits: () => Promise<void>;
}

const WorkUnitsView: React.FC<WorkUnitsViewProps> = ({ workUnits, users, userRole, onAddWorkUnit, onUpdateWorkUnit, onDeleteWorkUnit, refreshWorkUnits }) => {
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

    const [editingUnit, setEditingUnit] = useState<WorkUnit | null>(null);
    const [targetUnit, setTargetUnit] = useState<WorkUnit | null>(null);

    // Form states
    const [name, setName] = useState('');
    const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
    const [description, setDescription] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Assignment state
    const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
    const [assignmentSearch, setAssignmentSearch] = useState('');
    const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

    const openCreateModal = () => {
        setName('');
        setSelectedManagerIds([]);
        setDescription('');
        setErrors({});
        setIsCreateModalOpen(true);
    };

    const openEditModal = (unit: WorkUnit) => {
        setEditingUnit(unit);
        setName(unit.name);
        // Map existing managers to IDs
        setSelectedManagerIds(unit.managers ? unit.managers.map(m => m.id) : []);
        setDescription(unit.description || '');
        setErrors({});
        setIsEditModalOpen(true);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrors({});

        const newErrors: Record<string, string> = {};
        if (!name?.trim()) newErrors.name = 'Unit name is required';
        if (selectedManagerIds.length === 0) newErrors.managers = 'At least one manager is required';

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        await onAddWorkUnit({ name, managerIds: selectedManagerIds, description });
        setIsCreateModalOpen(false);
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrors({});

        const newErrors: Record<string, string> = {};
        if (!name?.trim()) newErrors.name = 'Unit name is required';

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        if (editingUnit && name) {
            await onUpdateWorkUnit(editingUnit.id, { name, managerIds: selectedManagerIds, description });
            setIsEditModalOpen(false);
            setEditingUnit(null);
        }
    };

    const confirmDelete = (unit: WorkUnit) => {
        setTargetUnit(unit);
        setIsDeleteConfirmOpen(true);
    };

    const handleDelete = async () => {
        if (targetUnit) {
            await onDeleteWorkUnit(targetUnit.id);
            setIsDeleteConfirmOpen(false);
            setTargetUnit(null);
        }
    };

    const openAssignments = async (unit: WorkUnit) => {
        setTargetUnit(unit);
        setIsAssignmentModalOpen(true);
        setIsLoadingAssignments(true);
        try {
            const userIds = await workUnitsApi.getUsers(unit.id);
            setAssignedUserIds(userIds);
        } catch (err) {
            console.error("Failed to load unit users", err);
        } finally {
            setIsLoadingAssignments(false);
        }
    };

    const saveAssignments = async () => {
        if (!targetUnit) return;
        try {
            await workUnitsApi.updateUsers(targetUnit.id, assignedUserIds);
            await refreshWorkUnits(); // Update counts
            setIsAssignmentModalOpen(false);
            setTargetUnit(null);
        } catch (err) {
            console.error("Failed to save assignments", err);
            alert("Failed to save assignments");
        }
    };

    const toggleUserAssignment = (userId: string) => {
        setAssignedUserIds(prev =>
            prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
        );
    };

    const toggleManagerSelection = (userId: string) => {
        setSelectedManagerIds(prev =>
            prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
        );
    };

    const filteredUsersForAssignment = useMemo(() => {
        if (!assignmentSearch) return users;
        return users.filter(u =>
            u.name.toLowerCase().includes(assignmentSearch.toLowerCase()) ||
            u.username.toLowerCase().includes(assignmentSearch.toLowerCase())
        );
    }, [users, assignmentSearch]);

    const managerOptions = users
        .filter(u => u.role === 'manager')
        .map(u => ({ id: u.id, name: u.name }));

    return (
        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Work Units</h2>
                    <p className="text-slate-500 font-medium">Manage implementation teams and their managers</p>
                </div>
                {userRole === 'admin' && (
                    <button
                        onClick={openCreateModal}
                        className="px-6 py-3 bg-praetor text-white font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <i className="fa-solid fa-plus"></i> New Work Unit
                    </button>
                )}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {workUnits.map(unit => (
                    <div key={unit.id} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
                        <div className="flex justify-between items-start mb-4">
                            <div className="w-12 h-12 rounded-xl bg-slate-100 text-praetor flex items-center justify-center text-xl">
                                <i className="fa-solid fa-sitemap"></i>
                            </div>
                            {userRole === 'admin' && (
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => openEditModal(unit)}
                                        className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 hover:text-praetor hover:bg-slate-100 flex items-center justify-center transition-colors"
                                        title="Edit"
                                    >
                                        <i className="fa-solid fa-pen"></i>
                                    </button>
                                    <button
                                        onClick={() => confirmDelete(unit)}
                                        className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                                        title="Delete"
                                    >
                                        <i className="fa-solid fa-trash-can"></i>
                                    </button>
                                </div>
                            )}
                        </div>

                        <h3 className="text-lg font-bold text-slate-800 mb-1">{unit.name}</h3>
                        {unit.description && <p className="text-sm text-slate-500 mb-4 line-clamp-2">{unit.description}</p>}

                        <div className="space-y-3 pt-4 border-t border-slate-100">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-bold shrink-0">
                                    <i className="fa-solid fa-user-tie"></i>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Managers</p>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {unit.managers && unit.managers.length > 0 ? (
                                            unit.managers.map(m => (
                                                <span key={m.id} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-praetor">
                                                    {m.name}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-sm text-slate-400 italic">No managers assigned</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-bold">
                                        <i className="fa-solid fa-users"></i>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Members</p>
                                        <p className="text-sm font-bold text-slate-700">{unit.userCount || 0} users</p>
                                    </div>
                                </div>
                                {userRole === 'admin' && (
                                    <button
                                        onClick={() => openAssignments(unit)}
                                        className="text-xs font-bold text-praetor hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        Manage Members
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                {workUnits.length === 0 && (
                    <div className="col-span-full py-20 bg-white rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center px-6">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 text-2xl mb-4">
                            <i className="fa-solid fa-sitemap"></i>
                        </div>
                        {userRole === 'admin' ? (
                            <>
                                <h3 className="text-lg font-bold text-slate-800">No work units created yet</h3>
                                <p className="text-slate-500 max-w-sm mt-1">Use the "New Work Unit" button above to start organizing your teams.</p>
                            </>
                        ) : (
                            <>
                                <h3 className="text-lg font-bold text-slate-800">No work units assigned</h3>
                                <p className="text-slate-500 max-w-md mt-1">You are not assigned to any work units. Please contact an administrator for assistance.</p>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                            <h3 className="text-lg font-bold text-slate-800">New Work Unit</h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>
                        <form onSubmit={handleCreate} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Unit Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        if (errors.name) setErrors({ ...errors, name: '' });
                                    }}
                                    className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-semibold text-slate-700 ${errors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                                    required
                                />
                                {errors.name && <p className="text-red-500 text-[10px] font-bold mt-1">{errors.name}</p>}
                            </div>
                            <div>
                                <CustomSelect
                                    label="Managers"
                                    options={managerOptions}
                                    value={selectedManagerIds}
                                    onChange={(val) => {
                                        setSelectedManagerIds(val as string[]);
                                        if (errors.managers) setErrors({ ...errors, managers: '' });
                                    }}
                                    isMulti={true}
                                    searchable={true}
                                    placeholder="Select managers..."
                                    className={errors.managers ? 'border-red-300' : ''}
                                />
                                {errors.managers && <p className="text-red-500 text-[10px] font-bold mt-1 ml-1">{errors.managers}</p>}
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none font-medium text-slate-600 min-h-[100px]"
                                />
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setIsCreateModalOpen(false)}
                                    className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={selectedManagerIds.length === 0}
                                    className="flex-1 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                                >
                                    Create Unit
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {isEditModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                            <h3 className="text-lg font-bold text-slate-800">Edit Work Unit</h3>
                            <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>
                        <form onSubmit={handleUpdate} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Unit Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        if (errors.name) setErrors({ ...errors, name: '' });
                                    }}
                                    className={`w-full px-4 py-2 bg-slate-50 border rounded-lg focus:ring-2 outline-none font-semibold text-slate-700 ${errors.name ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-slate-200 focus:ring-praetor'}`}
                                    required
                                />
                                {errors.name && <p className="text-red-500 text-[10px] font-bold mt-1">{errors.name}</p>}
                            </div>
                            <div>
                                <CustomSelect
                                    label="Managers"
                                    options={managerOptions}
                                    value={selectedManagerIds}
                                    onChange={(val) => {
                                        setSelectedManagerIds(val as string[]);
                                        if (errors.managers) setErrors({ ...errors, managers: '' });
                                    }}
                                    isMulti={true}
                                    searchable={true}
                                    placeholder="Select managers..."
                                    className={errors.managers ? 'border-red-300' : ''}
                                />
                                {errors.managers && <p className="text-red-500 text-[10px] font-bold mt-1 ml-1">{errors.managers}</p>}
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-praetor outline-none font-medium text-slate-600 min-h-[100px]"
                                />
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setIsEditModalOpen(false)}
                                    className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Assignment Modal */}
            {isAssignmentModalOpen && targetUnit && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in duration-200">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Manage Members</h3>
                                <p className="text-sm text-slate-500 font-medium">Add or remove users from <span className="text-praetor">{targetUnit.name}</span></p>
                            </div>
                            <button onClick={() => setIsAssignmentModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>

                        <div className="p-4 border-b border-slate-100 shrink-0">
                            <input
                                type="text"
                                placeholder="Search users..."
                                value={assignmentSearch}
                                onChange={(e) => setAssignmentSearch(e.target.value)}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-praetor outline-none"
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto p-4">
                            {isLoadingAssignments ? (
                                <div className="flex justify-center py-12">
                                    <i className="fa-solid fa-circle-notch fa-spin text-3xl text-praetor"></i>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {filteredUsersForAssignment.map(user => (
                                        <label
                                            key={user.id}
                                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${assignedUserIds.includes(user.id)
                                                ? 'bg-slate-50 border-slate-300 shadow-sm'
                                                : 'bg-white border-slate-200 hover:border-slate-300'
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={assignedUserIds.includes(user.id)}
                                                onChange={() => toggleUserAssignment(user.id)}
                                                className="w-5 h-5 text-praetor rounded focus:ring-praetor border-gray-300"
                                            />
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-slate-100 text-praetor flex items-center justify-center text-xs font-bold">
                                                    {user.avatarInitials}
                                                </div>
                                                <div>
                                                    <p className={`text-sm font-bold ${assignedUserIds.includes(user.id) ? 'text-praetor' : 'text-slate-700'}`}>{user.name}</p>
                                                    <p className="text-xs text-slate-500">{user.role}</p>
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                    {filteredUsersForAssignment.length === 0 && (
                                        <p className="col-span-full text-center text-slate-400 py-8">No users found matching your search.</p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 shrink-0">
                            <button
                                onClick={() => setIsAssignmentModalOpen(false)}
                                className="px-6 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveAssignments}
                                disabled={isLoadingAssignments}
                                className="px-8 py-2.5 bg-praetor text-white text-sm font-bold rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50"
                            >
                                Save Assignments
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirm Modal */}
            {isDeleteConfirmOpen && targetUnit && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
                        <div className="p-6 text-center space-y-4">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                                <i className="fa-solid fa-triangle-exclamation text-red-600 text-xl"></i>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-slate-800">Delete Work Unit?</h3>
                                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                                    Are you sure you want to delete <span className="font-bold text-slate-800">{targetUnit.name}</span>?
                                    This action cannot be undone. User assignments will be removed.
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
            )}
        </div>
    );
};

export default WorkUnitsView;
