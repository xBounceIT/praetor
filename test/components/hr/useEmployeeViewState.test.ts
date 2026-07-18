import { describe, expect, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useEmployeeViewState } from '../../../components/HR/useEmployeeViewState';
import type { HourlyCostPeriod, User } from '../../../types';

const buildEmployee = (id: string, costPerHour: number): User => ({
  id,
  name: `Employee ${id}`,
  role: 'user',
  avatarInitials: id.toUpperCase(),
  username: id,
  costPerHour,
});

const loadedPeriods: HourlyCostPeriod[] = [
  {
    id: 10,
    effectiveFrom: null,
    effectiveTo: '2024-12-31',
    costPerHour: 40,
  },
  {
    id: 11,
    effectiveFrom: '2025-01-01',
    effectiveTo: null,
    costPerHour: 55,
  },
];

describe('useEmployeeViewState hourly cost loading', () => {
  test('ignores a stale response after another employee is opened', () => {
    const firstEmployee = buildEmployee('first', 10);
    const secondEmployee = buildEmployee('second', 20);
    const { result } = renderHook(() => useEmployeeViewState());

    act(() => {
      result.current.openEditEmployeeModal(firstEmployee);
      result.current.startHourlyCostPeriodsLoad(firstEmployee.id);
    });
    act(() => {
      result.current.openEditEmployeeModal(secondEmployee);
      result.current.startHourlyCostPeriodsLoad(secondEmployee.id);
    });
    act(() => {
      result.current.completeHourlyCostPeriodsLoad(firstEmployee.id, loadedPeriods);
    });

    expect(result.current.state.editingEmployee?.id).toBe(secondEmployee.id);
    expect(result.current.state.isHourlyCostPeriodsLoading).toBe(true);
    expect(result.current.state.hourlyCostPeriods[0]?.costPerHour).toBe('20');

    act(() => {
      result.current.completeHourlyCostPeriodsLoad(secondEmployee.id, loadedPeriods);
    });

    expect(result.current.state.isHourlyCostPeriodsLoading).toBe(false);
    expect(result.current.state.hourlyCostPeriods.map((period) => period.costPerHour)).toEqual([
      '40',
      '55',
    ]);
  });

  test('ignores a late failure after the modal is closed', () => {
    const employee = buildEmployee('employee', 30);
    const { result } = renderHook(() => useEmployeeViewState());

    act(() => {
      result.current.openEditEmployeeModal(employee);
      result.current.startHourlyCostPeriodsLoad(employee.id);
    });
    act(() => {
      result.current.closeEmployeeModal();
      result.current.failHourlyCostPeriodsLoad(employee.id, 'late failure');
    });

    expect(result.current.state.isModalOpen).toBe(false);
    expect(result.current.state.isHourlyCostPeriodsLoading).toBe(false);
    expect(result.current.state.hourlyCostPeriodsLoadError).toBeNull();
  });
});
