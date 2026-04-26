export function getLinkedFieldStatus(
  isReadOnly: boolean,
  isLinkedToSupplierQuote: boolean,
  readOnlyReason: string,
  supplierLockedReason: string,
  statusEditable: string,
) {
  return isReadOnly
    ? readOnlyReason
    : isLinkedToSupplierQuote
      ? supplierLockedReason
      : statusEditable;
}
