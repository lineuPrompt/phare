# Every monthly bill and paycheque is dated the 1st

**Filed** 2026-09-29, from the onboarding stranger audit. **STOP** (dates).

**Status:** OPEN.

[save-plan](../../src/app/api/save-plan/route.ts) (~190, used at ~473 and
~511) gives every monthly recurring item `anchor_date = <current month>-01`.
Non-monthly items correctly stay unanchored until a real date is captured;
monthly ones get a date nobody gave. A mortgage paid on the 15th and a
salary paid on the 25th both land on the 1st, so the Timeline's dips and
low points fall on the wrong days — the Timeline being the product's main
view.

## To decide

Ask the day of month for monthly lines (the anchor step already asks
semi-monthly days), or keep the 1st but mark it as assumed and prompt for it
the way unanchored items are disclosed.

## Diagnosis (2026-09-30, read-only)

Only two households have recurring items at all. No external household is
affected.

- **2be22642** — 27 monthly rules, 20 on a real day (edited since). 7 on the
  1st, 6 from the July import, 1 a Parking rule split on 2026-08-01 that kept
  the imported anchor:
  - on **chequing**: Affirm / iPhone −51.05, Child benefit / Quebec +203.50;
  - on **Visa Avion** (close day 27): Apple + Claude −32.19, Apple Julia
    −4.59, Judo −78.28, Parking −226.00 (active) / −220.50 (inactive).
  Each active rule has 9–11 future rows, all on the 1st.
- **Zezinho Test** — all 7 monthly rules on the 1st (test data).

What the Timeline shows wrong: the two chequing lines move money on the 1st
instead of their real day, so the running balance and any low point between
the 1st and the real date are off by up to 203.50 / 51.05. The Visa lines
are placed in the cycle containing the 1st; for a charge that really lands
after the 27th, that's the wrong statement, so the card's bridge payment
lands a month early by that amount. Past rows (≤ today) are history and must
not be rewritten.

Repair options (none applied):
1. **Household edits the day** on the Recurring page — splitRule makes it
   effective-dated, so only future rows move. No script. Only the household
   knows the real days.
2. **Mark assumed days** — a column (e.g. `anchor_day_assumed`) set true for
   these rows, and a "confirm the day" prompt on Recurring/Timeline. Schema
   change.
3. **SQL repair** — not possible correctly: nothing records the real day.

Going forward, item 3's build captures a real day for every monthly line,
and the template lane leaves monthly lines unanchored until the anchor step
asks for the day (instead of the 1st).
