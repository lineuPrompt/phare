import {
  businessToday,
  DEFAULT_HOUSEHOLD_TIMEZONE,
  isCalendarDate,
  MANUAL_ENTRY_DESCRIPTION_MAX_CHARS,
  parseAmountInput,
} from '@phare/core';
import { ApiError, messageKeyFor } from './apiErrors';
import type { Getter } from './timelineLoader';
import type { AccountsResponse, TimezoneResponse } from './timeline';

// ---------------------------------------------------------------------------
// Quick entry: one-off money out, money in, or a contribution to a savings
// goal or debt (money in and contributions: standalone S6, 2026-10-22).
//
// SCOPE, ENFORCED BY THE BODIES THIS BUILDS: no repeat, no installments, no
// member. Each body has exactly the fields its type lists and nothing else,
// the same fields the web Timeline's entry form sends:
//   money out    POST /api/expenses  (ExpenseBody)
//   money in     POST /api/expenses  (IncomeBody — no category; the route
//                records the creator as the income's member, as on the web)
//   contribution POST /api/transfers (TransferBody — the atomic pair; a
//                draw only to a debt account, as on the web)
//
// THE SERVER DECIDES. This module stops a person sending something that is
// certainly wrong (an amount it could not read, a date that does not exist),
// so they hear about it before a round trip. It is never the last check:
// POST /api/expenses validates everything again, and its refusal is what the
// screen shows when the two disagree.
// ---------------------------------------------------------------------------

export type EntryAccount = { id: string; name: string; type: 'chequing' | 'credit_card' };
export type EntryCategory = { id: string; name: string };

export type EntryForm = {
  accounts: EntryAccount[];
  categories: EntryCategory[];
  /** The household's today, in its own timezone — the date's default. */
  today: string;
};

type CategoriesResponse = { categories: EntryCategory[] };

/**
 * The accounts an expense can go on: chequing first, then credit cards in the
 * order the server lists them. Savings, debt and investment accounts are not
 * places money is spent from, and the web forms do not offer them either.
 */
export function entryAccounts(accounts: AccountsResponse['accounts']): EntryAccount[] {
  const chequing = accounts.filter((a) => a.type === 'chequing');
  const cards = accounts.filter((a) => a.type === 'credit_card');
  return [...chequing, ...cards].map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as EntryAccount['type'],
  }));
}

export async function loadEntryForm(get: Getter, at: () => Date = () => new Date()): Promise<EntryForm> {
  const [accounts, categories, timezone] = await Promise.all([
    get<AccountsResponse>('/api/accounts'),
    get<CategoriesResponse>('/api/categories'),
    get<TimezoneResponse>('/api/household/timezone'),
  ]);
  return {
    accounts: entryAccounts(accounts.accounts),
    categories: categories.categories,
    // Timezone failure propagates (Promise.all rejects), as in the timeline:
    // the default date must be the household's today, not a guess.
    today: businessToday(timezone.timezone || DEFAULT_HOUSEHOLD_TIMEZONE, at()),
  };
}

/** What the form holds. Every field is exactly what was typed or chosen. */
export type EntryDraft = {
  accountId: string;
  date: string;
  description: string;
  categoryId: string;
  amount: string;
};

/** The POST /api/expenses body. Deliberately nothing more. */
export type ExpenseBody = {
  type: 'expense';
  date: string;
  description: string;
  categoryId: string;
  amount: number;
  accountId: string;
};

/** Why the form cannot be sent yet. Each maps to one message key. */
export type DraftProblem =
  | 'goalRequired'
  | 'accountRequired'
  | 'dateInvalid'
  | 'descriptionRequired'
  | 'descriptionTooLong'
  | 'categoryRequired'
  | 'amountInvalid';

export function buildExpenseBody(
  draft: EntryDraft
): { ok: true; body: ExpenseBody } | { ok: false; problem: DraftProblem } {
  if (!draft.accountId) return { ok: false, problem: 'accountRequired' };
  if (!isCalendarDate(draft.date)) return { ok: false, problem: 'dateInvalid' };

  // Trimmed, as the web forms trim, and then measured. Surrounding spaces
  // are not content; anything past the limit is refused, never cut.
  const description = draft.description.trim();
  if (!description) return { ok: false, problem: 'descriptionRequired' };
  if (description.length > MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) {
    return { ok: false, problem: 'descriptionTooLong' };
  }

  if (!draft.categoryId) return { ok: false, problem: 'categoryRequired' };

  const amount = parseAmountInput(draft.amount);
  if (amount === null || amount <= 0) return { ok: false, problem: 'amountInvalid' };

  return {
    ok: true,
    body: {
      type: 'expense',
      date: draft.date,
      description,
      categoryId: draft.categoryId,
      amount,
      accountId: draft.accountId,
    },
  };
}

// ── Money in ────────────────────────────────────────────────────────────────

export type EntryKind = 'expense' | 'income' | 'transfer';

/** The POST /api/expenses body for money in. No category: categories are money out. */
export type IncomeBody = {
  type: 'income';
  date: string;
  description: string;
  amount: number;
  accountId: string;
};

export function buildIncomeBody(
  draft: EntryDraft
): { ok: true; body: IncomeBody } | { ok: false; problem: DraftProblem } {
  if (!draft.accountId) return { ok: false, problem: 'accountRequired' };
  if (!isCalendarDate(draft.date)) return { ok: false, problem: 'dateInvalid' };
  const description = draft.description.trim();
  if (!description) return { ok: false, problem: 'descriptionRequired' };
  if (description.length > MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) return { ok: false, problem: 'descriptionTooLong' };
  const amount = parseAmountInput(draft.amount);
  if (amount === null || amount <= 0) return { ok: false, problem: 'amountInvalid' };
  return { ok: true, body: { type: 'income', date: draft.date, description, amount, accountId: draft.accountId } };
}

// ── A contribution to a savings goal or a debt ─────────────────────────────

/** A place a contribution can go: GET /api/goals (savings, TFSA, RRSP, debt). */
export type EntryGoal = { id: string; name: string; isDebt: boolean };

/**
 * The goals a contribution can go to. Loaded only when the person picks
 * "Contribution", so a failure here never blocks money out or money in.
 */
export async function loadTransferGoals(get: Getter): Promise<EntryGoal[]> {
  const data = await get<{ goals?: unknown }>('/api/goals');
  if (!Array.isArray(data?.goals)) throw new Error('goals: no goal list in the answer');
  return data.goals.map((g) => {
    const goal = g as { id?: unknown; name?: unknown; isDebt?: unknown };
    return { id: String(goal.id), name: String(goal.name), isDebt: goal.isDebt === true };
  });
}

export type TransferDraft = {
  goalId: string;
  /** Only read for a debt account; anything else is always a contribution. */
  transferKind: 'contribution' | 'draw';
  date: string;
  description: string;
  amount: string;
};

/** The POST /api/transfers body. */
export type TransferBody = {
  date: string;
  amount: number;
  goalAccountId: string;
  /** Left out when blank: the route names the transfer after the goal. */
  description?: string;
  kind: 'contribution' | 'draw';
};

export function buildTransferBody(
  draft: TransferDraft,
  goals: EntryGoal[]
): { ok: true; body: TransferBody } | { ok: false; problem: DraftProblem } {
  const goal = goals.find((g) => g.id === draft.goalId);
  if (!goal) return { ok: false, problem: 'goalRequired' };
  if (!isCalendarDate(draft.date)) return { ok: false, problem: 'dateInvalid' };
  const description = draft.description.trim();
  if (description.length > MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) return { ok: false, problem: 'descriptionTooLong' };
  const amount = parseAmountInput(draft.amount);
  if (amount === null || amount <= 0) return { ok: false, problem: 'amountInvalid' };
  // A draw is borrowing against a credit line: only a debt account has one.
  const kind = goal.isDebt ? draft.transferKind : 'contribution';
  return {
    ok: true,
    body: { date: draft.date, amount, goalAccountId: goal.id, ...(description ? { description } : {}), kind },
  };
}

/** The message key for a local problem. Literal keys: see the parity test. */
export function problemKey(problem: DraftProblem): string {
  switch (problem) {
    case 'goalRequired': return 'entry.problems.goalRequired';
    case 'accountRequired': return 'entry.problems.accountRequired';
    case 'dateInvalid': return 'entry.problems.dateInvalid';
    case 'descriptionRequired': return 'entry.problems.descriptionRequired';
    case 'descriptionTooLong': return 'entry.problems.descriptionTooLong';
    case 'categoryRequired': return 'entry.problems.categoryRequired';
    case 'amountInvalid': return 'entry.problems.amountInvalid';
  }
}

/**
 * The message key for a failed save.
 *
 * The route's `code` names what it refused; each has its own message, because
 * "something went wrong on our end" is false when the server refused an
 * account that is not yours. Any code this app does not know falls back to the
 * status-based message — still true, just less specific.
 */
export const ENTRY_ERROR_KEYS: Record<string, string> = {
  INVALID_AMOUNT: 'entry.errors.invalidAmount',
  INVALID_DATE: 'entry.errors.invalidDate',
  DESCRIPTION_REQUIRED: 'entry.errors.descriptionRequired',
  DESCRIPTION_TOO_LONG: 'entry.errors.descriptionTooLong',
  CATEGORY_REQUIRED: 'entry.errors.categoryRequired',
  CATEGORY_NOT_FOUND: 'entry.errors.categoryNotFound',
  ACCOUNT_NOT_FOUND: 'entry.errors.accountNotFound',
  PAYLOAD_TOO_LARGE: 'entry.errors.payloadTooLarge',
  NO_CHEQUING: 'entry.errors.noChequing',
  SAVE_FAILED: 'entry.errors.saveFailed',
  LOOKUP_FAILED: 'entry.errors.saveFailed',
};

export function entryErrorKey(err: unknown): string {
  if (err instanceof ApiError && err.code && err.code in ENTRY_ERROR_KEYS) {
    return ENTRY_ERROR_KEYS[err.code];
  }
  return messageKeyFor(err);
}
