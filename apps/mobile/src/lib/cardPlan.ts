import { editorItemsFrom, parseAmountInput, sumWarning } from '@phare/core';
import { ApiError, messageKeyFor } from './apiErrors';

// ---------------------------------------------------------------------------
// A card's detail and plan (standalone S5, 2026-10-22).
//
// EXISTING ROUTES, AS THE WEB CARDS PAGE USES THEM:
//   GET  /api/card-envelope?cardId&month&locale — the card, its plan for the
//        month (own or carried forward), each category's spend, the cycle's
//        state, and later months that hold their own plan
//   POST /api/card-envelope — saves the month's goal, category budgets and
//        the card's statement/payment days
//
// THE SERVER DECIDES, the app follows:
//   - a CLOSED statement keeps its plan: the route answers 409 cycle_closed,
//     and the app offers no editor for a closed month in the first place;
//   - LATER MONTHS with a plan of their own: the route refuses (409
//     later_plans_decision_required) until the household chooses, for exactly
//     the months it was shown, to apply this plan to them or keep theirs;
//   - categories must be the household's own (400 unknown_category).
//
// Every figure is the server's. Amounts typed here go through core's
// parseAmountInput, so "12,50" on a French keypad is 12.50, never 12.
// ---------------------------------------------------------------------------

export type CycleState = 'closed' | 'open' | 'future';
export type BudgetStatus = 'ok' | 'watch' | 'over' | 'unset';
export type PastPlan = 'saved' | 'goalOnly' | 'none';

export type CardBudget = {
  categoryId: string;
  categoryName: string;
  monthlyAmount: number;
  actual: number;
  remaining: number;
  status: BudgetStatus;
  /** false: spend in a category the plan has no budget for. */
  planned: boolean;
};

export type CardDetail = {
  card: { id: string; name: string; statementCloseDay: number | null; paymentDay: number | null };
  month: string;
  totalGoal: number | null;
  budgets: CardBudget[];
  uncategorized: number;
  totalSpent: number;
  categories: { id: string; name: string }[];
  cycleState: CycleState;
  laterPlanMonths: string[];
  /** Closed months only: what was saved for that month itself. */
  pastPlan: PastPlan | null;
};

type Getter = <T>(path: string) => Promise<T>;
type Poster = <T>(path: string, body: unknown) => Promise<T>;

export function cardDetailPath(cardId: string, month: string, locale: 'en' | 'fr'): string {
  return `/api/card-envelope?cardId=${encodeURIComponent(cardId)}&month=${encodeURIComponent(month)}&locale=${locale}`;
}

/** A Postgres numeric can arrive as a string; anything else unreadable is an error, never $0. */
function num(value: unknown, what: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`card detail: ${what} is not a number`);
  return n;
}

function dayOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function parseCardDetail(raw: unknown, month: string): CardDetail {
  const d = raw as Record<string, unknown> | null;
  const card = d?.card as Record<string, unknown> | undefined;
  if (!d || !card || typeof card.id !== 'string' || typeof card.name !== 'string') {
    throw new Error('card detail: no card in the answer');
  }
  const state = d.cycleState;
  if (state !== 'closed' && state !== 'open' && state !== 'future') throw new Error('card detail: unknown cycle state');
  const items = Array.isArray(d.envelopeItems) ? d.envelopeItems : [];
  const pastPlan = d.pastPlan === 'saved' || d.pastPlan === 'goalOnly' || d.pastPlan === 'none' ? d.pastPlan : null;
  return {
    card: {
      id: card.id,
      name: card.name,
      statementCloseDay: dayOrNull(card.statement_close_day),
      paymentDay: dayOrNull(card.payment_day),
    },
    month,
    totalGoal: d.totalGoal === null || d.totalGoal === undefined ? null : num(d.totalGoal, 'goal'),
    budgets: items.map((raw, i) => {
      const it = raw as Record<string, unknown>;
      const status = it.status;
      return {
        categoryId: String(it.categoryId),
        categoryName: String(it.categoryName),
        monthlyAmount: num(it.monthlyAmount, `budget ${i}`),
        actual: num(it.actual, `spent ${i}`),
        remaining: num(it.remaining, `remaining ${i}`),
        status: status === 'ok' || status === 'watch' || status === 'over' ? status : 'unset',
        planned: it.planned !== false,
      };
    }),
    uncategorized: num(d.uncategorized ?? 0, 'uncategorized'),
    totalSpent: num(d.totalSpent ?? 0, 'total spent'),
    categories: (Array.isArray(d.categories) ? d.categories : []).map((c) => {
      const cat = c as Record<string, unknown>;
      return { id: String(cat.id), name: String(cat.name) };
    }),
    cycleState: state,
    laterPlanMonths: Array.isArray(d.laterPlanMonths) ? d.laterPlanMonths.filter((m): m is string => typeof m === 'string') : [],
    pastPlan,
  };
}

export async function loadCardDetail(get: Getter, cardId: string, month: string, locale: 'en' | 'fr'): Promise<CardDetail> {
  return parseCardDetail(await get(cardDetailPath(cardId, month, locale)), month);
}

/** Only an open or future month can be planned; a closed one keeps its plan. */
export function canEditPlan(detail: Pick<CardDetail, 'cycleState'>): boolean {
  return detail.cycleState !== 'closed';
}

// ── The editor ──────────────────────────────────────────────────────────────

export type PlanDraft = {
  goal: string;
  items: { categoryId: string; categoryName: string; amount: string }[];
  closeDay: string;
  payDay: string;
};

/** What the editor opens with: the plan on screen, nothing more (core's editorItemsFrom). */
export function draftFrom(detail: CardDetail): PlanDraft {
  return {
    goal: detail.totalGoal === null ? '' : String(detail.totalGoal),
    items: editorItemsFrom(detail.budgets).map((i) => ({
      categoryId: i.categoryId,
      categoryName: i.categoryName,
      amount: String(i.monthlyAmount),
    })),
    closeDay: detail.card.statementCloseDay === null ? '' : String(detail.card.statementCloseDay),
    payDay: detail.card.paymentDay === null ? '' : String(detail.card.paymentDay),
  };
}

export type PlanProblem = 'goalInvalid' | 'amountInvalid' | 'closeDayInvalid' | 'payDayInvalid';

/** An amount of 0 or more. parseAmountInput already refuses past nine digits (MANUAL_ENTRY_MAX_AMOUNT). */
function readAmount(raw: string): number | null {
  const n = parseAmountInput(raw);
  return n === null || n < 0 ? null : n;
}

/** '' is "not set"; otherwise a whole day of the month, 1 to 31. */
function readDay(raw: string): number | null | 'invalid' {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d{1,2}$/.test(s)) return 'invalid';
  const n = Number(s);
  return n >= 1 && n <= 31 ? n : 'invalid';
}

export type LaterChoice = { choice: 'apply' | 'keep'; months: string[] };

export type PlanBody = {
  cardId: string;
  month: string;
  totalGoal: number;
  items: { categoryId: string; monthlyAmount: number }[];
  statementCloseDay: number | null;
  paymentDay: number | null;
  laterPlans?: 'apply' | 'keep';
  laterPlanMonths?: string[];
};

/** The POST body, or the first thing the person has to fix — nothing is sent until it reads exactly. */
export function buildPlanBody(
  cardId: string,
  month: string,
  draft: PlanDraft,
  later: LaterChoice | null
): { ok: true; body: PlanBody } | { ok: false; problem: PlanProblem; categoryId?: string } {
  const goal = readAmount(draft.goal);
  if (goal === null) return { ok: false, problem: 'goalInvalid' };
  const items: PlanBody['items'] = [];
  for (const item of draft.items) {
    const amount = readAmount(item.amount);
    if (amount === null) return { ok: false, problem: 'amountInvalid', categoryId: item.categoryId };
    items.push({ categoryId: item.categoryId, monthlyAmount: amount });
  }
  const closeDay = readDay(draft.closeDay);
  if (closeDay === 'invalid') return { ok: false, problem: 'closeDayInvalid' };
  const payDay = readDay(draft.payDay);
  if (payDay === 'invalid') return { ok: false, problem: 'payDayInvalid' };
  return {
    ok: true,
    body: {
      cardId,
      month,
      totalGoal: goal,
      items,
      statementCloseDay: closeDay,
      paymentDay: payDay,
      ...(later && later.months.length > 0 ? { laterPlans: later.choice, laterPlanMonths: later.months } : {}),
    },
  };
}

/** The budgets add up to more than the goal — a warning, as on the web; saving is still allowed. */
export function overGoal(draft: PlanDraft): boolean {
  const goal = readAmount(draft.goal);
  if (goal === null) return false;
  const amounts = draft.items.map((i) => readAmount(i.amount));
  if (amounts.some((a) => a === null)) return false;
  return sumWarning(amounts.map((a) => ({ monthlyAmount: a as number })), goal);
}

export type SaveOutcome =
  | { kind: 'saved' }
  /** Goal and budgets saved; the statement/payment days did not. */
  | { kind: 'savedDaysFailed' }
  /** Later months hold their own plans (or the list changed): reload and ask. */
  | { kind: 'laterPlansRequired' }
  | { kind: 'error'; messageKey: string };

const SAVE_ERROR_KEYS: Record<string, string> = {
  cycle_closed: 'cardPlan.errors.cycleClosed',
  later_plans_remove_failed: 'cardPlan.errors.laterPlansRemoveFailed',
  unknown_category: 'cardPlan.errors.unknownCategory',
};

export async function savePlan(post: Poster, body: PlanBody): Promise<SaveOutcome> {
  try {
    const res = await post<{ saved?: boolean; daysUpdateFailed?: boolean }>('/api/card-envelope', body);
    return res?.daysUpdateFailed ? { kind: 'savedDaysFailed' } : { kind: 'saved' };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'later_plans_decision_required') return { kind: 'laterPlansRequired' };
    if (err instanceof ApiError && err.code && err.code in SAVE_ERROR_KEYS) {
      return { kind: 'error', messageKey: SAVE_ERROR_KEYS[err.code] };
    }
    console.error('Card plan save error:', err);
    return { kind: 'error', messageKey: messageKeyFor(err) };
  }
}
