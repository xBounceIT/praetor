import { useTranslation } from 'react-i18next';
import type { DurationUnit } from '../../types';
import SelectControl from './SelectControl';

interface DurationUnitSelectorProps {
  value: DurationUnit;
  onChange: (value: DurationUnit) => void;
  // Displayed duration value, used only to pick the singular/plural label.
  count: number;
  disabled?: boolean;
  i18nPrefix?: string;
}

// Months/years/N-A selector. Storage remains in canonical months, but pricing uses the exact
// numeric value shown beside this selector. N/A disables the input and stays neutral (×1).
const DurationUnitSelector: React.FC<DurationUnitSelectorProps> = ({
  value,
  onChange,
  count,
  disabled = false,
  i18nPrefix = 'sales:clientQuotes',
}) => {
  const { t } = useTranslation();

  const unitOptions = [
    { id: 'months', name: t(`${i18nPrefix}.${count === 1 ? 'month' : 'months'}`) },
    { id: 'years', name: t(`${i18nPrefix}.${count === 1 ? 'year' : 'years'}`) },
    { id: 'na', name: t(`${i18nPrefix}.durationNa`, { defaultValue: 'N/A' }) },
  ];

  return (
    <SelectControl
      options={unitOptions}
      value={value}
      onChange={(val) => onChange(val as DurationUnit)}
      disabled={disabled}
      searchable={false}
      className="shrink-0"
      buttonClassName="p-2 bg-white border border-zinc-200 rounded-lg text-xs min-w-[4rem]"
    />
  );
};

export default DurationUnitSelector;
