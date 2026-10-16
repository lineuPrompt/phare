import {
  acceptsOpeningBalance,
  businessToday,
  DEFAULT_HOUSEHOLD_TIMEZONE,
  isCalendarDate,
  parseAmountInput,
} from '@phare/core';
import type { AccountsResponse, TimezoneResponse } from './timeline';

// ---------------------------------------------------------------------------
// Accounts and the chequing balance, without the web (standalone S3,
// 2026-10-16). Pure: the requests are injected, as in quickEntry.ts, so every
// rule here is testable from Node.
//
// EXISTING ROUTES ONLY:
//   GET   /api/accounts          the list
//   POST  /api/accounts          create { name, type }
//   PATCH /api/accounts/[id]     { openingBalance } — a goal account's
//                                starting balance
//   POST  /api/anchors           { accountId, anchorDate, balance } — the
//                                chequing balance on a known date
//
// THE STARTING BALANCE IS A SECOND REQUEST, ON PURPOSE. POST /api/accounts
// also accepts `openingBalance`, but if that write fails it logs and answers
// 200 anyway ("non-fatal"): the account would exist with no starting balance
// and nothing would say so. PATCH treats the same failure as fatal and
// answers 500. So the account is created bare, then the balance is PATCHed,
// and a failed PATCH is reported as "account added, balance not saved" with
// a retry of just the balance (ticket: accounts-post-opening-balance-swallowed).
//
// WHICH TYPES TAKE A STARTING BALANCE is acceptsOpeningBalance (@phare/core),
// the function both routes enforce. Chequing never does: its balance is an
// anchor, a separate request (setChequingBalance).
// ---------------------------------------------------------------------------

/** What this app offers to add. Debt and lines of credit come later (audit). */
export const ADDABLE_ACCOUNT_TYPES = ['chequing', 'credit_card', 'savings', 'tfsa', 'rrsp'] as const;
export type AddableAccountType = (typeof ADDABLE_ACCOUNT_TYPES)[number];

export type Account = AccountsResponse['accounts'][number];

export type Getter = <T>(path: string) => Promise<T>;
export type Sender = <T>(path: string, body: unknown) => Promise<T>;

/** The literal i18n key for an account type. Unknown types read as "Account". */
export function accountTypeKey(type: string): string {
  switch (type) {
    case 'chequing': return 'accounts.types.chequing';
    case 'credit_card': return 'accounts.types.credit_card';
    case 'savings': return 'accounts.types.savings';
    case 'tfsa': return 'accounts.types.tfsa';
    case 'rrsp': return 'accounts.types.rrsp';
    case 'debt': return 'accounts.types.debt';
    case 'line_of_credit': return 'accounts.types.line_of_credit';
    default: return 'accounts.types.other';
  }
}

export async function loadAccounts(get: Getter): Promise<Account[]> {
  const data = await get<AccountsResponse>('/api/accounts');
  if (!data || !Array.isArray(data.accounts)) throw new Error('accounts: no account list in the answer');
  return data.accounts;
}

// ── Adding an account ───────────────────────────────────────────────────────

export type NewAccountDraft = { name: string; type: AddableAccountType; openingBalance: string };

export type NewAccountProblem = 'nameRequired' | 'balanceInvalid';

export type NewAccountPlan = {
  body: { name: string; type: AddableAccountType };
  /** Null: nothing to PATCH — the type takes none, or the field was left blank. */
  openingBalance: number | null;
};

/**
 * The form → what to send, or the first problem. A blank starting balance is
 * "none", not zero. A starting balance on a type that takes none is never
 * sent: the form does not show the field for those types, and a stale value
 * left over from switching type must not reach the server.
 */
export function planNewAccount(
  draft: NewAccountDraft
): { ok: true; plan: NewAccountPlan } | { ok: false; problem: NewAccountProblem } {
  const name = draft.name.trim();
  if (!name) return { ok: false, problem: 'nameRequired' };

  let openingBalance: number | null = null;
  if (acceptsOpeningBalance(draft.type) && draft.openingBalance.trim()) {
    const parsed = parseAmountInput(draft.openingBalance);
    if (parsed === null) return { ok: false, problem: 'balanceInvalid' };
    openingBalance = parsed === 0 ? null : parsed;
  }

  return { ok: true, plan: { body: { name, type: draft.type }, openingBalance } };
}

export type CreateOutcome =
  | { kind: 'created'; account: Account }
  /** The account exists; its starting balance did not save. Retry just that. */
  | { kind: 'balanceFailed'; account: Account; error: unknown };

/** Create, then (when there is one) set the starting balance. A failed create throws. */
export async function createAccount(post: Sender, patch: Sender, plan: NewAccountPlan): Promise<CreateOutcome> {
  const created = await post<{ account?: Account }>('/api/accounts', plan.body);
  const account = created?.account;
  if (!account?.id) throw new Error('accounts: the create answer has no account');

  if (plan.openingBalance === null) return { kind: 'created', account };
  try {
    await setOpeningBalance(patch, account.id, plan.openingBalance);
    return { kind: 'created', account };
  } catch (error) {
    return { kind: 'balanceFailed', account, error };
  }
}

/** A goal account's starting balance. Throws on failure — the caller says so. */
export async function setOpeningBalance(patch: Sender, accountId: string, amount: number): Promise<void> {
  await patch(`/api/accounts/${encodeURIComponent(accountId)}`, { openingBalance: amount });
}

// ── The chequing balance (an anchor) ────────────────────────────────────────

export type BalanceDraft = { amount: string; date: string };

export type BalanceProblem = 'amountInvalid' | 'dateInvalid' | 'dateInFuture';

/**
 * The balance form → the anchor body, or the first problem.
 *
 * Negative is allowed: an overdrawn account is a real balance. Zero is
 * allowed: an empty account is a real balance too. Blank is not — this form
 * exists to state one.
 *
 * `today` is businessToday in the household's zone. The route refuses a
 * future date with the same comparison; checking here only says so before
 * sending.
 */
export function planBalance(
  draft: BalanceDraft,
  accountId: string,
  today: string
): { ok: true; body: { accountId: string; anchorDate: string; balance: number } } | { ok: false; problem: BalanceProblem } {
  const balance = parseAmountInput(draft.amount);
  if (balance === null) return { ok: false, problem: 'amountInvalid' };
  const date = draft.date.trim();
  if (!isCalendarDate(date)) return { ok: false, problem: 'dateInvalid' };
  if (date > today) return { ok: false, problem: 'dateInFuture' };
  return { ok: true, body: { accountId, anchorDate: date, balance } };
}

/**
 * The types the add form offers. Chequing only while there is none: every
 * route (timeline, anchors, onboarding, quick entry) uses the FIRST chequing
 * account, so a second one would hold entries no screen shows.
 */
export function addableTypes(accounts: Account[]): AddableAccountType[] {
  const hasChequing = chequingOf(accounts) !== null;
  return ADDABLE_ACCOUNT_TYPES.filter((type) => type !== 'chequing' || !hasChequing);
}

/** The household's chequing account: the first one, as every route picks it. */
export function chequingOf(accounts: Account[]): Account | null {
  return accounts.find((account) => account.type === 'chequing') ?? null;
}

/** Literal keys, so the i18n parity test sees each one. */
export function newAccountProblemKey(problem: NewAccountProblem): string {
  return problem === 'nameRequired' ? 'accounts.problems.nameRequired' : 'accounts.problems.balanceInvalid';
}

export function balanceProblemKey(problem: BalanceProblem): string {
  switch (problem) {
    case 'amountInvalid': return 'balance.problems.amountInvalid';
    case 'dateInvalid': return 'balance.problems.dateInvalid';
    case 'dateInFuture': return 'balance.problems.dateInFuture';
  }
}

// ── Loading the balance form ────────────────────────────────────────────────

export type BalanceForm = {
  chequing: Account | null;
  /** businessToday in the household's zone: the default date and the future limit. */
  today: string;
  /** The most recent anchor, to show what the balance was last set to. */
  latest: { date: string; balance: number } | null;
};

type AnchorsResponse = { anchors: { anchor_date: string; balance: number | string }[] };

/**
 * Accounts and the household's today, then (with a chequing account) its
 * anchors. Every failure propagates: a form that guessed "today" or showed
 * "no balance set yet" after a failed read would be stating something false.
 */
export async function loadBalanceForm(get: Getter, at: () => Date = () => new Date()): Promise<BalanceForm> {
  const [accounts, timezone] = await Promise.all([
    loadAccounts(get),
    get<TimezoneResponse>('/api/household/timezone'),
  ]);
  const today = businessToday(timezone.timezone || DEFAULT_HOUSEHOLD_TIMEZONE, at());
  const chequing = chequingOf(accounts);
  if (!chequing) return { chequing: null, today, latest: null };

  const data = await get<AnchorsResponse>(`/api/anchors?account=${encodeURIComponent(chequing.id)}`);
  if (!data || !Array.isArray(data.anchors)) throw new Error('balance: no anchor list in the answer');
  let latest: BalanceForm['latest'] = null;
  for (const anchor of data.anchors) {
    // The route sends a Postgres numeric, which can arrive as a string.
    const balance = Number(anchor.balance);
    if (!Number.isFinite(balance)) throw new Error('balance: an anchor balance is not a number');
    if (latest === null || anchor.anchor_date > latest.date) latest = { date: anchor.anchor_date, balance };
  }
  return { chequing, today, latest };
}
