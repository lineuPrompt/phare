/**
 * The opening-balance ledger row — one place that knows how to write, find,
 * and change it.
 *
 * WHAT IT IS. Money the household already had (or already owed) before Phare
 * existed, stated once as a starting position. It is a one-sided 'transfer'
 * row on the goal account with NO chequing peer, so it sums into
 * computeGoalBalance — and therefore into the goal's progress toward its
 * target — while never appearing as a movement on the Cash Timeline, which
 * renders only rows whose account_id is the chequing account.
 *
 * IT IS AN ASSERTION, NOT A RECORD. "Never rewrite history" protects records
 * of things that happened. This row is a claim about where the household
 * began. Correcting a mistyped starting position therefore UPDATES the row
 * in place rather than appending a correction delta — a delta would invent a
 * movement on a date when nothing moved. That is the opposite of the debt
 * `newAmountOwed` path in PATCH /api/accounts/[id], which appends a
 * 'Balance correction' row precisely because a debt balance genuinely
 * changed over time and is being re-baselined. The two look similar and mean
 * different things; they are kept apart deliberately.
 *
 * IDENTIFIED BY is_opening_balance, NEVER BY DESCRIPTION. The description is
 * user-editable from the goal's history list, so matching on the old
 * 'Starting balance / Solde initial' literal would target the wrong row the
 * moment someone retitled it. A partial unique index guarantees at most one
 * per account, which is what makes "the" opening-balance row upsertable.
 * See supabase/migrations/20260831000000_transactions_is_opening_balance.sql.
 */

import type { createClient } from '@/lib/supabase-server';

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Description stored on the row. Retained only so a household reading the
 * raw ledger (or a CSV export) sees something meaningful; the UI renders its
 * label from i18n via the is_opening_balance flag and never reads this
 * string. New rows keep the historical literal so old and new rows read
 * identically in an export.
 */
export const OPENING_BALANCE_DESCRIPTION = 'Starting balance / Solde initial';

/**
 * Creates, updates, or removes an account's single opening-balance row.
 *
 *   amount === 0 or null → the row is deleted ("I never had a starting
 *                          balance"), which is a real answer and not the
 *                          same as leaving it untouched.
 *   otherwise            → upserted at `date`.
 *
 * Returns the error message on failure, or null on success. Callers decide
 * whether that is fatal; account creation treats it as non-fatal (the
 * account exists, only the seed is missing) while an explicit edit does not.
 */
export async function setOpeningBalance(
  supabase: Supa,
  householdId: string,
  accountId: string,
  amount: number | null,
  date: string
): Promise<string | null> {
  const { data: existing, error: findErr } = await supabase
    .from('transactions')
    .select('id')
    .eq('household_id', householdId)
    .eq('account_id', accountId)
    .eq('is_opening_balance', true)
    .maybeSingle();

  if (findErr) return findErr.message;

  if (amount == null || amount === 0) {
    if (!existing) return null;
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', existing.id)
      .eq('household_id', householdId);
    return error?.message ?? null;
  }

  if (existing) {
    // Amount and date only. Description is left alone so a household that
    // renamed the row keeps their wording.
    const { error } = await supabase
      .from('transactions')
      .update({ amount, date })
      .eq('id', existing.id)
      .eq('household_id', householdId);
    return error?.message ?? null;
  }

  const { error } = await supabase.from('transactions').insert({
    household_id: householdId,
    member_id: null,
    category_id: null,
    description: OPENING_BALANCE_DESCRIPTION,
    amount,
    date,
    type: 'transfer',
    source: 'manual',
    account_id: accountId,
    is_opening_balance: true,
  });
  return error?.message ?? null;
}
