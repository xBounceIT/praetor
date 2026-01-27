export const parseNumberInputValue = (value: string, fallback: number | undefined = 0) => {
  if (value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const roundToTwoDecimals = (value: number) => {
  return Number(Math.round(Number(value + 'e2')) + 'e-2');
};
