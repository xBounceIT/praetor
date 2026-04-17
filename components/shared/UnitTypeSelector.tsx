import { useTranslation } from 'react-i18next';
import type { SupplierUnitType } from '../../types';
import CustomSelect from './CustomSelect';

interface UnitTypeSelectorProps {
  value: SupplierUnitType;
  onChange: (value: SupplierUnitType) => void;
  isSupply: boolean;
  quantity: number;
  disabled?: boolean;
  i18nPrefix?: string;
}

const UnitTypeSelector: React.FC<UnitTypeSelectorProps> = ({
  value,
  onChange,
  isSupply,
  quantity,
  disabled = false,
  i18nPrefix = 'sales:clientQuotes',
}) => {
  const { t } = useTranslation();

  if (isSupply) {
    return (
      <span className="text-xs font-semibold text-slate-400 shrink-0 whitespace-nowrap">
        {quantity === 1 ? t(`${i18nPrefix}.unit`) : t(`${i18nPrefix}.units`)}
      </span>
    );
  }

  const unitOptions = [
    { id: 'hours', name: t(`${i18nPrefix}.${quantity === 1 ? 'hour' : 'hours'}`) },
    { id: 'days', name: t(`${i18nPrefix}.${quantity === 1 ? 'day' : 'days'}`) },
    { id: 'unit', name: t(`${i18nPrefix}.${quantity === 1 ? 'unit' : 'units'}`) },
  ];

  return (
    <CustomSelect
      options={unitOptions}
      value={value}
      onChange={(val) => onChange(val as SupplierUnitType)}
      disabled={disabled}
      searchable={false}
      className="shrink-0"
      buttonClassName="px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs min-w-[4rem]"
    />
  );
};

export default UnitTypeSelector;
