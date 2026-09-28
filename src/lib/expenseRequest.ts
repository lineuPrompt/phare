import {
  isCalendarDate,
  MANUAL_ENTRY_DESCRIPTION_MAX_CHARS,
  MANUAL_ENTRY_MAX_AMOUNT,
  MANUAL_ENTRY_MAX_INSTALLMENTS,
  MANUAL_ENTRY_MIN_INSTALLMENTS,
} from '@phare/core';

// ---------------------------------------------------------------------------
// POST /api/expenses — what a request body must be before anything is read
// from or written to the database.
//
// WHY THIS EXISTS (2026-09-27). The route trusted its body. A negative amount
// was saved as-is; `installments: 100000` tried to insert 100,000 rows; a
// 10 MB description went straight into a text column; '2026-02-31' became a
// 500 from Postgres. The web forms never send those, but the route is also
// the mobile app's, and a route is only as safe as its least careful caller.
//
// Pure, so every guard is tested directly. Ownership of the account and the
// category needs the database and lives in the route.
//
// EVERY REFUSAL CARRIES A `code`. Clients switch on it to pick a translated
// message; `error` is English prose for logs and a last-resort fallback.
// ---------------------------------------------------------------------------

/** Raw body cap. A valid request is a few hundred bytes. */
export const EXPENSE_MAX_BODY_BYTES = 16_384;

export type ExpenseErrorCode =
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_TYPE'
  | 'INVALID_DATE'
  | 'DESCRIPTION_REQUIRED'
  | 'DESCRIPTION_TOO_LONG'
  | 'INVALID_AMOUNT'
  | 'CATEGORY_REQUIRED'
  | 'INVALID_INSTALLMENTS'
  | 'ACCOUNT_NOT_FOUND'
  | 'CATEGORY_NOT_FOUND'
  | 'NOT_AUTHENTICATED'
  | 'NO_HOUSEHOLD'
  | 'NO_MEMBER'
  | 'NO_CHEQUING'
  | 'LOOKUP_FAILED'
  | 'SAVE_FAILED';

export type ExpenseRefusal = { code: ExpenseErrorCode; error: string; status: number };

export type ExpenseRequest = {
  type: 'income' | 'expense';
  date: string;
  /** As sent. Checked for length and content, never trimmed or cut. */
  description: string;
  amount: number;
  /** null: none sent (income, or chequing money-in). */
  categoryId: string | null;
  /** null: none sent — the route falls back to chequing. */
  accountId: string | null;
  repeat: 'once' | 'monthly' | 'installments';
  /** Set only when repeat is 'installments'. */
  installments: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refuse(code: ExpenseErrorCode, error: string, status = 400): { ok: false; refusal: ExpenseRefusal } {
  return { ok: false, refusal: { code, error, status } };
}

/** An amount with at most two decimals, read without trusting float equality. */
function hasAtMostTwoDecimals(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

/**
 * The raw body text → a validated request, or the first refusal.
 *
 * Size is weighed on the raw text, before JSON.parse, so an oversized body is
 * never materialised.
 */
export function parseExpenseRequest(
  raw: string
): { ok: true; value: ExpenseRequest } | { ok: false; refusal: ExpenseRefusal } {
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > EXPENSE_MAX_BODY_BYTES) {
    return refuse(
      'PAYLOAD_TOO_LARGE',
      `Request body is ${bytes} bytes; the limit is ${EXPENSE_MAX_BODY_BYTES} bytes.`,
      413
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return refuse('INVALID_JSON', 'Request body must be a JSON object.');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return refuse('INVALID_JSON', 'Request body was not valid JSON.');
  }

  const type = body.type ?? 'expense';
  if (type !== 'income' && type !== 'expense') {
    return refuse('INVALID_TYPE', 'type must be "income" or "expense".');
  }

  if (!isCalendarDate(body.date)) {
    return refuse('INVALID_DATE', 'date must be a real calendar date written as YYYY-MM-DD.');
  }

  const description = body.description;
  if (typeof description !== 'string' || description.trim() === '') {
    return refuse('DESCRIPTION_REQUIRED', 'description is required.');
  }
  if (description.length > MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) {
    return refuse(
      'DESCRIPTION_TOO_LONG',
      `description is ${description.length} characters; the limit is ${MANUAL_ENTRY_DESCRIPTION_MAX_CHARS}.`
    );
  }

  const amount = body.amount;
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MANUAL_ENTRY_MAX_AMOUNT ||
    !hasAtMostTwoDecimals(amount)
  ) {
    return refuse(
      'INVALID_AMOUNT',
      `amount must be a number above 0, at most ${MANUAL_ENTRY_MAX_AMOUNT}, with at most two decimals.`
    );
  }

  // '' and null both mean "none" — the web forms send '' for an untouched
  // select. Anything else must be an id in the right shape; a malformed id
  // cannot belong to the household, so it is refused as not found rather than
  // handed to Postgres to fail on.
  const categoryId = body.categoryId === undefined || body.categoryId === null || body.categoryId === ''
    ? null
    : body.categoryId;
  if (categoryId !== null && (typeof categoryId !== 'string' || !UUID.test(categoryId))) {
    return refuse('CATEGORY_NOT_FOUND', 'That category does not belong to this household.');
  }
  if (type === 'expense' && categoryId === null) {
    return refuse('CATEGORY_REQUIRED', 'A category is required for money out.');
  }

  const accountId = body.accountId === undefined || body.accountId === null || body.accountId === ''
    ? null
    : body.accountId;
  if (accountId !== null && (typeof accountId !== 'string' || !UUID.test(accountId))) {
    return refuse('ACCOUNT_NOT_FOUND', 'That account does not belong to this household.');
  }

  // Anything other than the two repeating modes has always meant "once", and
  // still does — only the bound on installments is new.
  const repeat = body.repeat === 'monthly' || body.repeat === 'installments' ? body.repeat : 'once';
  let installments: number | null = null;
  if (repeat === 'installments') {
    const n = body.installments;
    if (
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      n < MANUAL_ENTRY_MIN_INSTALLMENTS ||
      n > MANUAL_ENTRY_MAX_INSTALLMENTS
    ) {
      return refuse(
        'INVALID_INSTALLMENTS',
        `installments must be a whole number from ${MANUAL_ENTRY_MIN_INSTALLMENTS} to ${MANUAL_ENTRY_MAX_INSTALLMENTS}.`
      );
    }
    installments = n;
  }

  return {
    ok: true,
    value: {
      type,
      date: body.date,
      description,
      amount,
      categoryId: categoryId as string | null,
      accountId: accountId as string | null,
      repeat,
      installments,
    },
  };
}
