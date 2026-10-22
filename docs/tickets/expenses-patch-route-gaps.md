# PATCH /api/expenses/[id] and /api/transfers/[id]: validation gaps

**Found:** 2026-10-17, building Timeline edit/delete on mobile.
**Status:** FIXED in code 2026-10-22 (launch plan 1.7). All six:
1. income → expense clears `member_id`; 2–4. the edit runs the create rules
(`parseExpensePatch` in `src/lib/expenseRequest.ts`: calendar date, 200-char
description, 999,999,999.99 ceiling, two decimals, a number not text) and
looks up the category's household, as create does; transfers get the same
date/amount/description limits; 5. a failed tombstone refuses the edit or
delete with `DETACH_FAILED` and the reason, nothing changed (an existing
tombstone, 23505, is success); 6. transfer PATCH and DELETE check what they
touched (409 when nothing). Also: transfer reads no longer answer "not found"
on a failed read. Tests in both routes' `detach.test.ts`; mutants 15/15
(expenses) and 10/10 (transfers).

1. **Income → expense keeps the member.** PATCH `/api/expenses/[id]`
   accepts `type: 'expense'` and never clears `member_id`. An income entry
   (which carries a member) edited into an expense keeps it, which breaks
   "expenses never get member attribution" (CLAUDE.md §4). The web
   Timeline offers this switch. *Mobile:* doesn't offer a type switch.
2. **No date validation.** `date` is written as sent, with no format or
   calendar check. *Mobile:* checks with `isCalendarDate` first.
3. **No description limit.** POST `/api/expenses` refuses more than 200
   characters; PATCH accepts any length. *Mobile:* refuses past 200.
4. **No maximum amount.** PATCH accepts any positive number; the create
   path's ceiling is 999,999,999.99. *Mobile:* refuses past it.
5. **A lost tombstone is silent.** Editing or deleting a recurring
   occurrence writes `recurring_skipped_dates` "best-effort": a failed
   insert is logged and the edit still answers 200. A later rule edit can
   then bring the occurrence back. That's a silent failure (CLAUDE.md §4).
6. **Transfers PATCH doesn't check it touched anything.** Unlike the
   expenses route, it doesn't `.select()` the update. If the pair was
   deleted in between, it answers `updated: true` for a write that changed
   nothing.

Each fix needs a route test that fails first, mutation-tested.
