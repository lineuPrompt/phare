import { describe, it, expect } from 'vitest';
import { ensureBridgesForWindow, type BridgeCardInfo } from '../bridgeHelpers';
import { addMonthsToMonth } from '../goalHelpers';

/**
 * Fix 2 (2026-07-20): before this change, /api/dashboard/route.ts never
 * called ensureBridgesForWindow, so navigating the snapshot to a future
 * month nobody had opened Timeline for would silently omit that month's
 * credit-card bridge payment — understating expenses with no error. The fix
 * derives the bridge's spend month from the viewed month exactly the way
 * the route now does (`addMonthsToMonth(actualsMonth, -1)`, since a bridge
 * for spend month M lands in the chequing ledger in month M+1) and calls
 * the same ensureBridgesForWindow helper Timeline already relies on — one
 * source of truth, no parallel bridge logic.
 *
 * This test exercises that exact spend-month derivation, including the
 * December→January wraparound where an off-by-one would be easiest to miss.
 */

type Row = Record<string, unknown> & { id: string };

function makeFakeSupabase(seed: Row[]) {
  let rows: Row[] = seed.map((r) => ({ ...r }));
  let idCounter = 1;

  function selectQuery(initial: Row[]) {
    let result = initial;
    const api = {
      eq(field: string, value: unknown) { result = result.filter((r) => r[field] === value); return api; },
      in(field: string, values: unknown[]) { result = result.filter((r) => values.includes(r[field])); return api; },
      gte(field: string, value: string) { result = result.filter((r) => (r[field] as string) >= value); return api; },
      lte(field: string, value: string) { result = result.filter((r) => (r[field] as string) <= value); return api; },
      then(resolve: (v: { data: Row[] }) => unknown) {
        return Promise.resolve({ data: result.map((r) => ({ ...r })) }).then(resolve);
      },
    };
    return api;
  }

  return {
    from(table: string) {
      if (table !== 'transactions') throw new Error(`fake supabase: unexpected table "${table}"`);
      return {
        select() { return selectQuery(rows); },
        insert(newRows: Record<string, unknown>[]) {
          const withIds: Row[] = newRows.map((r) => ({ ...r, id: `bridge-${idCounter++}` }));
          rows = [...rows, ...withIds];
          return Promise.resolve({ data: withIds });
        },
        update(patch: Record<string, unknown>) {
          return { eq(field: string, value: unknown) {
            rows = rows.map((r) => (r[field] === value ? { ...r, ...patch } : r));
            return Promise.resolve({ data: null });
          } };
        },
        delete() {
          return { in(field: string, values: unknown[]) {
            rows = rows.filter((r) => !values.includes(r[field]));
            return Promise.resolve({ data: null });
          } };
        },
      };
    },
    currentRows(): Row[] { return rows; },
  };
}

const HOUSEHOLD = 'hh-1';
const CHEQUING = 'acc-chq';
const CARD = 'acc-visa';
const MEMBER = 'mem-1';

const cards: BridgeCardInfo[] = [
  { id: CARD, name: 'Visa', payment_day: 5, statement_close_day: 15 },
];

// Mirrors the exact call dashboard/route.ts now makes: given a viewed
// (target) month, derive spendMonth and ensure that month's bridge exists.
async function ensureForTargetMonth(supabase: ReturnType<typeof makeFakeSupabase>, targetMonth: string) {
  const spendMonth = addMonthsToMonth(targetMonth, -1);
  await ensureBridgesForWindow({
    supabase, householdId: HOUSEHOLD, chequingId: CHEQUING, memberId: MEMBER,
    cards, spendMonths: [spendMonth],
  });
}

describe('Fix 2 — dashboard snapshot bridge derivation for a viewed future month', () => {
  it('a never-visited future month still gets its card bridge materialized', async () => {
    // Card spend in the cycle ending 2026-07-15 pays out 2026-08-05 — i.e.
    // the founder navigates the snapshot to 2026-08 and the bridge must
    // already be there, even though nobody ever opened Timeline for it.
    const supabase = makeFakeSupabase([
      { id: 'card-1', household_id: HOUSEHOLD, account_id: CARD, amount: 150, type: 'expense', date: '2026-07-01', description: 'Groceries', is_bridge: false },
    ]);

    await ensureForTargetMonth(supabase, '2026-08');

    const bridge = supabase.currentRows().find((r) => r.is_bridge === true);
    expect(bridge).toBeTruthy();
    expect(bridge!.amount).toBe(150);
    expect((bridge!.date as string).slice(0, 7)).toBe('2026-08');
  });

  it('year wraparound: viewing January correctly derives December as the spend month', async () => {
    const supabase = makeFakeSupabase([
      { id: 'card-1', household_id: HOUSEHOLD, account_id: CARD, amount: 80, type: 'expense', date: '2026-12-01', description: 'Holiday shopping', is_bridge: false },
    ]);

    await ensureForTargetMonth(supabase, '2027-01');

    const bridge = supabase.currentRows().find((r) => r.is_bridge === true);
    expect(bridge).toBeTruthy();
    expect(bridge!.amount).toBe(80);
    expect((bridge!.date as string).slice(0, 7)).toBe('2027-01');
  });

  it('a month with no card spend in its spend-month cycle materializes no bridge (no fabrication)', async () => {
    const supabase = makeFakeSupabase([]);
    await ensureForTargetMonth(supabase, '2026-09');
    expect(supabase.currentRows().find((r) => r.is_bridge === true)).toBeUndefined();
  });
});
