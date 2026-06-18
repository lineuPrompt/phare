'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';
import AnalyzingLoader from '@/components/onboarding/AnalyzingLoader';
import ModeSelector from '@/components/onboarding/ModeSelector';
import AccountStep from '@/components/onboarding/AccountStep';
import ManualForm from '@/components/onboarding/ManualForm';
import PlanDisplay from '@/components/onboarding/PlanDisplay';
import { Plan, FormLine } from '@/components/onboarding/types';

type Status = 'idle' | 'uploading' | 'analyzing' | 'error' | 'plan' | 'form' | 'accounts';

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
  const [formIncome, setFormIncome] = useState<FormLine[]>([{ label: '', amount: '' }]);
  const [formExpenses, setFormExpenses] = useState<FormLine[]>([{ label: '', amount: '' }]);
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Account step
  const [cardCount, setCardCount] = useState(1);
  const [cardNames, setCardNames] = useState<string[]>(['']);
  const [pendingPlanBody, setPendingPlanBody] = useState<Record<string, unknown> | null>(null);
  const [creatingAccounts, setCreatingAccounts] = useState(false);

  // Plan save state
  type PlanSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
  const [planSaveStatus, setPlanSaveStatus] = useState<PlanSaveStatus>('idle');
  const [pendingSavePayload, setPendingSavePayload] = useState<{ plan: Plan; reviewText: string; locale: string } | null>(null);

  const localeOf = () => (typeof window !== 'undefined' && window.location.pathname.startsWith('/fr') ? 'fr' : 'en');

  const doSave = useCallback(async (payload: { plan: Plan; reviewText: string; locale: string }) => {
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

  const streamReview = useCallback(async (planData: Plan, planBody: Record<string, unknown>) => {
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

      const savePayload = { plan: planData, reviewText: fullText, locale };
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

  const buildPlan = useCallback(async (planBody: Record<string, unknown>) => {
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
    streamReview(planData.plan, planBody);
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

      const planBody =
        uploadData.source === 'template'
          ? { source: 'template', parsed: uploadData.parsed }
          : { source: 'calculated', calculated: uploadData.calculated };

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

  const submitForm = useCallback(async () => {
    setFormSubmitting(true);
    setError('');
    try {
      const income = formIncome.filter((l) => l.label.trim() && l.amount)
        .map((l) => ({ label: l.label.trim(), amount: parseFloat(l.amount) }));
      const expenses = formExpenses.filter((l) => l.label.trim() && l.amount)
        .map((l) => ({ label: l.label.trim(), amount: parseFloat(l.amount) }));

      const incomeTotal = income.reduce((s, l) => s + l.amount, 0);
      const expenseTotal = expenses.reduce((s, l) => s + l.amount, 0);

      const calculated = {
        income: { detected: income.length > 0, lines: income, total: incomeTotal },
        expenses: { detected: expenses.length > 0, lines: expenses, total: expenseTotal },
        netCashFlow: incomeTotal - expenseTotal,
        excludedLines: [],
        confidence: 'high',
      };

      setPendingPlanBody({ source: 'calculated', calculated });
      setStatus('accounts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    } finally {
      setFormSubmitting(false);
    }
  }, [formIncome, formExpenses]);

const confirmAccounts = useCallback(async () => {
    if (!pendingPlanBody) return;
    setCreatingAccounts(true);
    setError('');
    try {
      // Clear existing card accounts first (re-onboarding replaces them; chequing is kept)
      const existing = await fetch('/api/accounts').then((r) => r.json()).catch(() => null);
      if (existing?.accounts) {
        for (const acct of existing.accounts) {
          if (acct.type !== 'chequing') {
            await fetch(`/api/accounts/${acct.id}`, { method: 'DELETE' });
          }
        }
      }

      // Create the new card accounts
      for (let i = 0; i < cardCount; i++) {
        const name = (cardNames[i] || `Card ${i + 1}`).trim();
        await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type: 'credit_card' }),
        });
      }
      await buildPlan(pendingPlanBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    } finally {
      setCreatingAccounts(false);
    }
  }, [pendingPlanBody, cardCount, cardNames, buildPlan]);

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
            submitting={formSubmitting}
            onSubmit={submitForm}
            onCancel={() => setStatus('idle')}
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
            onStartOver={() => { setStatus('idle'); setPlan(null); setReviewText(''); setPlanSaveStatus('idle'); setPendingSavePayload(null); }}
          />
        )}
      </div>
    </main>
  );
}