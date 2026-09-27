# Mobile V1 — Phase 1 report

Phase 1 diagnosis for the remaining mobile V1 screens. Written in a prior
Claude Code session; saved here so the plan survives across sessions.

## Before the mobile work

- CLAUDE.md commit: done in 7ba04da ("use read only key"), which adds the
  Database reads block.
- Supabase MCP: not connected at the time of writing. What the repo says,
  not verified live:
  - handle_new_user: the latest definition,
    20260904000000_restore_signup_event.sql, has both the
    provisioned-member path and the events 'signup' insert.
  - Opening-balance trigger: trg_enforce_opening_balance_account_type,
    BEFORE INSERT OR UPDATE ON transactions, in
    20260831000000_transactions_is_opening_balance.sql.
- Baseline suites: web+core 2011 passed, 1 skipped. Mobile 116 passed.

## 1. Card room (read-only)

- Web equivalent: src/app/[locale]/cards/page.tsx:149-154 and
  src/components/cards/CrossCardView.tsx.
- Logic: the server computes every figure (goal, spent, remaining,
  status), scoped by statement cycle (src/app/api/cards/overview/route.ts).
  The client only needs "this month", from businessToday (already in
  core).
- Nothing moves to core.
- Routes: GET /api/accounts, GET /api/household/timezone,
  GET /api/cards/overview?month=. All use createClient, which accepts
  bearer tokens. No route changes.
- Differences from web:
  - Web shows this panel only with 2+ cards. Mobile shows it for 1+.
  - A null goal or null room shows "—", never $0.
  - Current month only. No month picker, no envelope editor, no
    12-month grid.
- New keys:
  - cards.title — EN "Room on your cards" / FR "Marge sur vos cartes"
  - cards.goal / spent / room — "Goal / Spent / Room" /
    "Objectif / Dépensé / Marge"
  - cards.status.over / watch / ok / noGoal — "Over / Watch / OK /
    No goal" / "Dépassé / À surveiller / OK / Aucun objectif"
  - cards.noCards — "No credit cards set up yet. You can add them on
    phare.money." / "Aucune carte de crédit pour l'instant. Vous pouvez
    en ajouter sur phare.money."
  - cards.loadFailed — "Couldn't load your cards." / "Impossible de
    charger vos cartes."

## 2. Quick expense entry (write)

- Web equivalent: src/components/expenses/ExpenseForm.tsx (cards) and
  src/components/timeline/TimelineEntryForm.tsx:85 (chequing).
- V1 scope: money out, one-off, on chequing or a credit card. Fields:
  account, date (defaults to the household's today), description, an
  existing category, amount.
  - No income, recurring, installments or transfers.
  - No "new category": creating one is Pro-gated
    (src/app/api/categories/route.ts:57) and would expose a paywall on
    mobile.
- Writes: one transactions row, source='manual', member_id=null (the
  route forces this for expenses), account_id from the form.
- Server guards today: auth and household scoping (route + RLS on
  household_id); category required for expenses; expense member_id
  forced to null.
- The closed-cycle lock does not apply, on purpose
  (src/app/api/card-envelope/route.ts:220): a late-posted charge still
  belongs to its closed cycle. The lock covers the plan only.
- Route change needed: POST /api/expenses (web, separate). The server
  does not enforce today:
  - amount finite and > 0 (a negative amount is accepted and saved);
  - date format;
  - description length (breaks reject-don't-truncate);
  - an installments bound (installments: 100000 would try to insert
    100,000 rows);
  - account and category belonging to the household.
  It also returns no code, so mobile can only show a status-based
  message. Recommended: validation plus a code on every error before
  this screen ships.
- Moves into core:
  - parseAmountInput(raw, locale), new. On an fr-CA iPhone the decimal
    keypad types "12,50"; web's parseFloat turns that into 12, silently.
    The parser must reject anything it cannot read exactly, never
    truncate. Quick entry and onboarding both need it.
  - The canSave predicate, extracted from ExpenseForm, with a web stub.
- Mobile must never: trust its own validation in place of the server's;
  show the entry before the 200; default the member; send repeat or
  installments.
- New keys: entry.title ("Add an expense" / "Ajouter une dépense"),
  account, date, description, category, amount, save, saving, saved
  ("Saved." / "Enregistrée."), amountInvalid, and one key per new server
  code. All EN/FR.

## 3. Manual onboarding (write)

- Web equivalent: src/app/[locale]/upload/page.tsx (manual branch), with
  ManualForm, PlausibilityCheck, AccountStep, PlanDisplay, AnchorDateStep.
- Sequence:
  1. Form -> buildCalculatedFromFormLines -> runPlausibilityGuard (both
     in core).
  2. Accounts step: card names and opening balance.
  3. POST /api/plan.
  4. POST /api/review-stream?stream=0.
  5. POST /api/save-plan. If the review failed, save still happens with
     a localized placeholder reviewText.
  6. Only after the save: POST /api/anchors (chequing, household today).
  7. If needsPayDate: PATCH /api/recurring/[id] per item.
  8. Entry point: hasPlan from GET /api/dashboard (true once a
     file_imports row exists; manual save-plan writes one too).
- Already in core: form-to-calculated, the plausibility guard,
  hasNonMonthlyLines, and all AnchorDateStep validators.
- Moves (web stubs; tests move with the code):
  - canGoToDashboard (src/lib/onboardingCompletion.ts) and
    formatResetDate (the pure part of onboardingQuota.ts).
  - Three pure decisions extracted from upload/page.tsx: error code ->
    message key; what to do after the save (needsConfirmation /
    needsPayDate / done); whether to anchor.
  Streaming stays per-platform. Touches the web onboarding page — needs
  explicit approval.
- Routes: all bearer-capable. No route changes.
- Server guards: requireOnboardingGeneration (auth + monthly
  per-household quota, reserved before generation;
  ONBOARDING_QUOTA_EXHAUSTED with resetsOn); body-size caps (413
  PAYLOAD_TOO_LARGE); save-plan's replace confirmation; /api/anchors
  refuses a future date. The opening-balance trigger does not apply here
  (chequing opening balance is an account_balance_anchors row).
- Mobile must never: send confirmReplace: true (on needsConfirmation,
  stop and say to finish on the web — replacing data stays web-only in
  V1); retry /api/plan in a loop (each call uses a quota slot); anchor
  before the save succeeds.
- New keys: about 60 under onboarding.* (form, plausibility, accounts,
  plan, payDates, errors), adapted from web upload.*, which contains no
  prices. All run through the compliance scan. Full list in the handoff.

## 4. Account deletion (write)

- Web equivalent: src/components/household/DeleteAccountSection.tsx.
- Routes: GET /api/household/deletion-preview, DELETE /api/me (Case B),
  DELETE /api/household (Case A). All bearer-capable. No route changes.
- Both cases:
  - self_delete: type your email, then DELETE /api/me.
  - household_delete: show what would be destroyed, type the household
    name, then DELETE /api/household. all_pending adds an
    acknowledgement checkbox.
  - After 200 or 202, mobile signs out locally.
- Server guards: re-computes the verdict (never trusts the preview),
  matches the confirmation phrase, cancels any Stripe subscription
  before deleting, records intent before either change.
- Moves: confirmationMatches to core, stub in accountDeletionHelpers.ts.
  The web component re-implements it inline (phraseMatches) — an
  existing duplicate, fixed here. DeletionVerdict type moves too.
- Mobile i18n has no ICU plurals: blast radius shown as label/count rows
  ("Transactions: 1 204").
- Gaps vs. web:
  - Export first. Recommended (a): fetch /api/export/transactions with
    bearer auth and hand it to React Native's Share (no new native
    dependency). Alternative (b): plain text "Download your data on
    phare.money first".
  - blocked_promote. Web says "promote someone using the button above"
    (household management, out of scope). Apple 5.1.1(v) expects
    deletion doable in-app. Recommended: one Promote button inside the
    blocked state (POST /api/household/members/[id]/promote), nothing
    else from household management.
- Keys: EN from web deleteAccount.* minus the "button above" sentence.
  FR re-checked for Quebec typography (U+00A0 before ":").

## 5. Navigation

- Tabs: Review | Timeline | Cards | Account, via expo-router/js-tabs
  (ships in expo-router 57.0.17, no native module, no rebuild). Account
  tab: email, sign out, delete.
- Quick entry: modal route /add, opened from "+" in Timeline and Cards
  headers. Not a tab.
- Onboarding: OnboardingGate next to AuthGate; when hasPlan=false the
  onboarding flow replaces the tabs.
- The Timeline's "Monthly review" header link goes away.

## Decisions requested

- Account deletion: both cases work; gaps are export and promote.
- Sign-up options:
  - A. In-app sign-up with consent capture. Catch: Terms show
    "$15 CAD / $150 CAD" (src/content/legal/terms.en.ts:68), so linking
    or embedding brings a price into the app.
  - B. Sign-in only: neutral copy, no create-account link, demo account
    in App Review notes. Accepted under 3.1.3(b); avoids steering.
  - C. Web view of the signup page. Worst of both.
  Recommended: B for the first submission, A later with a price-free
  Terms version. Either way, mobile has no terms-acceptance gate today;
  /api/me already returns termsCurrent, so mobile should gate on it.

## Out-of-scope bugs to file under docs/tickets/

1. The diagnostics probe cannot pass: it calls /api/review-stream
   without a session, and the route now requires one (always 401).
2. Remote sign-out may not happen on mobile: DELETE /api/me does its
   global sign-out through getSession(), probably empty on the bearer
   client. If so, the refresh token survives the 202 partial case.
3. Cross-household account_id: the transactions policy checks
   household_id but not that account_id belongs to the household.
4. The /api/expenses validation gaps from section 2, if not approved as
   a route change.

## Proposed build order (one commit each)

0. Core moves plus web stubs (confirmationMatches, canGoToDashboard,
   formatResetDate, the onboarding decisions, parseAmountInput, canSave).
1. Tab navigation plus the Account tab (sign out only).
2. Card room.
3. /api/expenses route change (separate web commit, if approved).
4. Quick entry.
5. Onboarding gate and flow.
6. Account deletion.
7. bundle:check and the device checklist.
