'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';
import AnalyzingLoader from '@/components/onboarding/AnalyzingLoader';
import ModeSelector from '@/components/onboarding/ModeSelector';
import AccountStep from '@/components/onboarding/AccountStep';
import ManualForm from '@/components/onboarding/ManualForm';
import PlanDisplay from '@/components/onboarding/PlanDisplay';
import { Plan, FormLine, IncomeFormLine } from '@/components/onboarding/types';
import { monthlyIncomeEquivalent } from '@/lib/incomeHelpers';
import { runPlausibilityGuard, PlausibilityResult } from '@/lib/plausibilityGuard';
import { TemplateParseResult } from '@/lib/templateParser';
import { formatCAD } from '@/components/onboarding/types';

type Status = 'idle' | 'uploading' | 'analyzing' | 'error' | 'plan' | 'form' | 'accounts' | 'plausibility_check';

export default function UploadPage() {
  const t = useTranslations('upload');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<'template' | 'own'>('own');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [reviewStreaming, setReviewStreaming] = useState(false);

  // Manual form
  const [formIncome, setFormIncome] = useState<IncomeFormLine[]>([{ label: '', amount: '', frequency: 'monthly' }]);
  const [formExpenses, setFormExpenses] = useState<FormLine[]>([{ label: '', amount: '' }]);
  const [statedCombinedAnnual, setStatedCombinedAnnual] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Plausibility check
  const [plausibilityResult, setPlausibilityResult] = useState<Extract<PlausibilityResult, { ok: false }> | null>(null);
  const [skippedIncomeRows, setSkippedIncomeRows] = useState(0);
  // The calculated body built during submitForm (or the template planBody), held until plausibility is confirmed.
  const [pendingCalculated, setPendingCalculated] = useState<Record<string, unknown> | null>(null);

  // Account step
  const [cardCount, setCardCount] = useState(1);
  const [cardNames, setCardNames] = useState<string[]>(['']);
  const [pendingPlanBody, setPendingPlanBody] = useState<Record<string, unknown> | null>(null);
  const [creatingAccounts, setCreatingAccounts] = useState(false);

  // Plan save state
  type PlanSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
  const [planSaveStatus, setPlanSaveStatus] = useState<PlanSaveStatus>('idle');
  const [pendingSavePayload, setPendingSavePayload] = useState<{
    plan: Plan; reviewText: string; locale: string; cardNames: string[];
  } | null>(null);

  const localeOf = () => (typeof window !== 'undefined' && window.location.pathname.startsWith('/fr') ? 'fr' : 'en');

  const doSave = useCallback(async (payload: {
    plan: Plan; reviewText: string; locale: string; cardNames: string[];
  }) => {
    setPlanSaveStatus('saving');
    try {
      const res = await fetch('/api/save-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Save failed');
      setPlanSaveStatus('saved');
    } catch (err) {
      console.error('Plan save error:', err);
      setPlanSaveStatus('error');
    }
  }, []);

  const streamReview = useCallback(async (
    planData: Plan,
    planBody: Record<string, unknown>,
    resolvedCardNames: string[],
  ) => {
    setReviewStreaming(true);
    setReviewText('');
    setPlanSaveStatus('idle');
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

      const savePayload = { plan: planData, reviewText: fullText, locale, cardNames: resolvedCardNames };
      setPendingSavePayload(savePayload);
      await doSave(savePayload);
    } catch (err) {
      console.error('Review streaming error:', err);
      setReviewText(t('plan.reviewError'));
    } finally {
      setReviewStreaming(false);
    }
  }, [t, doSave]);

  const retrySave = useCallback(async () => {
    if (!pendingSavePayload) return;
    await doSave(pendingSavePayload);
  }, [pendingSavePayload, doSave]);

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
    setStatus('plan');
    streamReview(planData.plan, planBody, resolvedCardNames);
  }, [streamReview]);

  const handleFile = useCallback(async (file: File) => {
    setStatus('uploading');
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);

      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || 'Upload failed');
      }
      const uploadData = await uploadRes.json();

      if (uploadData.source === 'template_mismatch') {
        setError(uploadData.message || 'This does not look like the Phare template.');
        setStatus('error');
        return;
      }
      if (uploadData.source === 'needs_form') {
        setStatus('form');
        return;
      }

      if (uploadData.source === 'template') {
        const parsed = uploadData.parsed as TemplateParseResult;
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
        const planBody: Record<string, unknown> = { source: 'template', parsed };

        if (!guard.ok || skipped > 0) {
          setPendingCalculated(planBody);
          setSkippedIncomeRows(skipped);
          if (!guard.ok) setPlausibilityResult(guard);
          setStatus('plausibility_check');
          return;
        }

        setPendingPlanBody(planBody);
        setStatus('accounts');
        return;
      }

      const planBody = { source: 'calculated', calculated: uploadData.calculated };
      setPendingPlanBody(planBody);
      setStatus('accounts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    }
  }, [mode]);

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
   * Build the calculated body from the manual form — applying frequency conversion
   * so the AI and the plan receive real monthly equivalents, never raw paycheque amounts.
   */
  const buildCalculated = useCallback(() => {
    const incomeLines = formIncome
      .filter((l) => l.label.trim() && l.amount)
      .map((l) => ({
        label: l.label.trim(),
        amount: monthlyIncomeEquivalent(parseFloat(l.amount), l.frequency),
      }));

    const expenseLines = formExpenses
      .filter((l) => l.label.trim() && l.amount)
      .map((l) => ({ label: l.label.trim(), amount: parseFloat(l.amount) }));

    const incomeTotal = incomeLines.reduce((s, l) => s + l.amount, 0);
    const expenseTotal = expenseLines.reduce((s, l) => s + l.amount, 0);

    return {
      income: { detected: incomeLines.length > 0, lines: incomeLines, total: Math.round(incomeTotal * 100) / 100 },
      expenses: { detected: expenseLines.length > 0, lines: expenseLines, total: Math.round(expenseTotal * 100) / 100 },
      netCashFlow: Math.round((incomeTotal - expenseTotal) * 100) / 100,
      excludedLines: [],
      confidence: 'high',
    };
  }, [formIncome, formExpenses]);

  const submitForm = useCallback(async () => {
    setFormSubmitting(true);
    setError('');
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
    setStatus('accounts');
  }, [pendingCalculated]);

  /** User wants to go back and fix income after seeing the plausibility warning. */
  const rejectPlausibility = useCallback(() => {
    setPlausibilityResult(null);
    setPendingCalculated(null);
    setSkippedIncomeRows(0);
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
  }, []);

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl md:text-4xl font-bold mb-4 text-center" style={{ color: '#0F2044' }}>
          {t('title')}
        </h1>
        <p className="text-lg text-center mb-12" style={{ color: '#6B7280' }}>{t('subtitle')}</p>

        {status === 'idle' && (
          <ModeSelector
            mode={mode} setMode={setMode}
            dragOver={dragOver} setDragOver={setDragOver}
            onDrop={onDrop} onFileSelect={onFileSelect}
            onManual={() => setStatus('form')}
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

        {/* Plausibility check / skipped-row warning step */}
        {status === 'plausibility_check' && (plausibilityResult || skippedIncomeRows > 0) && (
          <PlausibilityCheck
            result={plausibilityResult}
            skippedIncomeRows={skippedIncomeRows}
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

        {status === 'plan' && plan && (
          <PlanDisplay
            plan={plan}
            reviewText={reviewText}
            reviewStreaming={reviewStreaming}
            planSaveStatus={planSaveStatus}
            onRetrySave={retrySave}
            onStartOver={startOver}
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
  onConfirm,
  onCorrect,
  t,
}: {
  result: Extract<PlausibilityResult, { ok: false }> | null;
  skippedIncomeRows: number;
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
