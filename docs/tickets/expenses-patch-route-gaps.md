# PATCH /api/expenses/[id] and /api/transfers/[id]: validation gaps

**Found:** 2026-10-17, building Timeline edit/delete on mobile.
**Status:** filed, not fixed (out of scope). Mobile avoids each one, as noted.

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
