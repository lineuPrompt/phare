# Backlog

The single ordered list of what to work on next. Rules: CLAUDE.md §9.
"STOP" means diagnose, report, and wait for approval before changing
anything (money math, dates, auth, AI output, schema, deletion — §6).

Last reconciled with `docs/tickets/` and the code: 2026-10-01 (mobile first; web functionality frozen).

## READY

**Direction (Lineu, 2026-10-01): no web functionality changes. Mobile goes
first — iOS App Store submission. Every web functionality item is FROZEN
(listed below with its ticket, so nothing is lost).**

**Direction (Lineu, 2026-10-15): the mobile app must work without the web
(CLAUDE.md §1). Submit v1.0 as tested (build 9). Standalone ships as
updates (1.1, 1.2…), in the order below. Pre-approved: existing routes only,
shared helpers moved into `@phare/core` (never copied), no DB change, no new
money math. STOP only if one of those would break or a live check fails.
One handoff per item, with the rebuild line. Gaps and estimates:
[mobile-standalone-audit.md](mobile-standalone-audit.md). Lineu approves
the v1.1 list separately.**

- ~~**S0. Early access (`EARLY_ACCESS` flag)**~~ — **dropped by Lineu,
  2026-10-16** ("that was a mistake"). The business model ($15/$150 CAD)
  stays. No free-for-all switch is to be built.
- **S1. Sign-up, in-app password reset, accepting updated terms.**
  **STOP, blocked 2026-10-15.** Three things fall outside the
  pre-approval:
  - the `signup` event needs `platform: 'mobile'`: a `handle_new_user`
    change, which is a DB change;
  - confirmation, reset and invite links open phare.money pages:
    in-app links need Supabase redirect config plus `redirectTo` in 3
    routes (auth);
  - the Terms state the Pro price (`terms.en.ts:68`), so consent text
    can't show them in the app: a copy decision with counsel.

  Details in the audit, steps 1–3 and 24–25.
- ~~**S2. Month navigation: Home, Timeline, Cards.**~~ Built 2026-10-15,
  uncommitted (handoff "S2"). Device test pending.
- ~~**S3. Accounts and opening balance.**~~ Built 2026-10-16, uncommitted
  (handoff "S3"). Device test pending. Card statement/payment days stay with
  S5; debt and line-of-credit accounts are not offered yet.
- **`/api/accounts` silent failures** (found during S3): POST answers 200
  when the opening balance fails; GET answers `[]` on a failed read. —
  [ticket](tickets/accounts-route-silent-failures.md)
- **`GET /api/anchors` swallows a failed read** (found during S2): a failed
  read answers `{ anchors: [] }` and hides every past month on both
  Timelines. — [ticket](tickets/anchors-get-swallows-read-error.md)
- **S4. Income and bill dates, and editing them (effective-dated, as on web).**
- **S5. Cards: setup, detail, goal and category budgets** (Lineu: edit goal AND
  budgets, as on web; same closed-cycle and later-plans 409s; live write
  tests on Zezinho Test only).
- **S6. Entries: edit and delete, income, transfers.**
- **S7. Household members: list, invite, remove (owner only).**
- **S8. Savings goals and sinking funds** (read-only first round, then
  creation).
- **S9. Generating a new monthly review / regenerating the plan.**
- **SECURITY, FIRST: any signed-in member can give their own household Pro**
  (found 2026-10-16). The live `households` policy allows ALL commands and
  `authenticated` may UPDATE `comp_until` and the Stripe columns through the
  public REST API. No abuse found (every comp has a known reason). Fix =
  revoke client writes + SELECT-only policy. **APPLIED and verified
  2026-10-16** (`20261016000000_households_read_only_for_clients.sql`):
  VERIFY 7/7 PASS (it gave 4 FAIL before applying). PostgREST behaviour verified
  live as Zezinho Test: read 200, PATCH refused 403/42501, row unchanged. Blocks in-app purchase (its columns would share the
  hole). — [ticket](tickets/households-billing-columns-client-writable.md)
- **In-app purchase — chosen by Lineu 2026-10-16, replaces early access.**
  Pro is sold in the iOS app through Apple (StoreKit), alongside Stripe on
  the web; one derived entitlement (Stripe OR Apple OR comp), never stored.
  Required before the standalone app can unlock or sell Pro (Guidelines
  3.1.1, 3.1.3(b)). Billing + schema + auth: **diagnose and STOP** before
  building. Apple's Small Business Program: 15% instead of 30% under
  US$1M/year — enrol before the first sale.
  Decisions (Lineu, 2026-10-16, "the simpler and easiest solution that
  follows the plan"): `expo-iap` + Apple's server library; same price as the
  web at Apple's nearest price point; the mobile "no prices" rule becomes
  "prices only from StoreKit, never a web pricing link"; Apple columns on
  `households`.
  - **Piece 1, columns + entitlement: BUILT 2026-10-16, uncommitted.**
    Migration `20261016010000_apple_subscription_columns.sql` APPLIED and
    VERIFIED LIVE 2026-10-16 (14/14 PASS; the entitlement select runs live).
    Safe to deploy the code now.
  - **Piece 2, server: BUILT 2026-10-16, uncommitted.**
    `POST /api/apple/verify` (app → server after a purchase or restore) and
    `POST /api/apple/notifications` (Apple → server). Uses
    `@apple/app-store-server-library@3.1.0`, Apple root CA G3/G2 embedded
    (fingerprints pinned by a test), and re-asks Apple for the live status
    every time. 503 `apple_not_configured` until Lineu sets the five
    `APPLE_*` env vars in Vercel (list in `src/lib/apple/appleConfig.ts`) and
    the notification URL in App Store Connect. Not exercised against Apple
    yet: needs the In-App Purchase key and a sandbox purchase (piece 3).
  - Piece 3: the app's subscribe screen (expo-iap, Restore Purchases,
    manage subscription). Native module, so a new dev build.
  - Piece 4: web display of an Apple subscription (Subscription section,
    `/api/me`).
  - Piece 5: rewrite `sourceCompliance` and `bundle:check` for "StoreKit
    prices only"; update CLAUDE.md §1 and §4.
  - Piece 6: App Review notes for in-app purchase; Terms and Privacy (Apple
    billing) to counsel.

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
     screen was checked in a throwaway prebuild. **Production build 9**
     (2026-10-15, from 9c6599f) is on TestFlight, installed on Lineu's
     iPhone through the internal group "Team (Expo)"; device findings
     pending. Built with the ASC API key (no Apple login): first production
     build interactive, `EXPO_NO_CAPABILITY_SYNC=1`, and eas-cli's token
     shortened to 19 minutes locally (eas-cli issue #4462 — reapply after any
     eas-cli upgrade; steps in the runbook, part 6). Submit takes the key from
     `eas.json`'s submit profile.
   - **`submit.production`** — ascAppId **6812001209** set 2026-10-13. The
     full step-by-step to submission (device checks, app record, EAS API
     key, demo household and its comp script, screenshots, build and submit,
     App Privacy and review notes) is
     [ios-submission-runbook.md](ios-submission-runbook.md).
   - **The Privacy Policy's Stripe sentence** — the scanner now catches
     plurals and French (2026-10-02); the sentence passes by design through
     a pinned full-sentence allowlist (EN and FR), as does the seed category
     "Utilities & Subscriptions". **Stale wording:** "once paid
     subscriptions are available" — billing has been live since August. It
     goes to counsel with the Terms; when it changes, the allowlist entry
     must change with it (a test fails until it does).
   - **Demo household** — Lineu creates and comps it (steps in the listing
     doc).
   - **Device checklist (runbook part 1), run 2026-10-14 on T1/T2:** C
     passed structurally (one plan, one letter, anchor today, pay dates within
     14 days, no member on expenses) but was done in English with other
     figures, so the French amount/refusal steps are unproven; B passed
     (12.50 on the card, yesterday, no member; 12,345 and 201 characters
     refused); D passed (T1: login, sessions, tokens gone, member row kept;
     T2: household and every row gone). Found and fixed, uncommitted: the
     Account screen's deletion field sat under the keyboard. Unverified on a
     device until the next reload.
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

**Mobile, after the iOS submission** (no new features before it):

- **Onboarding pay-date step: a date picker instead of typed `YYYY-MM-DD`**
  (Lineu, 2026-10-14, during device check C). Today the field is free text
  checked against "within the next 14 days". A native picker
  (`@react-native-community/datetimepicker`) is a native module: it needs a
  new development build and an Expo-SDK-pinned version (see the pnpm/Expo
  peer pinning rule). The quick-entry date field has the same shape.

**Web, found 2026-10-14 during the device checklist:**

- **Invite accepted in a browser already signed in as someone else:
  possible session mix-up.** T2 (island.flora8040@…) followed its invite and
  signed in at 18:35:17; ten seconds later the terms acceptance and the
  dashboard load were recorded for T1 (`users.terms_accepted_at` re-set,
  `viewed_monthly_review` with T1's user_id), and T2 stayed unaccepted. In a
  fresh private window T2 accepted normally. Not yet known whether an old T1
  tab was used or whether the set-password/accept-terms flow keeps the
  previous session. Diagnose before any fix (auth).

Weekly check-in, event-based coaching, chat, budget alerts, review email
delivery, referral, French currency formatting on web onboarding.

**Web functionality, frozen 2026-10-01 (Lineu: mobile first).** Order kept
for when it thaws:

- **Monthly review: the remaining letter-quality issues** (found 2026-10-13,
  frozen when the review work closed). The figure, name and framing guards
  hold; these are wording the guards cannot see:
  - an open card cycle with $0 spent was called "running well ahead of that
    target" (the open-cycle phrase is meant for spend past the goal so far);
  - the letter called the month's expense lines "fixed expenses" — the AI
    still classifies fixed/variable
    ([ticket](tickets/plan-ai-classifies-expense-lines.md));
  - the top recommendation suggests opening a TFSA, a product nothing in the
    payload names.
- **`events` is writable and deletable by any signed-in member** (RLS
  `FOR ALL`), so quota counters can be reset and "server only" holds for
  `/api/events` only. Schema change. —
  [ticket](tickets/events-rls-client-writable.md)
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
| Standalone S3 — accounts list, add account, chequing balance in the app; opening-balance rule moved to `@phare/core` | _(Lineu)_ |
| Standalone S2 — month navigation (Home, Timeline, Cards); month helpers moved to `@phare/core` | _(Lineu)_ |
| Mobile standalone audit (`docs/mobile-standalone-audit.md`), CLAUDE.md product rule, 1.1 review notes | _(Lineu)_ |
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
| Mobile Home tab — snapshot and Plan card, current month; household gate uses `snapshotOnly=1` ([ticket](tickets/mobile-gate-logs-review-view.md), closed); verified on device by Lineu | 8afabd5 |
| Monthly review fix A+B — reviewed-month cycles, contributions apart from requirements, funded needs skipped, real months, real savings; cards, month-over-month, month ahead, goal and reserve progress; figure and names guards | b109f6d |
| Figure guard: whole dollars a payload figure rounds to | 8e95933 |
| Extra income vs extra expenses split; typical surplus adds extra expenses back; NO FORECASTS and recommendation-source rules; framing and top-recommendation guards ([ticket](tickets/top-recommendation-unguarded-figures.md), closed). Review work CLOSED 2026-10-13 | |
