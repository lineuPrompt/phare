# "Balances begin {date}" always showed the one date it cannot be

**Filed** 2026-09-18. **Fixed** 2026-09-18, same day. Surfaced twice without
being tracked (Phase 1 of the mobile Timeline diagnosis, then again in the
mobile Timeline build handoff); filed so a third sighting would land on a
ticket instead of another aside, then fixed on the same pass.

**Status:** CLOSED. The fix is in the working tree, not yet committed.

**Severity:** cosmetic — an explanatory note beside a rare-case block, not
money math. No balance, total, projection or dip was affected, and nothing is
written to the database. But it was wrong *every single time it appeared*, by
construction, not intermittently.

---

## The problem

As filed, at `src/components/timeline/DayLedger.tsx:414-418`:

```tsx
          {balancesBeginNote && (
            <p className="text-xs px-1" style={{ color: '#9CA3AF' }}>
              {t('balancesBegin', { date: fmtDay(monthView.month + '-01', locale) })}
            </p>
          )}
```

The copy it fills in ([src/messages/en.json:668](../../src/messages/en.json#L668)):

> Balances begin {date} — the date of your first anchor.

The date passed was `monthView.month + '-01'` — **the 1st of the month being
viewed**. The flag deciding whether the note renders at all is
`balancesBeginNote`, computed in `buildMonthView`
([packages/core/src/timeline.ts](../../packages/core/src/timeline.ts)):

```ts
  const balancesBeginNote =
    balancesStartDate.slice(0, 7) === month && balancesStartDate.slice(8, 10) !== '01';
```

So the note rendered **only when `balancesStartDate` is not the 1st**, and when
it rendered it printed **the 1st**. Mutually exclusive: there was no input for
which the displayed date was correct. A household whose balances begin on 15
July was told "Balances begin Wed, Jul 1 — the date of your first anchor",
naming a date two weeks before the anchor they entered, while calling it their
anchor date.

The second half of the sentence is accurate about the *real* value, which made
the wrong date more convincing rather than less: `windowStart` is always a
`YYYY-MM-01` (the route rejects anything else), so `balancesStartDate` can only
be a non-1st date when it *is* the first anchor's date.

## The fix

`DayLedger` did not have the value. Its props were `monthView`, `today`,
`locale`, `categories`, `todayRef`, `onChanged`, and `MonthView` carries
`balancesBeginNote` (the boolean derived *from* `balancesStartDate`) but not the
date itself — which is why the component reached for the only date in scope.

`balancesStartDate` is threaded in as a **required** prop, straight from the API
response. Required rather than optional-with-a-fallback: an optional prop would
let the wrong date come back silently at any call site that forgot it, which is
the failure being fixed.

**`@phare/core` and `MonthView` were deliberately left alone.** Putting the date
on `MonthView` would have made it available to every future consumer without
threading, but that type is shared with the Expo app, and widening a shared type
to fix one web component's missing prop is the wrong shape for a cosmetic
web-only note. Revisit only if that type is being changed for another reason.

## What changed

Three files, no logic change:

1. **[src/components/timeline/DayLedger.tsx](../../src/components/timeline/DayLedger.tsx)** —
   added the required `balancesStartDate: string` prop
   ([line 359](../../src/components/timeline/DayLedger.tsx#L359),
   documented at [line 377](../../src/components/timeline/DayLedger.tsx#L377)),
   and the note now formats it
   ([line 432](../../src/components/timeline/DayLedger.tsx#L432)) instead of
   `monthView.month + '-01'`.
2. **[src/app/[locale]/timeline/page.tsx:291](../../src/app/[locale]/timeline/page.tsx#L291)** —
   the one production call site passes `data.balancesStartDate`, already in
   scope (it feeds `buildMonthView` at line 223) and non-null wherever
   `DayLedger` renders, since `data.ok` is checked earlier.
3. **[src/components/savings/__tests__/renderProbe.test.tsx](../../src/components/savings/__tests__/renderProbe.test.tsx)** —
   the four existing `<DayLedger …>` fixtures carry the new prop, plus the
   regression test below.

### The regression test, and why there wasn't one

`renderProbe.test.tsx` renders `DayLedger` for real through `react-dom/server`
against the live `src/messages/*.json` in both locales — but its only fixture
set `balancesBeginNote: false`, so this note **never rendered in any test**.
That is exactly how the bug shipped unnoticed.

Added: a fixture with `balancesBeginNote: true` and one unbalanced day (the note
renders inside that block, so both are needed), asserting in **en and fr** that
the whole interpolated sentence appears with the real start date — and
explicitly that the sentence with the 1st of the month does *not*. Asserting the
whole sentence rather than a date-shaped substring is deliberate: a substring
check would pass on the wrong date too.

What it prints now:

```
EN: … Balances begin Tue, Sep 15 — the date of your first anchor.
FR: … Les soldes commencent le mar. 15 sept. — la date de votre premier ancrage.
```

**Mutation-tested:** reverting the component to `monthView.month + '-01'` fails
both new assertions, for the right reason (the expected sentence is absent, not
some incidental mismatch). Restored after.

### Verification

- `tsc --noEmit` clean.
- Web suite **2054 → 2056 passed**, 1 skipped, **120 files unchanged** — the
  +2 are exactly the two new locale cases. No existing assertion changed; the
  only other test edit was adding the prop to the four fixtures.
- Lint on the three files reports only the pre-existing `set-state-in-effect`
  error at `page.tsx:144` and two unused-`locale` warnings in `DayLedger`
  (lines 76, 177), all unchanged by this work.

### Not verified

Nobody has loaded the authenticated `/timeline` route in a browser with a
household whose anchor falls mid-month. The render probe runs the real component
against the real catalogues, which is what proves the string, but it is not the
live page.

## Adjacent observation — deliberately out of scope

The note is nested **inside** the `unbalancedDays.length > 0` block, so a
household whose balances start mid-month with **no** pre-anchor entries is told
nothing at all — the ledger simply starts partway through the month with no
explanation. That reads as deliberate (the note explains the dashed block it
sits under), and the mobile screen mirrors it. Left exactly as it was; if it
should show independently, that is a separate decision about the note's purpose.

## Mobile

[apps/mobile/src/lib/timelineView.ts:124](../../apps/mobile/src/lib/timelineView.ts#L124)
already used the real `balancesStartDate`, pinned by
[apps/mobile/src/__tests__/timelineView.test.ts:221](../../apps/mobile/src/__tests__/timelineView.test.ts#L221).
The two apps no longer disagree about this date. No mobile change was needed.
