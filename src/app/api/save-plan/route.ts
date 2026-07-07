import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { formatLocalMonth, materializeRule, monthNameToNumber } from '@/lib/dateHelpers';
import { logEvent } from '@/lib/eventLogger';
import { GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import {
  buildFileImportRow,
  resolveTransactionSource,
  needsReplaceConfirmation,
  missingSeedCategories,
  planAccountActions,
  type FileMeta,
  type AccountProvenanceInfo,
  type DesiredAccount,
} from '@/lib/importProvenance';
import { resolveMemberId, type IncomeFrequency } from '@/lib/incomeHelpers';

type PlanCategory = {
  name: string;
  budgeted: number;
  type: string;
  seedCategory?: string;
  isFixed?: boolean;
  // Per-payment identity: template v2 income lines and v3 fixed-expense
  // lines only (member is income-only) — see api/plan/route.ts.
  rawAmount?: number;
  frequency?: IncomeFrequency;
  member?: string;
};

export async function POST(request: Request) {
  try {
    const { plan, reviewText, locale, cardNames, fileMeta, confirmReplace } = await request.json() as {
      plan: { monthlyBudget: { categories: PlanCategory[] }; seedCategories?: string[]; sinkingFunds?: { name: string; annualAmount: number; dueMonth: string }[]; goals?: { name: string; targetAmount: number }[]; topRecommendation: string };
      reviewText: string;
      locale: string;
      cardNames: string[];
      fileMeta: FileMeta;
      confirmReplace?: boolean;
    };

    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();
    if (userError || !userRow?.household_id) {
      return NextResponse.json({ error: 'No household found' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    const { data: member } = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('user_id', user.id)
      .single();
    const memberId = member?.id ?? null;

    // All household members, for matching the template's "Member" column
    // against a real person. Fallback for unmatched/blank rows is the
    // current onboarding user (memberId above) — always reported, never silent.
    const { data: allMembers } = await supabase
      .from('household_members')
      .select('id, name')
      .eq('household_id', householdId);

    // ----- Resolve chequing account (required) -----
    const { data: accts } = await supabase
      .from('accounts')
      .select('id, type, name, file_import_id')
      .eq('household_id', householdId);

    const chequingId = accts?.find((a) => a.type === 'chequing')?.id ?? null;
    if (!chequingId) {
      return NextResponse.json({ error: 'A chequing account is required before saving a plan' }, { status: 400 });
    }

    // ----- What this save wants to exist: cards from the UI + goal accounts
    // from the plan. Built once, used to decide reuse vs. create vs. delete
    // vs. preserve for every non-chequing account in a single pass. -----
    const desiredAccounts: DesiredAccount[] = [
      ...((cardNames as string[] | null | undefined) ?? []).map((rawName) => ({
        name: (rawName ?? '').trim() || 'Card',
        type: 'credit_card' as const,
      })),
      ...(plan.goals ?? []).map((g: { name: string }) => ({ name: g.name, type: 'savings' as const })),
    ];

    // ----- Build the account action plan (reuse by name match; otherwise
    // delete if safe or preserve if it carries real activity) -----
    const nonChequingAccts = (accts ?? []).filter((a) => a.type !== 'chequing');
    const nonChequingIds = nonChequingAccts.map((a) => a.id);

    async function buildAccountPlan() {
      if (nonChequingIds.length === 0) return planAccountActions(desiredAccounts, []);

      const [{ data: txRows }, { data: bridgeRows }, { data: envRows }, { data: goalRows }] = await Promise.all([
        supabase.from('transactions').select('account_id').eq('household_id', householdId).in('account_id', nonChequingIds),
        supabase.from('transactions').select('bridge_source_account').eq('household_id', householdId).in('bridge_source_account', nonChequingIds),
        supabase.from('card_envelope_items').select('account_id').eq('household_id', householdId).in('account_id', nonChequingIds),
        supabase.from('monthly_goals').select('account_id').eq('household_id', householdId).in('account_id', nonChequingIds),
      ]);

      const tally = (rows: Record<string, unknown>[] | null, key: string) => {
        const m = new Map<string, number>();
        for (const r of rows ?? []) {
          const id = r[key] as string | null;
          if (id) m.set(id, (m.get(id) ?? 0) + 1);
        }
        return m;
      };
      const txByAccount = tally(txRows, 'account_id');
      const bridgeByAccount = tally(bridgeRows, 'bridge_source_account');
      const envByAccount = tally(envRows, 'account_id');
      const goalByAccount = tally(goalRows, 'account_id');

      const infos: AccountProvenanceInfo[] = nonChequingAccts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type as AccountProvenanceInfo['type'],
        file_import_id: a.file_import_id ?? null,
        transactionCount: (txByAccount.get(a.id) ?? 0) + (bridgeByAccount.get(a.id) ?? 0),
        envelopeItemCount: envByAccount.get(a.id) ?? 0,
        monthlyGoalCount: goalByAccount.get(a.id) ?? 0,
      }));

      return planAccountActions(desiredAccounts, infos);
    }

    // ----- Prior-data guard: never wipe an existing plan silently -----
    // Every prior save-plan run left a recurring_items/budgets/sinking_funds
    // footprint (whether it came from a file or the manual form). If any of
    // that — or any non-chequing account — still exists, the UI must show an
    // explicit bilingual confirmation before this call is allowed to replace it.
    const [{ count: priorRecurringCount }, { count: priorBudgetsCount }, { count: priorSinkingCount }] = await Promise.all([
      supabase.from('recurring_items').select('id', { count: 'exact', head: true }).eq('household_id', householdId),
      supabase.from('budgets').select('id', { count: 'exact', head: true }).eq('household_id', householdId),
      supabase.from('sinking_funds').select('id', { count: 'exact', head: true }).eq('household_id', householdId),
    ]);
    const hasPriorData = (priorRecurringCount ?? 0) > 0 || (priorBudgetsCount ?? 0) > 0
      || (priorSinkingCount ?? 0) > 0 || nonChequingIds.length > 0;

    if (needsReplaceConfirmation(hasPriorData, confirmReplace)) {
      const { data: recurringRowsForCount } = await supabase
        .from('recurring_items')
        .select('id, file_import_id')
        .eq('household_id', householdId);
      const provenancedRecurring = (recurringRowsForCount ?? []).filter((r) => r.file_import_id !== null).length;
      const legacyRecurring = (recurringRowsForCount ?? []).filter((r) => r.file_import_id === null).length;
      const accountPlan = await buildAccountPlan();

      return NextResponse.json({
        needsConfirmation: true,
        counts: {
          totalRecurring: priorRecurringCount ?? 0,
          provenancedRecurring,
          legacyRecurring,
          accountsToDelete: accountPlan.toDelete,
          accountsToPreserve: accountPlan.toPreserve,
          accountsToReuse: accountPlan.toReuse.map((a) => ({ id: a.id, name: a.name })),
        },
      });
    }

    const now = new Date();
    const currentMonth = formatLocalMonth(now);
    const monthDate = `${currentMonth}-01`;
    const anchorDate = `${currentMonth}-01`;

    // ----- Replace only the non-chequing accounts safe to replace -----
    // Everything in accountPlan.toPreserve — manually added accounts, or
    // imported ones with real activity since — is left completely alone:
    // not deleted, transactions untouched, envelope items/goals untouched.
    const accountPlan = await buildAccountPlan();
    const deleteAccountIds = accountPlan.toDelete.map((a) => a.id);

    if (deleteAccountIds.length > 0) {
      const goalAccountIdsToDelete = deleteAccountIds.filter((id) =>
        (accts ?? []).some((a) => a.id === id && (GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type))
      );

      if (goalAccountIdsToDelete.length > 0) {
        const { data: goalTxs } = await supabase
          .from('transactions')
          .select('id')
          .eq('household_id', householdId)
          .in('account_id', goalAccountIdsToDelete)
          .eq('type', 'transfer');

        const goalTxIds = (goalTxs ?? []).map((t) => t.id);
        if (goalTxIds.length > 0) {
          // Delete the chequing-side transfer rows that pointed to these goal transactions.
          await supabase
            .from('transactions')
            .delete()
            .eq('household_id', householdId)
            .eq('account_id', chequingId)
            .in('transfer_peer_id', goalTxIds);
        }
      }

      // toDelete accounts are guaranteed (by planAccountActions) to have zero
      // transactions and zero bridge references — the FK on transactions.account_id
      // is ON DELETE RESTRICT, so this errors loudly instead of silently
      // orphaning anything if that guarantee were ever wrong.
      await supabase
        .from('accounts')
        .delete()
        .eq('household_id', householdId)
        .in('id', deleteAccountIds);
    }

    // ----- Record this onboarding save as a provenance row -----
    // Every save-plan run gets one, file-backed or not (file_type:'manual'
    // when there is no upload). That is the whole trick: rows this run
    // creates carry file_import_id; rows added later one at a time via the
    // Recurring page or ledger never do, so they're structurally immune to
    // the replace below.
    const { data: importRow, error: importError } = await supabase
      .from('file_imports')
      .insert(buildFileImportRow(fileMeta, householdId, user.id))
      .select('id')
      .single();
    if (importError || !importRow) {
      console.error('Save plan file_imports insert error:', importError);
      return NextResponse.json({ error: 'Failed to record import' }, { status: 500 });
    }
    const fileImportId: string = importRow.id;
    const transactionSource = resolveTransactionSource(fileMeta);

    // ----- Reuse, create, and refresh non-chequing accounts per the plan -----
    // A name match (cardNames or plan.goals, case/whitespace-insensitive)
    // reuses the existing account instead of creating a duplicate. Only an
    // account with no manual history gets its provenance refreshed to this
    // run — one with real activity (or none at all) keeps its provenance
    // exactly as it was.
    if (accountPlan.toReuse.some((a) => a.refreshProvenance)) {
      await supabase
        .from('accounts')
        .update({ file_import_id: fileImportId })
        .in('id', accountPlan.toReuse.filter((a) => a.refreshProvenance).map((a) => a.id));
    }

    if (accountPlan.toCreate.length > 0) {
      const goalsByName = new Map((plan.goals ?? []).map((g: { name: string; targetAmount: number }) => [g.name.trim().toLowerCase(), g]));
      await supabase.from('accounts').insert(
        accountPlan.toCreate.map((a) => {
          const goal = a.type === 'savings' ? goalsByName.get(a.name.trim().toLowerCase()) : undefined;
          return {
            household_id: householdId,
            name: a.name,
            type: a.type,
            file_import_id: fileImportId,
            ...(a.type === 'savings' ? { goal_target: goal && goal.targetAmount > 0 ? goal.targetAmount : null } : {}),
          };
        })
      );
    }

    // ----- Replace prior onboarding-plan-generated recurring items -----
    // Scoped to file_import_id IS NOT NULL: a row with no provenance was
    // either added ad-hoc (Recurring page) or predates provenance tracking,
    // and must never be touched here (surfaced to the user as `legacyRecurring`
    // in the confirmation step above instead of being silently kept or dropped).
    const { data: priorRecurring } = await supabase
      .from('recurring_items')
      .select('id')
      .eq('household_id', householdId)
      .not('file_import_id', 'is', null);
    const priorRecurringIds = (priorRecurring ?? []).map((r) => r.id);

    if (priorRecurringIds.length > 0) {
      // Delete ALL of their materialized transactions — past and future —
      // not just date >= today. Deleting only future rows left past-dated
      // rows orphaned (recurring_item_id set NULL by the FK) on every
      // re-onboarding; that orphan leak is what caused ledger duplication.
      await supabase
        .from('transactions')
        .delete()
        .eq('household_id', householdId)
        .in('recurring_item_id', priorRecurringIds);

      await supabase.from('recurring_items').delete().in('id', priorRecurringIds);
    }

    // ----- Replace plan-output artifacts -----
    // budgets and sinking_funds are written ONLY by this route (verified: no
    // other endpoint inserts/updates/deletes them) — full replacement here is
    // correct, not a scope violation, since nothing else can be silently
    // destroying user-owned data. Already gated by the confirmation step above.
    await supabase.from('budgets').delete().eq('household_id', householdId);
    await supabase.from('sinking_funds').delete().eq('household_id', householdId);

    // ----- Seed any missing categories (idempotent — never delete) -----
    // Categories are user-editable and referenced by manually-created
    // budgets/card-envelopes/transactions; wiping them on every re-onboarding
    // destroyed custom categories and cascade-deleted their envelope items.
    const { data: existingCats } = await supabase
      .from('categories')
      .select('name')
      .eq('household_id', householdId);

    // ----- Seed the fixed category set (idempotent) -----
    const seedNames: string[] = plan.seedCategories ?? [
      'Housing', 'Transportation', 'Restaurants', 'Groceries & Pharmacy',
      'Utilities & Subscriptions', 'Childcare', 'Shopping',
      'Health & Personal', 'Installments', 'Unexpected',
    ];

    const toSeed = missingSeedCategories((existingCats ?? []).map((c) => c.name), seedNames);
    if (toSeed.length > 0) {
      await supabase.from('categories').insert(toSeed.map((name) => ({
        household_id: householdId,
        name,
        type: 'expense',
        is_sinking_fund: false,
      })));
    }

    const { data: allCats } = await supabase
      .from('categories')
      .select('id, name')
      .eq('household_id', householdId);

    const catByName = new Map<string, string>();
    for (const c of allCats ?? []) {
      catByName.set(c.name.trim().toLowerCase(), c.id);
    }
    const unexpectedId = catByName.get('unexpected') ?? (allCats?.[0]?.id ?? null);
    const resolveCat = (seed?: string) =>
      (seed && catByName.get(seed.trim().toLowerCase())) || unexpectedId;

    // ----- Route each plan line -----
    const sinkingFundNames = new Set(
      (plan.sinkingFunds ?? []).map((f: { name: string }) => f.name.trim().toLowerCase())
    );

    const recurringRows: Record<string, unknown>[] = [];
    const budgetByCat = new Map<string, number>();
    // Visible, never-silent flags for the save-plan response.
    const unmatchedMembers: { label: string; attemptedMember: string }[] = [];
    const needsPayDate: { id: string; description: string; cadence: string; amount: number; type: 'income' | 'expense'; member: string | null; memberId: string | null; isHousehold: boolean; attemptedName: string | null }[] = [];
    const memberNameById = new Map((allMembers ?? []).map((m) => [m.id, m.name]));
    // Per-income-line resolution detail, keyed by description — recurringRows
    // only carries DB columns, so this is how the anchor step (built after
    // insert, from insertedItems) learns whether a row was a household
    // attribution or an unmatched-name fallback worth visibly flagging.
    const incomeMetaByDescription = new Map<string, { isHousehold: boolean; attemptedName: string | null }>();

    for (const cat of (plan.monthlyBudget.categories as PlanCategory[])) {
      if (sinkingFundNames.has(cat.name.trim().toLowerCase())) continue;

      if (cat.type === 'income') {
        // Real cadence + true per-paycheque amount, when the parser gave us
        // one (template v2 income lines). The "calculated" (own-file/manual
        // form) path has no frequency/member info yet — falls back to the
        // pre-existing monthly-lump behaviour, unchanged.
        const cadence = cat.frequency ?? 'monthly';
        const amount = cat.rawAmount ?? cat.budgeted;
        const isMonthly = cadence === 'monthly';

        const { memberId: resolvedMemberId, usedFallback, unmatchedName, isHousehold } =
          resolveMemberId(cat.member, allMembers ?? [], memberId);
        if (usedFallback && unmatchedName) {
          unmatchedMembers.push({ label: cat.name, attemptedMember: unmatchedName });
        }
        incomeMetaByDescription.set(cat.name, { isHousehold, attemptedName: usedFallback ? unmatchedName : null });

        recurringRows.push({
          household_id: householdId,
          member_id: resolvedMemberId,
          category_id: null,
          description: cat.name,
          amount,
          type: 'income',
          cadence,
          // A non-monthly cadence needs a real pay date (next paycheque /
          // the two semi-monthly days) — guessing one would fabricate a
          // schedule, so it stays unknown until a real anchor exists.
          anchor_date: isMonthly ? anchorDate : null,
          second_day: null,
          account_id: chequingId,
          file_import_id: fileImportId,
        });
        continue;
      }

      const categoryId = resolveCat(cat.seedCategory);

      if (cat.isFixed) {
        // Fixed expense → recurring item, paid from chequing. Real cadence +
        // true per-payment amount when the parser gave us one (template v3
        // fixed-expense lines) — same conversion point as income (Phase C).
        // No member resolution here: the template has no per-expense member
        // column, so expenses stay attributed to whoever is running onboarding.
        const cadence = cat.frequency ?? 'monthly';
        const amount = cat.rawAmount ?? cat.budgeted;
        const isMonthly = cadence === 'monthly';

        recurringRows.push({
          household_id: householdId,
          member_id: memberId,
          category_id: categoryId,
          description: cat.name,
          amount,
          type: 'expense',
          cadence,
          // Same rule as income: a non-monthly cadence needs a real anchor
          // date (next payment date) — guessing one would fabricate a
          // schedule, so it stays unknown until a real one is captured via
          // the anchor step.
          anchor_date: isMonthly ? anchorDate : null,
          second_day: null,
          account_id: chequingId,
          file_import_id: fileImportId,
        });
      } else {
        // Variable expense → contributes to its category's budget (lands on card)
        budgetByCat.set(categoryId, (budgetByCat.get(categoryId) ?? 0) + Number(cat.budgeted));
      }
    }

    // ----- Insert recurring items + materialize 12 months of transactions -----
    if (recurringRows.length) {
      const { data: insertedItems, error: recurringError } = await supabase
        .from('recurring_items')
        .insert(recurringRows)
        .select('id, description, amount, type, cadence, anchor_date, second_day, category_id, account_id, member_id');

      if (recurringError) {
        console.error('Save plan recurring insert error:', recurringError);
        return NextResponse.json({ error: 'Failed to save recurring items' }, { status: 500 });
      }

      const txnRows: Record<string, unknown>[] = [];

      for (const item of insertedItems ?? []) {
        if (!item.anchor_date) {
          // Real cadence and amount are saved; there is just no known pay
          // date yet to place dated instances on. Nothing to materialize —
          // and nothing to fabricate.
          const meta = incomeMetaByDescription.get(item.description);
          needsPayDate.push({
            id: item.id,
            description: item.description,
            cadence: item.cadence,
            amount: Number(item.amount),
            type: item.type,
            member: item.member_id ? memberNameById.get(item.member_id) ?? null : null,
            memberId: item.member_id,
            isHousehold: meta?.isHousehold ?? false,
            attemptedName: meta?.attemptedName ?? null,
          });
          continue;
        }

        const { error: cleanupError } = await supabase
          .from('transactions')
          .delete()
          .eq('household_id', householdId)
          .eq('recurring_item_id', item.id)
          .gte('date', monthDate);

        if (cleanupError) {
          console.error('Save plan materialize cleanup error:', cleanupError);
          return NextResponse.json({ error: 'Failed to prepare recurring transactions' }, { status: 500 });
        }

        const dates = materializeRule(
          {
            cadence: item.cadence as 'monthly' | 'biweekly' | 'semimonthly' | 'weekly',
            anchorDate: item.anchor_date,
            secondDay: item.second_day,
          },
          currentMonth,
          12
        );
        for (const d of dates) {
          txnRows.push({
            household_id: householdId,
            // The item's own resolved member (null for household-level
            // income) — never the uploading user's id. Hardcoding memberId
            // here was the bug: it silently re-attributed every materialized
            // transaction to whoever ran onboarding, even when the recurring
            // item itself correctly resolved to a different member.
            member_id: item.member_id,
            category_id: item.category_id,
            amount: item.amount,
            description: item.description,
            date: d,
            type: item.type,
            source: transactionSource,
            recurring_item_id: item.id,
            account_id: item.account_id,
            file_import_id: fileImportId,
          });
        }
      }

      if (txnRows.length) {
        const { error: txError } = await supabase.from('transactions').insert(txnRows);
        if (txError) {
          console.error('Save plan materialize insert error:', txError);
          return NextResponse.json({ error: 'Failed to save recurring transactions' }, { status: 500 });
        }
      }
    }

    // ----- Insert category budgets (summed variable spending per category) -----
    const budgetRows = [...budgetByCat.entries()].map(([categoryId, amount]) => ({
      household_id: householdId,
      category_id: categoryId,
      month: monthDate,
      amount: Math.round(amount * 100) / 100,
      file_import_id: fileImportId,
    }));
    if (budgetRows.length) {
      await supabase.from('budgets').insert(budgetRows);
    }

    // ----- Sinking funds -----
    if (plan.sinkingFunds?.length) {
      await supabase.from('sinking_funds').insert(
        plan.sinkingFunds.map((f: { name: string; annualAmount: number; dueMonth: string }) => ({
          household_id: householdId,
          name: f.name,
          annual_amount: f.annualAmount,
          due_month: monthNameToNumber(f.dueMonth),
          file_import_id: fileImportId,
        }))
      );
    }

    // Goal accounts are handled above with cards, in the reuse/create pass —
    // a name match reuses the existing (possibly funded) goal account
    // instead of creating a duplicate savings account for it.

    // ----- Review -----
    await supabase.from('conversations').insert({
      household_id: householdId,
      user_id: user.id,
      type: 'onboarding',
      messages: [
        { role: 'assistant', type: 'top_recommendation', content: plan.topRecommendation, locale },
        { role: 'assistant', type: 'monthly_review', content: reviewText, locale },
      ],
    });

    await logEvent(supabase, householdId, user.id, 'completed_onboarding', { locale });
    return NextResponse.json({ saved: true, unmatchedMembers, needsPayDate, householdMembers: allMembers ?? [] });
  } catch (error) {
    console.error('Save plan error:', error);
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 });
  }
}
