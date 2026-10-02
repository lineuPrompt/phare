# App Store listing — draft for Lineu's approval

Drafted 2026-10-02. Nothing here is submitted. Every field is written for
App Store Connect as it will appear; character counts are Apple's limits.

Ground rules this copy follows (CLAUDE.md §1, §4; App Store 3.1.1):
Phare is a planning system for Canadian **households** — never a budgeting
app, an expense tracker or a financial dashboard. No prices, no "Pro", no
paid features, no upgrade wording, nothing that points to buying anything.
The features named below are the ones every household has in the iOS app.

---

## 1. Store metadata

| Field | Value |
|---|---|
| Name | Phare |
| Primary language | English (Canada); French (Canada) added as a localization |
| Category | Finance |
| Age rating | 4+ (answer "None" to every content question) |
| Availability | Canada only |
| Version | 1.0.0 |
| Support URL | https://phare.money/en/faq (FR: https://phare.money/fr/faq) — lists support@phare.money |
| Privacy policy URL | https://phare.money/en/privacy (FR: https://phare.money/fr/privacy) |

### English (Canada)

**Subtitle** (30 max — 27):
> Plan your household's money

**Promotional text** (170 max — optional):
> See where your chequing account is headed, day by day, from today to your next payday — and what's left on each credit card this month.

**Description** (4,000 max):
> Phare is a planning system for Canadian households. It answers one question every day: will the money in our chequing account cover what's coming before the next pay arrives?
>
> **Your timeline.** Phare lays out your chequing account day by day — each paycheque, each bill, each card payment on the date it actually happens — so you can see the low point before you reach it, not after.
>
> **Real months, never averages.** A bi-weekly paycheque lands twice in most months and three times in some. Phare shows the month you'll actually live, not a smoothed-out average that's wrong in both directions.
>
> **Room on your cards.** For each credit card, see this month's spending, the goal you set, and how much room is left.
>
> **Quick entry.** Add an expense in a few taps, on the right card or account, in your own language. French keypads welcome: 12,50 reads as 12,50.
>
> **Built from what you already know.** Start with your pay, your bills and how often each one comes. Phare does the math — monthly figures, pay schedules, card cycles.
>
> **Made for Canada, in English and French.** Canadian dollars, Canadian pay schedules, and an app that speaks your language.
>
> **Your data stays yours.** You can export your transactions and delete your account from inside the app at any time.
>
> A Phare account is created at phare.money. Sign in with it here.

**Keywords** (100 max, comma-separated, no spaces after commas — 96):
> household,planning,cash flow,timeline,paycheque,payday,bills,credit card,chequing,balance,Canada

### French (Canada)

**Sous-titre** (30 max — 28):
> Planifiez l'argent du ménage

**Texte promotionnel** (170 max — facultatif):
> Voyez où s'en va votre compte chèques, jour après jour, d'aujourd'hui à votre prochaine paie — et ce qu'il reste sur chaque carte de crédit ce mois-ci.

**Description** (4 000 max):
> Phare est un système de planification pour les ménages canadiens. Il répond chaque jour à une question : l'argent dans notre compte chèques suffira-t-il à couvrir ce qui s'en vient avant la prochaine paie?
>
> **Votre chronologie.** Phare déploie votre compte chèques jour par jour — chaque paie, chaque facture, chaque paiement de carte à la date où il a vraiment lieu — pour que vous voyiez le creux avant d'y arriver, pas après.
>
> **De vrais mois, jamais des moyennes.** Une paie aux deux semaines tombe deux fois la plupart des mois, et trois fois dans certains. Phare montre le mois que vous allez réellement vivre, pas une moyenne lissée qui se trompe dans les deux sens.
>
> **La marge sur vos cartes.** Pour chaque carte de crédit, voyez les dépenses du mois, l'objectif que vous vous êtes fixé et la marge qu'il vous reste.
>
> **Saisie rapide.** Ajoutez une dépense en quelques touches, sur la bonne carte ou le bon compte. Le clavier français est le bienvenu : 12,50 se lit bien 12,50.
>
> **Bâti à partir de ce que vous savez déjà.** Commencez par vos paies, vos factures et leur fréquence. Phare s'occupe des calculs — montants mensuels, calendriers de paie, cycles de cartes.
>
> **Conçu pour le Canada, en français et en anglais.** Des dollars canadiens, des calendriers de paie canadiens, et une application qui parle votre langue.
>
> **Vos données restent les vôtres.** Vous pouvez exporter vos transactions et supprimer votre compte à partir de l'application, en tout temps.
>
> Un compte Phare se crée sur phare.money. Connectez-vous ici avec ce compte.

**Mots-clés** (100 max — 94):
> ménage,planification,trésorerie,paie,factures,carte de crédit,compte chèques,solde,chronologie

### Screenshots

iPhone 6.9″ set (1320 × 2868), one set per language, from the demo
household (section 4). No iPad set: `supportsTablet` is false. In order:

1. Timeline — a month with a visible low point before payday
2. Cards — "Room on your cards", one card over goal, one with no goal ("—")
3. Quick entry — the add-an-expense sheet
4. Onboarding — the "Enter your numbers" form (the first thing a new household sees)
5. Account — showing the Privacy policy row and account deletion

Avoid in screenshots: the Review tab while the demo household is not comped
(the locked notice), and any real household's data.

---

## 2. App Privacy (as decided 2026-10-02)

**Does this app collect data? Yes. Is any of it used for tracking? No.**

| Data type (Apple's names) | Collected | Linked to the user | Used for tracking | Purposes |
|---|---|---|---|---|
| Contact Info → **Name** | Yes | Yes | No | App Functionality |
| Contact Info → **Email Address** | Yes | Yes | No | App Functionality |
| Financial Info → **Other Financial Info** (income, expenses, balances, card names, entry descriptions) | Yes | Yes | No | App Functionality |
| Identifiers → **User ID** | Yes | Yes | No | App Functionality |
| Usage Data → **Product Interaction** (onboarding steps, opening a screen, the daily "returned" record) | Yes | Yes | No | Analytics |

**Not collected:** Health & Fitness, Location, Sensitive Info, Contacts,
User Content other than the above, Browsing History, Search History,
Diagnostics (no crash or performance SDK), Purchases, Payment Info (the app
sells nothing), Audio, Photos/Videos, Gameplay, Customer Support data.

Notes for the questionnaire:
- Name is declared even though the app itself never sends it: the account
  it signs into holds it (decided 2026-10-02).
- Plan text generated with an AI provider (Anthropic) is processing on
  Phare's behalf for App Functionality — not "sharing with third parties"
  for advertising or tracking.
- No third-party analytics or advertising SDK is in the app (dependencies:
  Expo, React Native, Supabase client).

---

## 3. App Review notes (paste into "Notes")

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

---

## 4. Demo household — setup steps (Lineu)

So it can be recreated identically if it is ever deleted. Never household
2be22642, never Zezinho Test.

1. **Sign up on the web** at phare.money with an inbox you control
   (email confirmation is on). Name: "Demo Household". Language: English.
   Tick the consent box; confirm the email; accept the terms if asked.
2. **Onboard (step-by-step form)** — use round, plainly fictional figures:
   - Income: "Salary A" 2,400 every 2 weeks; "Salary B" 2,100 twice a month.
   - Expenses: Rent 1,850 monthly; Hydro 110 monthly; Phone & internet 140
     monthly; Car payment 420 every 2 weeks.
   - Accounts: 2 credit cards, "Visa" and "Mastercard". Chequing today: 3,200.
   - Build the plan; on the pay-date step set real next dates for both pays
     and the car payment.
3. **Cards** (web Cards page, current month):
   - Visa: monthly goal 900, close day 20, payment day 10; category
     budgets Groceries & Pharmacy 500, Restaurants 200.
   - Mastercard: no goal (it must show "—" in the app). Close day 5,
     payment day 25.
4. **History** — add expenses on the web (or quick entry) dated across the
   last two months and this one: groceries, restaurants, a pharmacy run, a
   gas fill, enough that Visa this month is **over** its 900 goal.
5. **Monthly review** — after the history is in, generate one review on the
   web so the Review tab is not empty.
6. **Comp the household** (Lineu, SQL Editor) so the review shows in full —
   as a one-off data change in the usual shape:

   ```sql
   -- BEFORE
   SELECT id, name, comp_until, comp_reason FROM households WHERE id = '<DEMO_HH>';
   BEGIN;
   UPDATE households
      SET comp_until = '2027-12-31', comp_reason = 'App Store review demo'
    WHERE id = '<DEMO_HH>';   -- expect 1 row
   COMMIT;
   -- VERIFY
   SELECT id, name, comp_until, comp_reason FROM households WHERE id = '<DEMO_HH>';
   ```
7. **Check on the iPhone** (TestFlight build): sign in → Review, Timeline,
   Cards, Account all populated; Account → Privacy policy opens; nothing
   shows a price.
8. **Exclude it from the funnel**: add `<DEMO_HH>` to the excluded
   households alongside Zezinho Test in every funnel or usage count.

---

## 5. Still open before submitting

- **Final app icon and splash** — the current ones are Expo placeholders.
- **ascAppId** — from the App Store Connect app record; `submit.production`
  in `apps/mobile/eas.json` stays empty until you give it to me.
- **The Privacy Policy's Stripe sentence** passes the compliance scan only
  through a gap: "once paid subscriptions are available" escapes the
  `subscription` pattern because of the plural, and the French « abonnements
  payants » is not covered by any pattern (they are English-only). The
  singular wording would be caught. Your call, with counsel, whether the
  sentence stays as is for the app.
- **Confirm the association file** after the deploy (Claude Code: a 200 with
  no `/auth/callback`; Apple's CDN can take up to a day to refresh).
