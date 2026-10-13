# iOS submission runbook

Written 2026-10-13 for Lineu. Do the parts in order. Every step says exactly
what to tap and what you should see. When a part says **"Send Claude Code:"**,
paste that message into the session; Claude Code then runs the read-only
checks listed and tells you pass or fail before you go on.

Ground rules for every part:

- **Never use household 2be22642 or Zezinho Test** for anything here. Parts 1
  and 3 use two throwaway accounts, **T1** and **T2**, created only for this.
- Deletion (part 1, section D) is permanent. Do it last.
- If anything on screen differs from what is written here, stop and send
  Claude Code a screenshot. Do not work around it.

---

## Part 1 — Device checklist (sections C, B, D)

### 1.0 Before you start (once)

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

### 1.1 Create T1 (web, 5 minutes)

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

**Send Claude Code:** `T1 created: <the T1 email>`

Claude Code checks (read-only):
```sql
SELECT u.id AS user_id, u.household_id, u.terms_version, u.terms_accepted_at,
       (SELECT count(*) FROM file_imports f WHERE f.household_id = u.household_id) AS plans
  FROM users u WHERE lower(u.email) = lower('<T1 email>');
```
Pass: one row, terms accepted, `plans` = 0.

### 1.2 Section C — Onboarding on the phone (T1, French)

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

**Send Claude Code:** `C done for <the T1 email>` (and a screenshot of any
step that did not match).

Claude Code checks (read-only):
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

### 1.3 Section B — Quick entry "12,50" (T1, French)

1. Tab **Cartes** → the **+** at top right.
   - Pass: **Ajouter une dépense**; the chequing account is preselected; the
     date is today.
2. **Compte**: choose **Visa test**. **Date**: tap **Hier**.
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

**Send Claude Code:** `B done for <the T1 email>`

Claude Code checks (read-only):
```sql
SELECT t.date, t.description, t.amount, t.type, t.source, t.member_id,
       a.name AS account, c.name AS category, t.recurrence_id, t.installment_label, t.created_at
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
 WHERE t.household_id = (SELECT household_id FROM users WHERE lower(email) = lower('<T1 email>'))
   AND t.source = 'manual'
 ORDER BY t.created_at DESC LIMIT 5;
```
Pass: exactly **one** row — yesterday's date in Toronto time, amount
**12.50**, type `expense`, account **Visa test**, `member_id` **null**, no
`recurrence_id`, no `installment_label`.

### 1.4 Create T2 (web)

1. On the computer, sign in at **https://phare.money/fr/signin** as **T1**,
   then open **https://phare.money/fr/household** (« Membres du foyer »).
   Under **Ajouter un membre**: **Nom complet** any name; **Courriel** a
   second email, **T2** (for example `lineugraeff+t2@hotmail.com`);
   **Rôle**: **Membre** → **Ajouter le membre**.
2. Open the invitation email for T2 → follow the link → set a password →
   accept the terms → sign in once on the web. Sign out.

**Send Claude Code:** `T2 created: <the T2 email>`

Claude Code checks (read-only):
```sql
SELECT u.email, u.role, u.household_id, u.terms_version, m.name AS member_name, m.deleted_at
  FROM users u LEFT JOIN household_members m ON m.user_id = u.id
 WHERE lower(u.email) IN (lower('<T1 email>'), lower('<T2 email>'));
```
Pass: both in the **same** household; T1 `owner`; T2 a member with terms
accepted.

### 1.5 Section D — Account deletion (T1, then T2). Permanent.

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

**Send Claude Code:** `D (T1) done for <the T1 email>`

Claude Code checks (read-only). It needs T1's user id, which it looks up from
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

**Send Claude Code:** `D (T2) done for <the T2 email>`

Claude Code checks (read-only):
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

## Part 2 — The App Store Connect app record

**Already done.** You created the record; its Apple ID is **6812001209**, and
that is the `ascAppId` now in `apps/mobile/eas.json` under
`submit.production.ios` (uncommitted). Check these three things once:

1. Open **https://appstoreconnect.apple.com** → **Apps** → **Phare**.
2. Left column **General → App Information**:
   - **Bundle ID** reads **money.phare.app**. (If it shows anything else,
     stop: the build would not match the record.)
   - **Apple ID** reads **6812001209**.
   - **Primary Language**: English (Canada).
3. Left column **Pricing and Availability**: price **Free**; availability
   **Canada** only.

For reference, if you ever need the ascAppId again: it is that **Apple ID**
number on **App Information**, not your Apple account email.

---

## Part 3 — A new App Store Connect API key for EAS

EAS uses this key to upload builds to App Store Connect without your Apple
password. Make a new one and revoke any older one.

1. **https://appstoreconnect.apple.com** → top right **Users and Access** →
   tab **Integrations** → left **App Store Connect API** → **Team Keys**.
   (If Apple asks you to request API access first, click **Request Access**
   and accept; it is immediate for an Account Holder.)
2. Click **+** (Generate API Key). **Name**: `EAS Phare`. **Access**: **App
   Manager** → **Generate**.
3. In the new row, note the **Key ID** (10 characters). Above the table,
   note the **Issuer ID** (a long id with dashes).
4. Click **Download API Key**. Apple lets you download it **once**. Save the
   `AuthKey_<KeyID>.p8` file in a private folder **outside the repo** (for
   example `C:\Users\lineu\Documents\keys\`). Never put it in the repo.
5. If an older key named for EAS or Phare is listed, click it → **Revoke**.
6. In a terminal:
   ```
   cd C:\Users\lineu\source\repos\phare\apps\mobile
   eas credentials --platform ios
   ```
   Answer the prompts:
   - Build profile: **production**
   - Menu: **App Store Connect: Manage your API Key**
   - **Set up your project to use an API Key for EAS Submit**
   - **Add a new ASC API Key** (or **Use an existing ASC API Key** if you
     already uploaded this exact key)
   - Path to the key: the full path of the `.p8` file from step 4
   - Key ID and Issuer ID: from step 3
   - If it asks which Apple team, pick the one that owns the Phare record.
   (EAS CLI menu wording can differ slightly by version. Pick the option
   that matches each line above.)
7. **Send Claude Code:** `ASC key stored in EAS` — Claude Code will not need
   the key itself, only to know it is there.

---

*The request for this runbook was cut off after part 3 (it ended at
"storing it with `eas"). Later parts — production build, TestFlight, the
submission itself — will be added when the rest of the request arrives.*
