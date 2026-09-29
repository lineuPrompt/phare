# /api/plan lets the AI choose each expense's category and whether it's fixed

**Filed** 2026-09-29, from the onboarding stranger audit. **STOP** (AI output,
money routing).

**Status:** OPEN.

CLAUDE.md §4: "The AI never chooses a number, category, or source." In
[src/app/api/plan/route.ts](../../src/app/api/plan/route.ts) (~246–312) the
model returns `lineClassifications` — for every expense line, a `category`
and `isFixed` — and the plan takes them as given (unknown → Unexpected /
variable).

`isFixed` decides where money goes in
[save-plan](../../src/app/api/save-plan/route.ts) (~483): fixed → a chequing
recurring item on the Timeline; variable → a category budget on the cards.
So the model decides whether a household's rent appears on its Timeline.

## To decide

Replace with a code rule or the household's own choice (e.g. the manual form
asks "paid from chequing on a schedule?"; the template's Fixed/Variable
sheets already say which is which). Bears directly on the minimal first
session proposal (backlog item 3).
