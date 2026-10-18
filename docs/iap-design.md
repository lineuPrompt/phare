# In-app purchase design

**Status (2026-10-17):** pieces 1–2 built and live; **piece 3 (the app) and
piece 5 (rule and tests) built, uncommitted**, with Lineu's decisions: owner
only, `expo-iap` 5.8.2, warn before deletion. Pieces 4 (web display) and 6
(App Store metadata, review notes, counsel) remain.

## 1. What is set up in App Store Connect (Lineu, 2026-10-17)

| Item | Value |
|---|---|
| Subscription group | Phare Pro |
| Monthly product | `phare.app.pro.monthly`, CAD 14.99 (price assumed unchanged; confirm) |
| Yearly product | `phare.app.pro.yearly`, CAD 149.00 (price assumed unchanged; confirm) |
| Family Sharing | **Off.** Lineu replaced the first two products (which had it on) with these, 2026-10-17 |
| Paid Apps Agreement | Done |
| Small Business Program | Submitted, awaiting approval |
| GST/QST, Canada tax form | In progress (Revenu Québec), pending |
| Server key + env vars | In-App Purchase key created; 5 `APPLE_*` vars live (probe answered 400 `invalid_signature`, 2026-10-17) |
| Notification URL + test | Not confirmed yet |

## 2. What these values change

### Family Sharing: off

Lineu removed it (2026-10-17) by replacing the products. One purchase covers
one Apple ID, which belongs to one household. Piece 2's rules stand as built:
a purchase is accepted only for the household that made it, and one Apple
subscription belongs to one household.

**Added server check (piece 3):** `/api/apple/verify` and the notification
handler accept only the two product IDs above. A transaction for anything
else, such as the retired `money.phare.app.pro.*` products, is refused by name.

### App Store prices differ from the web

App Store: 14.99 / 149.00 CAD. Web (Stripe): 15 / 150. The app never types a
price: it shows StoreKit's own localized price string. The Terms state
"$15 CAD per month, or $150 CAD per year" and "Payment is processed by
Stripe". **For counsel:** the Terms need to cover App Store billing (price
shown in the App Store, billed and refunded by Apple, cancel in the iPhone's
settings).

### Taxes

Not a code question. For Lineu's accountant: which sales taxes Apple collects
and remits on App Store sales in Canada, versus Stripe sales on the web, which
are Phare's to collect.

## 3. Piece 3: the app (native, needs a new development build)

- **Library:** `expo-iap` **5.8.2** (2026-09-30), the newest release at least
  two weeks old. Not 6.x: a new major version, 8 days old. Its exact API
  (purchase call, the field holding the signed transaction, finishing a
  transaction) is read from its installed types before any code is written,
  not assumed.
- **Where:**
  - Account tab, new "Phare Pro" section: status, plus "See Phare Pro".
  - The locked parts of the app: the review letter's `LockedNotice`, and
    later the horizon and regenerate. A "See Phare Pro" button there opens the
    in-app purchase. That button is allowed now, because it uses Apple's
    purchase.
- **The Phare Pro screen** (Guideline 3.1.2(c): "clearly describe what the
  user will get for the price"):
  - what Pro adds: 12-month horizon, full monthly review, plan regeneration,
    custom categories. Taken from `src/lib/entitlement.ts`'s list, moved to
    `@phare/core` so the web pricing card and the app say the same;
  - for each product, StoreKit's display price and period;
  - the auto-renewal sentence;
  - links to the Terms of Use and the Privacy Policy (in-app);
  - buttons: **Subscribe monthly**, **Subscribe yearly**, **Restore
    Purchases**; **Manage subscription** (Apple's own sheet) for an Apple
    subscriber.
- **Who may buy:** the household **owner** only, as on the web
  (`/api/stripe/checkout`: `owner_only`). A member sees "Only the household
  owner can subscribe".
- **Already Pro** (comp, Stripe or Apple): no purchase offered. The screen
  states the household has Phare Pro (until a date for comp or ending).
  It does not say where a Stripe subscription is managed (no pointing to the
  web, Guideline 3.1.1).
- **The purchase:**
  1. `requestPurchase` with `appAccountToken` = the household id, from
     `/api/me`.
  2. When StoreKit reports the purchase, the signed transaction goes to
     `POST /api/apple/verify`.
  3. Only after a 200 is the transaction **finished**. An unfinished one is
     re-delivered by StoreKit at the next launch and verified again.
  4. Pro is shown from the server's answer (`entitlement`), never from the
     device.
- **Restore Purchases:** each current transaction from StoreKit is sent to
  `/api/apple/verify`.
- **Errors:** each route code maps to bilingual text
  (`account_token_mismatch`, `belongs_to_other_household`,
  `apple_not_configured`…).

## 4. Piece 4: the web

- **Household page, Subscription section, for `apple_*` reasons:**
  "Subscribed through the App Store", the renewal or end date, and "Manage
  it in your iPhone's Settings → [your name] → Subscriptions". No Stripe
  upgrade; Stripe checkout already refuses a household that is Pro.
- **`/api/me`:** add the Apple expiry and renewal state for that display.
- **Deleting an account or household with a live Apple subscription:** Phare
  cannot cancel it; only the person can, in Apple's settings. Proposed: warn
  before deleting, with the way to cancel, and still allow deletion
  (Guideline 5.1.1(v): deletion must stay possible). **Deletion: diagnose
  and STOP before changing.**

## 5. Pieces 5–6: rules, tests, review

- **Piece 5, rule and tests:** the mobile rule becomes "the plan name 'Phare
  Pro' and Apple's own prices may appear; no typed price, no Stripe, no link
  to web pricing". Rewrite `sourceCompliance.test.ts` and `bundle:check` to
  enforce exactly that. Update CLAUDE.md §1 (buying a **Stripe**
  subscription stays web-only) and §4.
- **Piece 6, App Store and counsel:**
  - App Store Connect, for each product: EN and FR display name and
    description, and a review screenshot of the Phare Pro screen;
  - the products go to review **with** the app version that sells them;
  - a sandbox tester account;
  - App Review notes rewritten for in-app purchase;
  - Terms and Privacy to counsel.

## 6. Decisions for Lineu

1. **Who may buy in the app:** the owner only, as on the web.
   *Recommended: yes.*
2. **Library version:** `expo-iap` 5.8.2, not 6.x. *Recommended: yes.*
3. **Deleting with a live Apple subscription:** warn, explain how to cancel,
   still allow. *Recommended: yes.*
4. **Terms in the app:** a version without the Stripe and web-price clause,
   plus App Store billing terms, for counsel.
