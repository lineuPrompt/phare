# Backlog

The single ordered list of what to work on next. Rules: CLAUDE.md §9.
"STOP" means diagnose, report, and wait for approval before changing
anything (money math, dates, auth, AI output, schema, deletion — §6).

Last reconciled with `docs/tickets/` and the code: 2026-10-01 (mobile first; web functionality frozen).

## READY

**Direction (Lineu, 2026-10-01): no web functionality changes. Mobile goes
first — iOS App Store submission. Every web functionality item is FROZEN
(listed below with its ticket, so nothing is lost).**

**LAUNCH PLAN ADOPTED (Lineu, 2026-10-17): [launch-plan.md](launch-plan.md).
Phase 1 (security and correctness) is current. No feature work (S1, S4–S6)
until Phase 1 exits. Android paused. The launch plan's rows outrank this list
where they overlap.**

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
  **Decisions (Lineu, 2026-11-04: "common sense, the easiest"):** record
  `platform` on the signup event (yes); email links open the app (yes);
  the Terms drop the price (done, above). Plan awaiting approval (auth +
  DB).
  **BUILT 2026-11-05 (Lineu: "Yes sign-up"), uncommitted.** Sign in →
  "Create an account" (name, email, password, consent box with the Terms
  and the Privacy Policy readable in the app) → 6-digit code from the email
  (verifyOtp) → consent recorded → onboarding. "Forgot your password?" →
  POST /api/auth/forgot-password → code + new password. Updated terms: read
  and accept in the app. Codes, not links: links into an app break in Gmail.
  Terms moved to `@phare/core` (`TERMS_OF_SERVICE`, `CURRENT_LEGAL_VERSION`);
  version BUMPED to 2026-11-05 (everyone accepts again after the deploy).
  On screen (Android emulator): sign-in links, Create account, the consent
  box, both links (fixed: the first build's links ticked the box instead).
  NOT yet checked: the code steps live (need the email templates below),
  the reset screen and Android Back on screen (emulator hung).
  **LINEU before testing:** add `{{ .Token }}` to the Supabase "Confirm
  signup" and "Reset password" email templates.
  **WAITING:** the `signup` event's platform needs the trigger migration,
  held for the security fix below (one migration for both).
- **SECURITY: a sign-up can join any household as owner through its
  metadata** (found 2026-11-05). No sign of abuse. First fix
  (`20261105000000`, app_metadata; committed c5f12a6, APPLIED) closed the
  hole but BROKE INVITES (app_metadata is set after the trigger runs; caught
  by the live invite test). Second fix BUILT 2026-11-05, uncommitted:
  server-only `member_invites` table + trigger reads it + the route checks
  where the account landed. **FIXED AND PROVEN LIVE 2026-11-05** (2deeeda,
  migration `20261105010000` APPLIED, VERIFY 10/10): real invite joins,
  forged sign-up gets its own household. Invites are safe again. All test
  accounts (Rocky Test, Fern, Summit, Cliffs, Ridge) deleted through the
  app's deletion routes; Zezinho Test keeps Ridge's "Former member" row, by
  design. —
  [ticket](tickets/signup-metadata-joins-any-household.md)
- S1 live test 2026-11-05 on the deployed site (emulator, throwaway
  asian.rocky3618@…, household **73157e93**: exclude from every count):
  sign-up → 8-digit code → confirmed, consent recorded at 2026-11-05,
  `signup` event, onboarding shown. Reset: code requested from the app's
  Forgot password screen; the emulator then died, so the code was entered
  through the app's own two calls (verifyOtp recovery + updateUser) from a
  script: new password signs in, old one refused (400). The reset screen's
  second step is still unseen on a device.
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
- ~~**`/api/accounts` silent failures**~~ FIXED in code 2026-10-22 (launch
  plan 1.7), uncommitted. — [ticket](tickets/accounts-route-silent-failures.md)
- ~~**`GET /api/anchors` swallows a failed read**~~ FIXED in code 2026-10-22
  (launch plan 1.7), uncommitted; the web Timeline now shows load errors. —
  [ticket](tickets/anchors-get-swallows-read-error.md)
- **S4. Income and bill dates, and editing them (effective-dated, as on web).**
  BUILT 2026-10-23, uncommitted: tabs are now Home · Timeline · Cards · More
  (Review and Account moved into More, Lineu's call); Recurring in More —
  list (undated first), add a date, edit with "Applies from", new income /
  bill / contribution, delete. Server: recurring rows take the rule's member,
  GET /api/recurring reports read failures, effectiveFrom must be a calendar
  date, DELETE refuses if future rows fail to go. Committed f01d795; verified live on
  Zezinho Test after the deploy (bill rows carry no member; 2099-02-30 refused).
  2026-10-23 also: tabs relabelled as the web sidebar (Overview · Timeline ·
  Credit Cards · More); More in the sidebar's order (Goals, Reviews,
  Recurring, then Account); Goals screen (read-only, "Add money" opens a
  contribution); card categories expand to their entries (read-only).
- **S5. Cards: setup, detail, goal and category budgets** (Lineu: edit goal AND
  budgets, as on web; same closed-cycle and later-plans 409s; live write
  tests on Zezinho Test only). BUILT 2026-10-22, uncommitted: tap a card →
  its month (goal, spent, each category's budget vs spend); "Edit plan" for
  an open/future statement → goal, budgets, statement and payment days, the
  later-months choice. Device test pending. No 12-month grid yet.
- **S6. Entries: edit and delete, income, transfers.** Edit/delete of
  Timeline entries BUILT 2026-10-17, uncommitted (Lineu asked for it): tap a
  row → edit date, description, amount, category; delete with confirmation;
  transfers through `/api/transfers/[id]`; card payments not editable; no
  money in↔out switch. Adding income and contributions (savings goal or debt, payment or draw) BUILT 2026-10-22, uncommitted, verified live on Zezinho Test. Route gaps
  FIXED in code 2026-10-22 (launch plan 1.7), uncommitted:
  [ticket](tickets/expenses-patch-route-gaps.md).
- **Home ↔ Timeline month link** (Lineu, 2026-10-17): BUILT, uncommitted —
  tapping the month name opens that month on the other tab.
- **LAUNCH BLOCKER (Lineu, 2026-10-27): withdraw from savings and the
  Reserve Fund back to chequing.** "It should work exactly as the credit
  line." BUILT 2026-10-27, uncommitted. The credit line's draw now works
  from every goal account (savings, TFSA, RRSP, the Reserve Fund); a draw
  from savings is "withdrawn", from a debt "borrowed"; both stay out of
  the surplus. The route refuses a withdrawal above the balance on its date
  (`INSUFFICIENT_BALANCE`). Web: Withdraw on each savings goal and on the
  Reserve Fund (with its own withdrawals list), and on the Timeline's Add
  entry form (Reserve Fund listed first; Add money / Withdraw on savings,
  Payment / Draw on a debt; tab renamed "Savings or debt"); mobile: Add money /
  Withdraw chips in quick entry, the Reserve Fund listed there first,
  Withdraw on Goals. Overview, Home, the audit page and the monthly review
  say "withdrawn from savings", never "borrowed".
  **Migration `20261027000000_create_transfer_draw_from_savings.sql`
  APPLIED + VERIFIED LIVE 2026-10-27** (VERIFY 8/8; body md5
  90ce1fc4280b647b54b919fdc921707e, length 4189). Live RPC probe on
  Zezinho Test: +50 then a 30 withdrawal from a savings goal, both 200,
  pair stored -30/-30 and peer-linked, balance 20; probe rows deleted.
  Web deployed (c539bff + ccdd738); route VERIFIED LIVE 2026-10-29 on
  phare.money as Zezinho Test: +50, withdraw 30 → 200, balance 20;
  withdraw 100 → 400 `INSUFFICIENT_BALANCE` (available 20); probe pairs
  deleted through DELETE /api/transfers/[id], none left. STILL TO DO: ship
  the app (after the web, which is now live); device check of mobile
  quick entry Withdraw.
  Floor on edit/delete BUILT 2026-11-02, uncommitted: after an edit or a
  delete a savings-type account never goes below zero, or below the lowest
  it already reaches (400 BALANCE_WOULD_GO_NEGATIVE, said in EN/FR on the
  Goals page, the Timeline and the app; the Goals page's history edit and
  delete used to fail in silence). Still open: two withdrawals sent at the
  same instant could both pass the check.
- ~~**`POST /api/transfers` input checks**~~ FIXED in code 2026-10-29,
  uncommitted. — [ticket](tickets/transfers-post-input-gaps.md)
- ~~**`GET /api/goals` ignores read errors**~~ FIXED in code 2026-10-29,
  uncommitted (route, web Goals page, Timeline entry form). —
  [ticket](tickets/goals-get-ignores-read-errors.md)
- **Monthly review: the month-end letter gets its own row (Lineu, 2026-11-02).**
  Lineu's October review was never written: his 13 October refresh held
  October's only slot and the 1 November run could only take it over.
  BUILT 2026-11-02, uncommitted: one letter per household, month AND writer
  (month-end 'cron' + refresh 'manual', both shown — "keep both"); a missed
  month is retried on days 1–7; the run stops starting households after
  240 s. Migrations WRITTEN, NOT APPLIED: A `20261102000000` before the
  deploy, B `20261102010000` after it is live. Deployed before 7 November,
  the next run writes October for every household that missed it. Cause on
  1 November (failed vs cut off) unconfirmed: the Supabase token expired.
- **"Delete all" for a recurring bill** (Lineu, 2026-11-02). BUILT,
  uncommitted. Deleting a recurring entry (card page and Timeline on the web,
  Timeline in the app) asks "Just this one" or "All from today on". All from
  today on = the rule's own DELETE: the rule and its entries dated today or
  later; past entries and entries edited one by one stay (Lineu's answers).
  The delete confirmations on those screens now show a refusal's reason.
  Not yet checked live (needs the deploy). Found on the way, not fixed:
  [ticket](tickets/recurring-list-delete-ignores-failure.md) (the Recurring
  page's own Delete ignores a failure).
- ~~**`getHouseholdTimezone` turns a failed read into Toronto time**~~ FIXED
  in code 2026-11-02, uncommitted. —
  [ticket](tickets/household-timezone-read-error-falls-back.md)
- **Monthly review name guard false alarm** (2026-11-02): 2be22642's October
  letter failed twice on "Viagens", the category inside its goal "Ferias e
  Viagens". FIXED in code, uncommitted: every name the letter is given is
  allowed (goals, funds, debt line, category lines). Once deployed, the next
  daily run (days 1–7) writes October; check conversations for 2be22642.
- **Mid-month refresh said the month "closed"** (Zezinho, 2 November). FIXED
  in code, uncommitted: the prompt says when the month is in progress, with
  today's date, and its tone example follows.
- **S7. Household members: list, invite, remove (owner only).**
  List BUILT 2026-11-04, uncommitted: More → Household (after Recurring, as
  the web sidebar): names, email, Owner / Member / Not invited yet / Role
  unavailable, Pending, Former member, "(you)". `memberRoleView` moved into
  `@phare/core` (web re-exports it). Route verified live as Zezinho Test with
  the app's bearer token (200, owner, isMe). On screen 2026-11-05 (Android
  emulator, dev build 88fc5e7e): as Zezinho Test (Owner, you) and as the
  invited member Ridge Hazel (Member, you); the invite showed Pending until
  it was accepted. Shown to members too (the route
  answers both; the web hides the page from members). Invite, remove and
  make owner: not started (auth + deletion, plan first).
- **S8. Savings goals and sinking funds** (read-only first round, then
  creation).
  Reserve Fund BUILT 2026-11-05, uncommitted: first card on Goals (as on
  the web Goals page): balance today, contribution and next date, what it
  covers (each fund per year; excluded ones dimmed), Add money / Withdraw
  through quick entry. Hidden when there is no fund and no account. GET
  /api/sinking-funds now reports its four reads' failures (500) instead of
  a $0 Reserve Fund — needs the deploy. On screen: only the "none" case
  (Zezinho Test has no fund; funds are created by save-plan only).
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
  - App Store Connect done by Lineu 2026-10-17: group Phare Pro,
    `phare.app.pro.monthly` (CAD 14.99) and `phare.app.pro.yearly`
    (CAD 149.00), Family Sharing OFF (products replaced), Paid Apps
    Agreement done, Small Business Program pending, taxes in progress.
  - **Piece 3, the app: BUILT 2026-10-17, uncommitted** (decisions: owner
    only, expo-iap 5.8.2, deletion warns but stays possible). Phare Pro
    screen (`/pro`), Account section, "See Phare Pro" on the locked letter,
    one StoreKit listener (`IapListener`), verify-then-finish, Restore,
    Manage subscription, warning before deletion while an Apple subscription
    renews. Server accepts only `phare.app.pro.monthly/.yearly`. Native
    module: **new build needed**. Not yet tested against Apple's sandbox.
  - **Piece 5, rule and tests: DONE with piece 3.** CLAUDE.md §1/§4,
    `complianceScan`, `sourceCompliance`, `i18nParity`: "Phare Pro" and
    subscribe are allowed; typed prices, Stripe, upgrade/pricing wording and
    web pricing links are refused.
  - Piece 4: web display of an Apple subscription (Subscription section,
    `/api/me`).
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
3. ~~**The diagnostics probe calls review-stream without a session**~~ FIXED in code 2026-11-02, uncommitted (sends the bearer token).
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

- **Top recommendation falls back to code's line on Zezinho Test** (found
  2026-11-03, QA of the trends letter): in EN and FR the AI's priority failed
  its check twice and code's "Put $200.00 toward …" was used. Cause not
  confirmed; likely the AI quoting the goal's $5,000 target, which is not in
  topRecommendationAllowed. Diagnose from the `review_guard_failed` event of a
  real refresh before changing the allowed list (AI output: STOP for approval).

- ~~**Plain edit of a split rule rewrites dates before its start**~~ (the
  "double bill") FIXED in code 2026-11-05, uncommitted. Live check on Zezinho
  Test after the deploy. —
  [ticket](tickets/recurring-metadata-edit-ignores-effective-from.md)
- **A split can bring back deleted entries when a skipped-dates read fails**
  (found 2026-11-05). **STOP.** —
  [ticket](tickets/recurring-split-tombstone-reads-ignored.md)
- ~~**Web `formatDate` shows the day before in Canada**~~ FIXED in code
  2026-11-04, uncommitted (no screen was wrong yet). —
  [ticket](tickets/formatdate-utc-shifts-a-day.md)
- **Terms and Privacy: price removed, Apple billing added** (Lineu,
  2026-11-04: "remove it, the easiest"). BUILT, uncommitted. Terms: the Pro
  price is "shown before you subscribe"; Stripe on the web, Apple in the
  app; Apple refunds and cancelling through Apple. Privacy: Stripe for the
  web, Apple added. `CURRENT_LEGAL_VERSION` NOT bumped yet: a bump makes
  every app user accept again, and the app can only send them to
  phare.money until S1's in-app acceptance ships. Bump it in the same
  deploy as S1. `lastUpdated` goes with the bump. Counsel review still
  advised.
- **App Store texts for in-app purchase** written 2026-11-04:
  [app-store-listing.md §3c](app-store-listing.md) (product names and
  descriptions EN/FR, App Privacy "Purchase History", review notes).

- **Web suite: 57 tests fail on clean main** (found 2026-11-13) — the
  event-writer test double records nothing. Diagnose first.
  [ticket](tickets/web-suite-57-failing-on-main.md)

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
- ~~**save-plan: five more writes never read their error.**~~ FIXED in code
  2026-10-22 (launch plan 1.7), eight writes checked, uncommitted. A failed
  onboarding letter is said on screen, web and mobile. — [ticket](tickets/save-plan-unchecked-writes.md)
- **The AI chooses each expense's category and fixed/variable** (CLAUDE.md
  §4). **STOP.** — [ticket](tickets/plan-ai-classifies-expense-lines.md)
- ~~**save-plan seeds whatever category names the request body sends.**~~
  FIXED 2026-10-21 (launch plan 1.6, commit 1d39cd2). —
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
| Open card statement counts its actual (2026-11-13, approved by Lineu): a statement already running = actual on it so far (flag `inProgress`, basis stays `actual` so installed apps don't break); future = budget, closed = actual, unchanged. Web + app | _(Lineu)_ |
| Date pickers on every date field in the app (2026-11-13): quick entry, edit entry, balance, onboarding next payday, recurring date / end date / applies from; `@react-native-community/datetimepicker` 9.1.0 (SDK 57 pin) — needs a new build | _(Lineu)_ |
| Recurring entries keep going (2026-11-04): the daily 07:00 job tops every active rule up to 12 months ahead (deleted or edited-alone dates never come back); optional end date on web and app; migration 20261104000000 APPLIED; first run VERIFIED LIVE 2026-11-05 (all 3 real households reach Oct 2027, biweekly rhythm kept, 0 duplicates) | _(Lineu)_ |
| Monthly letter compares real months (2026-11-03): per-category trends with code-picked biggest increase/decrease, balance progress per goal/reserve/debt, last month's recommendation quoted, the bills before next month's lowest day; QA'd with a real letter over Zezinho Test data (in memory, nothing written) | _(Lineu)_ |
| Withdraw from savings and the Reserve Fund (draw from any goal account; withdrawn vs borrowed) — migration applied + verified live 2026-10-27 | _(Lineu)_ |
| POST /api/transfers input checks; GET /api/goals read errors shown, not "no goals" (2026-10-29) | _(Lineu)_ |
| "Balance today" card on the Overview above the snapshot, web and app (same component and figures as Timeline); app version 1.1.0 (2026-11-01) | _(Lineu)_ |
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
