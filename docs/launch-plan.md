# Launch plan

**Adopted:** Lineu, 2026-10-17.

**Rules:**
- Phases run in order. **No feature work (S1, S4–S6) until Phase 1 exits.**
- **Android is paused** until Phase 4.
- Schema, auth, billing, money and deletion items: diagnose, report, and
  STOP for approval (CLAUDE.md §6).
- Live write tests run on Zezinho Test or throwaway T-accounts only, never a
  real household (CLAUDE.md §5).

**Priority:**
- **P0**: blocks the phase from exiting.
- **P1**: should be done within the phase.
- **P2**: can slip to the next phase.

**Owner:** **C** = Claude Code, **L** = Lineu, **K** = counsel or accountant.

---

## Phase 1: Security and correctness (current)

**Exits when every P0 row meets its criterion.**

| # | Item | Pri | Owner | Depends on | Verifiable exit criterion |
|---|---|---|---|---|---|
| 1.1 | **`events` writable by members.** Server-only writes; members keep SELECT. **Approved 2026-10-19. Code BUILT (all writes via `eventWriter`, service role), uncommitted; migration `20261019010000_events_server_only_writes.sql` WRITTEN; VERIFY baseline 4 FAIL / 3 PASS. Deploy code first, then apply.** | P0 | C (code + migration), L (apply) | Writers moved to the service role and deployed **before** the migration | On Zezinho Test over PostgREST: insert, update and delete on `events` refused (42501); `/api/events` still writes an allowlisted type; a server event (`timeline_opened`) still writes; quota counts identical before and after; VERIFY block all PASS |
| 1.2 | **`users` writable by members.** A member can change their own `household_id` (moving into another household's data) or `role` (self-promotion to owner). **DONE 2026-10-19: `20261019000000_users_read_only_for_clients.sql` applied; VERIFY 8/8 PASS; PostgREST as Zezinho Test: PATCH household_id/role/terms_version and DELETE all 403/42501, row unchanged** | P0 | C, L | None: both `users` writers are already admin | Over PostgREST as Zezinho Test: an UPDATE of `household_id`, `role` or `terms_version` is refused; terms acceptance, promote and sign-up still work; VERIFY all PASS |
| 1.3 | **`conversations` readable in full by members.** A free household can read the whole monthly letter over PostgREST, bypassing Pro truncation | P0 | C, L | Readers and writers moved to the service role first | As a free throwaway household: a direct SELECT of a letter is refused or returns nothing; `/api/reviews` still truncates for free and gives Pro the full letter |
| 1.4 | **`household_members` and `member_deletion_requests` writable by members.** A member can delete or rename member rows, or forge or erase deletion requests | P0 | C, L | Member routes' writers checked (admin vs session) | Over PostgREST: member-row and deletion-request writes refused; invite, remove, promote and self-delete still work on T1/T2 |
| 1.5 | **Invite opened where someone else is signed in** changes the signed-in person's password and records their terms | P0 | C (fix), L (T1/T2 test) | Lineu approves the fix | On T1/T2: an invite opened while T1 is signed in ends with T2 signed in and T2's password set; T1's password and terms unchanged |
| 1.6 | **Policy review, remaining tables.** Each fix is one migration, verified live | P1 | C, L | 1.1–1.4 done | Every table in `public` classified OK, or fixed and verified (review: §Policy review below) |
| 1.7 | **Silent-failure tickets** (anchors GET, accounts POST/GET, expenses PATCH gaps, save-plan writes, category seed) | P1 | C | None | Each route answers an error on a failed read or write; one test per route that fails first; mutation-tested |
| 1.8 | **Device test checklist** run on iPhone: [phase1-device-tests.md](phase1-device-tests.md) | P0 | L | Build 11 on TestFlight | Every line ticked, or a bug filed for it |
| 1.9 | **Sandbox purchase test** (build 11, a household without Pro) | P0 | L | Products have EN/FR metadata; Paid Apps Agreement active | Subscribe → household's `apple_*` columns filled → Pro shown; Restore works; Manage opens Apple's sheet |
| 1.10 | **Piece 4:** web shows Apple subscriptions; web warns before deletion | P1 | C | 1.9 | Household page states "Subscribed through the App Store" with the date; deletion warns while an Apple subscription renews |

## Phase 2: Finish iOS

| # | Item | Pri | Owner | Depends on | Verifiable exit criterion |
|---|---|---|---|---|---|
| 2.1 | **Sign-up decisions:** platform on the signup event (trigger change), email links opening the app, Terms without the web price | P0 | L decides, K (Terms) | Phase 1 | Three decisions written in BACKLOG |
| 2.2 | **S1:** sign-up, password reset, updated-terms acceptance in the app | P0 | C | 2.1 | A new account created and confirmed in the app, with no web page; `signup` event carries `platform: 'mobile'`; reset finishes in the app |
| 2.3 | **S4:** income and bill dates, editing them (effective-dated) | P0 | C (diagnose → STOP) | Phase 1 | Dateless lines dated in the app; a raise saved from a date leaves past months unchanged |
| 2.4 | **S5:** cards: close and payment days, detail, goal and budgets | P0 | C | Phase 1 | A card's days, goal and two budgets set in the app match the web for the same month; closed cycle refused |
| 2.5 | **S6 remainder:** add income and transfers in the app | P0 | C | Phase 1 | An income and a transfer added in the app appear on the Timeline and web identically |
| 2.6 | Product metadata EN/FR, and review screenshot per product | P0 | L (C writes text) | 1.9 | Both products "Ready to Submit" |
| 2.7 | App Store screenshots (new screens, EN/FR) | P0 | L | 2.2–2.5 | Uploaded for both locales |
| 2.8 | App Privacy: add "Purchase history" | P0 | L (C gives answers) | None | Saved in App Store Connect |
| 2.9 | App Review notes for IAP, and a **second, non-Pro demo account** | P0 | C (text), L (account) | 2.2 | Notes pasted; the reviewer can buy in the sandbox |
| 2.10 | Terms and Privacy final (Apple billing, stale "once paid subscriptions" line) | P0 | K | 2.1 | Published on the web; the app links them |
| 2.11 | v1.0 status: resolve | P0 | L | None | Known: withdrawn, unreleased, or live |
| 2.12 | **Readiness question → submit** | P0 | C asks, L decides | 2.1–2.11 | Lineu answers "yes" to "Is this build ready for submission?"; submitted |
| 2.13 | Date picker for date fields (native) | P2 | C | None | Typed dates no longer needed |

## Phase 3: Real household usage

| # | Item | Pri | Owner | Depends on | Verifiable exit criterion |
|---|---|---|---|---|---|
| 3.1 | Households complete onboarding | P0 | L (recruit) | 2.12 | ≥ N households with `completed_onboarding` (N set by Lineu), excluding Zezinho Test and the demo |
| 3.2 | Real transactions entered | P0 | L | 3.1 | Those households have manual entries in at least two separate weeks |
| 3.3 | Return visits | P0 | L | 3.1 | `returned` / `timeline_opened` events on ≥ 2 separate days per household |
| 3.4 | Funnel check (signup → onboarding → first expense) | P1 | C (queries) | 3.1 | Report from live data, test households excluded |
| 3.5 | Monthly review letter quality (frozen list) | P1 | C | 3.1 | Each listed issue fixed or closed |

## Phase 4: Android (paused)

| # | Item | Pri | Owner | Depends on | Verifiable exit criterion |
|---|---|---|---|---|---|
| 4.1 | Incorporation → D-U-N-S → Google Play organization account | P0 | L | None | Play Console account active |
| 4.2 | EAS cloud Android build, verified on a phone (timezone probe) | P0 | C, L | 4.1 for distribution; build can precede | `/diagnostics` passes on a real Android phone ([ticket](tickets/android-diagnostics-verification.md)) |
| 4.3 | **Billing decision:** Google Play Billing (server verification + notifications), or an Android build that offers no purchase | P0 | L decides, C builds | 4.1 | Decision written; the chosen path built and verified in Play's test track |
| 4.4 | Play listing: description, screenshots, Data safety, content rating, audience, privacy URL | P0 | L (C writes text) | 4.1 | Listing complete in Play Console |
| 4.5 | Closed testing (personal accounts: 12 testers for 14 days; confirm whether it applies to an organization account) | P0 | L | 4.1 | Requirement met or confirmed not to apply |
| 4.6 | `eas.json` Android submit config (service-account key) | P1 | L (key), C | 4.1 | `eas submit --platform android` uploads to a test track |
| 4.7 | Android app links (`/auth/callback`; config ticket) | P1 | C | 4.2 | Link opens the app on a test phone |

---

## Policy review (Phase 1, item 1.6) — diagnosed 2026-10-17

Live, through the read-only MCP:
- **Every `public` table has RLS on.**
- **`households`** was fixed earlier today; it's the only table with a
  SELECT-only policy.
- **Every other table** has one `FOR ALL … TO public` policy scoped by
  household (or, for `users`, by `auth.uid()`). None has a separate
  `WITH CHECK`, so `USING` doubles as the write check: rows stay in the
  caller's own household, but every column is writable.
- **`anon`** holds SELECT and INSERT everywhere. RLS refuses it, because
  `auth.uid()` is null, but the grants should go.

| Table | Feeds billing / limits / another household? | Verdict |
|---|---|---|
| `users` | **Yes.** `household_id` decides which household every policy grants; `role` decides owner-only actions (checkout, promote, remove, delete household) | **FIX, P0 (1.2).** Read-only for clients. Both writers are already admin |
| `events` | **Yes.** AI quotas and the regenerate quota count its rows | **FIX, P0 (1.1)** |
| `conversations` | **Yes.** Holds full monthly letters; Pro truncation happens in the route, so a direct SELECT bypasses it | **FIX, P0 (1.3)** |
| `household_members` | Membership trail; deleted members' tombstones; the invite and re-invite rules | **FIX, P0 (1.4)** |
| `member_deletion_requests` | Drives member self-deletion | **FIX, P0 (1.4)** |
| `categories` | Custom categories are Pro-gated in the route; a direct INSERT bypasses the gate | **FIX, P1** (entitlement bypass, own household only) |
| `monthly_goals`, `card_envelope_items` | Closed-cycle lock is route-only; a direct write can rewrite a closed cycle's plan | **FIX, P1** (history rewrite, own household) |
| `account_balance_anchors`, `accounts`, `recurring_items`, `recurring_skipped_dates`, `sinking_funds` | Own data; references to another household's account or category are not blocked (only `transactions` has the cross-household trigger) | **FIX, P1** (cross-household reference checks, as for transactions) |
| `transactions` | Own data; cross-household references blocked by trigger (20260928) | **OK** (writes are the household's own entries) |
| `budgets`, `budget_alerts`, `file_imports` | Own data; no billing or limit role found | **OK** (review again if a feature starts reading them) |
| `stripe_webhook_events` | No policy → RLS refuses all client access | **OK** (revoke stale grants with the next migration) |
| `households` | Fixed 2026-10-16 (SELECT-only, writes revoked) | **OK** |
| All tables | `anon` SELECT/INSERT grants; RLS refuses them, but nothing needs them | **FIX, P2** (hygiene, in the same migrations) |
