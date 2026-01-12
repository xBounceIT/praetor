import React, { useState } from 'react';
import CustomSelect from './CustomSelect';

interface CustomRepeatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (pattern: string) => void;
}

const CustomRepeatModal: React.FC<CustomRepeatModalProps> = ({ isOpen, onClose, onSave }) => {
    const [type, setType] = useState<'first' | 'second' | 'third' | 'fourth' | 'last'>('first');
    const [dayOfWeek, setDayOfWeek] = useState<number>(1); // 1 = Monday, 7 = Sunday (standard JS getDay is 0=Sun, but usually we map 1-7 for UI)

    if (!isOpen) return null;

    const days = [
        { id: '1', name: 'Monday' },
        { id: '2', name: 'Tuesday' },
        { id: '3', name: 'Wednesday' },
        { id: '4', name: 'Thursday' },
        { id: '5', name: 'Friday' },
        { id: '6', name: 'Saturday' },
        { id: '0', name: 'Sunday' },
    ];

    const handleSave = () => {
        // pattern format: monthly:first:1 (First Monday), monthly:last:0 (Last Sunday)
        onSave(`monthly:${type}:${dayOfWeek}`);
        onClose();
    };

    const occurrenceOptions = [
        { id: 'first', name: 'First' },
        { id: 'second', name: 'Second' },
        { id: 'third', name: 'Third' },
        { id: 'fourth', name: 'Fourth' },
        { id: 'last', name: 'Last' },
    ];

    return (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-calendar-days text-indigo-500"></i>
                        Custom Repeat
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Configure complex recurrence patterns</p>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Every</span>
                        <div className="flex-1">
                            <CustomSelect
                                options={occurrenceOptions}
                                value={type}
                                onChange={(val) => setType(val as any)}
                                className="w-full"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <CustomSelect
                            label="Day of Week"
                            options={days}
                            value={dayOfWeek.toString()}
                            onChange={(val) => setDayOfWeek(parseInt(val))}
                            className="w-full"
                        />
                    </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
                    >
                        Set Pattern
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CustomRepeatModal;
