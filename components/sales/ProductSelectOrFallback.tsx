import SelectControl, { type Option } from '../shared/SelectControl';

interface ProductSelectOrFallbackItem {
  productId?: string | null;
  productName?: string | null;
  supplierQuoteItemId?: string | null;
}

interface ProductSelectOrFallbackProps<TItem extends ProductSelectOrFallbackItem> {
  item: TItem;
  index: number;
  options: Option[];
  isProductMissing: boolean;
  isReadOnly: boolean;
  ariaLabel: string;
  placeholder: string;
  className?: string;
  buttonClassName?: string;
  onProductChange: (index: number, productId: string) => void;
}

const ProductSelectOrFallback = <TItem extends ProductSelectOrFallbackItem>({
  item,
  index,
  options,
  isProductMissing,
  isReadOnly,
  ariaLabel,
  placeholder,
  className,
  buttonClassName,
  onProductChange,
}: ProductSelectOrFallbackProps<TItem>) => {
  if (isProductMissing) {
    return (
      <input
        type="text"
        readOnly
        value={item.productName || ''}
        aria-label={ariaLabel}
        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600"
      />
    );
  }

  return (
    <SelectControl
      options={options}
      value={item.productId || ''}
      onChange={(val) => onProductChange(index, val as string)}
      placeholder={placeholder}
      searchable={true}
      disabled={isReadOnly || Boolean(item.supplierQuoteItemId)}
      className={className}
      buttonClassName={buttonClassName}
    />
  );
};

export default ProductSelectOrFallback;
