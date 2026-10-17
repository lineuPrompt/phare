import { ApiError, messageKeyFor } from './apiErrors';
import {
  isCalendarDate,
  MANUAL_ENTRY_DESCRIPTION_MAX_CHARS,
  MANUAL_ENTRY_MAX_AMOUNT,
  parseAmountInput,
  type TimelineEntry,
} from '@phare/core';

// ---------------------------------------------------------------------------
// Editing and deleting a Timeline entry (Lineu, 2026-10-17; standalone S6).
//
// EXISTING ROUTES, AS THE WEB TIMELINE USES THEM (DayLedger.tsx):
//   - income / expense (typed by hand, OR one occurrence of a recurring rule)
//       PATCH / DELETE /api/expenses/[id]
//   - a transfer (savings contribution, debt payment, debt draw)
//       PATCH / DELETE /api/transfers/[id] — moves BOTH rows of the pair at
//       once; editing one side through /api/expenses would split the pair
//   - a card payment ("bridge")
//       NOT editable: computed from the card's cycle on every load, and the
//       route refuses it. The screen does not offer it.
//
// A RECURRING OCCURRENCE is detached by the route: its original date is
// tombstoned and it becomes a one-off. The rule and its other dates are not
// touched. The screen says so before saving or deleting.
//
// NOT OFFERED, ON PURPOSE:
//   - switching money out ↔ money in. PATCH /api/expenses keeps member_id when
//     an income becomes an expense, and expenses never carry a member
//     (CLAUDE.md §4). Ticket: expenses-patch-route-gaps.
//   - changing the account. Neither route supports it.
//
// LIMITS ARE QUICK ENTRY'S (@phare/core): the PATCH route itself checks no
// description length and no maximum amount, so the app refuses past them
// rather than send what the create route would never have accepted.
// ---------------------------------------------------------------------------

export type EditableKind = 'entry' | 'transfer';

/** Which edit path a Timeline row takes, or null when it cannot be edited. */
export function editableKind(entry: Pick<TimelineEntry, 'isBridge' | 'type'>): EditableKind | null {
  if (entry.isBridge) return null;
  if (entry.type === 'transfer') return 'transfer';
  if (entry.type === 'income' || entry.type === 'expense') return 'entry';
  return null;
}

export function entryPath(kind: EditableKind, id: string): string {
  return `/api/${kind === 'transfer' ? 'transfers' : 'expenses'}/${encodeURIComponent(id)}`;
}

export type EditDraft = {
  date: string;
  description: string;
  amount: string;
  /** '' = leave the category as it is (only for an expense). */
  categoryId: string;
};

export type EditProblem = 'dateInvalid' | 'descriptionRequired' | 'descriptionTooLong' | 'amountInvalid';

/**
 * The edit form → the PATCH body, or the first problem.
 *
 * Amount is a positive magnitude for both routes. A debt draw is stored
 * negative, and /api/transfers re-applies the pair's own sign, so re-saving
 * one never flips it into a contribution.
 */
export function buildEditBody(
  _kind: EditableKind,
  entryType: 'income' | 'expense' | 'transfer',
  draft: EditDraft
): { ok: true; body: Record<string, unknown> } | { ok: false; problem: EditProblem } {
  const date = draft.date.trim();
  if (!isCalendarDate(date)) return { ok: false, problem: 'dateInvalid' };

  // Required, as quick entry requires it: an entry with no description reads
  // as "Entry" on every screen and cannot be told apart.
  const description = draft.description.trim();
  if (!description) return { ok: false, problem: 'descriptionRequired' };
  if (description.length > MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) return { ok: false, problem: 'descriptionTooLong' };

  const amount = parseAmountInput(draft.amount);
  if (amount === null || amount <= 0 || amount > MANUAL_ENTRY_MAX_AMOUNT) return { ok: false, problem: 'amountInvalid' };

  const body: Record<string, unknown> = { date, description, amount };
  // Only for an expense, and only when one was picked: sending nothing leaves
  // the stored category as it is, as on the web ("Category…" = unchanged). A
  // transfer's type is always 'transfer', so it never sends one — no separate
  // transfer branch is needed (a mutation run proved one redundant).
  if (entryType === 'expense' && draft.categoryId) body.categoryId = draft.categoryId;
  return { ok: true, body };
}

/** The amount as the form shows it: a positive magnitude, never a sign. */
export function amountField(amount: number): string {
  return String(Math.abs(amount));
}

/** Literal keys, so the i18n parity test sees each one. */
export function editProblemKey(problem: EditProblem): string {
  switch (problem) {
    case 'dateInvalid': return 'entry.problems.dateInvalid';
    case 'descriptionRequired': return 'entry.problems.descriptionRequired';
    case 'descriptionTooLong': return 'entry.problems.descriptionTooLong';
    case 'amountInvalid': return 'entry.problems.amountInvalid';
  }
}

/**
 * A failed save or delete → its message. 409 is both routes' "the row is no
 * longer there" (deleted or changed elsewhere since the Timeline loaded):
 * worth saying exactly, because "try again" would fail the same way.
 */
export function editErrorKey(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return 'edit.errors.gone';
  return messageKeyFor(err);
}
