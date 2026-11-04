import type { SupabaseClient } from '@supabase/supabase-js';
import { topUpOccurrences } from '@phare/core';
import { materializeTransferOccurrences } from '@/lib/recurringTransferHelpers';

// ---------------------------------------------------------------------------
// KEEP EVERY ACTIVE RECURRING RULE 12 MONTHS AHEAD (2026-11-04).
//
// A rule's rows were written once, 12 months ahead, when it was created or
// edited. Nothing ever added more, so a salary or a mortgage set up in October
// 2026 stopped in September 2027: the plan showed $0 from then on, and a year
// after onboarding the household's CURRENT month would have emptied too
// (Lineu, 2026-11-04: "it should keep going unless I set an end date").
//
// Run daily by the 07:00 UTC cron, for every household. For each active rule
// with a pay date: its latest row or tombstone (recurring_skipped_dates) is
// where it stands, and topUpOccurrences (@phare/core) gives the dates after
// that, inside the same 12-month window, never past the rule's end date.
//   - an occurrence deleted or edited alone has a tombstone, so it counts as
//     reached and is never written back;
//   - a rule with no row and no tombstone is left alone: there is no
//     schedule to continue, and writing one would be a guess;
//   - inactive rules (split into a successor) are never continued;
//   - rows are written exactly as POST /api/recurring writes them — a
//     transfer through create_transfer, both sides, one date at a time.
// Idempotent: a second run the same day finds every rule already reached.
//
// Each rule's latest date is read with its own ordered, limit-1 query: one
// read of every row would be cut at PostgREST's row cap without an error.
// ---------------------------------------------------------------------------

type Rule = {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  cadence: 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';
  anchor_date: string | null;
  second_day: number | null;
  effective_from: string | null;
  // Read through '*' so the run works before and after the end_date column
  // exists (migration 20261104000000): absent reads as "no end date".
  end_date?: string | null;
  member_id: string | null;
  category_id: string | null;
  account_id: string;
  destination_account_id: string | null;
  description: string;
  amount: number | string;
};

/** `errors`: one per rule that could not be continued; the others still are. */
export type TopUpResult = { rules: number; topped: number; inserted: number; errors: string[] };

async function latestDate(
  supabase: SupabaseClient,
  table: 'transactions' | 'recurring_skipped_dates',
  householdId: string,
  ruleId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select('date')
    .eq('household_id', householdId)
    .eq('recurring_item_id', ruleId)
    .order('date', { ascending: false })
    .limit(1);
  if (error) throw new Error(`${table} read failed for rule ${ruleId}: ${error.message}`);
  return ((data ?? []) as { date: string }[])[0]?.date ?? null;
}

/** Continues one rule; returns how many dates it wrote. Throws on a failed read or write. */
async function topUpRule(supabase: SupabaseClient, householdId: string, rule: Rule, today: string): Promise<number> {
  const [lastRow, lastSkip] = await Promise.all([
    latestDate(supabase, 'transactions', householdId, rule.id),
    latestDate(supabase, 'recurring_skipped_dates', householdId, rule.id),
  ]);
  const lastDate = [lastRow, lastSkip].filter((d): d is string => d !== null).sort().pop();
  if (!lastDate) return 0;

  const dates = topUpOccurrences(
    {
      cadence: rule.cadence,
      anchorDate: rule.anchor_date as string,
      secondDay: rule.second_day,
      effectiveFrom: rule.effective_from,
      endDate: rule.end_date ?? null,
    },
    lastDate,
    today
  );
  if (dates.length === 0) return 0;

  if (rule.type === 'transfer') {
    if (!rule.member_id || !rule.destination_account_id) {
      throw new Error(`transfer rule ${rule.id} has no member or no destination; not continued`);
    }
    const { materialized, error } = await materializeTransferOccurrences(supabase, {
      householdId,
      memberId: rule.member_id,
      chequingId: rule.account_id,
      destinationId: rule.destination_account_id,
      amount: Number(rule.amount),
      description: rule.description,
      recurringItemId: rule.id,
      dates,
    });
    if (error) throw new Error(`transfer rule ${rule.id}: ${error} (${materialized} of ${dates.length} written)`);
    return materialized;
  }

  const { error } = await supabase.from('transactions').insert(
    dates.map((date) => ({
      household_id: householdId,
      // Expenses never carry a member (CLAUDE.md §4), whatever an older rule holds.
      member_id: rule.type === 'expense' ? null : rule.member_id,
      category_id: rule.category_id,
      account_id: rule.account_id,
      amount: rule.amount,
      description: rule.description,
      date,
      type: rule.type,
      source: 'manual',
      recurring_item_id: rule.id,
    }))
  );
  if (error) throw new Error(`rule ${rule.id} insert failed: ${error.message}`);
  return dates.length;
}

/**
 * Every active rule of one household, continued to the 12-month window. One
 * rule's failure is reported in `errors` and never stops the others.
 */
export async function topUpRecurringRules(
  supabase: SupabaseClient,
  householdId: string,
  today: string
): Promise<TopUpResult> {
  const { data, error } = await supabase
    .from('recurring_items')
    .select('*')
    .eq('household_id', householdId)
    .eq('active', true);
  if (error) throw new Error(`recurring_items read failed: ${error.message}`);
  const rules = ((data ?? []) as Rule[]).filter((r) => r.anchor_date);

  let topped = 0;
  let inserted = 0;
  const errors: string[] = [];
  for (const rule of rules) {
    try {
      const written = await topUpRule(supabase, householdId, rule, today);
      if (written > 0) topped += 1;
      inserted += written;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { rules: rules.length, topped, inserted, errors };
}
