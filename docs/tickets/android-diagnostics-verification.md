# Verify /diagnostics (the Hermes timezone probe) on Android

**Filed** 2026-09-28, from the backlog reconciliation.

**Status:** OPEN. Verification, not a known bug.

---

## Why

`assertTimeZoneSupport()` gates the whole mobile app because a runtime
without full ICU silently ignores `timeZone` (CLAUDE.md §8). It has been
reasoned about and unit-tested against a simulated broken runtime, but the
Android build of the app has not been run against it; see
[packages/core/README.md](../../packages/core/README.md) ("UNVERIFIED ON
DEVICE").

## How

Local Android builds fail on Windows path length. Use an EAS cloud build
(`eas build --profile development --platform android` from `apps/mobile`),
install it, open `/diagnostics`, and record: the probe result, the
`businessToday(America/Toronto)` value against the real Toronto date near
midnight UTC, and the fr-CA codepoints line.

Note: the diagnostics screen's review-stream probe always fails today — see
[diagnostics-probe-review-stream-401.md](diagnostics-probe-review-stream-401.md).
That failure says nothing about the device.
