# @phare/core

Shared money and date logic. One source of truth, consumed by both the Next.js
web app (`src/`) and the Expo app. Nothing here is duplicated in either
consumer — if you find yourself copying a function out of this package, that is
the bug.

Everything is pure. No `next/*`, no Supabase, no `process.env`, no `node:`
builtins, no DOM globals, no `'use client'`. **The only platform dependency is
`Intl`** — and that dependency is the whole reason the rest of this document
exists.

## Contents

| Module | What it owns |
|---|---|
| `dateHelpers.ts` | `businessToday` / `businessMonth`, recurrence materialization, statement-cycle windows, anchor-date arithmetic |
| `anchorDateHelpers.ts` | Post-import anchor-step validators |
| `incomeHelpers.ts` | `monthlyEquivalent` — the single per-payment → monthly conversion point for the whole product — plus member-name resolution |
| `planHelpers.ts` | `buildCalculatedFromFormLines`, three-bucket budget assembly |
| `plausibilityGuard.ts` | The two-prong "is this plan believable" check |
| `money.ts` | `formatCAD`, `formatCADLocale` |
| `timezoneSupport.ts` | `assertTimeZoneSupport` — the runtime capability probe |

---

## ⚠️ Intl on React Native / Hermes — UNVERIFIED ON DEVICE

Everything below is **unverified on a real device.** It has been reasoned
about and unit-tested against a simulated broken runtime, but nobody has yet
run this package on Hermes. Treat it as a known open risk, not a solved
problem. It can only be settled on a device.

Hermes ships without full ICU in some configurations. The two consequences
are not equally serious, and they are listed in order of severity.

### 1. `businessToday()` — the dangerous one

`businessToday(timezone)` resolves *what day it is for a household* by
formatting an instant with `Intl.DateTimeFormat`'s `timeZone` option. Its
result decides **which month a transaction is booked into.**

The failure mode is silent. A runtime without full ICU does not reject the
`timeZone` option — it **accepts it and ignores it**, formatting in UTC or the
device zone instead. Every call keeps returning a well-formed `YYYY-MM-DD`
string. Nothing throws, nothing looks wrong, and no log line appears. The
dates are simply incorrect near midnight:

> `2026-02-01T02:30Z` is **January 31st, 9:30pm** in Toronto.
> A runtime that ignores `timeZone` reports `2026-02-01`.
> A January transaction is booked into February, and nothing surfaces.

**This is why `assertTimeZoneSupport()` exists.** Call it once, early, in the
Expo app's startup path — before any household data is read or written:

```ts
import { assertTimeZoneSupport } from '@phare/core';

assertTimeZoneSupport(); // throws TimeZoneSupportError if timeZone is ignored
```

It formats one fixed instant in two zones 25 hours apart (`Pacific/Kiritimati`,
UTC+14, and `Pacific/Niue`, UTC-11) that fall on *different calendar dates* at
that instant. A runtime honouring `timeZone` returns two different dates; a
runtime ignoring it collapses both to one value and the probe throws. Neither
zone observes DST, and they sit on opposite sides of UTC, so there is no zone a
broken runtime could fall back to that would produce a passing result by
coincidence. `hasTimeZoneSupport()` is the non-throwing form.

**It is deliberately NOT wired into the web app.** Node ships full ICU, the web
app is not at risk, and adding a startup assertion there would introduce a new
failure mode for no benefit. The Expo app calls it; the web app does not.

**Fallback if it fails on device:** install
[`@formatjs/intl-datetimeformat`](https://formatjs.io/docs/polyfills/intl-datetimeformat/)
with its timezone data, or build the app against a full-ICU JSC/Hermes variant.
Do **not** work around it with manual UTC-offset arithmetic — `dateHelpers.ts`
uses the real tz database precisely so DST transitions (Montréal's
spring-forward and fall-back) are handled correctly, and hand-rolled offset
math reintroduces exactly the bug that choice avoids.

### 2. `formatCAD()` — cosmetic, but still wrong

`formatCAD` and `formatCADLocale` use `Intl.NumberFormat`. Without full ICU
this can silently return a wrong-looking string rather than throwing — a
missing thousands separator, a wrong symbol position, or an ASCII space where
the fr-CA form requires U+00A0.

The exact expected output is pinned byte-for-byte in
`__tests__/money.test.ts`, including codepoint-level assertions that the fr-CA
form uses **U+00A0 NO-BREAK SPACE** both as the thousands separator and before
the `$`. If those tests pass on device, formatting is correct; if they fail,
the diff will name the exact codepoint that changed.

**Fallback if it fails on device:** `@formatjs/intl-numberformat`, or — since
the format is fixed and simple — a hand-rolled formatter. CAD has exactly two
decimal places and one grouping rule, so a hand-rolled version is perfectly
viable here and is the lighter option if bundle size matters. The pinning
tests define the contract it would have to meet.

---

## Known limitations

### `formatCAD` ignores locale — French users see English currency

`formatCAD(amount)` takes **no locale** and always formats as `en-CA`. A French
onboarding user currently sees `$1,234.50` where they should see
`1 234,50 $`.

**This is a visible bug in the primary market, not a cleanup item.** It affects
the onboarding flow — the plan review, the manual entry form, the anchor-date
step, and the plausibility warnings — which is the first thing a new household
sees.

It was left as-is deliberately: this package was created by *moving* code, and
fixing it changes rendered output, which a move must not do. The behaviour is
pinned by a test that says so explicitly, so whoever fixes it has to delete
that test knowingly.

### There are four currency formatters in this repo

`formatCAD` is one of four near-identical implementations:

| Where | Signature | Locale-aware |
|---|---|---|
| `@phare/core` → `money.ts` | `formatCAD(amount)` | ❌ always en-CA |
| `src/components/dashboard/types.ts` | `formatCurrency(amount, locale)` | ✅ |
| `src/components/recurring/types.ts` | `formatCurrency(amount, locale)` | ✅ |
| `src/components/expenses/types.ts` | `formatCurrency(amount, locale)` | ✅ |

The three `formatCurrency` copies are byte-identical to one another.
`formatCADLocale` in this package is the same function expressed once, and is
where they should all converge — but that convergence also *fixes* the bug
above, so it changes behaviour and belongs in its own change. It is not wired
into the web app today.

---

## Testing

Tests live in `src/__tests__/` and run as part of the repo's single root Vitest
suite — there is no separate test command. From the repo root:

```bash
pnpm vitest run                      # everything
pnpm vitest run packages/core        # this package only
```

`pnpm` only — `npm` is blocked by a `preinstall` guard.

## Consumption

Source-only: no build step, no `dist/`, no compiled output to keep in sync. The
package's `exports` map points directly at `src/index.ts`, and each consumer's
own bundler transpiles the TypeScript.

Verified to need **no** configuration on the web side — Next 16 with
`next dev --webpack` resolves and transpiles it with no `transpilePackages`
entry, `tsc --noEmit` resolves it through `exports.types` under
`moduleResolution: "bundler"` with no `paths` entry, and Vitest picks it up
with no `server.deps` config.
