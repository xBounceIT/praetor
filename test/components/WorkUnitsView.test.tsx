import { describe, expect, test } from 'bun:test';

const readSource = () =>
  Bun.file(new URL('../../components/WorkUnitsView.tsx', import.meta.url)).text();

describe('<WorkUnitsView /> submit guards', () => {
  test('handleCreate and handleUpdate use a single isSubmitting guard with try/finally', async () => {
    const source = await readSource();

    // State variable.
    expect(source).toContain('const [isSubmitting, setIsSubmitting] = useState(false);');
    // Guard at the top of each async submit handler.
    const guardOccurrences = source.match(/if \(isSubmitting\) return;/g) ?? [];
    expect(guardOccurrences.length).toBeGreaterThanOrEqual(2);
    // setIsSubmitting flips on before the await and off in finally.
    expect(source).toContain('setIsSubmitting(true);');
    expect(source).toContain('try {');
    expect(source).toContain('} finally {');
    expect(source).toContain('setIsSubmitting(false);');
    // The change preserves an awaited call to the parent handlers.
    expect(source).toMatch(/await onAddWorkUnit\(/);
    expect(source).toMatch(/await onUpdateWorkUnit\(/);
  });

  test('both submit buttons reflect the submitting state', async () => {
    const source = await readSource();

    // Create modal submit button now includes isSubmitting in its disabled prop.
    expect(source).toContain('disabled={selectedManagerIds.length === 0 || isSubmitting}');
    // Edit modal submit button is also gated on isSubmitting.
    expect(source).toContain('disabled={isSubmitting}');
  });
});
