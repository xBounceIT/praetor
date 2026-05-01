export const stripEmoji = (s: string): string => s.replace(/\p{Extended_Pictographic}/gu, '');
