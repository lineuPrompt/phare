/**
 * Runtime capability probe for Intl.DateTimeFormat's `timeZone` option.
 *
 * WHY THIS EXISTS
 * ---------------
 * businessToday() (dateHelpers.ts) resolves "what day is it for this
 * household" by formatting an instant in the household's IANA zone. That is
 * the correct approach and it is load-bearing: the result decides which month
 * a transaction is booked into.
 *
 * On a JS runtime built without full ICU — which includes some Hermes/React
 * Native configurations — the `timeZone` option is not honoured. Critically,
 * it does not throw. The runtime accepts the option, ignores it, and formats
 * in UTC (or the device zone) instead. Every call keeps returning a
 * plausible-looking YYYY-MM-DD string, so nothing surfaces as an error; the
 * dates are simply wrong near midnight, and entries land in the wrong month.
 *
 * A README note cannot catch that. This can.
 */

/**
 * Thrown when the runtime accepts a `timeZone` option but does not honour it.
 */
export class TimeZoneSupportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeZoneSupportError';
  }
}

/**
 * Verifies that Intl.DateTimeFormat actually applies the `timeZone` option
 * rather than silently ignoring it.
 *
 * Pure: no I/O, no platform sniffing, no feature-flag lookup. It does not ask
 * "am I on Hermes?" — it asks "does timeZone work?", which is the thing that
 * actually matters and the only thing that stays true as runtimes change.
 *
 * CHOICE OF INSTANT AND ZONES
 * ---------------------------
 * Instant: 2026-01-15T12:00:00Z — midday UTC, mid-month, mid-year.
 *
 * Zones: Pacific/Kiritimati (UTC+14) and Pacific/Niue (UTC-11).
 *
 * The pair is chosen so that a runtime which ignores `timeZone` cannot pass
 * by coincidence, which is the failure mode a naive probe has:
 *
 *  - They are 25 hours apart, the maximum spread in the tz database. At the
 *    chosen instant they fall on genuinely different CALENDAR DATES —
 *    2026-01-16 in Kiritimati, 2026-01-15 in Niue — so the probe compares
 *    dates, not clock times. A runtime that ignores the option returns the
 *    same string for both and fails.
 *  - Neither observes DST, so the 25-hour gap holds on any date and this
 *    cannot start flaking at a transition.
 *  - Both are far from UTC in OPPOSITE directions, so a fallback to UTC, to
 *    the device zone, or to any single fixed zone whatsoever collapses both
 *    results to one value. There is no zone a broken runtime could fall back
 *    to that would produce two different answers.
 *  - Midday UTC keeps both results comfortably inside their local days rather
 *    than near a boundary, so the assertion does not depend on rounding.
 *
 * A weaker pair (say America/Toronto vs UTC) would differ by only 5 hours and
 * share a calendar date at most instants — a broken runtime would pass.
 *
 * @throws {TimeZoneSupportError} if the option is not honoured.
 */
export function assertTimeZoneSupport(): void {
  // Midday UTC, so neither comparison zone sits near a day boundary.
  const instant = new Date('2026-01-15T12:00:00Z');

  const format = (timeZone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);

  let farEast: string;
  let farWest: string;
  try {
    farEast = format('Pacific/Kiritimati'); // UTC+14 → 2026-01-16
    farWest = format('Pacific/Niue');       // UTC-11 → 2026-01-15
  } catch (cause) {
    throw new TimeZoneSupportError(
      'Intl.DateTimeFormat rejected an IANA timeZone, so this runtime cannot resolve ' +
      'a household\'s local date. Every date in the app is derived from that — ' +
      'transactions would be booked into the wrong month, silently and with no error. ' +
      'Install a full-ICU build or an Intl polyfill before using @phare/core. ' +
      `Underlying error: ${String(cause)}`
    );
  }

  if (farEast === farWest) {
    throw new TimeZoneSupportError(
      'Intl.DateTimeFormat ACCEPTED a timeZone option but did not honour it: ' +
      `Pacific/Kiritimati (UTC+14) and Pacific/Niue (UTC-11) both formatted to "${farEast}", ` +
      'though they are 25 hours apart and fall on different calendar dates at this instant. ' +
      'This runtime is formatting in a single fixed zone regardless of what it is asked for. ' +
      'businessToday() therefore cannot resolve a household\'s local date, and transactions ' +
      'will be booked into the WRONG MONTH — silently, with no error and no wrong-looking ' +
      'output to notice. Install a full-ICU build or an Intl polyfill before using @phare/core.'
    );
  }
}

/**
 * Non-throwing form, for a caller that wants to degrade or warn rather than
 * halt. Same probe, same criteria.
 */
export function hasTimeZoneSupport(): boolean {
  try {
    assertTimeZoneSupport();
    return true;
  } catch {
    return false;
  }
}
