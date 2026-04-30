interface LinkedFieldStatusOptions {
  isReadOnly: boolean;
  isLinkedToSupplierQuote: boolean;
  readOnlyReason: string;
  supplierLockedReason: string;
  statusEditable: string;
}

export function getLinkedFieldStatus({
  isReadOnly,
  isLinkedToSupplierQuote,
  readOnlyReason,
  supplierLockedReason,
  statusEditable,
}: LinkedFieldStatusOptions) {
  return isReadOnly
    ? readOnlyReason
    : isLinkedToSupplierQuote
      ? supplierLockedReason
      : statusEditable;
}
