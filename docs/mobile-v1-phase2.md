# Mobile V1 — Phase 2 report

Built 2026-09-27/28 from [mobile-v1-phase1.md](mobile-v1-phase1.md) and the
decisions given on it. One commit per step. Nothing has been run on a device;
everything below marked "unverified on device" is exactly that.

## Suite counts

| After | Web+core (root) | of which core | Web only | Mobile |
|---|---|---|---|---|
| Baseline (19fa835) | 2011 + 1 skipped | 250 | 1761 | 116 |
| 0 core moves (a82271a) | 2066 + 1 | 305 | **1761** (unchanged, as required) | 116 |
| 1 tabs (1e9b8cc) | 2066 + 1 | 305 | 1761 | 117 |
| 2 card room (78b2342) | 2066 + 1 | 305 | 1761 | 133 |
| 3 /api/expenses (37740fa) | 2163 + 1 | 319 | 1844 | 133 |
| 4 quick entry (f4fd8fb) | 2172 + 1 | 328 | 1844 | 162 |
| terms gate (f6ada18) | 2172 + 1 | 328 | 1844 | 172 |
| 5 onboarding (9f72e62) | 2172 + 1 | 328 | 1844 | 234 |
| tickets + migration (bd52daf) | 2172 + 1 | 328 | 1844 | 234 |
| ticket 2 fix (fcc0957) | 2176 + 1 | 328 | 1848 | 234 |
| 6 deletion (d2b31ed) | **2176 + 1** | **328** | **1848** | **265** |

Typecheck clean on both. Whole-repo lint: 14 problems before and after (all
pre-existing; read once — the four warnings are dead locals, the ten errors
are `set-state-in-effect`, none in files this work changed except
`ExpenseForm.tsx:38-39`, which predate it).

Machine-load note: two full root runs during step 0 failed 3–6 tests with
5-second timeouts at 77% CPU; the failing files passed alone and the set
changed run to run. Every count above is from a clean run.

## Mutation totals

| Step | Caught | Survived |
|---|---|---|
| 0 core moves | 30 | 0 |
| 1 tabs | 7 | 0 |
| 2 card room | 13 | 0 |
| 3 /api/expenses | 32 | 3 (all equivalent — see step 3) |
| 4 quick entry (+ core addCalendarDays) | 21 | 0 (one survivor fixed by a new UTC+14 test) |
| terms gate | 7 | 0 |
| 5 onboarding + plan gate | 23 | 0 |
| ticket 2 fix | 6 | 0 |
| 6 deletion | 15 | 0 |

---

## Step 0 — core moves (a82271a)

1. **Feature** — Shared decisions moved into `@phare/core` with web
   re-exports: `canGoToDashboard`, `formatResetDate`, `DeletionVerdict`,
   `confirmationMatches`; three decisions extracted from `upload/page.tsx`
   (`onboardingErrorKind`, `afterSaveOutcome`, `openingAnchorValue`); new
   `parseAmountInput` and `canSaveExpense`.
2. **Files Changed** — `packages/core/src/{onboarding,accountDeletion,entry}.ts`
   (new), `packages/core/src/index.ts`, `packages/core/README.md`,
   `src/lib/{onboardingCompletion,onboardingQuota,accountDeletionHelpers}.ts`,
   `src/app/[locale]/upload/page.tsx`, `src/components/expenses/ExpenseForm.tsx`,
   `src/components/household/DeleteAccountSection.tsx`,
   `src/lib/__tests__/onboardingCompletion.test.ts`, two new core test files.
3. **DB Changes** — none.
4. **API Changes** — none.
5. **UI Changes** — none intended. `DeleteAccountSection` now uses
   `confirmationMatches` instead of its inline copy; the only input that
   behaves differently is a whitespace-only phrase (the inline copy enabled
   the button for it, the route refused it).
6. **Tests Added** — 55 core tests. Web tests left in place (web-only count
   unchanged at 1761). `onboardingCompletion.test.ts` repointed at the core
   file and its slice guarded: an `indexOf` of -1 would have let two
   `not.toContain` assertions pass against one character. Mutations 30/0.
7. **Known Limitations** — `parseAmountInput(raw)` takes no locale (the Phase
   1 signature had one): the rule is locale-independent and refuses anything
   ambiguous. The `upload/page.tsx` and `ExpenseForm` wiring is proven by
   typecheck and reading, not by a render test.
8. **Areas of Risk** — the web onboarding page (touched with approval).
9. **Manual Test Steps** — web: manual onboarding with a quota-exhausted
   household still shows the reset date; a card expense form still disables
   Save for an empty description.

## Step 1 — tab navigation + Account tab (1e9b8cc)

1. **Feature** — Review | Timeline | Account tabs (`expo-router/js-tabs`, no
   native module). Account tab: email and sign-out.
2. **Files Changed** — `apps/mobile/app/(tabs)/{_layout,index,timeline,account}.tsx`,
   `src/components/TabsLayout.tsx`, `src/screens/AccountScreen.tsx`,
   `ReviewScreen.tsx`, `TimelineScreen.tsx`, catalogues, `timelineLoader.test.ts`.
3. **DB Changes** — none. 4. **API Changes** — none.
5. **UI Changes** — tab bar; the Review header's sign-out and Timeline link
   and the Timeline's "Monthly review" link removed.
6. **Tests Added** — gate structure rewritten; new tripwire: any top-level
   route outside `(tabs)` must be gated or listed as public. Mutations 7/0.
7. **Known Limitations** — labels only, no icons.
8. **Areas of Risk** — found while building: with the default `global`
   scope, an offline `signOut()` returns an error **without** clearing the
   local session (auth-js 2.110). The old header link ignored it; the tab now
   says so.
9. **Manual Test Steps** — see the device checklist, section A.

## Step 2 — card room (78b2342)

1. **Feature** — Cards tab: goal, spent, room, status per credit card for the
   household's current month.
2. **Files Changed** — `src/lib/cardsLoader.ts`, `src/screens/CardsScreen.tsx`,
   `app/(tabs)/cards.tsx`, `TabsLayout.tsx`, `timelineView.ts`
   (`formatMonthLong`, moved out of `ReviewScreen`), catalogues, tests.
3. **DB Changes** — none. Columns the route reads checked live.
4. **API Changes** — none.
5. **UI Changes** — new tab. Shown for 1+ cards (web: 2+). Null goal/room
   render "—".
6. **Tests Added** — 16. Mutations 13/0.
7. **Known Limitations** — current month only. `line_of_credit` accounts are
   not listed (the route never returned them; none exist live).
8. **Areas of Risk** — low; every figure is the server's.
9. **Manual Test Steps** — checklist A.

## Step 3 — /api/expenses validation (37740fa, web)

1. **Feature** — body validation and account/category ownership checks.
2. **Files Changed** — `src/lib/expenseRequest.ts` (new),
   `src/app/api/expenses/route.ts`, its test,
   `src/lib/__tests__/expenseRequest.test.ts`, core `dateHelpers.ts`
   (`isCalendarDate`) and `entry.ts` (`MANUAL_ENTRY_*` limits).
3. **DB Changes** — none.
4. **API Changes** — `POST /api/expenses`: 16 KB cap (413); amount number
   > 0, ≤ 999,999,999.99, ≤ 2 decimals; real calendar date; description
   required, ≤ 200 chars (longest live: 34); installments 2–48; UUID ids;
   account and category looked up scoped to the caller's household; lookup
   errors are `LOOKUP_FAILED` (500), not "not found". Every refusal is
   `{ code, error }`.
5. **UI Changes** — web forms show more specific English errors.
   Installments of 1 are now refused instead of silently saving one row.
6. **Tests Added** — 65 validator + 18 route (real route, recording mock
   that proves `.eq('household_id', …)` on each lookup and no insert on
   refusal). Mutations 32 caught, 3 survived — all equivalent: the finite
   check is covered by the ceiling (JSON cannot carry NaN; `1e999` is
   Infinity), the `typeof` check by `Number.isFinite` (strings fail it), and
   `isCalendarDate`'s month check by its year check (month overflow rolls
   the year).
7. **Known Limitations** — an unrecognised `repeat` still means "once". No
   date range bound.
8. **Areas of Risk** — money input. Live check: all 5 existing ≤ 0 amounts
   are `transfer` rows written by `/api/transfers`, which this route does not
   serve.
9. **Manual Test Steps** — web: add a card expense with amount -5 via the
   console → 400 `INVALID_AMOUNT`; normal expense still saves.

## Step 4 — quick entry (f4fd8fb)

1. **Feature** — `/add` modal from "+" in Timeline and Cards.
2. **Files Changed** — `app/add.tsx`, `app/_layout.tsx`,
   `src/lib/{quickEntry,entryEvents}.ts`, `src/screens/QuickEntryScreen.tsx`,
   `src/components/AddEntryButton.tsx`, Timeline/Cards screens, core
   `addCalendarDays`, catalogues, tests.
3. **DB Changes** — none (writes `transactions` through the route).
4. **API Changes** — none.
5. **UI Changes** — account chips (chequing first, then cards), Today /
   Yesterday / typed date, description, existing category, amount. Stays
   open after a save with account/category/date kept.
6. **Tests Added** — 29 mobile + 8 core. The body builder sends exactly six
   fields (no member, repeat, installments). Every runtime message key is
   resolved in both locales by the test, since the parity extractor cannot
   see them. Mutations 21/0 (the local-time `addCalendarDays` mutant passed
   on this UTC-4 machine; a test pinned to UTC+14 now catches it).
7. **Known Limitations** — no native date picker (typed `YYYY-MM-DD` plus two
   chips). Category names are shown as stored (`name`); `name_fr` exists in
   the table but the categories route does not return it — same as web.
8. **Areas of Risk** — money input on a French keypad: `parseAmountInput`.
9. **Manual Test Steps** — checklist B.

## Terms gate (f6ada18) — decision 6

1. **Feature** — `HouseholdGate` inside `AuthGate` (tabs and `/add`): when
   `/api/me` says `termsCurrent: false`, the app shows exactly "Our terms were
   updated. Review and accept them on phare.money, then sign in again." and a
   sign-out control. No link, no figure. A missing/non-boolean flag is an
   error with retry.
2. **Files Changed** — `src/lib/householdGate.ts`, `src/components/HouseholdGate.tsx`,
   `TabsLayout.tsx`, `app/add.tsx`, `apiErrors.ts` (`resetsOn`), `api.ts`
   (`apiPatch`), catalogues, tests.
3. **DB Changes** — none. **Live fact:** one user in household 2be22642 (the
   second owner, `terms_version` null) will see this block until they accept
   on the web. Everyone else is current.
4. **API Changes** — none.
5–6. Tests 10, mutations 7/0 (including copy containing a link).
7. **Known Limitations** — sign-in only, as decided: no create-account link.
8. **Areas of Risk** — a deploy that drops `termsCurrent` from `/api/me` shows
   everyone an error, by design, rather than letting them through.
9. **Manual Test Steps** — checklist A0 (optional, needs a write).

## Step 5 — onboarding (9f72e62)

1. **Feature** — no plan (`/api/dashboard` `hasPlan: false`) → the manual
   onboarding flow in place of the tabs: form → plausibility → accounts →
   plan → review (`?stream=0`) → save → anchor → pay dates → done.
2. **Files Changed** — `src/lib/onboardingFlow.ts`,
   `src/screens/OnboardingScreen.tsx`, `householdGate.ts`, `HouseholdGate.tsx`,
   catalogues (~80 keys), tests.
3. **DB Changes** — none. Writes `file_imports`, `recurring_items`, accounts,
   `conversations`, `account_balance_anchors`, events — all through routes.
4. **API Changes** — none.
5. **UI Changes** — the whole flow.
6. **Tests Added** — 57 + 5 gate. Proven: amounts go through
   `parseAmountInput` and are re-written canonically (core's builder uses
   `parseFloat`, which would read "1 234,56" as 1); a half-filled line is
   refused (the web silently drops it); `/api/plan` once per press;
   `confirmReplace` always false; no anchor on `needsConfirmation`; anchor
   dated in the household zone; pay-date PATCH omits `memberId`; the
   dashboard is never asked for a terms-blocked person. Mutations 23/0.
7. **Known Limitations** — manual lane only (no template upload). Pay dates
   are saved one at a time, attribution as the server assigned it. Replacing
   an earlier plan is web-only (`needsConfirmation` stops with a message).
   Opening balance cannot be negative on the iOS decimal pad (no minus key).
   `canGoToDashboard` moved to core but the linear mobile flow does not use
   it (its "done" screen appears only after a save). French avoids
   "par mois" because the compliance scan refuses it.
8. **Areas of Risk** — AI calls and the monthly quota; `/api/dashboard` has
   side effects (daily `returned` heartbeat, bridge materialisation) that a
   mobile open now triggers like a web one.
9. **Manual Test Steps** — checklist C.

## Tickets + migration (bd52daf)

Filed under `docs/tickets/`: diagnostics probe 401 (file only), bearer
self-delete sign-out (fixed next), cross-household references (migration),
expenses validation (closed by 37740fa), dashboard `formatResetDate`
duplicate (new, file only).

**Ticket 3 — the route fix does not close it.** Any signed-in client holds a
user JWT plus the anon key and can write through PostgREST directly. Live
policy: `ALL USING (household_id IN …)`, nothing on referenced rows.

**Migration** `supabase/migrations/20260928000000_transactions_same_household_refs.sql`
— **WRITTEN, NOT APPLIED.** `SECURITY DEFINER` trigger, `BEFORE INSERT OR
UPDATE OF household_id, account_id, bridge_source_account, category_id`,
refusing another household's account or category (42501). Production before
writing: 0 cross-household account, category, member or recurring rows. The
VERIFY block (BEGIN/ROLLBACK) checks the trigger, the full function body via
`prosrc`, no overload, existing data, and four behaviours.

## Ticket 2 fix (fcc0957, web)

1. **Feature** — a mobile caller is now globally signed out on self-deletion.
2. **Files Changed** — `src/lib/callerAccessToken.ts` (new; owns `BEARER`),
   `src/lib/supabase-server.ts` (imports `BEARER`; cookie path unchanged),
   `src/app/api/me/route.ts`, its test, the ticket.
3. **DB Changes** — none. 4. **API Changes** — `DELETE /api/me` behaviour for
   bearer callers only.
6. **Tests Added** — 4 (200 and 202 bearer paths, lowercase scheme, Basic
   header falls back). Mutations 6/0.
7. **Known Limitations / verification** — the 202 branch cannot be forced in
   production. The live check is the `auth.sessions` query in checklist D
   after a throwaway deletion; the read-only MCP role can read `auth.*`
   (confirmed). **Not yet verified live.**

## Step 6 — account deletion (d2b31ed)

1. **Feature** — deletion on the Account tab, both cases.
2. **Files Changed** — `src/lib/accountDeletion.ts`,
   `src/components/DeleteAccountSection.tsx`, `AccountScreen.tsx`, `api.ts`
   (`apiGetText`, `apiDelete`), catalogues, tests.
3. **DB Changes** — none (routes do the work). 4. **API Changes** — none.
5. **UI Changes** — export-first (share sheet), blast radius as label/count
   rows, two gates for the escape hatch, one Promote control per candidate in
   the blocked state, Alert after 200/202 then local sign-out.
6. **Tests Added** — 31. Mutations 15/0.
7. **Known Limitations** — the CSV is shared as text, not a `.csv` file. A
   household 202 has two server meanings without a code to tell them apart;
   the mobile copy is true for both. Share sheet, Alert and sign-out are
   unverified on device (no RN renderer).
8. **Areas of Risk** — irreversible. Test only on throwaway accounts.
9. **Manual Test Steps** — checklist D.

## Step 7 — bundle:check

Fresh Android export (3.5 MB `.hbc`), `bundleCompliance.bundle.ts` 5/5: the
bundle is newer than every source file, both encodings are decoded
("Try again" as ASCII, "Réessayer" as UTF-16LE), no forbidden text outside
the allowlist. Independently, 12 new EN/FR strings from every Phase 2 screen
were found in the bundle bytes — the French ones as UTF-16LE, including one
with U+00A0 — and "par mois" is absent in both encodings.

---

## iPhone device checklist

Read screens first, destructive last. **Never household 2be22642 for any
write or deletion.** Accounts used:

- **R** — your real account, read-only screens only.
- **T1** — throwaway: sign up on phare.money (web), accept terms, **do not
  onboard on the web**. Choose French for one pass, English for another.
- **T2** — second throwaway, invited into T1 from T1's web Household page,
  signed in once on the web.

Replace `<HH>` with the throwaway's household id and `<UID>` with the user id
(both from `SELECT id, household_id FROM users WHERE email = '<email>';`).
Every query below is read-only and was dry-run against the live schema.

### A. Read screens (account R)

1. Cold start signed out → sign-in screen, no "create account" link, no
   Terms link.
2. Sign in → tab bar: Review / Timeline / Cards / Account (FR: Bilan /
   Chronologie / Cartes / Compte). No Timeline link or sign-out in the Review
   header.
3. Review: letters render; pull to refresh works.
4. Timeline: no "Monthly review" link; "+" at top right.
5. Cards: title "Room on your cards", current month under it, one row per
   credit card, goal/spent/room/status; a card with no goal shows "—" and
   "No goal", never $0. Compare two figures with the web Cards page for the
   same month.
6. Switch the phone to French: amounts read "1 234,50 $".
7. Account: your email; **airplane mode → Sign out** → error "Couldn't sign
   out… still signed in", still signed in. Airplane off → Sign out works.

A0 (optional, needs a write you run yourself). Terms block: on a throwaway
only, set its `users.terms_version` to an old value in the SQL Editor, sign
in on the phone → the one sentence, a Sign out, nothing else; no link.

### B. Quick entry (account T1, after C)

1. Cards → "+" → modal "Add an expense"; chequing preselected; date = today.
2. Pick the card, "Yesterday", description "Épicerie test", a category,
   amount typed on the French keypad **12,50** → Save → "Saved." Form keeps
   account/category/date, clears description/amount.
3. Close → Cards: Spent went up by exactly 12.50 (refetched on its own).
4. Amount `12,345` → "Enter an amount above zero…" and nothing sent.
5. Description of 201 characters (paste) → "too long" message, nothing sent.

```sql
SELECT t.date, t.description, t.amount, t.type, t.source, t.member_id,
       a.name AS account, a.type AS account_type, c.name AS category,
       t.recurrence_id, t.installment_label, t.created_at
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
 WHERE t.household_id = '<HH>' AND t.source = 'manual'
 ORDER BY t.created_at DESC LIMIT 5;
```
Expect one row: yesterday's date **in the household timezone**, amount
`12.50` (not 12), type `expense`, `member_id` null, the card, no
`recurrence_id`, no `installment_label`.

### C. Onboarding (account T1, first sign-in on the phone)

1. Sign in → onboarding form instead of tabs.
2. Income "Salaire" **2 500,50** (with the space) → Build my plan → refused,
   "couldn't be read" (grouping spaces are refused, never guessed). Retype
   **2500,50**, frequency "Aux 2 semaines" → preview "= … chaque mois".
3. Expense row with amount but no name → "has an amount but no name".
   Fix: "Loyer" 1500, Mensuel.
4. Combined income **134000** → plausibility screen (stated vs computed) →
   "continue".
5. Accounts: 1 card named "Visa test"; opening balance **1250,50**.
6. Build my plan → "Building…", "Writing…", "Saving…" → pay-date screen for
   the biweekly salary: a date 3 weeks away → "more than 14 days"; a date
   within 14 days → "Date set." → Continue → done screen with the letter →
   Continue → tabs.

```sql
SELECT id, file_name, file_type, status, row_count, created_at
  FROM file_imports WHERE household_id = '<HH>';
SELECT description, amount, type, cadence, anchor_date, second_day,
       member_id, account_id, active, file_import_id
  FROM recurring_items WHERE household_id = '<HH>';
SELECT b.anchor_date, b.balance, a.name
  FROM account_balance_anchors b JOIN accounts a ON a.id = b.account_id
 WHERE b.household_id = '<HH>';
SELECT name, type, created_at FROM accounts WHERE household_id = '<HH>';
SELECT event_type, created_at, metadata FROM events
 WHERE household_id = '<HH>'
   AND event_type IN ('onboarding_plan_generated','onboarding_review_generated','signup');
SELECT type, review_month, generated_by, created_at
  FROM conversations WHERE household_id = '<HH>';
```
Expect: exactly one `file_imports` row (file_type `manual`); salary
`amount` 2500.50 biweekly with the `anchor_date` you entered; Loyer 1500
monthly; anchor `1250.50` dated today in the household zone on Chequing;
accounts Chequing + "Visa test"; **one** plan event and **one** review event
(not two — no retry loop); one onboarding letter in `conversations`.

### D. Account deletion — destructive, last (T1 and T2 only)

1. T1 on the phone → Account → deletion shows **blocked**, naming T2, one
   "Make {T2} an owner" button → press → verdict becomes self-deletion.
2. "Export transactions (CSV)" → share sheet opens with CSV text; save it to
   Notes/Files; it contains the "Épicerie test" row.
3. Start → type your email wrong → button stays disabled; type it in capitals
   → enabled → delete → Alert "Your account has been deleted" → sign-in
   screen.

```sql
SELECT id, email, role, household_id, terms_version FROM users WHERE id = '<T1_UID>';
SELECT id, name, user_id, deleted_at FROM household_members WHERE household_id = '<HH>';
SELECT kind, requested_at, db_completed_at, auth_completed_at, last_error
  FROM member_deletion_requests WHERE subject_user_id = '<T1_UID>';
SELECT id FROM auth.users WHERE id = '<T1_UID>';
SELECT id FROM auth.sessions WHERE user_id = '<T1_UID>';
SELECT id FROM auth.refresh_tokens WHERE user_id = '<T1_UID>' AND NOT revoked;
```
Expect: `auth.users`, `auth.sessions` and live `refresh_tokens` all empty
(ticket 2's live check); T1's member row tombstoned; the request row with
`auth_completed_at` set and `last_error` null. If the phone showed
"didn't fully finish" (202), the three `auth.*` queries are the important
ones: sessions and refresh tokens must be empty even though `auth.users`
may still hold the row.

4. T2 on the phone (now sole owner) → Account → household deletion: blast
   radius rows with grouped numbers → type the household name → delete →
   Alert → sign-in screen.

```sql
SELECT id, name FROM households WHERE id = '<HH>';
SELECT id FROM auth.users WHERE id = '<T2_UID>';
SELECT id FROM auth.sessions WHERE user_id = '<T2_UID>';
SELECT count(*) FROM transactions WHERE household_id = '<HH>';
```
Expect every query empty / 0.

### E. Compliance pass on the device

Scroll every screen in both languages: no price, no "upgrade", no plan name,
no link to pricing or Terms. The review letter's locked notice (existing,
free households) reads "isn't part of your current plan" — judge whether you
want it in front of App Review (see below).

---

## Demo account plan for App Review notes (not created)

- **Account:** a dedicated household, e.g. `appreview@phare.money`, created
  on the web, never used for anything else, **not** 2be22642.
- **Data it needs:**
  - current terms accepted (else the reviewer sees only the terms block);
  - a saved plan (else onboarding replaces the tabs — which is fine to show,
    but each run spends quota);
  - chequing anchored, a biweekly income and rent, so the Timeline has a
    real dip;
  - two credit cards with a goal for the current month and a few expenses
    each, one of them over goal, one with no goal (shows "—");
  - at least two months of history and one generated monthly review, so
    the Review tab is not empty;
  - a second member is **not** needed.
- **Decision for you:** as a free household, review letters show the locked
  notice. Either comp the demo household (`comp_until`) so letters show in
  full, or accept the notice. Recommend comping it.
- **Notes text should say:** sign-in only (accounts are created on the
  web); account deletion is live, immediate and irreversible — a reviewer
  who tests it destroys the demo household, so keep the setup steps to
  recreate it.

## Open items needing you

1. Apply the migration and run its VERIFY block; report the NOTICEs.
2. Run checklist D and the `auth.sessions` query to verify ticket 2 live.
3. Demo account: create it, decide on comping.
4. The second owner in 2be22642 has never accepted terms.
