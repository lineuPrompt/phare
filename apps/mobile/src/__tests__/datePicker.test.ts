import { describe, expect, it } from 'vitest';
import { isoToPickerDate, pickerDateToIso, pickerStart } from '../lib/datePicker';

// The picker's Date is a moment in the device's zone; the forms keep a plain
// 'YYYY-MM-DD'. These pin that the day survives the round trip in any zone.


describe('YYYY-MM-DD → picker Date', () => {
  it('is that calendar day, at local noon', () => {
    const d = isoToPickerDate('2026-11-13')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 13, 12]);
  });

  it('refuses days that do not exist rather than rolling them over', () => {
    expect(isoToPickerDate('2026-02-30')).toBeNull();
    expect(isoToPickerDate('2026-13-01')).toBeNull();
    expect(isoToPickerDate('2026-00-10')).toBeNull();
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    expect(isoToPickerDate('')).toBeNull();
    expect(isoToPickerDate(undefined)).toBeNull();
    expect(isoToPickerDate('2026-1-5')).toBeNull();
    expect(isoToPickerDate('13/11/2026')).toBeNull();
  });

  it('accepts a leap day', () => {
    expect(isoToPickerDate('2028-02-29')?.getDate()).toBe(29);
  });
});

describe('picker Date → YYYY-MM-DD', () => {
  it('reads the local calendar day, zero-padded', () => {
    expect(pickerDateToIso(new Date(2027, 0, 5, 12))).toBe('2027-01-05');
  });

  it('a late-evening pick in Canada is still that day (UTC would say tomorrow)', () => {
    // 23:30 local; toISOString() would roll to the next day in any zone west of UTC.
    expect(pickerDateToIso(new Date(2026, 10, 30, 23, 30))).toBe('2026-11-30');
  });

  it('an early-morning pick is still that day (UTC would say yesterday east of Greenwich)', () => {
    expect(pickerDateToIso(new Date(2026, 11, 1, 0, 15))).toBe('2026-12-01');
  });

  it('round-trips every day of a year, DST changes included', () => {
    for (let day = 0; day < 366; day++) {
      const iso = pickerDateToIso(new Date(2028, 0, 1 + day, 12));
      expect(pickerDateToIso(isoToPickerDate(iso)!)).toBe(iso);
    }
  });
});

describe('where the calendar opens', () => {
  it('on the field’s own day', () => {
    expect(pickerDateToIso(pickerStart('2027-03-04', '2026-11-13')!)).toBe('2027-03-04');
  });

  it('on the household’s today when the field is empty', () => {
    expect(pickerDateToIso(pickerStart('', '2026-11-13')!)).toBe('2026-11-13');
  });

  it('nowhere yet (field waits) when neither is known — never the device clock', () => {
    expect(pickerStart('', undefined)).toBeNull();
  });
});
