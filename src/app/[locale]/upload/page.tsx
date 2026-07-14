'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';
import AnalyzingLoader from '@/components/onboarding/AnalyzingLoader';
import UploadEntry from '@/components/onboarding/UploadEntry';
import AccountStep from '@/components/onboarding/AccountStep';
import ManualForm from '@/components/onboarding/ManualForm';
import PlanDisplay from '@/components/onboarding/PlanDisplay';
import AnchorDateStep, { NeedsPayDateItem } from '@/components/onboarding/AnchorDateStep';
import MemberConfirmStep from '@/components/onboarding/MemberConfirmStep';
import { Plan, FormLine, IncomeFormLine } from '@/components/onboarding/types';
import { collectUnresolvedMemberNames } from '@/lib/incomeHelpers';
import { buildCalculatedFromFormLines } from '@/lib/planHelpers';
import { dropResolvedItems } from '@/lib/anchorDateHelpers';
import { runPlausibilityGuard, PlausibilityResult } from '@/lib/plausibilityGuard';
import { TemplateParseResult } from '@/lib/templateParser';
import { formatCAD } from '@/components/onboarding/types';

type Status = 'idle' | 'uploading' | 'analyzing' | 'error' | 'plan' | 'form' | 'accounts' | 'plausibility_check' | 'member_confirm' | 'anchor_dates';

export default function UploadPage() {
  const t = useTranslations('upload');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  // Which source produced the current plan — drives honest empty-states in
  // PlanDisplay (manual entry legitimately has no goals/sinking funds; a
  // template does or doesn't per the user's sheet).
  const [planSource, setPlanSource] = useState<'template' | 'calculated' | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [reviewStreaming, setReviewStreaming] = useState(false);

  // Manual form
  const [formIncome, setFormIncome] = useState<IncomeFormLine[]>([{ label: '', amount: '', frequency: 'monthly' }]);
  const [formExpenses, setFormExpenses] = useState<FormLine[]>([{ label: '', amount: '', frequency: 'monthly' }]);
  const [statedCombinedAnnual, setStatedCombinedAnnual] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Plausibility check
  const [plausibilityResult, setPlausibilityResult] = useState<Extract<PlausibilityResult, { ok: false }> | null>(null);
  const [skippedIncomeRows, setSkippedIncomeRows] = useState(0);
  const [skippedGoalDateRows, setSkippedGoalDateRows] = useState(0);
  // The calculated body built during submitForm (or the template planBody), held until plausibility is confirmed.
  const [pendingCalculated, setPendingCalculated] = useState<Record<string, unknown> | null>(null);

  // Member discovery — income Member names that don't resolve to an existing
  // household member or a household keyword. Resolved BEFORE plan
  // generation, so the plan is born with correct attribution rather than
  // patched after saving.
  const [pendingUnresolvedNames, setPendingUnresolvedNames] = useState<string[]>([]);
  const [pendingTemplateParsed, setPendingTemplateParsed] = useState<TemplateParseResult | null>(null);

  // Account step
  const [cardCount, setCardCount] = useState(1);
  const [cardNames, setCardNames] = useState<string[]>(['']);
  const [pendingPlanBody, setPendingPlanBody] = useState<Record<string, unknown> | null>(null);
  const [creatingAccounts, setCreatingAccounts] = useState(false);

  // Import provenance — which real file (if any) is behind this onboarding save.
  type FileMeta = { fileName: string; fileType: 'csv' | 'excel' } | null;
  const [fileMeta, setFileMeta] = useState<FileMeta>(null);

  // Plan save state
  type PlanSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
  const [planSaveStatus, setPlanSaveStatus] = useState<PlanSaveStatus>('idle');
  const [pendingSavePayload, setPendingSavePayload] = useState<{
    plan: Plan; reviewText: string; locale: string; cardNames: string[]; fileMeta: FileMeta;
  } | null>(null);
  const [confirmReplaceFlag, setConfirmReplaceFlag] = useState(false);
  type AccountPreserveReason = 'not_from_import' | 'has_transactions' | 'has_envelope_budget' | 'has_monthly_goal';
  const [replaceConfirmation, setReplaceConfirmation] = useState<{
    totalRecurring: number; provenancedRecurring: number; legacyRecurring: number;
    accountsToDelete: { id: string; name: string }[];
    accountsToPreserve: { id: string; name: string; reason: AccountPreserveReason }[];
    accountsToReuse: { id: string; name: string }[];
  } | null>(null);
  // Visible, never-silent fallbacks from the save — member names that didn't
  // match anyone in the household, and income rows still missing a real pay date.
  const [saveNotices, setSaveNotices] = useState<{
    unmatchedMembers: { label: string; attemptedMember: string }[];
    needsPayDate: NeedsPayDateItem[];
  } | null>(null);
  // Household members for the anchor step's attribution dropdown.
  const [householdMembers, setHouseholdMembers] = useState<{ id: string; name: string }[]>([]);
  // The server's actual reason a save failed — shown verbatim, never a generic dead end.
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  const localeOf = () => (typeof window !== 'undefined' && window.location.pathname.startsWith('/fr') ? 'fr' : 'en');

  const doSave = useCallback(async (
    payload: { plan: Plan; reviewText: string; locale: string; cardNames: string[]; fileMeta: FileMeta },
    confirmReplace: boolean,
  ) => {
    setPlanSaveStatus('saving');
    setSaveErrorMessage(null);
    try {
      const res = await fetch('/api/save-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, confirmReplace }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      if (data?.needsConfirmation) {
        setReplaceConfirmation(data.counts);
        setPlanSaveStatus('idle');
        return;
      }
      setReplaceConfirmation(null);
      const needsPayDate: NeedsPayDateItem[] = data?.needsPayDate ?? [];
      setSaveNotices({
        unmatchedMembers: data?.unmatchedMembers ?? [],
        needsPayDate,
      });
      setHouseholdMembers(data?.householdMembers ?? []);
      setPlanSaveStatus('saved');
      if (needsPayDate.length > 0) {
        setStatus('anchor_dates');
      }
    } catch (err) {
      console.error('Plan save error:', err);
      setSaveErrorMessage(err instanceof Error ? err.message : String(err));
      setPlanSaveStatus('error');
    }
  }, []);

  /**
   * Generating the narrative review and persisting the plan are independent
   * concerns — a hiccup in the former (network blip, AI error, an
   * interrupted stream) must never silently skip the latter. This used to
   * call doSave() from inside the try block, right after the streaming
   * loop — so any error thrown by the fetch or the loop above it skipped
   * straight to the catch and doSave() was never reached at all, with no
   * distinct save error ever surfacing (only reviewText's soft fallback
   * copy). doSave is now called unconditionally after the try/catch/finally,
   * with a placeholder body when generation failed, so the plan always gets
   * a real save attempt — and a real saved/error outcome — regardless of
   * whether the prose came through.
   */
  const streamReview = useCallback(async (
    planData: Plan,
    planBody: Record<string, unknown>,
    resolvedCardNames: string[],
  ) => {
    setReviewStreaming(true);
    setReviewText('');
    const locale = localeOf();
    let fullText = '';
    try {
      const res = await fetch('/api/review-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planData, analysis: planBody, locale }),
      });
      if (!res.ok || !res.body) throw new Error('Review stream failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setReviewText((prev) => prev + chunk);
      }
    } catch (err) {
      console.error('Review streaming error:', err);
      fullText = '';
      setReviewText(t('plan.reviewError'));
    } finally {
      setReviewStreaming(false);
    }

    const savePayload = {
      plan: planData,
      reviewText: fullText || t('plan.reviewUnavailableForSave'),
      locale, cardNames: resolvedCardNames, fileMeta,
    };
    setPendingSavePayload(savePayload);
    setConfirmReplaceFlag(false);
    await doSave(savePayload, false);
  }, [t, doSave, fileMeta]);

  const retrySave = useCallback(async () => {
    if (!pendingSavePayload) return;
    await doSave(pendingSavePayload, confirmReplaceFlag);
  }, [pendingSavePayload, confirmReplaceFlag, doSave]);

  const confirmReplaceAndSave = useCallback(async () => {
    if (!pendingSavePayload) return;
    setConfirmReplaceFlag(true);
    await doSave(pendingSavePayload, true);
  }, [pendingSavePayload, doSave]);

  const cancelReplace = useCallback(() => {
    setReplaceConfirmation(null);
  }, []);

  const buildPlan = useCallback(async (planBody: Record<string, unknown>, resolvedCardNames: string[]) => {
    setStatus('analyzing');
    const planRes = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...planBody, locale: localeOf() }),
    });
    if (!planRes.ok) {
      const err = await planRes.json();
      throw new Error(err.error || 'Plan generation failed');
    }
    const planData = await planRes.json();
    setPlan(planData.plan);
    setPlanSource(planBody.source === 'template' ? 'template' : 'calculated');
    // Visible the instant the plan screen appears — there must never be a
    // silent window where the plan looks fully done but nothing has
    // persisted yet. Previously this stayed 'idle' (which renders no banner
    // at all) for the entire multi-second review-streaming duration, only
    // flipping once doSave() ran at the end of streamReview — invisible if
    // that never happened.
    setPlanSaveStatus('saving');
    setStatus('plan');
    streamReview(planData.plan, planBody, resolvedCardNames);
  }, [streamReview]);

  /**
   * Resumes onboarding from a parsed template once member discovery (if any
   * was needed) is settled — the plausibility check / accounts step is
   * exactly what ran before this refactor, just reachable from two call
   * sites now (no unresolved names, or after MemberConfirmStep finishes).
   */
  const proceedWithParsedTemplate = useCallback((parsed: TemplateParseResult) => {
    const allExpenseLines = [
      ...(parsed.fixedExpenses?.lines ?? []),
      ...(parsed.variableExpenses?.lines ?? []),
    ];
    const guard = runPlausibilityGuard({
      computedMonthlyIncome: parsed.income.total,
      netCashFlow: parsed.summary.netCashFlow,
      expenseLines: allExpenseLines,
      statedCombinedAnnual: null,
    });
    const skipped = parsed.incomeSkippedRows ?? 0;
    const skippedGoalDates = parsed.goalDateFlaggedRows ?? 0;
    const planBody: Record<string, unknown> = { source: 'template', parsed };

    if (!guard.ok || skipped > 0 || skippedGoalDates > 0) {
      setPendingCalculated(planBody);
      setSkippedIncomeRows(skipped);
      setSkippedGoalDateRows(skippedGoalDates);
      if (!guard.ok) setPlausibilityResult(guard);
      setStatus('plausibility_check');
      return;
    }

    setPendingPlanBody(planBody);
    setStatus('accounts');
  }, []);

  const memberConfirmDone = useCallback(() => {
    if (!pendingTemplateParsed) return;
    proceedWithParsedTemplate(pendingTemplateParsed);
  }, [pendingTemplateParsed, proceedWithParsedTemplate]);

  const handleFile = useCallback(async (file: File) => {
    setStatus('uploading');
    setError('');
    const detectedFileMeta: FileMeta = { fileName: file.name, fileType: 'excel' };
    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || 'Upload failed');
      }
      const uploadData = await uploadRes.json();

      if (uploadData.source === 'template_mismatch') {
        // Exact-match-or-refuse: either reason names the fix (get/re-download
        // the template) — never a partial parse of the wrong layout.
        setError(uploadData.reason === 'outdated_template' ? t('mismatch.outdatedTemplate') : t('mismatch.wrongFile'));
        setStatus('error');
        return;
      }

      setFileMeta(detectedFileMeta);

      const parsed = uploadData.parsed as TemplateParseResult;

      // Member discovery — before plan generation, so the plan is born with
      // correct attribution instead of being patched after saving.
      const membersRes = await fetch('/api/household/members');
      const membersData = membersRes.ok ? await membersRes.json() : { members: [] };
      const existingMembers = (membersData.members ?? []) as { id: string; name: string }[];
      const unresolvedNames = collectUnresolvedMemberNames(
        parsed.income.lines.map((l) => l.member),
        existingMembers
      );

      if (unresolvedNames.length > 0) {
        setPendingTemplateParsed(parsed);
        setPendingUnresolvedNames(unresolvedNames);
        setStatus('member_confirm');
        return;
      }

      proceedWithParsedTemplate(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    }
  }, [t, proceedWithParsedTemplate]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  /**
   * Build the calculated body from the manual form. Carries rawAmount +
   * frequency through for both income and expenses, same as a template
   * upload — amount is still the monthly equivalent (what the AI and the
   * budget totals use), but save-plan reads rawAmount/frequency to give
   * non-monthly lines a real cadence and the same anchor-step treatment a
   * template row gets, instead of collapsing everyone to a monthly lump.
   * Manual and template must produce indistinguishable ledgers.
   *
   * The actual computation is buildCalculatedFromFormLines() in
   * planHelpers.ts — extracted to a pure function so the plausibility-guard
   * wiring below can be tested without a .tsx test (this codebase's
   * convention: no component tests, UI decision logic lives in testable .ts).
   */
  const buildCalculated = useCallback(
    () => buildCalculatedFromFormLines(formIncome, formExpenses),
    [formIncome, formExpenses]
  );

  const submitForm = useCallback(async () => {
    setFormSubmitting(true);
    setError('');
    setFileMeta(null); // manual form — numbers are typed, not extracted from any file
    try {
      const calculated = buildCalculated();

      const stated = parseFloat(statedCombinedAnnual) || null;
      const guard = runPlausibilityGuard({
        computedMonthlyIncome: calculated.income.total,
        netCashFlow: calculated.netCashFlow,
        expenseLines: calculated.expenses.lines,
        statedCombinedAnnual: stated,
      });

      if (!guard.ok) {
        // Store what we built and show the confirmation step before proceeding.
        setPendingCalculated({ source: 'calculated', calculated });
        setPlausibilityResult(guard);
        setStatus('plausibility_check');
        return;
      }

      setPendingPlanBody({ source: 'calculated', calculated });
      setStatus('accounts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    } finally {
      setFormSubmitting(false);
    }
  }, [buildCalculated, statedCombinedAnnual]);

  /** User confirmed the plausibility warning — proceed with original numbers. */
  const confirmPlausibility = useCallback(() => {
    if (!pendingCalculated) return;
    setPendingPlanBody(pendingCalculated);
    setPlausibilityResult(null);
    setPendingCalculated(null);
    setSkippedIncomeRows(0);
    setSkippedGoalDateRows(0);
    setStatus('accounts');
  }, [pendingCalculated]);

  /** User wants to go back and fix income after seeing the plausibility warning. */
  const rejectPlausibility = useCallback(() => {
    setPlausibilityResult(null);
    setPendingCalculated(null);
    setSkippedIncomeRows(0);
    setSkippedGoalDateRows(0);
    // Template uploads go back to idle (re-upload); manual form goes back to form.
    setStatus(pendingCalculated && 'parsed' in (pendingCalculated as Record<string, unknown>) ? 'idle' : 'form');
  }, [pendingCalculated]);

  const confirmAccounts = useCallback(async () => {
    if (!pendingPlanBody) return;
    setCreatingAccounts(true);
    setError('');
    try {
      const resolvedCardNames = Array.from({ length: cardCount }, (_, i) =>
        (cardNames[i] || `Card ${i + 1}`).trim()
      );
      await buildPlan(pendingPlanBody, resolvedCardNames);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    } finally {
      setCreatingAccounts(false);
    }
  }, [pendingPlanBody, cardCount, cardNames, buildPlan]);

  const startOver = useCallback(() => {
    setStatus('idle');
    setPlan(null);
    setReviewText('');
    setPlanSaveStatus('idle');
    setPendingSavePayload(null);
    setFileMeta(null);
    setConfirmReplaceFlag(false);
    setReplaceConfirmation(null);
    setSaveNotices(null);
    setPendingUnresolvedNames([]);
    setPendingTemplateParsed(null);
  }, []);

  // The plan-review screen (and everything reached only from it, like the
  // post-anchor-step return) is the product's proudest screen — it must not
  // keep wearing the generic "upload your data" entry header once the plan
  // actually exists.
  const isPlanState = status === 'plan' || status === 'anchor_dates';

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className={`text-3xl md:text-4xl font-bold text-center ${isPlanState ? 'mb-10' : 'mb-4'}`} style={{ color: '#0F2044' }}>
          {isPlanState ? t('planTitle') : t('title')}
        </h1>
        {!isPlanState && (
          <p className="text-lg text-center mb-12" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
        )}

        {status === 'idle' && (
          <UploadEntry
            dragOver={dragOver} setDragOver={setDragOver}
            onDrop={onDrop} onFileSelect={onFileSelect}
            onManual={() => { setFileMeta(null); setStatus('form'); }}
          />
        )}

        {status === 'uploading' && (
          <div className="rounded-2xl bg-white p-16 text-center" style={{ border: '1px solid #E5E7EB' }}>
            <div className="text-4xl mb-4 animate-pulse">📊</div>
            <p className="text-lg font-medium" style={{ color: '#0F2044' }}>{t('uploading')}</p>
          </div>
        )}

        {status === 'accounts' && (
          <AccountStep
            cardCount={cardCount} setCardCount={setCardCount}
            cardNames={cardNames} setCardNames={setCardNames}
            onConfirm={confirmAccounts} creating={creatingAccounts}
          />
        )}

        {status === 'analyzing' && <AnalyzingLoader t={t} />}

        {status === 'form' && (
          <ManualForm
            income={formIncome} setIncome={setFormIncome}
            expenses={formExpenses} setExpenses={setFormExpenses}
            statedCombinedAnnual={statedCombinedAnnual}
            setStatedCombinedAnnual={setStatedCombinedAnnual}
            submitting={formSubmitting}
            onSubmit={submitForm}
            onCancel={() => setStatus('idle')}
          />
        )}

        {status === 'member_confirm' && (
          <MemberConfirmStep
            names={pendingUnresolvedNames}
            onDone={memberConfirmDone}
          />
        )}

        {/* Plausibility check / skipped-row warning step */}
        {status === 'plausibility_check' && (plausibilityResult || skippedIncomeRows > 0 || skippedGoalDateRows > 0) && (
          <PlausibilityCheck
            result={plausibilityResult}
            skippedIncomeRows={skippedIncomeRows}
            skippedGoalDateRows={skippedGoalDateRows}
            onConfirm={confirmPlausibility}
            onCorrect={rejectPlausibility}
            t={t}
          />
        )}

        {status === 'error' && (
          <div className="rounded-2xl p-8 text-center" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <p className="text-red-600 mb-6">{error}</p>
            <button onClick={() => setStatus('idle')}
              className="px-6 py-2 rounded-full font-medium cursor-pointer"
              style={{ background: '#0F2044', color: 'white' }}>
              {t('tryAgain')}
            </button>
          </div>
        )}

        {status === 'anchor_dates' && saveNotices && (
          <AnchorDateStep
            items={saveNotices.needsPayDate}
            members={householdMembers}
            onDone={(resolvedIds) => {
              // Drop the items that actually got a real date from the
              // "awaiting dates" count — leaving the stale pre-anchor-step
              // count in place is exactly what made the notice fire on the
              // plan review even after every date was set. Anything skipped
              // stays counted, honestly.
              setSaveNotices((prev) => prev && {
                ...prev,
                needsPayDate: dropResolvedItems(prev.needsPayDate, resolvedIds),
              });
              setStatus('plan');
            }}
          />
        )}

        {status === 'plan' && plan && (
          <PlanDisplay
            plan={plan}
            planSource={planSource}
            reviewText={reviewText}
            reviewStreaming={reviewStreaming}
            planSaveStatus={planSaveStatus}
            onRetrySave={retrySave}
            onStartOver={startOver}
            replaceConfirmation={replaceConfirmation}
            onConfirmReplace={confirmReplaceAndSave}
            onCancelReplace={cancelReplace}
            saveNotices={saveNotices}
            saveErrorMessage={saveErrorMessage}
            locale={localeOf()}
          />
        )}
      </div>
    </main>
  );
}

// ── Plausibility Check Step ────────────────────────────────────────────────

function PlausibilityCheck({
  result,
  skippedIncomeRows,
  skippedGoalDateRows,
  onConfirm,
  onCorrect,
  t,
}: {
  result: Extract<PlausibilityResult, { ok: false }> | null;
  skippedIncomeRows: number;
  skippedGoalDateRows: number;
  onConfirm: () => void;
  onCorrect: () => void;
  t: ReturnType<typeof useTranslations<'upload'>>;
}) {
  return (
    <div className="rounded-2xl p-8 space-y-6" style={{ background: '#FFFBEB', border: '1.5px solid #F5A623' }}>
      <div>
        <p className="text-lg font-bold mb-2" style={{ color: '#0F2044' }}>
          {t('plausibility.title')}
        </p>
        <div className="space-y-3">
          {skippedIncomeRows > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'white', border: '1px solid #FDE68A' }}>
              <p style={{ color: '#374151' }}>
                {t('plausibility.skippedIncomeRows', { count: skippedIncomeRows })}
              </p>
            </div>
          )}
          {skippedGoalDateRows > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'white', border: '1px solid #FDE68A' }}>
              <p style={{ color: '#374151' }}>
                {t('plausibility.skippedGoalDateRows', { count: skippedGoalDateRows })}
              </p>
            </div>
          )}
          {result?.issues.map((issue, i) => (
            <div key={i} className="rounded-xl p-4" style={{ background: 'white', border: '1px solid #FDE68A' }}>
              {issue.prong === 'income_vs_stated' && (
                <p style={{ color: '#374151' }}>
                  {t('plausibility.incomeVsStated', {
                    stated: formatCAD(issue.statedAnnual),
                    computed: formatCAD(issue.computedAnnual),
                  })}
                </p>
              )}
              {issue.prong === 'deficit_not_financed' && (
                <p style={{ color: '#374151' }}>
                  {t('plausibility.deficitNotFinanced', {
                    deficit: formatCAD(issue.monthlyDeficit),
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onCorrect}
          className="flex-1 px-6 py-3 rounded-full font-semibold cursor-pointer hover:opacity-90 transition-all"
          style={{ background: '#0F2044', color: 'white' }}
        >
          {t('plausibility.correct')}
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 px-6 py-3 rounded-full font-semibold cursor-pointer hover:opacity-90 transition-all"
          style={{ border: '2px solid #0F2044', color: '#0F2044' }}
        >
          {t('plausibility.confirm')}
        </button>
      </div>
    </div>
  );
}
