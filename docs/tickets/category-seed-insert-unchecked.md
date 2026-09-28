# save-plan seeds categories without checking the insert

**Filed** 2026-09-28, found during the backlog reconciliation (while checking
why four households have no categories — they never saved a plan, which is
correct).

**Status:** OPEN.

**Severity:** medium. Without categories a household cannot record money out
(category is required, and creating one is a paid feature).

---

## The problem

[src/app/api/save-plan/route.ts](../../src/app/api/save-plan/route.ts)
(around line 391) seeds the ten fixed categories with
`await supabase.from('categories').insert(...)` and never reads the error.
If that insert fails, the plan still saves, the response is 200, and the
household is left with no categories and no sign of why — a silent failure
(CLAUDE.md §4).

Related, cosmetic: the comment in
[src/app/api/categories/route.ts](../../src/app/api/categories/route.ts)
(POST) says "the seeded ten come from the signup trigger". They come from
save-plan; the live `handle_new_user` inserts no categories.

## The fix

Check the insert's error and fail the save visibly (or report it in the
response the way `unmatchedMembers` is reported). Correct the comment.
