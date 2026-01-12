
/**
 * Italian Holiday Logic (Anonymous Algorithm for Easter)
 */
export const getEaster = (y: number): Date => {
    const f = Math.floor;
    const G = y % 19;
    const C = f(y / 100);
    const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
    const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
    const J = (y + f(y / 4) + I + 2 - C + f(C / 4)) % 7;
    const L = I - J;
    const m = 3 + f((L + 40) / 44);
    const d = L + 28 - 31 * f(m / 4);
    return new Date(y, m - 1, d);
};

export const isItalianHoliday = (date: Date): string | null => {
    const d = date.getDate();
    const m = date.getMonth() + 1; // 1-based
    const y = date.getFullYear();

    // Fixed holidays (Month-Day)
    const fixedHolidays: Record<string, string> = {
        "1-1": "Capodanno",
        "1-6": "Epifania",
        "4-25": "Liberazione",
        "5-1": "Lavoro",
        "6-2": "Repubblica",
        "8-15": "Ferragosto",
        "11-1": "Ognissanti",
        "12-8": "Immacolata",
        "12-25": "Natale",
        "12-26": "S. Stefano",
    };

    const key = `${m}-${d}`;
    if (fixedHolidays[key]) return fixedHolidays[key];

    // Dynamic holidays
    const easter = getEaster(y);
    const isSameDay = (d1: Date, d2: Date) =>
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();

    if (isSameDay(date, easter)) return "Pasqua";

    const easterMonday = new Date(easter);
    easterMonday.setDate(easter.getDate() + 1);
    if (isSameDay(date, easterMonday)) return "Lunedì dell'Angelo";

    return null;
};
