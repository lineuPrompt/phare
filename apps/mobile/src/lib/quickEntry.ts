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
// Quick expense entry: money out, one-off, on chequing or a credit card.
//
// V1 SCOPE, ENFORCED BY THE BODY THIS BUILDS: no income, no repeat, no
// installments, no transfer, no member. The body has exactly the fields
// listed in ExpenseBody and nothing else — see buildExpenseBody.
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

/** The message key for a local problem. Literal keys: see the parity test. */
export function problemKey(problem: DraftProblem): string {
  switch (problem) {
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
