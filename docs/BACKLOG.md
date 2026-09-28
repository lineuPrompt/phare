# Backlog

The single ordered list of what to work on next. Rules: CLAUDE.md §9.
"STOP" means diagnose, report, and wait for approval before changing
anything (money math, dates, auth, AI output, schema, deletion — §6).

Last reconciled with `docs/tickets/` and the code: 2026-09-28.

## READY

1. **Carry-forward: an older future card-envelope snapshot outranks a newer
   edit to an earlier month.** Reaches the grid, the decision view, coaching
   and the Timeline plan. Diagnose which of the two existing rules (exact
   month vs. nearest-at-or-before) should win repo-wide. **STOP** before
   fixing. — [ticket](tickets/carry-forward-older-future-snapshot-outranks-newer-edit.md)
2. **Onboarding review runs unguarded.** The sourcing, borrowed-cash and
   token-leak guards exist only in `monthlyReviewService`; the first letter a
   household reads has none, and it is persisted. **STOP.** —
   [ticket](tickets/onboarding-review-unguarded.md)
3. **splitRule duplicate materialization.** Rows detached without a
   tombstone survive its delete-by-`recurring_item_id` and are materialized
   again (reported cost: 44 rows, once). **STOP.** —
   [ticket](tickets/splitrule-detached-duplicate-materialization.md)
4. **Recurring expense/income divergence on the Timeline.** **STOP.** —
   [ticket](tickets/recurring-expense-income-divergence.md)
5. **Cards: month-by-month table gets its own month navigation**,
   independent of the page-level selector. Reuse the existing month control.
   — [ticket](tickets/cards-grid-independent-month-nav.md)
6. **Two safe Phase 2 tickets:** the diagnostics probe calling review-stream
   without a session ([ticket](tickets/diagnostics-probe-review-stream-401.md) —
   decided 2026-09-28: send the bearer token; keep it a manual, labelled
   button, one review generation per deliberate press; do not retire it),
   and the dashboard's divergent `formatResetDate`
   ([ticket](tickets/dashboard-format-reset-date-duplicate.md)).
7. **Date-serial coercion:** an Excel date in a Household answer reaches the
   prompt as "46265.83". Read `cell.w` for that column. —
   [ticket](tickets/household-answer-date-serial.md)
8. **`apps/mobile/app.json` → `app.config.ts`** reading the bundle id and
   Android package from the same env vars the web's well-known routes use. —
   [ticket](tickets/mobile-app-config-from-env.md)
9. **Android: verify `/diagnostics`** (Hermes timezone probe) on an EAS cloud
    build — local builds fail on Windows path length. —
    [ticket](tickets/android-diagnostics-verification.md)
10. **Household info never reaches the review route**, so the Quebec /
    out-of-province-employer tax gap can surface only in the onboarding plan.
    Product decision — diagnose and propose, **STOP.** —
    [ticket](tickets/household-info-missing-from-review.md)
11. **save-plan: five more writes never read their error** (budgets and
    sinking_funds deletes and inserts, the review conversation) — same
    silent 200 as the category seed. —
    [ticket](tickets/save-plan-unchecked-writes.md)

## LINEU (needs Lineu, not code)

- **Device checklist on iPhone** (onboarding, quick entry, French keypad,
  share sheet, deletion + ticket 2 live check) — deletion steps on T1/T2
  only. Steps and SQL: [mobile-v1-phase2.md](mobile-v1-phase2.md).
- Incorporation, then D-U-N-S, then Google Play organization account.
- App Store submission: create the demo household per
  [mobile-v1-phase2.md](mobile-v1-phase2.md), App Store Connect listing,
  TestFlight.
- Check the onboarding funnel (signup / onboarding_entry_viewed /
  onboarding_path_chosen) once real signups exist — excluding Zezinho Test.
- *(new 2026-09-28)* The second owner in household 2be22642 has never
  accepted the terms (`terms_version` null); mobile will show them only the
  terms block until they accept on the web.

## WAITING ON DATA

- Invert the upload screen so manual entry is primary — only after the
  funnel shows households reaching the entry screen and bouncing.

## FROZEN (do not start)

Weekly check-in, event-based coaching, chat, budget alerts, review email
delivery, referral, French currency formatting on web onboarding.

## Done

| Item | Commit |
|---|---|
| Mobile V1 Phase 2, step 0 — core moves | a82271a |
| Step 1 — tab navigation + Account tab | 1e9b8cc |
| Step 2 — card room | 78b2342 |
| Step 3 — `/api/expenses` validation ([ticket](tickets/expenses-route-validation-gaps.md), closed) | 37740fa |
| Step 4 — quick entry | f4fd8fb |
| Terms gate (decision 6) | f6ada18 |
| Step 5 — onboarding gate and flow | 9f72e62 |
| Phase 2 tickets filed; cross-household refs migration written | bd52daf |
| Ticket 2 — bearer self-delete skipped global sign-out ([ticket](tickets/bearer-self-delete-skips-global-signout.md)); live check is on the LINEU device checklist | fcc0957 |
| Step 6 — account deletion | d2b31ed |
| Phase 2 handoff doc | 6a90988 |
| Cross-household references ([ticket](tickets/transactions-cross-household-references.md)): route 37740fa; migration applied, structure and behaviour verified live 2026-09-28 | 66796ec |
| "Balances begin" date ([ticket](tickets/balances-begin-wrong-date.md)) | 92ab3e7 |
| save-plan category seed checked ([ticket](tickets/category-seed-insert-unchecked.md), closed) | 000196b |
