# The web Recurring page's Delete ignores a failed delete

**Filed** 2026-11-02, found while diagnosing "delete all recurring entries".

**Status:** FIXED in code 2026-11-02, uncommitted. Delete keeps the dialog
open with the server's reason; the edit path was silent too (it only
logged) and now shows its reason. Unverified on screen (no web DOM test).

## The problem

[src/components/recurring/RecurringList.tsx](../../src/components/recurring/RecurringList.tsx)
`doDelete` calls `DELETE /api/recurring/[id]` and never reads the response.
It closes the confirmation and reloads either way. If the server refuses
(for example, "Failed to remove the future occurrences: …"), the household
sees the line still there and no reason. CLAUDE.md §4: silent failure is
worse than visible failure.

Mobile's `RecurringEditScreen` reads the status; only the web is affected.

## The fix

Check `res.ok`; on failure keep the confirmation open and show the server's
`error`, as the edit path in the same file already does. Test where a render
harness allows it; otherwise say plainly it is unverified on screen.
