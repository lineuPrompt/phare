# Backlog

The single ordered list of what to work on next. Rules: CLAUDE.md §9.
"STOP" means diagnose, report, and wait for approval before changing
anything (money math, dates, auth, AI output, schema, deletion — §6).

Last reconciled with `docs/tickets/` and the code: 2026-10-01 (mobile first; web functionality frozen).

## READY

**Direction (Lineu, 2026-10-01): no web functionality changes. Mobile goes
first — iOS App Store submission. Every web functionality item is FROZEN
(listed below with its ticket, so nothing is lost).**

1. **iOS App Store submission readiness — report only.** Everything left
   between today and submission, in order, each marked Claude Code / Lineu /
   needs a decision: device checklist, App Review demo household, EAS
   production build and submit config, App Store Connect listing, App
   Review notes, deep links, anything that would fail review.
   *Reported 2026-10-01; decisions 2026-10-02.* Built 2026-10-02,
   uncommitted: universal links claim no path (reset/invite links open in
   Safari again — confirm the live file after deploy); Privacy Policy
   screen in the app (text moved verbatim to `@phare/core`); `/diagnostics`
   development-only; `supportsTablet: false`; version 1.0.0; duplicate
   applinks removed; dashboard button "Build your plan"; listing draft in
   [app-store-listing.md](app-store-listing.md) awaiting approval.
   Still open:
   - **App icon and splash** — final art wired in 2026-10-05 (icon.png;
     splash.png through the `expo-splash-screen` plugin, 200 pt on #02245E;
     Android adaptive icon from adaptive-icon.png). The generated iOS launch
     screen was checked in a throwaway prebuild. **Needs a new EAS build**
     to appear; unverified on a device until then.
   - **`submit.production`** — waits on the ascAppId from Lineu.
   - **The Privacy Policy's Stripe sentence** — the scanner now catches
     plurals and French (2026-10-02); the sentence passes by design through
     a pinned full-sentence allowlist (EN and FR), as does the seed category
     "Utilities & Subscriptions". **Stale wording:** "once paid
     subscriptions are available" — billing has been live since August. It
     goes to counsel with the Terms; when it changes, the allowlist entry
     must change with it (a test fails until it does).
   - **Demo household** — Lineu creates and comps it (steps in the listing
     doc).
2. **`apps/mobile/app.json` → `app.config.ts`** reading the bundle id and
   Android package from the same env vars the web's well-known routes use. —
   [ticket](tickets/mobile-app-config-from-env.md)
   *Set aside by Lineu, 2026-10-09, in favour of items 6 and 7. Not
   started. On iOS the ticket's failure mode cannot occur while the
   association file claims no paths.*
3. **The diagnostics probe calls review-stream without a session**
   (decided 2026-09-28: send the bearer token; keep it a manual, labelled
   button, one review generation per deliberate press; do not retire it). —
   [ticket](tickets/diagnostics-probe-review-stream-401.md)
4. **Android: verify `/diagnostics`** (Hermes timezone probe) on an EAS cloud
   build — local builds fail on Windows path length. —
   [ticket](tickets/android-diagnostics-verification.md)
5. **Web onboarding entry screen — visual only** (Lineu, 2026-10-01): the
   step-by-step form becomes the primary action on /upload; the template
   download and file drop move below it as "Prefer a spreadsheet? Import
   from our template." Same form, steps, routes and funnel events. EN/FR.
   *Built 2026-10-01 (layout and copy only); committed by Lineu in 2346046.*
6. **Monthly review fix — correctness and substance** (Lineu, 2026-10-09;
   approved as a correctness exception to the freeze). **Must be live
   before the 2026-11-01 cron run.** *Design delivered 2026-10-09; waiting
   on Lineu's approval before any code.* Part A: over-target check on the
   reviewed month's cycles; actual contribution rule and deposits separate
   from the required amount; skip needs the plan already funds; a
   card-only month is not a real month; real savings total. Part B: card
   goal vs actual and top overspends, surplus and savings by destination,
   month-over-month, the month ahead, goal and reserve progress. New guard:
   every dollar figure in a letter must be in its payload, or the letter is
   not saved. The same guard covers the onboarding letter (FROZEN list).

**Dropped by Lineu, 2026-10-01:**

- ~~Minimal first session~~ — the existing onboarding stays as the only
  onboarding. Its core rules (1abe296) are reverted; the unapplied
  `save_first_session` migration is deleted (confirmed absent from the
  database). Kept from that work: the seed-category list in `@phare/core`
  (72e40d8).
- ~~Web manual form: require an income line, refuse a half-filled line~~ —
  [ticket](tickets/web-manual-form-accepts-empty.md) stays filed.
- ~~Ask the day of month on monthly lines~~ — the 1st-of-month dating stays
  as it is. Diagnosis kept in the
  [ticket](tickets/monthly-recurring-dated-first-of-month.md); Lineu edits
  2be22642's seven lines on the Recurring page himself.

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

- *(new 2026-09-29)* Visa Avion (2be22642): re-save **October** (the open
  cycle — September closed on the 27th and is locked) and answer **Replace**
  when asked about November and December. They still hold the Aug 6 plan
  (Groceries $550).

## WAITING ON DATA

- (none — the upload-screen inversion became READY item 5, visual only.)

## FROZEN (do not start)

Weekly check-in, event-based coaching, chat, budget alerts, review email
delivery, referral, French currency formatting on web onboarding.

**Web functionality, frozen 2026-10-01 (Lineu: mobile first).** Order kept
for when it thaws:

- **Guard the onboarding letter** — options reported 2026-09-29; the letter
  is still unguarded and needs a decision. **STOP.** —
  [ticket](tickets/onboarding-review-unguarded.md)
- **Onboarding funnel: the real-screen run** — events built (80e6981,
  1226134) and verified on Zezinho Test; no run through the actual screens.
- **save-plan: five more writes never read their error.** —
  [ticket](tickets/save-plan-unchecked-writes.md)
- **The AI chooses each expense's category and fixed/variable** (CLAUDE.md
  §4). **STOP.** — [ticket](tickets/plan-ai-classifies-expense-lines.md)
- **save-plan seeds whatever category names the request body sends.** —
  [ticket](tickets/save-plan-client-chooses-seed-categories.md)
- **POST /api/recurring attributes an expense rule's transactions to its
  creator** (CLAUDE.md §4); 0 live rows. —
  [ticket](tickets/recurring-post-expense-rows-attributed-to-creator.md)
- **The manual-entry amount ceiling is above what the columns hold**
  (999,999,999.99 vs `numeric(10,2)`). —
  [ticket](tickets/manual-entry-max-amount-exceeds-column.md)
- **splitRule duplicate materialization.** **STOP.** —
  [ticket](tickets/splitrule-detached-duplicate-materialization.md)
- **Recurring expense/income divergence on the Timeline.** **STOP.** —
  [ticket](tickets/recurring-expense-income-divergence.md)
- **Cards: month-by-month table gets its own month navigation.** —
  [ticket](tickets/cards-grid-independent-month-nav.md)
- **Dashboard's divergent `formatResetDate`.** —
  [ticket](tickets/dashboard-format-reset-date-duplicate.md)
- **Date-serial coercion** in Household answers. —
  [ticket](tickets/household-answer-date-serial.md)
- **Household info never reaches the review route.** **STOP.** —
  [ticket](tickets/household-info-missing-from-review.md)
- **Cards grid: plan reads never check their error.** —
  [ticket](tickets/cards-grid-plan-read-unchecked.md)
- **Card plan editor: three hardcoded English strings.** —
  [ticket](tickets/card-editor-hardcoded-english.md)
- **Timeline plan chain resolves card goals with its own function.**
  **STOP.** — [ticket](tickets/timeline-card-plan-own-resolver.md)

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
| Funnel trail events built (web + mobile); data path verified live on Zezinho Test (real-screen run frozen) | 80e6981 |
| Onboarding audit as a stranger (report, 2026-09-29; findings accepted) | — |
| Template shipped with no household data ([ticket](tickets/template-prefilled-sample-figures.md), closed) | 57983b8 |
| "Takes about 10 minutes" removed from the template card, EN/FR | 7abf46e |
| Required `platform` ('web' \| 'mobile') on every funnel event | 1226134 |
| Mobile Home tab — snapshot and Plan card, current month; household gate uses `snapshotOnly=1` ([ticket](tickets/mobile-gate-logs-review-view.md), closed) | |
