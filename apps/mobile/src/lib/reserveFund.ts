import type { Getter } from './timelineLoader';

// ---------------------------------------------------------------------------
// The Reserve Fund (sinking funds), read-only (S8, first round, 2026-11-05).
// GET /api/sinking-funds computes every figure: the balance as of today, the
// contribution rule and its next date, and each fund's yearly and monthly
// amounts. Nothing here adds or divides; the app shows what the server said.
// Adding money and withdrawing go through quick entry, as for a goal.
// ---------------------------------------------------------------------------

export type Cadence = 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';

export type ReserveFund = {
  /** The Reserve Fund's account. null: not started yet (no account). */
  accountId: string | null;
  /** As of today. Meaningful only when started. */
  balance: number;
  contribution: { amount: number; cadence: Cadence; nextDate: string | null } | null;
  funds: { id: string; name: string; annual: number; monthly: number; active: boolean }[];
};

function num(value: unknown, what: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`reserve fund: ${what} is not a number`);
  return n;
}

const CADENCES: readonly string[] = ['monthly', 'biweekly', 'semimonthly', 'weekly'];

export function parseReserveFund(raw: unknown): ReserveFund {
  const d = raw as { funds?: unknown; buffer?: unknown } | null;
  if (!d || !Array.isArray(d.funds) || !d.buffer || typeof d.buffer !== 'object') {
    throw new Error('reserve fund: no funds or buffer in the answer');
  }
  const b = d.buffer as Record<string, unknown>;
  const accountId = typeof b.linkedAccountId === 'string' ? b.linkedAccountId : null;
  const cadence = b.cadence;
  return {
    accountId,
    balance: accountId ? num(b.balance, 'balance') : 0,
    contribution:
      accountId && b.contributionAmount !== null && b.contributionAmount !== undefined && typeof cadence === 'string' && CADENCES.includes(cadence)
        ? {
            amount: num(b.contributionAmount, 'contribution'),
            cadence: cadence as Cadence,
            nextDate: typeof b.nextContributionDate === 'string' ? b.nextContributionDate : null,
          }
        : null,
    funds: d.funds.map((f, i) => {
      const o = f as Record<string, unknown>;
      if (typeof o.id !== 'string') throw new Error(`reserve fund: fund ${i} has no id`);
      return {
        id: o.id,
        name: String(o.name ?? ''),
        annual: num(o.annual_amount, `fund ${i} yearly amount`),
        monthly: num(o.monthly_provision, `fund ${i} monthly amount`),
        active: o.active !== false,
      };
    }),
  };
}

export async function loadReserveFund(get: Getter): Promise<ReserveFund> {
  return parseReserveFund(await get<unknown>('/api/sinking-funds'));
}
