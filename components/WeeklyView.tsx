
import React, { useState, useMemo, useEffect } from 'react';
import { Client, Project, ProjectTask, TimeEntry, UserRole, User } from '../types';
import CustomSelect from './CustomSelect';
import { isItalianHoliday } from '../utils/holidays';

interface WeeklyViewProps {
    entries: TimeEntry[];
    clients: Client[];
    projects: Project[];
    projectTasks: ProjectTask[];
    onAddBulkEntries: (entries: Omit<TimeEntry, 'id' | 'createdAt' | 'userId'>[]) => Promise<void>;
    onDeleteEntry: (id: string) => void;
    onUpdateEntry: (id: string, updates: Partial<TimeEntry>) => void;
    userRole: UserRole;
    currentUser: User;
    viewingUserId: string;
    availableUsers: User[];
    onViewUserChange: (id: string) => void;
    startOfWeek: 'Monday' | 'Sunday';
    treatSaturdayAsHoliday: boolean;
}

const toLocalISOString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const WeeklyView: React.FC<WeeklyViewProps> = ({
    entries, clients, projects, projectTasks, onAddBulkEntries, onDeleteEntry, onUpdateEntry,
    userRole, currentUser, viewingUserId, availableUsers, onViewUserChange,
    startOfWeek, treatSaturdayAsHoliday
}) => {
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
        const start = new Date(d.setDate(diff));
        start.setHours(0, 0, 0, 0);
        return start;
    });

    const weekDays = useMemo(() => {
        return [0, 1, 2, 3, 4, 5, 6].map(offset => {
            const d = new Date(currentWeekStart);
            d.setDate(d.getDate() + offset);
            const dateStr = toLocalISOString(d);
            const holidayName = isItalianHoliday(new Date(dateStr + 'T00:00:00'));
            const isSunday = d.getDay() === 0;
            const isSaturday = d.getDay() === 6;
            const isForbidden = isSunday || (treatSaturdayAsHoliday && isSaturday) || !!holidayName;

            return {
                dateStr,
                dayName: d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', ''),
                dayNum: d.getDate(),
                isToday: dateStr === toLocalISOString(new Date()),
                isForbidden,
                holidayName
            };
        });
    }, [currentWeekStart]);

    const [rows, setRows] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [activeDropdownRow, setActiveDropdownRow] = useState<number | null>(null);

    // Initialize rows from existing entries in this week
    useEffect(() => {
        const weekDates = weekDays.map(d => d.dateStr);
        const weekEntries = entries.filter(e => weekDates.includes(e.date));

        // Group by client/project/task
        const groups: { [key: string]: any } = {};
        weekEntries.forEach(e => {
            const key = `${e.clientId}-${e.projectId}-${e.task}`;
            if (!groups[key]) {
                groups[key] = {
                    clientId: e.clientId,
                    projectId: e.projectId,
                    taskName: e.task,
                    days: {
                        [e.date]: { duration: e.duration, note: e.notes || '', id: e.id }
                    },
                    weekNote: '' // We'll infer this or let user set it
                };
            } else {
                groups[key].days[e.date] = { duration: e.duration, note: e.notes || '', id: e.id };
            }
        });

        const initialRows = Object.values(groups);
        // Add one empty row for new entries
        if (initialRows.length === 0) {
            initialRows.push({
                clientId: clients[0]?.id || '',
                projectId: projects.find(p => p.clientId === (clients[0]?.id || ''))?.id || '',
                taskName: '',
                days: {},
                weekNote: ''
            });
        }
        setRows(initialRows);
    }, [entries, currentWeekStart, clients, projects, weekDays]);

    const handleWeekChange = (offset: number) => {
        const newStart = new Date(currentWeekStart);
        newStart.setDate(newStart.getDate() + offset * 7);
        setCurrentWeekStart(newStart);
    };

    const handleValueChange = (rowIndex: number, dateStr: string, field: 'duration' | 'note', value: string) => {
        const newRows = [...rows];
        if (!newRows[rowIndex].days[dateStr]) {
            newRows[rowIndex].days[dateStr] = { duration: 0, note: '' };
        }

        if (field === 'duration') {
            newRows[rowIndex].days[dateStr].duration = value === '' ? 0 : parseFloat(value);
        } else {
            newRows[rowIndex].days[dateStr].note = value;
        }
        setRows(newRows);
    };

    const handleRowInfoChange = (rowIndex: number, field: string, value: string) => {
        const newRows = [...rows];
        newRows[rowIndex][field] = value;

        // Auto-fill project if client changes
        if (field === 'clientId') {
            const firstProj = projects.find(p => p.clientId === value);
            newRows[rowIndex].projectId = firstProj?.id || '';
            const firstTask = projectTasks.find(t => t.projectId === firstProj?.id);
            newRows[rowIndex].taskName = firstTask?.name || '';
        }
        // Auto-fill task if project changes
        if (field === 'projectId') {
            const firstTask = projectTasks.find(t => t.projectId === value);
            newRows[rowIndex].taskName = firstTask?.name || '';
        }

        setRows(newRows);
    };

    const addRow = () => {
        setRows([...rows, {
            clientId: clients[0]?.id || '',
            projectId: projects.find(p => p.clientId === (clients[0]?.id || ''))?.id || '',
            taskName: '',
            days: {},
            weekNote: ''
        }]);
    };

    const handleSubmit = async () => {
        setIsLoading(true);
        const entriesToAdd: Omit<TimeEntry, 'id' | 'createdAt' | 'userId' | 'hourlyCost'>[] = [];

        rows.forEach(row => {
            const client = clients.find(c => c.id === row.clientId);
            const project = projects.find(p => p.id === row.projectId);

            Object.entries(row.days).forEach(([dateStr, data]: [string, any]) => {
                if (data.duration > 0) {
                    // If it has an ID, it's an update, but user request implies mirror Anuko which has a Submit for bulk.
                    // For simplicity, we'll only ADD new ones here or we'd need bit more complex logic.
                    // Anuko typically handles both. Let's focus on adding new entries as requested.
                    if (!data.id) {
                        entriesToAdd.push({
                            date: dateStr,
                            clientId: row.clientId,
                            clientName: client?.name || 'Unknown',
                            projectId: row.projectId,
                            projectName: project?.name || 'General',
                            task: row.taskName,
                            duration: data.duration,
                            notes: data.note || row.weekNote // Use individual note or fallback to week note
                        });
                    } else {
                        // Handle update if needed? User didn't explicitly ask for editing existing in weekly view,
                        // but it's part of a full mirror. Let's stick to the core request first.
                        onUpdateEntry(data.id, {
                            duration: data.duration,
                            notes: data.note || row.weekNote,
                            task: row.taskName,
                            projectId: row.projectId,
                            clientId: row.clientId,
                            clientName: client?.name || 'Unknown',
                            projectName: project?.name || 'General'
                        });
                    }
                }
            });
        });

        if (entriesToAdd.length > 0) {
            await onAddBulkEntries(entriesToAdd as any);
        }
        setIsLoading(false);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
    };

    const dayTotals = useMemo(() => {
        const totals: { [key: string]: number } = {};
        weekDays.forEach(d => {
            totals[d.dateStr] = rows.reduce((sum: number, row: any) => sum + (row.days[d.dateStr]?.duration || 0), 0) as number;
        });
        return totals;
    }, [rows, weekDays]);

    const weekTotal = (Object.values(dayTotals) as number[]).reduce((a: number, b: number) => a + b, 0);

    return (
        <div className="space-y-6">
            {/* Header and Controls */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-4">
                    <button onClick={() => handleWeekChange(-1)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                        <i className="fa-solid fa-chevron-left"></i>
                    </button>
                    <div className="text-center min-w-[200px]">
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                            {currentWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(new Date(currentWeekStart).setDate(currentWeekStart.getDate() + 4)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </h3>
                        <p className="text-[10px] font-bold text-indigo-500 uppercase">Week View</p>
                    </div>
                    <button onClick={() => handleWeekChange(1)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                        <i className="fa-solid fa-chevron-right"></i>
                    </button>
                    <button
                        onClick={() => {
                            const d = new Date();
                            const day = d.getDay();
                            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                            const start = new Date(d.setDate(diff));
                            start.setHours(0, 0, 0, 0);
                            setCurrentWeekStart(start);
                        }}
                        className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 uppercase tracking-widest ml-2"
                    >
                        Go to Today
                    </button>
                </div>

                {availableUsers.length > 1 && (
                    <div className="w-64">
                        <CustomSelect
                            options={availableUsers.map(u => ({ id: u.id, name: u.name }))}
                            value={viewingUserId}
                            onChange={onViewUserChange}
                            label="Viewing User"
                            searchable={true}
                        />
                    </div>
                )}
            </div>

            {/* Grid */}
            <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 ${activeDropdownRow !== null ? '' : 'overflow-hidden'}`}>
                <div className={`${activeDropdownRow !== null ? 'overflow-visible' : 'overflow-x-auto'}`}>
                    <table className="w-full text-left border-collapse min-w-[800px] isolate">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-tighter w-40">Client</th>
                                <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-tighter w-40">Project</th>
                                <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-tighter w-48">Task</th>
                                {weekDays.map(day => (
                                    <th key={day.dateStr} className={`px-2 py-4 text-center w-24 relative ${day.isToday ? 'bg-indigo-50/50' : ''} ${day.isForbidden ? 'bg-red-50/50' : ''}`}>
                                        <p className={`text-[10px] font-black uppercase ${day.isToday ? 'text-indigo-600' : day.isForbidden ? 'text-red-500' : 'text-slate-400'}`}>{day.dayName}</p>
                                        <p className={`text-lg font-black leading-none ${day.isToday ? 'text-indigo-600' : day.isForbidden ? 'text-red-600' : 'text-slate-700'}`}>{day.dayNum}</p>
                                        {day.holidayName && <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" title={day.holidayName}></div>}
                                    </th>
                                ))}
                                <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-tighter w-20 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map((row, rowIndex) => (
                                <tr
                                    key={rowIndex}
                                    className="group hover:bg-slate-50/30 transition-all duration-500"
                                    style={{ zIndex: activeDropdownRow === rowIndex ? 50 : 0, position: 'relative' }}
                                >
                                    <td className="px-4 py-4">
                                        <div className="flex flex-col gap-2">
                                            <CustomSelect
                                                options={clients.map(c => ({ id: c.id, name: c.name }))}
                                                value={row.clientId}
                                                onChange={(val) => handleRowInfoChange(rowIndex, 'clientId', val)}
                                                className="!bg-transparent"
                                                onOpen={() => setActiveDropdownRow(rowIndex)}
                                                onClose={() => setActiveDropdownRow(null)}
                                                searchable={true}
                                            />
                                            <div className="h-7 invisible">Spacer</div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex flex-col gap-2">
                                            <CustomSelect
                                                options={projects.filter(p => p.clientId === row.clientId).map(p => ({ id: p.id, name: p.name }))}
                                                value={row.projectId}
                                                onChange={(val) => handleRowInfoChange(rowIndex, 'projectId', val)}
                                                className="!bg-transparent"
                                                placeholder="Select project..."
                                                onOpen={() => setActiveDropdownRow(rowIndex)}
                                                onClose={() => setActiveDropdownRow(null)}
                                                searchable={true}
                                            />
                                            <div className="h-7 invisible">Spacer</div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex flex-col gap-2">
                                            <CustomSelect
                                                options={projectTasks.filter(t => t.projectId === row.projectId).map(t => ({ id: t.name, name: t.name }))}
                                                value={row.taskName}
                                                onChange={(val) => handleRowInfoChange(rowIndex, 'taskName', val)}
                                                className="!bg-transparent"
                                                placeholder="Select task..."
                                                onOpen={() => setActiveDropdownRow(rowIndex)}
                                                onClose={() => setActiveDropdownRow(null)}
                                                searchable={true}
                                            />
                                            <input
                                                type="text"
                                                placeholder="Week note..."
                                                value={row.weekNote}
                                                onChange={(e) => handleRowInfoChange(rowIndex, 'weekNote', e.target.value)}
                                                className="w-full text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-600 h-7"
                                            />
                                        </div>
                                    </td>
                                    {weekDays.map(day => (
                                        <td key={day.dateStr} className={`px-2 py-4 transition-all duration-700 ${day.isToday ? 'bg-indigo-50/10' : ''} ${day.isForbidden ? 'bg-red-50/30' : ''} ${showSuccess && (row.days[day.dateStr]?.duration > 0) ? 'bg-emerald-50' : ''}`}>
                                            <div className="flex flex-col gap-2 items-center relative">
                                                {showSuccess && (row.days[day.dateStr]?.duration > 0) && (
                                                    <i className="fa-solid fa-circle-check text-emerald-500 text-[10px] absolute -top-2 -right-1 animate-in fade-in zoom-in duration-300"></i>
                                                )}
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    min="0"
                                                    placeholder="0.0"
                                                    disabled={day.isForbidden}
                                                    value={row.days[day.dateStr]?.duration || ''}
                                                    onChange={(e) => handleValueChange(rowIndex, day.dateStr, 'duration', e.target.value)}
                                                    className={`w-16 text-center text-sm font-black transition-all duration-300 ${showSuccess && (row.days[day.dateStr]?.duration > 0) ? 'text-emerald-700 border-emerald-200 bg-white scale-105 shadow-sm' : 'text-slate-700 bg-slate-50 border-slate-200'} ${day.isForbidden ? 'opacity-50 cursor-not-allowed bg-red-50/50 border-red-100' : 'border-slate-200'} border rounded-lg py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none`}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Note..."
                                                    disabled={day.isForbidden}
                                                    value={row.days[day.dateStr]?.note || ''}
                                                    onChange={(e) => handleValueChange(rowIndex, day.dateStr, 'note', e.target.value)}
                                                    className={`w-16 text-xs bg-slate-50 border border-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded px-2 py-1.5 transition-colors h-7 ${showSuccess && (row.days[day.dateStr]?.duration > 0) ? 'text-emerald-600' : 'text-slate-500 focus:text-slate-700'} ${day.isForbidden ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                />
                                            </div>
                                        </td>
                                    ))}
                                    <td className="px-4 py-3 text-right">
                                        <span className="text-sm font-black text-slate-800">
                                            {(Object.values(row.days).reduce((sum: number, d: any) => sum + (d.duration || 0), 0) as number).toFixed(1)}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-slate-50/50 border-t border-slate-200">
                            <tr>
                                <td colSpan={3} className="px-4 py-4">
                                    <button
                                        onClick={addRow}
                                        className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-2 uppercase tracking-widest"
                                    >
                                        <i className="fa-solid fa-plus"></i> Add Row
                                    </button>
                                </td>
                                {weekDays.map(day => (
                                    <td key={day.dateStr} className={`px-2 py-4 text-center ${day.isToday ? 'bg-indigo-50/30' : ''} ${day.isForbidden ? 'bg-red-50/50' : ''}`}>
                                        <p className={`text-xs font-black ${(dayTotals[day.dateStr] as number) > 8 ? 'text-red-600' : 'text-indigo-600'}`}>
                                            {(dayTotals[day.dateStr] as number).toFixed(1)}
                                        </p>
                                    </td>
                                ))}
                                <td className="px-4 py-4 text-right">
                                    <p className="text-sm font-black text-slate-900">{(weekTotal as number).toFixed(1)}</p>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* Footer Actions */}
            <div className="flex justify-end gap-4 p-4">
                <button
                    onClick={handleSubmit}
                    disabled={isLoading}
                    className={`bg-indigo-600 text-white px-10 py-3 rounded-xl hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-500/20 font-bold text-sm flex items-center gap-3 disabled:opacity-50 ${showSuccess ? 'bg-emerald-600 hover:bg-emerald-600 shadow-emerald-500/20' : ''}`}
                >
                    {isLoading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : (showSuccess ? <i className="fa-solid fa-check"></i> : <i className="fa-solid fa-cloud-arrow-up"></i>)}
                    {showSuccess ? 'Success!' : 'Submit Time'}
                </button>
            </div>
        </div>
    );
};

export default WeeklyView;
