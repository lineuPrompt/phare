// ---------------------------------------------------------------------------
// The minimal first session (2026-10-01): money in, chequing today, bills paid
// from chequing — saved straight to a working Timeline, with no AI anywhere.
//
// One module, three readers: the web /start screens and the mobile screen use
// it to check a draft before sending it, and POST /api/first-session uses the
// very same functions to refuse what a client should never have sent. A rule
// the screens and the server disagree on cannot exist, because there is only
// one copy of it.
//
// CODE DECIDES, NEVER A MODEL:
//   - every bill entered here is a fixed bill paid from chequing, on the
//     Timeline — the household said so by entering it on this screen;
//   - a checklist bill's category is the checklist's, fixed below;
//   - an "other" bill's category is the household's own pick from the seed
//     list;
//   - every date is a real one: the next date for weekly/bi-weekly lines, the
//     two days for semi-monthly, the day of the month for monthly. Nothing
//     defaults to the 1st.
//
// REJECT, NEVER TRUNCATE: an oversized label, too many lines or an amount past
// the ceiling is a problem reported back, not something quietly clipped.
// ---------------------------------------------------------------------------

import { isCalendarDate, materializeFromMonthStart } from './dateHelpers';
import { buildSemimonthlyAnchor, validateNextPayDate, validateSemimonthlyDays } from './anchorDateHelpers';
import { MANUAL_ENTRY_MAX_AMOUNT, parseAmountInput } from './entry';

/**
 * The ten expense categories every household starts with. One list: save-plan
 * seeds them, the first session seeds them, and the review's category guard
 * scans for them.
 */
export const SEED_EXPENSE_CATEGORIES = [
  'Housing', 'Transportation', 'Restaurants', 'Groceries & Pharmacy',
  'Utilities & Subscriptions', 'Childcare', 'Shopping',
  'Health & Personal', 'Installments', 'Unexpected',
] as const;
export type SeedExpenseCategory = (typeof SEED_EXPENSE_CATEGORIES)[number];

/** The bills offered as a checklist, each with the category code assigns it. */
export const BILL_CHECKLIST = [
  { key: 'rent', category: 'Housing' },
  { key: 'mortgage', category: 'Housing' },
  { key: 'home_insurance', category: 'Housing' },
  { key: 'car_payment', category: 'Transportation' },
  { key: 'car_insurance', category: 'Transportation' },
  { key: 'hydro', category: 'Utilities & Subscriptions' },
  { key: 'phone_internet', category: 'Utilities & Subscriptions' },
  { key: 'daycare', category: 'Childcare' },
  { key: 'loan', category: 'Installments' },
] as const satisfies readonly { key: string; category: SeedExpenseCategory }[];
export type BillKey = (typeof BILL_CHECKLIST)[number]['key'];
/** A bill that is not on the checklist; its category is the household's pick. */
export const OTHER_BILL = 'other' as const;

export const FIRST_SESSION_FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'] as const;
export type FirstSessionFrequency = (typeof FIRST_SESSION_FREQUENCIES)[number];

/** Ceilings. Past them the request is refused, never trimmed. */
export const FIRST_SESSION_MAX_INCOMES = 12;
export const FIRST_SESSION_MAX_BILLS = 40;
export const FIRST_SESSION_LABEL_MAX_CHARS = 80;
/** Twelve months of the densest cadence (weekly) is 53 dates; nothing needs more. */
export const FIRST_SESSION_MONTHS = 12;

// ── The request a client sends ────────────────────────────────────────────────

/** Exactly one date field, matching the frequency. */
export type FirstSessionWhen =
  | { frequency: 'weekly' | 'biweekly'; nextDate: string }
  | { frequency: 'semimonthly'; days: [number, number] }
  | { frequency: 'monthly'; dayOfMonth: number };

export type FirstSessionIncome = { label: string; amount: number } & FirstSessionWhen;
export type FirstSessionBill = { item: BillKey | typeof OTHER_BILL; label: string; amount: number; category?: SeedExpenseCategory } & FirstSessionWhen;

export type FirstSessionRequest = {
  incomes: FirstSessionIncome[];
  openingBalance: number;
  bills: FirstSessionBill[];
};

export type FirstSessionProblemCode =
  | 'malformed'
  | 'no_income'
  | 'too_many'
  | 'unexpected_field'
  | 'label_missing'
  | 'label_too_long'
  | 'amount_invalid'
  | 'frequency_invalid'
  | 'next_date_invalid'
  | 'next_date_past'
  | 'next_date_too_far'
  | 'days_invalid'
  | 'days_same'
  | 'day_of_month_invalid'
  | 'item_invalid'
  | 'category_invalid'
  | 'category_not_allowed'
  | 'opening_invalid';

export type FirstSessionProblem = {
  section: 'incomes' | 'bills' | 'openingBalance' | 'request';
  index?: number;
  code: FirstSessionProblemCode;
};

/** A finite amount in whole cents, within the manual-entry ceiling. */
function isMoney(n: unknown, { allowZero, allowNegative }: { allowZero: boolean; allowNegative: boolean }): n is number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return false;
  if (Math.abs(n) > MANUAL_ENTRY_MAX_AMOUNT) return false;
  if (!allowNegative && n < 0) return false;
  if (!allowZero && n === 0) return false;
  return true;
}

const LINE_KEYS = new Set(['label', 'amount', 'frequency', 'nextDate', 'days', 'dayOfMonth']);
const BILL_KEYS = new Set([...LINE_KEYS, 'item', 'category']);
const DATE_KEY: Record<FirstSessionFrequency, string> = {
  weekly: 'nextDate', biweekly: 'nextDate', semimonthly: 'days', monthly: 'dayOfMonth',
};

/** One line's checks, shared by incomes and bills. Returns the first problem. */
function lineProblem(line: Record<string, unknown>, allowed: Set<string>, today: string): FirstSessionProblemCode | null {
  for (const key of Object.keys(line)) if (!allowed.has(key)) return 'unexpected_field';

  if (typeof line.label !== 'string' || !line.label.trim()) return 'label_missing';
  if (line.label.trim().length > FIRST_SESSION_LABEL_MAX_CHARS) return 'label_too_long';
  if (!isMoney(line.amount, { allowZero: false, allowNegative: false })) return 'amount_invalid';

  const frequency = line.frequency;
  if (typeof frequency !== 'string' || !(FIRST_SESSION_FREQUENCIES as readonly string[]).includes(frequency)) {
    return 'frequency_invalid';
  }
  // Exactly the one date field this frequency uses. A leftover field from a
  // frequency the person switched away from is refused, not ignored: it
  // would mean the client and the person disagree about the schedule.
  const dateKey = DATE_KEY[frequency as FirstSessionFrequency];
  for (const key of ['nextDate', 'days', 'dayOfMonth']) {
    if (key !== dateKey && key in line) return 'unexpected_field';
  }

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const d = line.nextDate;
    if (!isCalendarDate(d)) return 'next_date_invalid';
    const v = validateNextPayDate(d, frequency, today);
    if (!v.ok) return v.error === 'past' ? 'next_date_past' : 'next_date_too_far';
  } else if (frequency === 'semimonthly') {
    const days = line.days;
    if (!Array.isArray(days) || days.length !== 2 || !days.every((x) => typeof x === 'number')) return 'days_invalid';
    const v = validateSemimonthlyDays(days[0] as number, days[1] as number);
    if (!v.ok) return v.error === 'same' ? 'days_same' : 'days_invalid';
  } else {
    const day = line.dayOfMonth;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31) return 'day_of_month_invalid';
  }
  return null;
}

/**
 * Validates a first-session request exactly as the server will. Every problem
 * is reported, not just the first, so a screen can mark every field at once.
 */
export function validateFirstSessionRequest(
  body: unknown,
  today: string
): { ok: true; value: FirstSessionRequest } | { ok: false; problems: FirstSessionProblem[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, problems: [{ section: 'request', code: 'malformed' }] };
  }
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!['incomes', 'openingBalance', 'bills'].includes(key)) {
      return { ok: false, problems: [{ section: 'request', code: 'unexpected_field' }] };
    }
  }
  if (!Array.isArray(b.incomes) || !Array.isArray(b.bills)) {
    return { ok: false, problems: [{ section: 'request', code: 'malformed' }] };
  }

  const problems: FirstSessionProblem[] = [];

  if (b.incomes.length === 0) problems.push({ section: 'incomes', code: 'no_income' });
  if (b.incomes.length > FIRST_SESSION_MAX_INCOMES) problems.push({ section: 'incomes', code: 'too_many' });
  if (b.bills.length > FIRST_SESSION_MAX_BILLS) problems.push({ section: 'bills', code: 'too_many' });
  if (problems.some((p) => p.code === 'too_many')) return { ok: false, problems };

  b.incomes.forEach((line, index) => {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) {
      problems.push({ section: 'incomes', index, code: 'malformed' });
      return;
    }
    const code = lineProblem(line as Record<string, unknown>, LINE_KEYS, today);
    if (code) problems.push({ section: 'incomes', index, code });
  });

  b.bills.forEach((line, index) => {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) {
      problems.push({ section: 'bills', index, code: 'malformed' });
      return;
    }
    const bill = line as Record<string, unknown>;
    const isChecklist = BILL_CHECKLIST.some((c) => c.key === bill.item);
    if (!isChecklist && bill.item !== OTHER_BILL) {
      problems.push({ section: 'bills', index, code: 'item_invalid' });
      return;
    }
    // Code decides a checklist bill's category; a client may not send one.
    if (isChecklist && 'category' in bill) {
      problems.push({ section: 'bills', index, code: 'category_not_allowed' });
      return;
    }
    if (!isChecklist && !(SEED_EXPENSE_CATEGORIES as readonly unknown[]).includes(bill.category)) {
      problems.push({ section: 'bills', index, code: 'category_invalid' });
      return;
    }
    const code = lineProblem(bill, BILL_KEYS, today);
    if (code) problems.push({ section: 'bills', index, code });
  });

  if (!isMoney(b.openingBalance, { allowZero: true, allowNegative: true })) {
    problems.push({ section: 'openingBalance', code: 'opening_invalid' });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: b as unknown as FirstSessionRequest };
}

// ── From a valid request to the rows the database receives ────────────────────

export type FirstSessionRule = {
  description: string;
  amount: number;
  type: 'income' | 'expense';
  cadence: FirstSessionFrequency;
  anchorDate: string;
  secondDay: number | null;
  /** Seed category name for an expense; null for income. */
  category: SeedExpenseCategory | null;
  /** Every occurrence from the start of today's month, twelve months on. */
  dates: string[];
};

/**
 * The anchor for a monthly line paid on `day`. Only the anchor's DAY is read
 * by occurrencesInMonth (which clamps it per month), but the column is a real
 * date — so the anchor goes in the first month, from today's, that has that
 * day: a bill on the 31st anchors in a 31-day month and still lands on the
 * 30th in September.
 */
export function monthlyAnchorDate(today: string, day: number): string {
  let [y, m] = today.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 12; i++) {
    const len = new Date(y, m, 0).getDate();
    if (day <= len) return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  throw new Error(`monthlyAnchorDate: no month has day ${day}`);
}

function anchorFor(when: FirstSessionWhen, today: string): { anchorDate: string; secondDay: number | null } {
  switch (when.frequency) {
    case 'weekly':
    case 'biweekly':
      return { anchorDate: when.nextDate, secondDay: null };
    case 'semimonthly':
      return buildSemimonthlyAnchor(today.slice(0, 7), when.days[0], when.days[1]);
    case 'monthly':
      return { anchorDate: monthlyAnchorDate(today, when.dayOfMonth), secondDay: null };
  }
}

function categoryFor(bill: FirstSessionBill): SeedExpenseCategory {
  const listed = BILL_CHECKLIST.find((c) => c.key === bill.item);
  return listed ? listed.category : (bill.category as SeedExpenseCategory);
}

/** A VALIDATED request → the rules and their dated occurrences. */
export function buildFirstSessionRules(req: FirstSessionRequest, today: string): FirstSessionRule[] {
  const rule = (
    line: FirstSessionIncome | FirstSessionBill,
    type: 'income' | 'expense',
    category: SeedExpenseCategory | null
  ): FirstSessionRule => {
    const { anchorDate, secondDay } = anchorFor(line, today);
    return {
      description: line.label.trim(),
      amount: line.amount,
      type,
      cadence: line.frequency,
      anchorDate,
      secondDay,
      category,
      dates: materializeFromMonthStart({ cadence: line.frequency, anchorDate, secondDay }, today, FIRST_SESSION_MONTHS),
    };
  };
  return [
    ...req.incomes.map((l) => rule(l, 'income', null)),
    ...req.bills.map((l) => rule(l, 'expense', categoryFor(l))),
  ];
}

// ── From what a person typed to a request ─────────────────────────────────────

/** One line as a form holds it: everything a string, as typed. */
export type FirstSessionDraftLine = {
  label: string;
  amount: string;
  frequency: FirstSessionFrequency;
  nextDate: string;   // YYYY-MM-DD, weekly/bi-weekly
  day1: string;       // semi-monthly
  day2: string;       // semi-monthly
  dayOfMonth: string; // monthly
};
export type FirstSessionDraftBill = FirstSessionDraftLine & { item: BillKey | typeof OTHER_BILL; category: string };

export type FirstSessionDraft = {
  incomes: FirstSessionDraftLine[];
  openingBalance: string;
  bills: FirstSessionDraftBill[];
};

export function emptyDraftLine(): FirstSessionDraftLine {
  return { label: '', amount: '', frequency: 'biweekly', nextDate: '', day1: '', day2: '', dayOfMonth: '' };
}

function wholeNumber(raw: string): number | null {
  const t = raw.trim();
  return /^\d{1,2}$/.test(t) ? Number(t) : null;
}

function whenFromDraft(line: FirstSessionDraftLine): Record<string, unknown> {
  switch (line.frequency) {
    case 'weekly':
    case 'biweekly':
      return { frequency: line.frequency, nextDate: line.nextDate.trim() };
    case 'semimonthly':
      return { frequency: line.frequency, days: [wholeNumber(line.day1), wholeNumber(line.day2)] };
    case 'monthly':
      return { frequency: line.frequency, dayOfMonth: wholeNumber(line.dayOfMonth) };
  }
}

/**
 * Turns a form's strings into the request body, then validates it with the
 * server's own rules. Amounts go through parseAmountInput, so an fr-CA keypad's
 * "1234,56" reads as 1234.56, never 1, and a grouped "1 234,56" is a problem
 * at that field rather than a guess. A blank income label takes
 * `defaultIncomeLabel(n)` (the screen's translated "Pay 1"); a checklist bill's
 * label is the screen's translated name for that item, passed in the draft.
 */
export function firstSessionRequestFromDraft(
  draft: FirstSessionDraft,
  today: string,
  defaultIncomeLabel: (n: number) => string
): { ok: true; value: FirstSessionRequest } | { ok: false; problems: FirstSessionProblem[] } {
  const amount = (raw: string) => {
    const v = parseAmountInput(raw);
    return v === null ? NaN : v;
  };
  const body = {
    incomes: draft.incomes.map((l, i) => ({
      label: l.label.trim() || defaultIncomeLabel(i + 1),
      amount: amount(l.amount),
      ...whenFromDraft(l),
    })),
    openingBalance: amount(draft.openingBalance),
    bills: draft.bills.map((l) => ({
      item: l.item,
      label: l.label.trim(),
      amount: amount(l.amount),
      ...(l.item === OTHER_BILL ? { category: l.category } : {}),
      ...whenFromDraft(l),
    })),
  };
  return validateFirstSessionRequest(body, today);
}
