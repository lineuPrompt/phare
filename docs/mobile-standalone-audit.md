# Mobile standalone audit

**Date:** 2026-10-15

> **Superseded in part, 2026-10-16:** Lineu dropped early access
> (`EARLY_ACCESS`) and chose **in-app purchase**. Every mention of early
> access below is out of date. Pro features in the app (steps 23, 27, 30)
> are unlocked by an Apple or Stripe subscription. The sign-up section's
> App Review notes will be rewritten for in-app purchase. See the BACKLOG item
> "In-app purchase".
**Against:** `main` at bd4194e, and the live database (read-only)

The rule this audits (CLAUDE.md §1): a household that installs from the
App Store and never opens phare.money must be able to run its plan month
after month. Only two things stay web-only: buying or managing a
subscription, and spreadsheet import.

**Legend**

| Mark | Meaning |
|---|---|
| **W** | Works on mobile today |
| **S** | Needs a mobile screen over an existing route. No server change |
| **N** | Needs new server work: a route, a redirect, the trigger, or config |
| **Web** | Stays web-only by rule |

**Method.** I listed every route's HTTP methods (`src/app/api/**/route.ts`),
every place the mobile app calls the API, and every string in the mobile
catalogue that sends people to phare.money (about 15). I confirmed three
facts live:
- **Email confirmation is on.** The last eight sign-ups confirmed 0–298 s
  after creating their account.
- **The `signup` event records `locale` only.** There is no `platform`
  (checked `pg_proc.prosrc` of `handle_new_user`).
- **Household 2be22642 has two members**, both with logins. The mobile
  Account screen simply never lists them.

---

## The walk: one new household, three months, mobile only

### Month 1: getting started

| # | Step | Today | What it takes |
|---|---|---|---|
| 1 | Sign up | **N** | No sign-up screen. The Supabase client can call `auth.signUp` as the web does (no route needed), but two server pieces are missing. **(a)** `signup` must record `platform: 'mobile'`, which means changing `handle_new_user` (a DB change; see §5 on overloads and dropped clauses). **(b)** The confirmation link goes to `phare.money/auth/callback`, which opens the web dashboard in Safari: the household lands on the web on day one. Keeping it in the app needs a link the app opens. That means either a custom-scheme `emailRedirectTo` added to Supabase's redirect allow-list, or the association file claiming `/auth/callback` (it deliberately claims no path today). |
| 2 | Accept terms at sign-up | **N** (copy decision) | `/api/legal/accept` exists, but the Terms text cannot appear in the app as written: `terms.en.ts:68` says "Phare Pro costs $15 CAD per month, or $150 CAD per year" (FR line 55). Consent needs the Terms to be readable. Decide with counsel: (a) the app shows a version without the fees clause, which is fine while early access makes it moot, or (b) the app opens the web Terms page (a link to a page with prices is a steering risk under 3.1.1). |
| 3 | Confirm email | **N** | Same as 1(b). |
| 4 | Onboarding: income, bills, cards, plan, letter | **W** | Built. Three escape hatches point to the web: opening balance "later" (step 7), undated bills (step 12), and "replacing an earlier plan" (only reachable after a re-onboarding, so rare). |
| 5 | Pick pay dates | **W** | Free-text `YYYY-MM-DD` today; the date picker is FROZEN, after submission. |
| 6 | First expense | **W** | Quick entry: expense on chequing or a card, no member attached. |
| 7 | Set the chequing opening balance later | **W** (S3, 2026-10-16) | `POST /api/anchors`. Without it the Timeline and the Plan card say "set it on phare.money". |
| 8 | See the month: Home, Timeline, Cards | **W** | Current month only. |
| 9 | Look at last month or ahead | **W** (S2, 2026-10-15) | Existing routes (`/api/dashboard?month`, `/api/timeline?windowStart`, `/api/cards/overview?month`, `/api/cards/months`). `availableMonths` moves from `src/lib/timelineDisplayHelpers.ts` into `@phare/core`. |
| 10 | Fix a wrong entry (amount, category, date, delete) | **S** | `PATCH`/`DELETE /api/expenses/[id]`. Needs a list of the month's entries to tap (Timeline rows). |
| 11 | One-off income (a refund, a bonus) | **S** | `POST /api/expenses` with `type: 'income'`. |
| 12 | Date the recurring lines onboarding left undated | **S** | `PATCH /api/recurring/[id]`. |
| 13 | Move money: chequing to savings, card payment | **S** | `POST /api/transfers`, `PATCH`/`DELETE /api/transfers/[id]`. |

### Month 2: life changes

| # | Step | Today | What it takes |
|---|---|---|---|
| 14 | A raise | **S** | `PATCH /api/recurring/[id]`, effective-dated (`splitRule`), so past months keep the old figure. The screen asks "from which date". |
| 15 | A new recurring bill | **S** | `POST /api/recurring`. |
| 16 | A new credit card, with close and payment days | **W** for the card (S3); **S** for the days (S5) | `POST /api/accounts`, then `PATCH /api/accounts/[id]` for the days. |
| 17 | Card detail, goal and category budgets | **S** | `GET`/`POST /api/card-envelope`, with its closed-cycle 409 and the "apply to later months?" 409. |
| 18 | Invite a spouse | **S + N** | Sending is `POST /api/household/members`. The invite email's link is `phare.money/auth/callback?next=…/dashboard`, so the spouse sets a password on the web page. Keeping that in the app is the same redirect work as 1(b) and 24. |
| 19 | List members, remove one, make one owner | **S** | `GET /api/household/members`, `DELETE /api/household/members/[id]`, `POST …/promote`, `POST …/resend`. Owner-only actions as on web. |
| 20 | Create a savings goal | **S** | `POST /api/accounts` (savings type, `goalTarget`, `goalTargetDate`) or `PATCH /api/accounts/[id]`. |
| 21 | Start funding a sinking fund | **S** | `POST /api/sinking-funds/start-funding`, `PATCH /api/sinking-funds/[id]`. |
| 22 | Change a contribution | **S** | The contribution is a recurring rule: `PATCH /api/recurring/[id]` (effective-dated). |
| 23 | A custom category | **S** | `POST /api/categories` (Pro-gated; open under early access). |

### Month 3: running it

| # | Step | Today | What it takes |
|---|---|---|---|
| 24 | Password reset | **S + N** | Requesting it is `POST /api/auth/forgot-password` (today the app says "reset it on phare.money"). The email link opens the web `set-password` page, because `redirectTo` is hard-coded to the web origin in the route. Finishing in the app needs the same redirect work as 1(b). |
| 25 | Accept updated terms | **S** (plus the copy decision in 2) | `POST /api/legal/accept`. Today the app says "accept them on phare.money". |
| 26 | Read the monthly review | **W** | The letter is written by the cron job, read via `/api/reviews`. |
| 27 | Regenerate the plan | **S** | `POST /api/regenerate-plan` (Pro-gated: 4 a month, open under early access), then `save-plan`. The AI output is shown as the web shows it; no new math. |
| 28 | Export transactions | **W** | Account → the export offered before deletion (`/api/export/transactions`). A standalone "Export" row is a small **S**. |
| 29 | Delete the account | **W** | Built and device-tested (checklist D). |
| 30 | Buy or manage a subscription | **Web** | By rule. While early access is on, nothing is sold. |
| 31 | Import a spreadsheet | **Web** | By rule. |

**Totals:**
- 8 steps work today.
- 19 need only mobile screens.
- 4 need server work, and all 4 have the same two causes:
  - **Email links go to the web.** Confirmation, invite and password reset all open phare.money pages.
  - **`handle_new_user` has no platform.** The `signup` event can't record that a sign-up came from mobile.
- 2 stay web-only.

---

## Sign-up on mobile: the App Store check

- **Can it be done with no prices, no plan names and no upgrade wording?**
  Yes for the screen itself: name, email, password, a consent checkbox, and
  "check your email". The web sign-up page has the same fields.
  `sourceCompliance.test.ts` and `bundle:check` already catch prices and
  plan words in mobile source and the compiled bundle.
- **One blocker: the Terms.** The consent text must link to Terms the
  person can read, and today's Terms state the Pro price (step 2). Decide
  that with counsel before building the consent checkbox.
- **What changes in the App Review notes.** v1.0's notes say the app is "a
  free, stand-alone companion for people who already have a Phare account"
  and lean on 3.1.3(f), the exemption for free companions to a paid web
  tool. From 1.1 that no longer describes the app. The 1.1 notes (in
  `app-store-listing.md` §3b) say instead:
  - the app is complete and accounts are created in it;
  - it is free during early access, with every feature on for every
    household;
  - nothing is sold anywhere in the app, and nothing points to buying
    outside it.
  
  Account creation in the app also brings 5.1.1(v) into play: an app that
  creates accounts must let people delete them in the app. That is
  already built.
- **The constraint that comes with it.** Under early access, no feature in
  the app depends on a web purchase, so 3.1.3(b) (a web-bought
  subscription must also be sold in-app) has nothing to apply to. **The
  day `EARLY_ACCESS` is turned off, the app is again unlocking
  features bought on the web, and in-app purchase must already be there.**
  That's why IAP is filed as required before any public launch.

---

## Recommended for v1.1, with estimates

Estimates are Claude Code build days, with tests and mutation runs, not
counting Lineu's device test. "Blocked" items need a decision or a
server/DB change before they can start.

| Order | Piece | Steps | Kind | Estimate |
|---|---|---|---|---|
| 1 | **Sign-up, in-app reset request, updated-terms screen** | 1–3, 24, 25 | S + **N** | Screens: 2 days. **Blocked on:** the `handle_new_user` platform change (migration, STOP), the email-link redirect decision (Supabase config plus 3 routes' `redirectTo`, STOP: auth), and the Terms copy decision |
| 2 | Month navigation: Home, Timeline, Cards | 9 | S | 2 days |
| 3 | Opening balance and accounts (chequing, savings, card days) | 7, 16 | S | 1.5 days |
| 4 | Income and bill dates, editing them (effective-dated) | 12, 14, 15 | S | 3 days |
| 5 | Cards: detail, goal and category budgets | 17 | S | 2.5 days |
| 6 | Entries: edit, delete, income, transfers | 10, 11, 13 | S | 3 days |
| 7 | Members: list, invite, remove (owner only) | 18, 19 | S (+ N for an in-app invite link) | 1.5 days |
| 8 | Savings goals and sinking funds | 20–22 | S | 2.5 days |
| 9 | Regenerate the plan | 27 | S | 1.5 days |

**Required for v1.1:** 1 to 6. Without them a mobile-only household can't
get in (1), can't see past or future months (2), has no balance to plan
from (3), can't keep its plan true when life changes (4, 6), and can't run
the card envelopes, which are the product (5). That's about 14 days plus
the blocked server work.

**Can follow in 1.2:** 7, 8 and 9. A household can run alone without
them, at the cost of a second person, savings goals and a fresh plan.

Not in this list:
- custom categories (23);
- a standalone export row (28);
- the date picker (FROZEN; it's a native module, so it needs a rebuild).
