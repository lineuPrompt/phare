import { describe, it, expect, afterEach } from 'vitest';
import { assertTimeZoneSupport, hasTimeZoneSupport, TimeZoneSupportError } from '../timezoneSupport';
import { businessToday } from '../dateHelpers';

// ---------------------------------------------------------------------------
// A PROBE THAT HAS NEVER FAILED IN A TEST IS NOT A PROBE.
//
// On the machine running this suite, Intl works — so a test that only calls
// assertTimeZoneSupport() and expects no throw proves nothing about whether
// the probe can DETECT a broken runtime. It would pass identically if the
// function body were `return;`.
//
// So the broken runtime is simulated: Intl.DateTimeFormat is replaced with an
// implementation that accepts a timeZone option and ignores it, which is
// precisely what a Hermes build without full ICU does. The probe must catch
// that. Both failure shapes are covered — silently ignoring the option, and
// rejecting it outright.
// ---------------------------------------------------------------------------

const realIntl = globalThis.Intl;

afterEach(() => {
  globalThis.Intl = realIntl;
});

/**
 * Stands in for a runtime whose Intl accepts `timeZone` and ignores it,
 * formatting every instant in one fixed zone (UTC here). No throw, no warning
 * — the exact silent-fallback behaviour that makes this worth probing for.
 */
function installTimeZoneIgnoringIntl() {
  globalThis.Intl = {
    ...realIntl,
    DateTimeFormat: function (locale?: string, options?: Intl.DateTimeFormatOptions) {
      // Deliberately drops options.timeZone on the floor.
      const stripped = { ...options };
      delete stripped.timeZone;
      return new realIntl.DateTimeFormat(locale, { ...stripped, timeZone: 'UTC' });
    },
  } as unknown as typeof Intl;
}

/** Stands in for a runtime that rejects any IANA zone outright. */
function installTimeZoneRejectingIntl() {
  globalThis.Intl = {
    ...realIntl,
    DateTimeFormat: function (_locale?: string, options?: Intl.DateTimeFormatOptions) {
      if (options?.timeZone) {
        throw new RangeError(`Invalid time zone specified: ${options.timeZone}`);
      }
      return new realIntl.DateTimeFormat(_locale, options);
    },
  } as unknown as typeof Intl;
}

describe('assertTimeZoneSupport — on a working runtime', () => {
  it('does not throw', () => {
    expect(() => assertTimeZoneSupport()).not.toThrow();
  });

  it('hasTimeZoneSupport() reports true', () => {
    expect(hasTimeZoneSupport()).toBe(true);
  });
});

describe('assertTimeZoneSupport — the fixture itself is sound', () => {
  // If the chosen instant and zones did NOT actually straddle a date boundary,
  // the probe would be vacuous: it would pass on a broken runtime too. These
  // tests pin the premise the probe rests on, so it cannot rot silently.

  it('the two probe zones fall on DIFFERENT calendar dates at the chosen instant', () => {
    const instant = new Date('2026-01-15T12:00:00Z');
    const fmt = (tz: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(instant);

    expect(fmt('Pacific/Kiritimati')).toBe('01/16/2026'); // UTC+14, next day
    expect(fmt('Pacific/Niue')).toBe('01/15/2026');       // UTC-11, same day
    expect(fmt('Pacific/Kiritimati')).not.toBe(fmt('Pacific/Niue'));
  });

  it('a UTC fallback collapses BOTH zones to one value — so it cannot pass by luck', () => {
    // This is the coincidence the zone choice is designed to rule out.
    installTimeZoneIgnoringIntl();
    const instant = new Date('2026-01-15T12:00:00Z');
    const fmt = (tz: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(instant);

    expect(fmt('Pacific/Kiritimati')).toBe(fmt('Pacific/Niue'));
  });
});

describe('assertTimeZoneSupport — THE BROKEN CASE, silently ignored timeZone', () => {
  it('THROWS when the runtime accepts timeZone but does not honour it', () => {
    installTimeZoneIgnoringIntl();
    expect(() => assertTimeZoneSupport()).toThrow(TimeZoneSupportError);
  });

  it('names the CONSEQUENCE — wrong-month bookings — not just missing ICU', () => {
    installTimeZoneIgnoringIntl();
    let message = '';
    try {
      assertTimeZoneSupport();
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('WRONG MONTH');
    expect(message).toContain('silently');
    // The diagnostic must show what it actually observed, not just a verdict.
    expect(message).toContain('Pacific/Kiritimati');
    expect(message).toContain('Pacific/Niue');
  });

  it('hasTimeZoneSupport() reports false rather than throwing', () => {
    installTimeZoneIgnoringIntl();
    expect(hasTimeZoneSupport()).toBe(false);
  });

  it('and this is not theoretical: businessToday() genuinely goes wrong here', () => {
    // The point of the probe, demonstrated. 2026-01-15T23:30 in Toronto is
    // already 2026-01-16 in UTC. A runtime that ignores timeZone therefore
    // reports the WRONG DAY — and at a month boundary, the wrong month.
    const lateEvening = new Date('2026-02-01T02:30:00Z'); // 2026-01-31 21:30 Toronto

    expect(businessToday('America/Toronto', lateEvening)).toBe('2026-01-31');

    installTimeZoneIgnoringIntl();
    expect(businessToday('America/Toronto', lateEvening)).toBe('2026-02-01');
    //                                                          ^^^^^^^^^^
    // A January transaction booked into February, with no error raised.
  });
});

describe('assertTimeZoneSupport — the broken case, timeZone rejected outright', () => {
  it('THROWS, wrapping the underlying error', () => {
    installTimeZoneRejectingIntl();
    expect(() => assertTimeZoneSupport()).toThrow(TimeZoneSupportError);
  });

  it('still names the consequence, and surfaces the underlying cause', () => {
    installTimeZoneRejectingIntl();
    let message = '';
    try {
      assertTimeZoneSupport();
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('wrong month');
    expect(message).toContain('Invalid time zone specified');
  });
});

describe('TimeZoneSupportError', () => {
  it('is identifiable by name, so a caller can branch on it', () => {
    installTimeZoneIgnoringIntl();
    try {
      assertTimeZoneSupport();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TimeZoneSupportError);
      expect((e as Error).name).toBe('TimeZoneSupportError');
    }
  });
});
