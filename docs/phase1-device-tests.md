# Phase 1 device tests (iPhone, TestFlight build 11)

> **Draft.** Lineu's instructions for this item were cut off after
> "Balances, edit and". This list covers everything built since build 9.
> Add or strike lines as needed.

**Who:**
- **Zezinho Test:** comped (Pro).
- **A new throwaway household without Pro:** needed for 9.
- **T1/T2:** for 10.

**How to record a result:** tick each line, or write what happened and file
it.

Do every section once in English and once in French (iPhone Settings → Apps
→ Phare → Language).

## 1. Month navigation (Home, Timeline, Cards)
- [ ] Home: ‹ goes back to August 2026 (Zezinho Test's first balance); a past month says "Actuals for …" and the plan note "The plan looks forward from …".
- [ ] Home: a later month shows that month's plan figure; › stops at the horizon end, with no message.
- [ ] Timeline: ‹ and › page months; only the current month continues to the next pay; "This month" jumps back to today's row.
- [ ] Cards: paging changes Goal, Spent and Room per month.
- [ ] Adding an expense with + while on another month refreshes and stays on that month.

## 2. Month link
- [ ] Home → tap the month name → the Timeline opens on that month.
- [ ] Timeline → tap the month name → Home opens on that month.
- [ ] Tapping the same month again after paging away still works.

## 3. Balances
- [ ] Account → Accounts → Update balance: shows "Last set: … on …".
- [ ] Save a balance for today → "Saved" → Home and the Timeline start from it.
- [ ] Tomorrow's date is refused; "$100" is refused; "-40,25" is accepted.

## 4. Accounts
- [ ] The Accounts list shows every account with its type; "Chequing" is not offered as a new type.
- [ ] Add a savings account with starting balance "500,25" → it appears. Then delete it on the web.

## 5. Edit and delete entries
- [ ] Tap an expense → change the amount to "12,50" → Save → the Timeline updates.
- [ ] Blank description refused; "abc" amount refused.
- [ ] A 🔁 recurring entry shows "only this occurrence"; deleting asks the occurrence question.
- [ ] A transfer edits both sides (check the savings account on the web).
- [ ] A 💳 card payment cannot be tapped.
- [ ] Delete an entry → confirm → it disappears.

## 6. Empty states
- [ ] Throwaway household with no balance: Home and Timeline show "Set your balance", which opens the balance screen.
- [ ] No card: Cards shows "Add a card", which opens Add an account preset to Credit card.

## 7. Phare Pro — status (Zezinho Test)
- [ ] Account → Phare Pro says "Your household has Phare Pro."
- [ ] The Phare Pro screen shows no prices and no Subscribe button.

## 8. Phare Pro — locked letter (household without Pro)
- [ ] The review letter shows its locked notice with "See Phare Pro".

## 9. Phare Pro — purchase (household without Pro, owner)
- [ ] The Phare Pro screen shows Monthly and Yearly with Apple's prices (not typed: they match App Store Connect).
- [ ] Subscribe → Apple's sheet → confirm (TestFlight: no charge) → "Welcome to Phare Pro".
- [ ] The household's `apple_*` columns are filled (Claude Code checks via MCP).
- [ ] The locked letter now opens in full.
- [ ] Restore Purchases → "Your purchase is restored."
- [ ] Manage subscription opens Apple's sheet.
- [ ] A **member** (not the owner) sees "Only the owner of the household can subscribe."

## 10. Deletion warning (household with an Apple subscription)
- [ ] Account: the warning about the App Store subscription shows above "Delete my account", with "Manage subscription".
- [ ] (Do not delete Zezinho Test. Use a throwaway account only.)
