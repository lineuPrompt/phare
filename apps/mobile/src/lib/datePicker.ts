/**
 * The bridge between the forms' 'YYYY-MM-DD' strings and the native date
 * picker's Date (Lineu, 2026-11-13: "date pickers in all date inputs").
 *
 * The forms, their validation and every API call keep the plain ISO day; the
 * picker only changes how a household chooses it. A picker Date is a moment
 * in the DEVICE's zone, so it is built from and read back as local calendar
 * components, never through toISOString() (which is UTC and would hand back
 * the day before for a picker set to midnight anywhere west of Greenwich).
 * Noon, not midnight, so no DST shift can move the day either way.
 *
 * Pure, so it is tested without a renderer (see vitest.config.ts).
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → that calendar day at local noon; null when it isn't a real day. */
export function isoToPickerDate(iso: string | null | undefined): Date | null {
  const m = ISO_DAY.exec((iso ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12, 0, 0, 0);
  // new Date(2026, 1, 30) rolls over to March 2: not a real day.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** The calendar day the picker shows → 'YYYY-MM-DD'. */
export function pickerDateToIso(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Where the calendar opens: the field's own day, else the household's today
 * (`fallback`, from businessToday upstream). Only where it OPENS — nothing is
 * written to the form until a day is picked.
 */
export function pickerStart(value: string, fallback: string | undefined): Date | null {
  return isoToPickerDate(value) ?? isoToPickerDate(fallback);
}
