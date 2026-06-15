/**
 * Converts a month name (English or French, possibly within a longer string)
 * to its number 1-12. Returns null if no month is recognized.
 * Matches the FIRST month mentioned, e.g. "March & June" → 3.
 */
export function monthNameToNumber(name: string): number | null {
  const months: Record<string, number> = {
    january: 1, janvier: 1, february: 2, février: 2, march: 3, mars: 3,
    april: 4, avril: 4, may: 5, mai: 5, june: 6, juin: 6,
    july: 7, juillet: 7, august: 8, août: 8, september: 9, septembre: 9,
    october: 10, octobre: 10, november: 11, novembre: 11, december: 12, décembre: 12,
  };
  const low = (name || '').toLowerCase();
  for (const [key, num] of Object.entries(months)) {
    if (low.includes(key)) return num;
  }
  return null;
}