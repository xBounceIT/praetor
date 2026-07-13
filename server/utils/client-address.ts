export const formatClientAddress = ({
  civicNumber,
  line,
  cap,
  state,
  province,
  country,
}: {
  civicNumber: string | null;
  line: string | null;
  cap: string | null;
  state: string | null;
  province: string | null;
  country: string | null;
}) => {
  const street = [line, civicNumber].filter(Boolean).join(' ').trim();
  const locality = [cap, state].filter(Boolean).join(' ').trim();
  const provinceChunk = province ? `(${province})` : '';
  return [street, [locality, provinceChunk].filter(Boolean).join(' ').trim(), country]
    .filter((chunk): chunk is string => Boolean(chunk?.trim()))
    .join(', ');
};
