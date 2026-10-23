import type { Getter } from './timelineLoader';

// ---------------------------------------------------------------------------
// Savings goals and debts, read-only (Lineu, 2026-10-23: Goals in More, as on
// the web sidebar). GET /api/goals computes every figure: the balance as of
// today (the sum of its transfers dated <= today, opening balance included),
// the target and the target date. Nothing here adds or divides — a progress
// figure would be a second computation of what the web shows, so none is made.
// Adding money is the quick-entry contribution (QuickEntryScreen).
// ---------------------------------------------------------------------------

export type Goal = {
  id: string;
  name: string;
  isDebt: boolean;
  /** As of today. Negative for a debt (money still owed). */
  balance: number;
  /** null: no target set. */
  target: number | null;
  targetDate: string | null;
  /** The recurring contribution, when one is set. */
  contribution: { amount: number; cadence: 'monthly' | 'biweekly' | 'semimonthly' | 'weekly' } | null;
};

function num(value: unknown, what: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`goals: ${what} is not a number`);
  return n;
}

export function parseGoals(raw: unknown): Goal[] {
  const d = raw as { goals?: unknown } | null;
  if (!d || !Array.isArray(d.goals)) throw new Error('goals: no goal list in the answer');
  return d.goals.map((g, i) => {
    const o = g as Record<string, unknown>;
    const rule = o.recurringContribution as { amount?: unknown; cadence?: unknown } | null | undefined;
    const cadence = rule?.cadence;
    return {
      id: String(o.id),
      name: String(o.name),
      isDebt: o.isDebt === true,
      balance: num(o.balance, `goal ${i} balance`),
      target: o.goalTarget === null || o.goalTarget === undefined ? null : num(o.goalTarget, `goal ${i} target`),
      targetDate: typeof o.goalTargetDate === 'string' ? o.goalTargetDate : null,
      contribution:
        rule && (cadence === 'monthly' || cadence === 'biweekly' || cadence === 'semimonthly' || cadence === 'weekly')
          ? { amount: num(rule.amount, `goal ${i} contribution`), cadence }
          : null,
    };
  });
}

export async function loadGoals(get: Getter): Promise<Goal[]> {
  return parseGoals(await get<unknown>('/api/goals'));
}
