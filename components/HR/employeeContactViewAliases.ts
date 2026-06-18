export const LEGACY_CONTACT_COLUMN_ID = 'contact';

const splitLegacyContactFilterValue = (
  value: string,
): { email: string | null; phone: string | null } => {
  const trimmed = value.trim();
  if (!trimmed) return { email: null, phone: null };
  const firstSpaceIndex = trimmed.search(/\s/);
  const firstToken = firstSpaceIndex === -1 ? trimmed : trimmed.slice(0, firstSpaceIndex);
  if (!firstToken.includes('@')) return { email: null, phone: trimmed };
  const phone = firstSpaceIndex === -1 ? '' : trimmed.slice(firstSpaceIndex).trim();
  return { email: firstToken, phone: phone || null };
};

export const mapLegacyContactEmailFilterValue = (value: string) =>
  splitLegacyContactFilterValue(value).email;

export const mapLegacyContactPhoneFilterValue = (value: string) =>
  splitLegacyContactFilterValue(value).phone;
