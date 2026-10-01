# save-plan seeds whatever category names the request body sends

**Filed** 2026-10-01, found while moving the seed list into `@phare/core`.

**Status:** OPEN. Ticket only.

## The problem

[src/app/api/save-plan/route.ts](../../src/app/api/save-plan/route.ts)
(the "Seed the fixed category set" block):

```ts
const seedNames: string[] = plan.seedCategories ?? [...SEED_EXPENSE_CATEGORIES];
```

`plan` is the request body. When it carries `seedCategories`, those names are
inserted as the household's categories — any names, any number. The legitimate
client sends back the list `/api/plan` put there (the same ten), so nothing
breaks today, but:

- a client chooses which categories get created, sidestepping the Pro gate on
  custom categories (`POST /api/categories` → `requirePro(…'custom_categories')`);
- there is no cap: a body can create an unbounded number of category rows;
- a household can be left without the seed categories the rest of the app
  assumes (e.g. no "Unexpected", which is save-plan's own fallback for an
  unclassified line).

## The fix

Seed `SEED_EXPENSE_CATEGORIES` from `@phare/core` unconditionally and ignore
(or refuse) `plan.seedCategories` from the body. `/api/plan` can stop returning
it. Test: a body with `seedCategories: ['Yachts']` creates the ten seed
categories and no "Yachts".
