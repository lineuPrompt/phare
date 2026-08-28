import { assertTimeZoneSupport } from '@phare/core';

// ---------------------------------------------------------------------------
// THE STARTUP GATE.
//
// assertTimeZoneSupport() runs at MODULE SCOPE, which on React Native means it
// runs while the bundle is being evaluated — before the first component
// renders and before any household data can be read or written. That timing is
// the requirement, not an implementation detail: packages/core/README.md is
// explicit that the probe has to run "before any household data is read or
// written", because the failure it catches is silent.
//
// WHAT IT CATCHES. A runtime without full ICU does not reject
// Intl.DateTimeFormat's `timeZone` option — it accepts it and ignores it,
// formatting in UTC or the device zone instead. businessToday() keeps
// returning well-formed YYYY-MM-DD strings that are simply wrong near
// midnight, so a January 31st transaction is booked into February with no
// error, no log line, and nothing wrong-looking on screen. There is no way to
// notice this in production after the fact.
//
// WHY THE RESULT IS CAPTURED RATHER THAN LEFT TO THROW. A module-scope throw
// during bundle evaluation is a red screen in development and an immediate
// crash on launch in a release build — the user learns nothing and support
// gets "the app won't open". Capturing it lets the app mount exactly one
// screen that names the problem in the user's own language, which is what
// requirement (b) asks for.
//
// This is the ONLY thing this module does. It is imported for its side effect
// by the root layout before anything else, so nothing can accidentally run
// first by reordering imports elsewhere.
// ---------------------------------------------------------------------------

export type ProbeResult =
  | { ok: true }
  | { ok: false; message: string };

function run(): ProbeResult {
  try {
    assertTimeZoneSupport();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      // The raw message from TimeZoneSupportError, kept verbatim. It names the
      // two zones, the instant, and what they both formatted to — which is the
      // only thing that makes a device report actionable. It is English-only
      // and shown under a "Technical detail" label, with the explanation above
      // it translated.
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Evaluated once, at bundle evaluation time. */
export const TIMEZONE_PROBE: ProbeResult = run();
