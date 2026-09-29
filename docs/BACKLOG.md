# Backlog

The single ordered list of what to work on next. Rules: CLAUDE.md §9.
"STOP" means diagnose, report, and wait for approval before changing
anything (money math, dates, auth, AI output, schema, deletion — §6).

Last reconciled with `docs/tickets/` and the code: 2026-09-29 (priority reset).

## READY

**Priority reset (Lineu, 2026-09-29): the failure point is onboarding.**
Three external households signed in and never entered data; none has ever
reached a plan, Timeline or review. Items 1–4 come first, in order. The App
Store submission waits until the approved minimal path ships on mobile.

1. **Complete the onboarding funnel trail** (build, then verify): the held
   events `onboarding_upload_rejected {reason}` (server, /api/upload),
   `onboarding_step_reached {step}`, `onboarding_plausibility_resolved
   {action}`, `onboarding_template_downloaded`; mobile emits the same step
   events. Verify with a throwaway T1 signup (template + manual on web,
   manual on mobile), read the whole trail through MCP, delete T1 through
   the app. Any gap is a finding.
   *Built 80e6981; each new event's data path verified live on Zezinho
   Test 2026-09-29. Waiting on the T1 run through the real screens (LINEU).*
2. **Audit onboarding as a stranger — report only.** Both paths, web and
   mobile: minutes to finish for a two-income, two-card household; what
   they must have on hand; every required field (file:line); every screen
   and decision; what could wait until after first value, and what breaks
   if it's missing.
   *Reported 2026-09-29.*
3. **Propose a minimal first session (<5 min to a first useful view),
   unassisted, web and mobile. Don't build. STOP.** Say what degrades for
   each deferred input and how it's prompted later, and whether the AI plan
   and letter belong in the first session.
   *Proposed 2026-09-29 — waiting on approval.*
4. **Guard the onboarding letter — diagnose, STOP.** Same sourcing,
   borrowed-cash and token-leak guards (and retry) as
   `monthlyReviewService`; options for streaming vs guarding, trade-offs,
   retry quota cost. — [ticket](tickets/onboarding-review-unguarded.md).
   (4b, the category-seed check, shipped in 000196b.)
   *Options reported 2026-09-29 — waiting on approval.*

Found by the audit (2026-09-29), ahead of the older list because each sits
on a first session:

- **Template ships pre-filled with example figures** that parse as the
  household's own. — [ticket](tickets/template-prefilled-sample-figures.md)
- **save-plan: five more writes never read their error** — on every first
  session's save step. — [ticket](tickets/save-plan-unchecked-writes.md)
- **Web manual form builds a plan from nothing** and drops half-filled lines
  silently. — [ticket](tickets/web-manual-form-accepts-empty.md)
- **The AI chooses each expense's category and fixed/variable** (CLAUDE.md
  §4), which decides whether a bill reaches the Timeline. **STOP.** —
  [ticket](tickets/plan-ai-classifies-expense-lines.md)
- **Every monthly bill and paycheque is dated the 1st.** **STOP.** —
  [ticket](tickets/monthly-recurring-dated-first-of-month.md)

5. **splitRule duplicate materialization.** Rows detached without a
   tombstone survive its delete-by-`recurring_item_id` and are materialized
   again (reported cost: 44 rows, once). **STOP.** —
   [ticket](tickets/splitrule-detached-duplicate-materialization.md)
6. **Recurring expense/income divergence on the Timeline.** **STOP.** —
   [ticket](tickets/recurring-expense-income-divergence.md)
7. **Cards: month-by-month table gets its own month navigation**,
   independent of the page-level selector. Reuse the existing month control.
   — [ticket](tickets/cards-grid-independent-month-nav.md)
8. **Two safe Phase 2 tickets:** the diagnostics probe calling review-stream
   without a session ([ticket](tickets/diagnostics-probe-review-stream-401.md) —
   decided 2026-09-28: send the bearer token; keep it a manual, labelled
   button, one review generation per deliberate press; do not retire it),
   and the dashboard's divergent `formatResetDate`
   ([ticket](tickets/dashboard-format-reset-date-duplicate.md)).
9. **Date-serial coercion:** an Excel date in a Household answer reaches the
   prompt as "46265.83". Read `cell.w` for that column. —
   [ticket](tickets/household-answer-date-serial.md)
10. **`apps/mobile/app.json` → `app.config.ts`** reading the bundle id and
   Android package from the same env vars the web's well-known routes use. —
   [ticket](tickets/mobile-app-config-from-env.md)
11. **Android: verify `/diagnostics`** (Hermes timezone probe) on an EAS cloud
    build — local builds fail on Windows path length. —
    [ticket](tickets/android-diagnostics-verification.md)
12. **Household info never reaches the review route**, so the Quebec /
    out-of-province-employer tax gap can surface only in the onboarding plan.
    Product decision — diagnose and propose, **STOP.** —
    [ticket](tickets/household-info-missing-from-review.md)
13. **Cards grid: plan reads never check their error.** A failed read renders
    as "no plan" beside a decision view that shows a 500. —
    [ticket](tickets/cards-grid-plan-read-unchecked.md)
14. **Card plan editor: three hardcoded English strings** ("Allocated:",
    two error fallbacks). — [ticket](tickets/card-editor-hardcoded-english.md)
15. **Timeline plan chain resolves card goals with its own function**, which
    carries goals into closed cycles where Cards does not. Not a live wrong
    figure yet. **STOP.** — [ticket](tickets/timeline-card-plan-own-resolver.md)

## LINEU (needs Lineu, not code)

- **Device checklist on iPhone** (onboarding, quick entry, French keypad,
  share sheet, deletion + ticket 2 live check) — deletion steps on T1/T2
  only. Steps and SQL: [mobile-v1-phase2.md](mobile-v1-phase2.md).
- Incorporation, then D-U-N-S, then Google Play organization account.
- App Store submission — **on hold until the approved minimal first session
  ships on mobile** (2026-09-29). Then: create the demo household per
  [mobile-v1-phase2.md](mobile-v1-phase2.md), App Store Connect listing,
  TestFlight.
- Check the onboarding funnel (signup / onboarding_entry_viewed /
  onboarding_path_chosen) once real signups exist — excluding Zezinho Test.
- *(new 2026-09-28)* The second owner in household 2be22642 has never
  accepted the terms (`terms_version` null); mobile will show them only the
  terms block until they accept on the web.

- *(new 2026-09-29)* Visa Avion (2be22642): re-save **October** (the open
  cycle — September closed on the 27th and is locked) and answer **Replace**
  when asked about November and December. They still hold the Aug 6 plan
  (Groceries $550).

- *(new 2026-09-29)* **T1 funnel run** (backlog item 1): sign up a
  throwaway T1 on web, run the template lane once and the manual lane once,
  the manual lane on mobile if a device run is possible, then delete T1
  through the app. Tell Claude when done; it reads the trail through MCP.

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
| Carry-forward ([ticket](tickets/carry-forward-older-future-snapshot-outranks-newer-edit.md), closed): one read rule, save asks about later plans, review judges the carried plan; verified live on Zezinho Test | 909f9c8, 76927aa, 60c9f5b |
| Funnel trail events built (web + mobile); data path verified live on Zezinho Test — T1 run pending | 80e6981 |
