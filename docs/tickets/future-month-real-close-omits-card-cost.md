# Future month "Real balance at close" leaves out card payments (found 2026-11-14)

**Status: FIXED 2026-11-14 (approved by Lineu as an exception to the web
freeze).** A future month now shows one basis only, the plan, as a sum that
adds up (start + income + drawn − bills − savings − debt payments − cards =
end), with a code-chosen "why" line, the month-end path and a card statement
check, on the web dashboard and the app's Home. The real-balance lines are
gone from future months; the current and past months keep their layout.
Reconciled to the cent for 2be22642 (May −637.84, Aug −542.28, Oct
−1,637.98).

**Found:** Lineu asked why May 2027 read "Real balance at close: $18,158.73"
next to a plan of −$637.84 (household 2be22642, read-only).

**Shape:** `PlanChainTile` shows `closesAt` (the Timeline walk) as the figure
the plan "is read against". For a future month that walk has card payments only
for cycles that already have bridge rows, which are created lazily from
actual-to-date spend (`bridgeHelpers.ts`, KNOWN LIMITATION). The plan uses the
card budget for those same cycles instead.

Live numbers, chequing card-payment (bridge) rows by payment month:

| Month | Bridge in Timeline | Plan card cost (budget) |
|---|---|---|
| 2027-01 | $1,276.79 | $4,680.00 |
| 2027-02..05 | $616–881 | $4,550.00 |

Over Dec–May that comes to about $17k of card spend that the "real" figure
leaves out and the plan includes. By comparison, closed cycles from Aug to Nov
2026 paid $5.5k–8.8k a month.

**Effect:** the plan is correct, but the label calls the walk "real" and says
the plan is read against it. For any future month, that makes the plan look
broken.

**Also seen:** `planChainHelpers.ts` header INVARIANT says plan ≤ real close
for the *current* month. The tile shows `closesAt` for every month, including
future ones, where no invariant holds.

**Not decided:** hide `closesAt` for future months, relabel it ("dated entries
only — card statements not yet in"), or project open/unstarted cycles onto the
Timeline. Copy change is EN/FR; the last option is money math → diagnose and
STOP first.
