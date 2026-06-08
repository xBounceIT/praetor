import { describe, expect, test } from 'bun:test';

const readSource = () =>
  Bun.file(new URL('../../../components/projects/TaskFormModal.tsx', import.meta.url)).text();

// Issue #785: the billing frequency selector used to be usable only for "Canone" (retainer)
// tasks - "A misura" (time_and_materials) tasks had it filtered to monthly and disabled.
// Both billing types must now offer the same frequencies (monthly / one-time).
describe('TaskFormModal billing frequency (issue #785)', () => {
  test('the frequency selector offers every frequency regardless of billing type', async () => {
    const source = await readSource();
    expect(source).toContain('id="task-billing-frequency"');
    expect(source).toContain('options={translatedBillingFrequencyOptions}');
    // No "only monthly" filtering for time_and_materials anymore.
    expect(source).not.toContain("option.id === 'monthly'");
  });

  test('the frequency selector is never disabled based on the billing type', async () => {
    const source = await readSource();
    expect(source).not.toMatch(/disabled=\{billingType === 'time_and_materials'\}/);
    // Switching billing type must not force the frequency back to monthly.
    expect(source).not.toMatch(/=== 'time_and_materials' \? 'monthly'/);
  });
});
