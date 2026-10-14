# iOS submission runbook

Written 2026-10-13 for Lineu. Do the parts in order. Every step is marked
**[Lineu]** (you do it) or **[Claude Code]** (ask in the session and Claude
Code does it). Every step says exactly what to tap and what you should see.
When a step says **[Lineu]** Send Claude Code:, paste that message into the session;
Claude Code then runs the read-only checks listed and tells you pass or fail
before you go on.

Ground rules for every part:

- **Never use household 2be22642 or Zezinho Test** for anything here. Part 1
  uses two throwaway accounts, **T1** and **T2**, created only for this.
  Part 4 uses a dedicated demo household.
- Deletion (part 1, section D) is permanent. Do it last in part 1.
- If anything on screen differs from what is written here, stop and send
  Claude Code a screenshot. Do not work around it.

---

## Part 1 — Device checklist (sections C, B, D) — Lineu, checked by Claude Code

### 1.0 Before you start (once) — Lineu

1. On the computer, open a terminal in the repo and run:
   ```
   pnpm --filter @phare/mobile start
   ```
   Leave it running. The development build on your iPhone loads the app's
   current code from this.
2. On the iPhone, open the **Phare** development build. If it shows the
   Expo dev menu, tap the computer's address in the list.
3. iPhone **Settings → General → Language & Region**: set **French
   (Canada)** for section C. You will switch back later where stated.

### 1.1 Create T1 (web, 5 minutes) — Lineu

1. On the computer, open **https://phare.money/fr/signin** in a private
   window → under the form, « Pas encore de compte? » → click **Créez-en
   un**.
2. **Nom complet**: any name. **Courriel**: an email you can receive,
   written down as **T1** (for example `lineugraeff+t1@hotmail.com`).
   **Mot de passe**: one you will remember.
3. Tick the consent box → **Créer le compte** → open the confirmation email
   → click the link.
4. If the web asks you to accept the terms, accept them.
5. **Stop on the web at the "build your plan" page. Do not onboard on the
   web.** Close the private window.

**[Lineu]** Send Claude Code: `T1 created: <the T1 email>`

**[Claude Code]** Checks (read-only):
```sql
SELECT u.id AS user_id, u.household_id, u.terms_version, u.terms_accepted_at,
       (SELECT count(*) FROM file_imports f WHERE f.household_id = u.household_id) AS plans
  FROM users u WHERE lower(u.email) = lower('<T1 email>');
```
Pass: one row, terms accepted, `plans` = 0.

### 1.2 Section C — Onboarding on the phone (T1, French) — Lineu

1. On the iPhone, the Phare sign-in screen (**Connexion**). Enter T1's
   email and password → **Se connecter**.
   - Pass: the screen **Entrez vos chiffres** appears instead of the tabs.
2. Under **Sources de revenus**: name **Salaire**, amount **2 500,50**
   (type the space) → tap **Construire mon plan**.
   - Pass: refused with « Le montant de la ligne marquée n'a pas pu être
     lu… ». Nothing is sent.
3. Change the amount to **2500,50** (no space). Frequency: **Aux 2
   semaines**.
   - Pass: under the line, « = … chaque mois ».
4. Under **Dépenses**: tap **+ Ajouter une ligne**, type an amount **1500**
   but leave the name empty → **Construire mon plan**.
   - Pass: « La ligne marquée a un montant, mais pas de nom… ».
5. Name that line **Loyer**, frequency **Mensuel**.
6. **Revenu annuel combiné du ménage**: type **134000** → **Construire mon
   plan**.
   - Pass: the screen **Vérifiez vos revenus** compares about 134 000 $ with
     about 65 013 $ a year.
7. Tap **Ces chiffres sont exacts — continuer**.
8. Screen **Vos comptes**: **Nombre de cartes de crédit** = **1**; name it
   **Visa test**; chequing balance today: **1250,50** → **Construire mon
   plan**.
   - Pass: « Construction de votre plan… », then « Rédaction de votre premier
     bilan… », then « Enregistrement de votre plan… ».
9. Screen **Quand ces montants sont-ils versés?** For Salaire, enter a date
   **three weeks from today** (format AAAA-MM-JJ) → **Enregistrer cette
   date**.
   - Pass: « C'est à plus de 14 jours… ».
10. Change it to a date **within the next 14 days** → **Enregistrer cette
    date**.
    - Pass: « Date définie. ».
11. Tap **Continuer** → **Votre plan est prêt** with the letter → tap
    **Continuer**.
    - Pass: the tabs appear: **Accueil · Bilan · Chronologie · Cartes ·
      Compte**, on **Accueil**.

**[Lineu]** Send Claude Code: `C done for <the T1 email>` (and a screenshot of any
step that did not match).

**[Claude Code]** Checks (read-only):
```sql
WITH t AS (SELECT household_id FROM users WHERE lower(email) = lower('<T1 email>'))
SELECT 'file_imports' AS what, jsonb_agg(jsonb_build_object('type', file_type, 'status', status, 'at', created_at)) AS rows
  FROM file_imports WHERE household_id = (SELECT household_id FROM t)
UNION ALL
SELECT 'recurring', jsonb_agg(jsonb_build_object('d', description, 'amount', amount, 'type', type, 'cadence', cadence, 'anchor', anchor_date, 'member', member_id))
  FROM recurring_items WHERE household_id = (SELECT household_id FROM t)
UNION ALL
SELECT 'anchor', jsonb_agg(jsonb_build_object('date', b.anchor_date, 'balance', b.balance, 'account', a.name))
  FROM account_balance_anchors b JOIN accounts a ON a.id = b.account_id WHERE b.household_id = (SELECT household_id FROM t)
UNION ALL
SELECT 'accounts', jsonb_agg(jsonb_build_object('name', name, 'type', type))
  FROM accounts WHERE household_id = (SELECT household_id FROM t)
UNION ALL
SELECT 'events', jsonb_agg(jsonb_build_object('type', event_type, 'meta', metadata) ORDER BY created_at)
  FROM events WHERE household_id = (SELECT household_id FROM t)
   AND event_type IN ('onboarding_plan_generated', 'onboarding_review_generated', 'onboarding_step_reached', 'completed_onboarding')
UNION ALL
SELECT 'conversations', jsonb_agg(jsonb_build_object('type', type, 'month', review_month))
  FROM conversations WHERE household_id = (SELECT household_id FROM t);
```
Pass, all of:
- exactly **one** `file_imports` row, type `manual`;
- Salaire **2500.50**, `biweekly`, anchor = the date from step 10; Loyer
  **1500** `monthly`; no `member` on Loyer;
- one anchor **1250.50** on Chequing, dated today in Toronto time;
- accounts Chequing + **Visa test**;
- **one** `onboarding_plan_generated` and **one** `onboarding_review_generated`
  (two of either means a retry loop); step events carry `platform: mobile`;
- one `onboarding` conversation.

### 1.3 Section B — Quick entry "12,50" (T1, French) — Lineu

1. Tab **Cartes** → the **+** at top right.
   - Pass: **Ajouter une dépense**; the chequing account is preselected; the
     date is today.
2. **Compte**: tap the card, **Visa test** (Chequing is selected by default —
   the card must be tapped). **Date**: tap **Hier**.
   **Description**: **Épicerie test**. **Catégorie**: any. **Montant**: on
   the French keypad type **12,50** → **Enregistrer**.
   - Pass: « Enregistrée. »; account, category and date stay; description and
     amount clear.
3. Close the sheet.
   - Pass: on **Cartes**, Visa test's **Dépensé** went up by exactly
     **12,50 $**, without pulling to refresh. Tab **Accueil** shows the same
     month.
4. Open **+** again. **Montant**: **12,345** → **Enregistrer**.
   - Pass: « Entrez un montant supérieur à zéro, par exemple 12,50. » and
     nothing saved.
5. **Description**: paste 201 characters (copy any long paragraph) →
   **Enregistrer**.
   - Pass: « Cette description est trop longue : 200 caractères au
     maximum. » and nothing saved.
6. Close the sheet.

**[Lineu]** Send Claude Code: `B done for <the T1 email>`

**[Claude Code]** Checks (read-only):
```sql
SELECT t.date, t.description, t.amount, t.type, t.source, t.member_id,
       a.name AS account, c.name AS category, t.recurrence_id, t.installment_label, t.created_at
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
 WHERE t.household_id = (SELECT household_id FROM users WHERE lower(email) = lower('<T1 email>'))
   AND t.source = 'manual'
   AND t.recurring_item_id IS NULL   -- onboarding's recurring rows are 'manual' too
 ORDER BY t.created_at DESC LIMIT 5;
```
Pass: exactly **one** row — yesterday's date in Toronto time, amount
**12.50**, type `expense`, account **Visa test**, `member_id` **null**, no
`recurrence_id`, no `installment_label`.

### 1.4 Create T2 (web) — Lineu

1. On the computer, sign in at **https://phare.money/fr/signin** as **T1**,
   then open **https://phare.money/fr/household** (« Membres du foyer »).
   Under **Ajouter un membre**: **Nom complet** any name; **Courriel** a
   second email, **T2** (for example `lineugraeff+t2@hotmail.com`);
   **Rôle**: **Membre** → **Ajouter le membre**.
2. Open the invitation email for T2 → follow the link → set a password →
   accept the terms → sign in once on the web. Sign out.

**[Lineu]** Send Claude Code: `T2 created: <the T2 email>`

**[Claude Code]** Checks (read-only):
```sql
SELECT u.email, u.role, u.household_id, u.terms_version, m.name AS member_name, m.deleted_at
  FROM users u LEFT JOIN household_members m ON m.user_id = u.id
 WHERE lower(u.email) IN (lower('<T1 email>'), lower('<T2 email>'));
```
Pass: both in the **same** household; T1 `owner`; T2 a member with terms
accepted.

### 1.5 Section D — Account deletion (T1, then T2). Permanent. — Lineu

1. On the iPhone, signed in as **T1** → tab **Compte** → scroll to
   **Supprimer votre compte**.
   - Pass: « Vous ne pouvez pas encore supprimer votre compte », naming T2,
     with one button « Nommer {T2} propriétaire ».
2. Tap that button.
   - Pass: the screen changes to the self-deletion text (« Votre accès est
     supprimé et votre nom est retiré de ce ménage… »).
3. Tap **Exporter les transactions (CSV)** → the share sheet opens → **Save
   to Files** (or Notes).
   - Pass: the saved file contains the **Épicerie test** row.
4. Tap **Supprimer mon compte**. In « Saisissez votre adresse courriel pour
   confirmer : » type T1's email **with one letter wrong**.
   - Pass: **Supprimer définitivement mon compte** stays disabled.
5. Retype the email correctly but **in capitals**.
   - Pass: the button becomes enabled.
6. Tap **Supprimer définitivement mon compte**.
   - Pass: alert « Votre compte a été supprimé », then the sign-in screen.
     (If it says « La suppression n'est pas tout à fait terminée », note it
     and continue — the checks below decide.)

**[Lineu]** Send Claude Code: `D (T1) done for <the T1 email>`

**[Claude Code]** Checks (read-only). It needs T1's user id, which it looks up from
the deletion request by email:
```sql
WITH r AS (SELECT * FROM member_deletion_requests WHERE lower(subject_email) = lower('<T1 email>') ORDER BY requested_at DESC LIMIT 1)
SELECT 'request' AS what, jsonb_build_object('kind', kind, 'requested', requested_at, 'db_done', db_completed_at, 'auth_done', auth_completed_at, 'error', last_error) AS v FROM r
UNION ALL SELECT 'public.users', to_jsonb(count(*)) FROM users WHERE id = (SELECT subject_user_id FROM r)
UNION ALL SELECT 'member row', jsonb_agg(jsonb_build_object('name', name, 'user_id', user_id, 'deleted_at', deleted_at)) FROM household_members WHERE id = (SELECT member_id FROM r)
UNION ALL SELECT 'auth.users', to_jsonb(count(*)) FROM auth.users WHERE id = (SELECT subject_user_id FROM r)
UNION ALL SELECT 'auth.sessions', to_jsonb(count(*)) FROM auth.sessions WHERE user_id = (SELECT subject_user_id FROM r)
UNION ALL SELECT 'live refresh tokens', to_jsonb(count(*)) FROM auth.refresh_tokens WHERE user_id::uuid = (SELECT subject_user_id FROM r) AND NOT revoked;
```
Pass: request with `auth_done` set and `error` null; `auth.users`,
`auth.sessions` and live refresh tokens all **0**; the member row kept with
`deleted_at` set. If the phone said the deletion didn't fully finish:
`auth.sessions` and live refresh tokens must still be **0**.

7. On the iPhone, sign in as **T2** → tab **Compte** → **Supprimer votre
   compte**.
   - Pass: the household text (T2 is now the only member) and the list
     « Supprimer {ménage} détruit : » with grouped numbers.
8. Tap **Supprimer ce ménage** → type the household's name exactly as shown
   → **Supprimer définitivement ce ménage**.
   - Pass: the alert, then the sign-in screen.

**[Lineu]** Send Claude Code: `D (T2) done for <the T2 email>`

**[Claude Code]** Checks (read-only):
```sql
WITH r AS (SELECT * FROM member_deletion_requests WHERE lower(subject_email) = lower('<T2 email>') ORDER BY requested_at DESC LIMIT 1)
SELECT 'household' AS what, to_jsonb(count(*)) AS v FROM households WHERE id = (SELECT household_id FROM r)
UNION ALL SELECT 'transactions', to_jsonb(count(*)) FROM transactions WHERE household_id = (SELECT household_id FROM r)
UNION ALL SELECT 'auth.users', to_jsonb(count(*)) FROM auth.users WHERE id = (SELECT subject_user_id FROM r)
UNION ALL SELECT 'auth.sessions', to_jsonb(count(*)) FROM auth.sessions WHERE user_id = (SELECT subject_user_id FROM r);
```
Pass: every count **0**.

9. iPhone **Settings → General → Language & Region**: back to your usual
   language.

---

## Part 2 — The App Store Connect app record — Lineu (already done)

You have created the record; its Apple ID **6812001209** is the `ascAppId`
now in `apps/mobile/eas.json` under `submit.production.ios`. The steps are
kept here so the record can be recreated identically.

1. **[Lineu]** https://appstoreconnect.apple.com → **Apps** → **+** →
   **New App**.
2. **[Lineu]** Fill in:
   - **Platforms**: iOS
   - **Name**: Phare
   - **Primary Language**: English (Canada)
   - **Bundle ID**: choose **money.phare.app** from the list. (If it is not
     in the list, it has not been registered yet: the first `eas build` in
     part 6 registers it; come back afterwards.)
   - **SKU**: `phare-ios`
   - **User Access**: Full Access
   → **Create**.
3. **[Lineu]** Left column **General → App Information**. Copy the number
   next to **Apple ID** — that is the `ascAppId`. Check **Bundle ID** reads
   **money.phare.app**.
4. **[Lineu]** Send Claude Code: `ascAppId <number>`.
5. **[Claude Code]** Puts it in `apps/mobile/eas.json` →
   `submit.production.ios.ascAppId`. *Done 2026-10-13 (6812001209).*
6. **[Lineu]** Left column **Pricing and Availability**: **Price**: Free (USD
   0.00). **Availability**: deselect all, select **Canada** only → **Save**.

---

## Part 3 — A new App Store Connect API key, stored with `eas credentials` — Lineu

EAS uses this key to upload builds without your Apple password. Make a new
one and revoke any older one.

1. **[Lineu]** https://appstoreconnect.apple.com → **Users and Access** (top
   right) → tab **Integrations** → left **App Store Connect API** → **Team
   Keys**. If Apple asks you to request API access, click **Request Access**
   and accept.
2. **[Lineu]** Click **+** (Generate API Key). **Name**: `EAS Phare`.
   **Access**: **App Manager** → **Generate**.
3. **[Lineu]** In the new row, note the **Key ID** (10 characters). Above
   the table, note the **Issuer ID** (long id with dashes).
4. **[Lineu]** Click **Download API Key**. Apple allows this **once**. Save
   `AuthKey_<KeyID>.p8` in a private folder **outside the repo**, e.g.
   `C:\Users\lineu\Documents\keys\`. Never put it in the repo.
5. **[Lineu]** If an older key for EAS or Phare is listed: click it →
   **Revoke**.
6. **[Lineu]** In a terminal:
   ```
   cd C:\Users\lineu\source\repos\phare\apps\mobile
   eas credentials --platform ios
   ```
   The prompts and the answers (EAS CLI ≥ 16; if a line is worded slightly
   differently in your version, pick the option with the same meaning):

   | EAS asks | You answer |
   |---|---|
   | Which build profile do you want to configure? | **production** |
   | Do you want to log in to your Apple account? | **Yes** → your Apple ID, password, then the 6-digit code on your phone |
   | What do you want to do? | **App Store Connect: Manage your API Key** |
   | What do you want to do? | **Set up your project to use an API Key for EAS Submit** |
   | Select what to use for your project | **[Add a new ASC API Key]** (not "Generate", since you made it yourself) |
   | Path to App Store Connect API Key | the full path of the `.p8`, e.g. `C:\Users\lineu\Documents\keys\AuthKey_ABC123DEFG.p8` |
   | Key ID | the Key ID from step 3 (EAS may fill it from the file name — check it) |
   | Issuer ID | the Issuer ID from step 3 |
   | Apple Team | the team that owns the Phare record |

   Then **Go back** / **Exit**.
7. **[Lineu]** Send Claude Code: `ASC key stored in EAS`. Claude Code never
   needs the key itself.

---

## Part 4 — The App Review demo household — Lineu, then Claude Code

A dedicated household App Review signs in to. **Never 2be22642, never
Zezinho Test.** Its email and password go in the App Review notes (part 7).

### 4.1 Create and onboard it on the web — Lineu

1. **[Lineu]** In a private window: **https://phare.money/en/signin** →
   « No account yet? » → **Create one**. **Full name**: `Demo
   Household`. **Email**: an inbox you control (e.g.
   `lineugraeff+appreview@hotmail.com`). A strong password you will paste
   into App Store Connect. Tick consent → **Create account** → confirm the email →
   accept the terms if asked.
2. **[Lineu]** Build the plan with the **step-by-step form** (not the
   template). Round, plainly fictional figures:
   - Income: **Salary A** 2400 **every 2 weeks**; **Salary B** 2100
     **twice a month**.
   - Expenses: **Rent** 1850 monthly; **Hydro** 110 monthly; **Phone &
     internet** 140 monthly; **Car payment** 420 every 2 weeks.
   - Accounts: **2** credit cards, **Visa** and **Mastercard**. Chequing
     balance today: **3200**.
   - On the pay-date step, give real next dates for both salaries and the
     car payment.
3. **[Lineu]** Send Claude Code: `Demo created: <demo email>`.

### 4.2 Comp it — Claude Code prepares, Lineu runs

4. **[Claude Code]** Looks up the household id (read-only) and sends it back:
   ```sql
   SELECT u.household_id, h.name FROM users u JOIN households h ON h.id = u.household_id
    WHERE lower(u.email) = lower('<demo email>');
   ```
5. **[Lineu]** Open `scripts/comp-demo-household.sql`, replace the four
   `<DEMO_HH>` with that id, and run it in the Supabase **SQL Editor** top to
   bottom. Check: BEFORE shows **Demo Household**; the UPDATE says
   **UPDATE 1**; VERIFY shows `comp_until` **2027-12-31**.
   The script in full:
   ```sql
   -- BEFORE
   SELECT id, name, comp_until, comp_reason, subscription_status
     FROM households WHERE id = '<DEMO_HH>';
   BEGIN;
   UPDATE households
      SET comp_until = '2027-12-31', comp_reason = 'App Store review demo'
    WHERE id = '<DEMO_HH>'
      AND id NOT IN ('2be22642-53c5-4599-ad3b-42a076e10484', '987c63c1-034b-4607-8623-d6288ce3d78d');
   -- Expect: UPDATE 1
   COMMIT;
   -- VERIFY
   SELECT id, name, comp_until, comp_reason FROM households WHERE id = '<DEMO_HH>';
   SELECT count(*) FROM households WHERE comp_reason = 'App Store review demo' AND id <> '<DEMO_HH>';
   -- Expect: 0
   ```
6. **[Lineu]** Send Claude Code: `Demo comped`.

### 4.3 Data so every tab has real content — Lineu

7. **[Lineu]** On the web, signed in as the demo: **Cards** page, current
   month.
   - **Visa**: monthly goal **900**, statement close day **20**, payment
     day **10**; category budgets **Groceries & Pharmacy 500**,
     **Restaurants 200**.
   - **Mastercard**: **no goal** (it must show "—" in the app). Close day
     **5**, payment day **25**.
8. **[Lineu]** Add expenses (web, or the app's **+**) dated across **last
   month and this month**: groceries, restaurants, a pharmacy run, a gas
   fill — enough that **Visa this month is over its 900 goal**, and a few
   on Mastercard.
9. **[Lineu]** On the web dashboard, **Regenerate** once, so the **Review**
   tab has a full monthly letter (the household is comped, so it is not
   locked).
10. **[Lineu]** Send Claude Code: `Demo data entered`.
11. **[Claude Code]** Checks (read-only) that every tab will have content:
    ```sql
    WITH d AS (SELECT household_id FROM users WHERE lower(email) = lower('<demo email>'))
    SELECT 'anchor' AS what, count(*)::text AS v FROM account_balance_anchors WHERE household_id = (SELECT household_id FROM d)
    UNION ALL SELECT 'cards', string_agg(name, ', ') FROM accounts WHERE household_id = (SELECT household_id FROM d) AND type = 'credit_card'
    UNION ALL SELECT 'card goals this month', string_agg(card_goal::text, ', ') FROM monthly_goals WHERE household_id = (SELECT household_id FROM d) AND month = date_trunc('month', (now() AT TIME ZONE 'America/Toronto'))::date
    UNION ALL SELECT 'manual expenses', count(*)::text FROM transactions WHERE household_id = (SELECT household_id FROM d) AND source = 'manual'
    UNION ALL SELECT 'letters', string_agg(type || coalesce(':' || review_month, ''), ', ') FROM conversations WHERE household_id = (SELECT household_id FROM d)
    UNION ALL SELECT 'comp_until', comp_until::text FROM households WHERE id = (SELECT household_id FROM d);
    ```
    Pass: one anchor; Visa and Mastercard; one goal (900) this month;
    several manual expenses; an `onboarding` letter **and** a
    `monthly_review`; `comp_until` 2027-12-31. Claude Code also adds the
    demo household to the list excluded from every funnel and usage count.
12. **[Lineu]** On the iPhone, sign in as the demo and open each tab:
    **Home, Review, Timeline, Cards, Account** all show content; no price
    anywhere; **Account → Privacy policy** opens.

---

## Part 5 — Screenshots — Lineu

### 5.1 Sizes

13. **[Lineu]** App Store Connect needs **one iPhone set** per language;
    iPad is not needed (`supportsTablet` is false). The required set is the
    **6.9-inch display**: portrait **1320 × 2868**, **1290 × 2796** or
    **1260 × 2736** pixels. Smaller iPhone sizes are generated from it.
    Before taking them, open the version page → **Previews and Screenshots**:
    if it lists a different required size, follow what it lists.
14. **[Lineu]** Check which iPhone you have: **Settings → General → About →
    Model Name**. These take screenshots of the right size directly:
    iPhone 16 Pro Max (1320 × 2868); iPhone 14 Pro Max, 15 Plus, 15 Pro Max,
    16 Plus (1290 × 2796). Any other model: the screenshots will be
    refused — borrow one of those phones for 15 minutes (sign in to the dev
    or TestFlight build as the demo), or tell Claude Code and it will
    write the steps for a cloud Mac simulator.

### 5.2 The five screens, in EN then FR

All signed in as the **demo household**, in this order:

| # | Screen | What must be visible |
|---|---|---|
| 1 | **Home** | the month's snapshot and the Plan card |
| 2 | **Timeline** | a month with a visible low point before payday |
| 3 | **Cards** | "Room on your cards": Visa over goal, Mastercard with "—" |
| 4 | **Add an expense** (the **+**) | the sheet with the amount field |
| 5 | **Review** | the top of the monthly letter |

15. **[Lineu]** iPhone language **English (Canada)**: take screens 1–5.
16. **[Lineu]** iPhone language **Français (Canada)**: take screens 1–5
    again (Accueil, Chronologie, Cartes, Ajouter une dépense, Bilan).

### 5.3 Taking them from the dev build

17. **[Lineu]** Start Metro (`pnpm --filter @phare/mobile start`), open the
    dev build, sign in as the demo. Wait until any "Refreshing…" or
    "Bundling" banner at the top is gone, and don't shake the phone (that
    opens the dev menu).
18. **[Lineu]** For each screen: press **side button + volume up** together.
19. **[Lineu]** Photos → select the 10 screenshots → Share → **AirDrop** (or
    email to yourself) → save on the computer in a folder named
    `screenshots/en` and `screenshots/fr`, named `1-home.png` …
    `5-review.png`.
20. **[Lineu]** Look at each one full-size: no dev-build banner, no
    personal data, no price.
    (Taking them later from the **TestFlight** build of part 6 avoids
    dev-build banners entirely; either is accepted.)

---

## Part 6 — Production build and submit — Claude Code, then Lineu

21. **[Claude Code]** Before any production build, on the commit you will
    build from: mobile tests, mobile typecheck, and `bundle:check` (the
    compiled-bundle price scan). Reports pass/fail. Do not build on a fail.
22. **[Lineu]** Commit everything first. Then:
    ```
    cd C:\Users\lineu\source\repos\phare\apps\mobile
    eas build --profile production --platform ios
    ```
    First production build only — the prompts and answers:

    | EAS asks | You answer |
    |---|---|
    | Do you want to log in to your Apple account? | **Yes** → Apple ID, password, 6-digit code |
    | Reuse this distribution certificate? / Generate a new Apple Distribution Certificate? | **Yes** (generate) if none exists |
    | Generate a new Apple Provisioning Profile? | **Yes** |
    | (remote version) buildNumber will be initialized… | just continue |

    The build runs in the cloud (about 15–25 minutes). It ends with a link;
    status **Finished**.
23. **[Lineu]** Upload it to App Store Connect:
    ```
    eas submit --platform ios --profile production --latest
    ```
    It uses the `ascAppId` and the API key from part 3; no questions
    expected. Ends with "Submitted your app to Apple App Store Connect".
24. **[Lineu]** App Store Connect → **Apps → Phare → TestFlight**. The build
    shows **Processing** (10–30 minutes), then **Missing Compliance** →
    **Manage** → "What type of encryption algorithms does your app
    implement?" → **None of the algorithms mentioned above** (the app only
    uses standard HTTPS) → **Save**.
25. **[Lineu]** **TestFlight → Internal Testing** → **+** → add yourself →
    install from the **TestFlight** app on the iPhone. Sign in as the demo;
    open every tab. Send Claude Code: `TestFlight build OK` or what you saw.
26. **[Lineu]** **App Store** tab → **iOS App 1.0** (Prepare for
    Submission):
    - **Previews and Screenshots**: drag in the five EN screenshots under
      English (Canada); switch the language at the top right to French
      (Canada) and drag in the five FR ones.
    - **Promotional Text, Description, Keywords, Support URL**: paste from
      `docs/app-store-listing.md` section 1 (EN and FR).
    - **Build**: **+** → select the TestFlight build from step 24.
    - **App Review Information**: from part 7.
    - **Version Release**: **Manually release this version**.
    - **Save** → **Add for Review** → **Submit to App Review**.
27. **[Lineu]** Send Claude Code: `Submitted` — and later Apple's verdict,
    word for word, if anything is rejected.

---

## Part 7 — App Privacy answers and App Review notes — Lineu

Copied from `docs/app-store-listing.md` (sections 2 and 3, decided
2026-10-02).

### 7.1 App Privacy

28. **[Lineu]** App Store Connect → **Phare** → **App Privacy** → **Get
    Started** → "Do you or your third-party partners collect data from this
    app?" → **Yes, we collect data from this app** → **Next**.
29. **[Lineu]** Tick exactly these data types, then **Save**:
    - Contact Info → **Name**, **Email Address**
    - Financial Info → **Other Financial Info**
    - Identifiers → **User ID**
    - Usage Data → **Product Interaction**
30. **[Lineu]** For each one, Apple asks three things. Answers:

    | Data type | Used for | Linked to the user's identity? | Used for tracking? |
    |---|---|---|---|
    | Name | **App Functionality** | **Yes** | **No** |
    | Email Address | **App Functionality** | **Yes** | **No** |
    | Other Financial Info | **App Functionality** | **Yes** | **No** |
    | User ID | **App Functionality** | **Yes** | **No** |
    | Product Interaction | **Analytics** | **Yes** | **No** |

    Everything else is **not collected**: Health & Fitness, Location,
    Sensitive Info, Contacts, other User Content, Browsing History, Search
    History, Diagnostics, Purchases, Payment Info, Audio, Photos/Videos,
    Gameplay, Customer Support.
31. **[Lineu]** **Privacy Policy URL**: `https://phare.money/en/privacy` →
    **Publish**.

### 7.2 App Review notes

32. **[Lineu]** Version page → **App Review Information**:
    - **Sign-In required**: ticked. **User name**: the demo email.
      **Password**: the demo password.
    - **Contact**: your name, phone, `support@phare.money`.
    - **Notes**: paste this, with the demo email and password filled in:

    > **Demo account**
    > Email: `<DEMO_EMAIL>`
    > Password: `<DEMO_PASSWORD>`
    > This household has several months of example data, two credit cards and a monthly plan, so every screen has something to show.
    >
    > **Why there is no sign-up in the app**
    > Phare is a household planning system. Accounts are created at phare.money; the iOS app is a free, stand-alone companion for people who already have a Phare account. There is no purchasing of any kind in the app and no call to action to purchase outside it (App Store Review Guideline 3.1.3(f)).
    >
    > **Account deletion**
    > Account → Delete my account. Deletion is immediate and permanent; the app offers a transaction export first. If the signed-in person shares a household with another member, the app first asks them to make that member an owner, then deletes only their own account.
    >
    > **Please do not delete the demo account** — it would remove the demo household and its history. If you need to test deletion, we can provide a second account on request at support@phare.money.
    >
    > **Privacy policy:** Account → Privacy policy (also at https://phare.money/en/privacy).

33. **[Lineu]** **Save**. (Submitting happens in part 6, step 26.)
