import {
  businessToday,
  DEFAULT_HOUSEHOLD_TIMEZONE,
  firstOfNextMonth,
  isCalendarDate,
  MANUAL_ENTRY_DESCRIPTION_MAX_CHARS,
  parseAmountInput,
  sameAnchorSchedule,
} from '@phare/core';
import type { Getter } from './timelineLoader';

// ---------------------------------------------------------------------------
// Recurring income, bills and contributions (standalone S4, 2026-10-23).
//
// EXISTING ROUTES, AS THE WEB RECURRING PAGE USES THEM:
//   GET    /api/recurring        the live rules (superseded ones are history,
//                                not listed), spending accounts, goal
//                                accounts, expense categories
//   POST   /api/recurring        a new rule; materializes its dates
//   PATCH  /api/recurring/[id]   an edit. When the amount, frequency or date
//                                changes on a rule that already has a date,
//                                the SERVER splits it: the old rule keeps the
//                                past, a new one starts on `effectiveFrom`
//                                (default: the 1st of next month; never in
//                                the past). Otherwise it edits in place.
//   DELETE /api/recurring/[id]   today-onward occurrences go; the past stays
//
// THE SERVER DECIDES. willApplyFromDate mirrors its rule (core's
// sameAnchorSchedule, the same function the route calls) only so the screen
// can ask "applies from" when it matters; the route is what splits or not.
// ---------------------------------------------------------------------------

export type RecurringType = 'income' | 'expense' | 'transfer';
export type Cadence = 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';

export type RecurringLine = {
  id: string;
  description: string;
  amount: number;
  type: RecurringType;
  cadence: Cadence;
  /** null: onboarding left it without a date — nothing materializes yet. */
  anchorDate: string | null;
  secondDay: number | null;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string | null;
  accountName: string | null;
  destinationId: string | null;
  destinationName: string | null;
};

export type RecurringData = {
  lines: RecurringLine[];
  /** Where income and bills can go (chequing, cards, credit lines). */
  accounts: { id: string; name: string }[];
  /** Where a contribution can go. */
  goalAccounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  /** The household's today, in its own timezone. */
  today: string;
};

const CADENCES: Cadence[] = ['monthly', 'biweekly', 'semimonthly', 'weekly'];

/** The frequencies a type may have: weekly is for contributions only, as on the web. */
export function cadencesFor(type: RecurringType): Cadence[] {
  return type === 'transfer' ? CADENCES : CADENCES.filter((c) => c !== 'weekly');
}

function nameOf(v: unknown): string | null {
  const o = v as { name?: unknown } | null;
  return o && typeof o.name === 'string' ? o.name : null;
}

export function parseRecurring(raw: unknown, today: string): RecurringData {
  const d = raw as Record<string, unknown> | null;
  if (!d || !Array.isArray(d.items)) throw new Error('recurring: no list in the answer');
  const lines = d.items.map((rawItem, i): RecurringLine => {
    const it = rawItem as Record<string, unknown>;
    const amount = typeof it.amount === 'string' ? Number(it.amount) : it.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error(`recurring: line ${i} amount is not a number`);
    const type = it.type;
    if (type !== 'income' && type !== 'expense' && type !== 'transfer') throw new Error(`recurring: line ${i} has an unknown type`);
    const cadence = it.cadence as Cadence;
    if (!CADENCES.includes(cadence)) throw new Error(`recurring: line ${i} has an unknown frequency`);
    return {
      id: String(it.id),
      description: String(it.description ?? ''),
      amount,
      type,
      cadence,
      anchorDate: typeof it.anchor_date === 'string' ? it.anchor_date : null,
      secondDay: typeof it.second_day === 'number' ? it.second_day : null,
      categoryId: typeof it.category_id === 'string' ? it.category_id : null,
      categoryName: nameOf(it.categories),
      accountId: typeof it.account_id === 'string' ? it.account_id : null,
      accountName: nameOf(it.accounts),
      destinationId: typeof it.destination_account_id === 'string' ? it.destination_account_id : null,
      destinationName: nameOf(it.destination_accounts),
    };
  });
  const pick = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => {
    const o = x as { id?: unknown; name?: unknown };
    return { id: String(o.id), name: String(o.name) };
  });
  return { lines, accounts: pick(d.accounts), goalAccounts: pick(d.goalAccounts), categories: pick(d.categories), today };
}

export async function loadRecurring(get: Getter, at: () => Date = () => new Date()): Promise<RecurringData> {
  const [raw, tz] = await Promise.all([
    get<unknown>('/api/recurring'),
    get<{ timezone?: string }>('/api/household/timezone'),
  ]);
  return parseRecurring(raw, businessToday(tz.timezone || DEFAULT_HOUSEHOLD_TIMEZONE, at()));
}

export type RecurringSections = {
  needsDate: RecurringLine[];
  income: RecurringLine[];
  bills: RecurringLine[];
  contributions: RecurringLine[];
};

/** Lines without a date first (they do nothing until dated), then by type. */
export function sectionsOf(lines: RecurringLine[]): RecurringSections {
  const dated = lines.filter((l) => l.anchorDate !== null);
  return {
    needsDate: lines.filter((l) => l.anchorDate === null),
    income: dated.filter((l) => l.type === 'income'),
    bills: dated.filter((l) => l.type === 'expense'),
    contributions: dated.filter((l) => l.type === 'transfer'),
  };
}

// ── The edit / new form ─────────────────────────────────────────────────────

export type RecurringDraft = {
  type: RecurringType;
  description: string;
  amount: string;
  cadence: Cadence;
  anchorDate: string;
  /** Twice a month only: the second day, 1–31. */
  secondDay: string;
  categoryId: string;
  accountId: string;
  destinationId: string;
  /** When a value change will apply from: YYYY-MM-DD. */
  effectiveFrom: string;
};

export function draftForLine(line: RecurringLine, today: string): RecurringDraft {
  return {
    type: line.type,
    description: line.description,
    amount: String(line.amount),
    cadence: line.cadence,
    anchorDate: line.anchorDate ?? '',
    secondDay: line.secondDay === null ? '' : String(line.secondDay),
    categoryId: line.categoryId ?? '',
    accountId: line.accountId ?? '',
    destinationId: line.destinationId ?? '',
    effectiveFrom: firstOfNextMonth(today),
  };
}

export function draftForNew(type: RecurringType, data: RecurringData): RecurringDraft {
  return {
    type,
    description: '',
    amount: '',
    cadence: 'monthly',
    anchorDate: '',
    secondDay: '',
    categoryId: '',
    accountId: data.accounts[0]?.id ?? '',
    destinationId: type === 'transfer' ? data.goalAccounts[0]?.id ?? '' : '',
    effectiveFrom: firstOfNextMonth(data.today),
  };
}

export type RecurringProblem =
  | 'descriptionRequired'
  | 'descriptionTooLong'
  | 'amountInvalid'
  | 'dateRequired'
  | 'dateInvalid'
  | 'secondDayInvalid'
  | 'categoryRequired'
  | 'accountRequired'
  | 'goalRequired'
  | 'effectiveFromInvalid'
  | 'effectiveFromPast';

type Checked = {
  description: string;
  amount: number;
  anchorDate: string | null;
  secondDay: number | null;
};

function check(draft: RecurringDraft, dateRequired: boolean): { ok: true; value: Checked } | { ok: false; problem: RecurringProblem } {
  const description = draft.description.trim();
  if (!description) return { ok: false, problem: 'descriptionRequired' };
  if (description.length > MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) return { ok: false, problem: 'descriptionTooLong' };
  const amount = parseAmountInput(draft.amount);
  if (amount === null || amount <= 0) return { ok: false, problem: 'amountInvalid' };
  const date = draft.anchorDate.trim();
  if (!date && dateRequired) return { ok: false, problem: 'dateRequired' };
  if (date && !isCalendarDate(date)) return { ok: false, problem: 'dateInvalid' };
  let secondDay: number | null = null;
  if (draft.cadence === 'semimonthly') {
    const s = draft.secondDay.trim();
    if (!/^\d{1,2}$/.test(s) || Number(s) < 1 || Number(s) > 31) return { ok: false, problem: 'secondDayInvalid' };
    secondDay = Number(s);
  }
  if (draft.type === 'expense' && !draft.categoryId) return { ok: false, problem: 'categoryRequired' };
  if (draft.type !== 'transfer' && !draft.accountId) return { ok: false, problem: 'accountRequired' };
  if (draft.type === 'transfer' && !draft.destinationId) return { ok: false, problem: 'goalRequired' };
  return { ok: true, value: { description, amount, anchorDate: date || null, secondDay } };
}

/**
 * Whether the server will split this edit from a date (core's rule, as the
 * route reads it): a value changed on a rule that already has a date.
 */
export function willApplyFromDate(line: RecurringLine, draft: RecurringDraft): boolean {
  if (line.anchorDate === null) return false;
  const amount = parseAmountInput(draft.amount);
  const anchor = draft.anchorDate.trim() || line.anchorDate;
  // The second day as buildPatchBody sends it (null unless twice a month),
  // compared with the stored one, exactly as the route compares them.
  const secondDay = draft.cadence === 'semimonthly' && /^\d{1,2}$/.test(draft.secondDay.trim()) ? Number(draft.secondDay.trim()) : null;
  return (
    (amount !== null && amount !== line.amount) ||
    draft.cadence !== line.cadence ||
    !sameAnchorSchedule(anchor, line.anchorDate, draft.cadence) ||
    secondDay !== line.secondDay
  );
}

export type PatchBody = {
  description: string;
  amount: number;
  cadence: Cadence;
  anchorDate: string | null;
  secondDay: number | null;
  categoryId?: string | null;
  accountId?: string;
  destinationAccountId?: string;
  effectiveFrom?: string;
};

/** The PATCH body for an edit, or the first thing to fix. A dated line stays dated. */
export function buildPatchBody(
  line: RecurringLine,
  draft: RecurringDraft,
  today: string
): { ok: true; body: PatchBody } | { ok: false; problem: RecurringProblem } {
  const checked = check(draft, line.anchorDate !== null);
  if (!checked.ok) return checked;
  const v = checked.value;
  const body: PatchBody = {
    description: v.description,
    amount: v.amount,
    cadence: draft.cadence,
    anchorDate: v.anchorDate,
    secondDay: v.secondDay,
  };
  if (line.type === 'transfer') body.destinationAccountId = draft.destinationId;
  else {
    body.accountId = draft.accountId;
    body.categoryId = line.type === 'expense' ? draft.categoryId : null;
  }
  if (willApplyFromDate(line, draft)) {
    const from = draft.effectiveFrom.trim();
    if (!isCalendarDate(from)) return { ok: false, problem: 'effectiveFromInvalid' };
    if (from < today) return { ok: false, problem: 'effectiveFromPast' };
    body.effectiveFrom = from;
  }
  return { ok: true, body };
}

export type CreateBody = {
  description: string;
  amount: number;
  type: RecurringType;
  cadence: Cadence;
  anchorDate: string;
  secondDay: number | null;
  categoryId?: string;
  accountId?: string;
  destinationAccountId?: string;
};

/** The POST body for a new line. A new line always has a date: without one nothing would appear. */
export function buildCreateBody(draft: RecurringDraft): { ok: true; body: CreateBody } | { ok: false; problem: RecurringProblem } {
  const checked = check(draft, true);
  if (!checked.ok) return checked;
  const v = checked.value;
  const body: CreateBody = {
    description: v.description,
    amount: v.amount,
    type: draft.type,
    cadence: draft.cadence,
    anchorDate: v.anchorDate as string,
    secondDay: v.secondDay,
  };
  if (draft.type === 'transfer') body.destinationAccountId = draft.destinationId;
  else {
    body.accountId = draft.accountId;
    if (draft.type === 'expense') body.categoryId = draft.categoryId;
  }
  return { ok: true, body };
}

/** Message key for a local problem. Literal keys, one per problem, for the parity test. */
export function recurringProblemKey(problem: RecurringProblem): string {
  switch (problem) {
    case 'descriptionRequired': return 'recurring.problems.descriptionRequired';
    case 'descriptionTooLong': return 'recurring.problems.descriptionTooLong';
    case 'amountInvalid': return 'recurring.problems.amountInvalid';
    case 'dateRequired': return 'recurring.problems.dateRequired';
    case 'dateInvalid': return 'recurring.problems.dateInvalid';
    case 'secondDayInvalid': return 'recurring.problems.secondDayInvalid';
    case 'categoryRequired': return 'recurring.problems.categoryRequired';
    case 'accountRequired': return 'recurring.problems.accountRequired';
    case 'goalRequired': return 'recurring.problems.goalRequired';
    case 'effectiveFromInvalid': return 'recurring.problems.effectiveFromInvalid';
    case 'effectiveFromPast': return 'recurring.problems.effectiveFromPast';
  }
}

/** Message key for a frequency. Literal keys for the parity test. */
export function cadenceKey(cadence: Cadence): string {
  switch (cadence) {
    case 'monthly': return 'recurring.cadence.monthly';
    case 'biweekly': return 'recurring.cadence.biweekly';
    case 'semimonthly': return 'recurring.cadence.semimonthly';
    case 'weekly': return 'recurring.cadence.weekly';
  }
}
