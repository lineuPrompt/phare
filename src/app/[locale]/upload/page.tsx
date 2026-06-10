'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';

type Plan = {
  monthlyBudget: {
    totalIncome: number;
    totalExpenses: number;
    totalSavings: number;
    categories: {
      name: string;
      budgeted: number;
      type: string;
    }[];
  };
  sinkingFunds: {
    name: string;
    annualAmount: number;
    monthlyProvision: number;
    dueMonth: string;
  }[];
  debtPayoff: {
    description: string;
    targetDate: string;
    monthlyPayment: number;
  } | null;
  goals: {
    name: string;
    targetAmount: number;
    monthlyContribution: number;
    onTrack: boolean;
    estimatedDate: string;
  }[];
  topRecommendation: string;
  topRecommendation_fr: string;
};

function AnalyzingLoader({ t }: { t: (key: string) => string }) {
  const [msgIndex, setMsgIndex] = useState(0);
  const messages = [
    { emoji: '🔍', text: t('analyzingSteps.reading') },
    { emoji: '📊', text: t('analyzingSteps.categories') },
    { emoji: '💡', text: t('analyzingSteps.patterns') },
    { emoji: '🏦', text: t('analyzingSteps.tax') },
    { emoji: '📋', text: t('analyzingSteps.building') },
    { emoji: '🎯', text: t('analyzingSteps.savings') },
    { emoji: '✨', text: t('analyzingSteps.almost') },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % messages.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-2xl bg-white p-16 text-center" style={{ border: '1px solid #E5E7EB' }}>
      <div className="text-4xl mb-4 animate-pulse">{messages[msgIndex].emoji}</div>
      <p className="text-lg font-medium transition-all" style={{ color: '#0F2044' }}>
        {messages[msgIndex].text}
      </p>
    </div>
  );
}

type FormLine = { label: string; amount: string };

export default function UploadPage() {
  const t = useTranslations('upload');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'error' | 'plan' | 'form'>('idle');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<'template' | 'own'>('own');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [reviewStreaming, setReviewStreaming] = useState(false);

  // Manual form state (fallback when calculator can't parse)
  const [formIncome, setFormIncome] = useState<FormLine[]>([{ label: '', amount: '' }]);
  const [formExpenses, setFormExpenses] = useState<FormLine[]>([{ label: '', amount: '' }]);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const streamReview = useCallback(async (planData: Plan, planBody: Record<string, unknown>) => {
    setReviewStreaming(true);
    setReviewText('');
    try {
      const locale = window.location.pathname.startsWith('/fr') ? 'fr' : 'en';
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
        setReviewText((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      console.error('Review streaming error:', err);
      setReviewText(t('plan.reviewError'));
    } finally {
      setReviewStreaming(false);
    }
  }, [t]);

  const buildPlan = useCallback(async (planBody: Record<string, unknown>) => {
    setStatus('analyzing');
    const planRes = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...planBody, locale: window.location.pathname.startsWith('/fr') ? 'fr' : 'en' }),
    });
    if (!planRes.ok) {
      const err = await planRes.json();
      throw new Error(err.error || 'Plan generation failed');
    }
    const planData = await planRes.json();
    setPlan(planData.plan);
    setStatus('plan');
    // Plan numbers are on screen instantly; now stream the review live
    streamReview(planData.plan, planBody);
  }, [streamReview]);

  const handleFile = useCallback(async (file: File) => {
    setStatus('uploading');
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

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

      await buildPlan(planBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    }
  }, [mode, buildPlan]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);

  const submitForm = useCallback(async () => {
    setFormSubmitting(true);
    setError('');
    try {
      const income = formIncome
        .filter((l) => l.label.trim() && l.amount)
        .map((l) => ({ label: l.label.trim(), amount: parseFloat(l.amount) }));
      const expenses = formExpenses
        .filter((l) => l.label.trim() && l.amount)
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

      await buildPlan({ source: 'calculated', calculated });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    } finally {
      setFormSubmitting(false);
    }
  }, [formIncome, formExpenses, buildPlan]);

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl md:text-4xl font-bold mb-4 text-center" style={{ color: '#0F2044' }}>
          {t('title')}
        </h1>
        <p className="text-lg text-center mb-12" style={{ color: '#6B7280' }}>
          {t('subtitle')}
        </p>

        {/* Idle */}
        {status === 'idle' && (
          <div className="space-y-6">
            {/* Mode selector */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setMode('own')}
                className="flex-1 rounded-xl p-4 text-left transition-all cursor-pointer"
                style={{
                  border: mode === 'own' ? '2px solid #2ABFBF' : '1.5px solid #D1D5DB',
                  background: mode === 'own' ? '#F0FDFD' : 'white',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                    style={{ border: `2px solid ${mode === 'own' ? '#2ABFBF' : '#D1D5DB'}` }}
                  >
                    {mode === 'own' && <span className="w-2 h-2 rounded-full" style={{ background: '#2ABFBF' }} />}
                  </span>
                  <span className="font-semibold" style={{ color: '#0F2044' }}>{t('mode.own')}</span>
                </div>
                <p className="text-sm ml-6" style={{ color: '#6B7280' }}>{t('mode.ownDesc')}</p>
              </button>

              <button
                onClick={() => setMode('template')}
                className="flex-1 rounded-xl p-4 text-left transition-all cursor-pointer"
                style={{
                  border: mode === 'template' ? '2px solid #2ABFBF' : '1.5px solid #D1D5DB',
                  background: mode === 'template' ? '#F0FDFD' : 'white',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                    style={{ border: `2px solid ${mode === 'template' ? '#2ABFBF' : '#D1D5DB'}` }}
                  >
                    {mode === 'template' && <span className="w-2 h-2 rounded-full" style={{ background: '#2ABFBF' }} />}
                  </span>
                  <span className="font-semibold" style={{ color: '#0F2044' }}>{t('mode.template')}</span>
                </div>
                <p className="text-sm ml-6" style={{ color: '#6B7280' }}>{t('mode.templateDesc')}</p>
              </button>
            </div>

            {/* Upload zone */}
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              className="rounded-2xl p-16 text-center cursor-pointer transition-all"
              style={{
                border: `2px dashed ${dragOver ? '#2ABFBF' : '#D1D5DB'}`,
                background: dragOver ? '#F0FDFD' : 'white',
              }}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <div className="text-5xl mb-4">📄</div>
              <p className="text-lg font-medium mb-2" style={{ color: '#0F2044' }}>
                {t('dropzone')}
              </p>
              <p className="text-sm" style={{ color: '#6B7280' }}>
                {t('formats')}
              </p>
              <input
                id="file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={onFileSelect}
                className="hidden"
              />
            </div>

            {/* Template download — only relevant in template mode */}
            {mode === 'template' && (
              <div
                className="rounded-2xl p-8 text-center"
                style={{ background: '#F0FDFD', border: '1px solid #D1FAE5' }}
              >
                <div className="text-4xl mb-4">📝</div>
                <p className="text-lg font-medium mb-2" style={{ color: '#0F2044' }}>
                  {t('noFile.title')}
                </p>
                <p className="text-sm mb-4" style={{ color: '#6B7280' }}>
                  {t('noFile.description')}
                </p>
                <a
                  href="/phare_template.xlsx"
                  download
                  className="inline-block px-6 py-2.5 rounded-full font-medium cursor-pointer transition-all hover:opacity-90"
                  style={{ background: '#2ABFBF', color: '#0F2044' }}
                >
                  {t('noFile.cta')}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Uploading */}
        {status === 'uploading' && (
          <div className="rounded-2xl bg-white p-16 text-center" style={{ border: '1px solid #E5E7EB' }}>
            <div className="text-4xl mb-4 animate-pulse">📊</div>
            <p className="text-lg font-medium" style={{ color: '#0F2044' }}>{t('uploading')}</p>
          </div>
        )}

        {/* Analyzing */}
        {status === 'analyzing' && <AnalyzingLoader t={t} />}

        {/* Manual form fallback */}
        {status === 'form' && (
          <div className="space-y-8">
            <div className="rounded-2xl p-6" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <p className="font-medium mb-1" style={{ color: '#0F2044' }}>{t('form.title')}</p>
              <p className="text-sm" style={{ color: '#6B7280' }}>{t('form.subtitle')}</p>
            </div>

            {/* Income */}
            <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
              <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('form.income')}</h3>
              <div className="space-y-3">
                {formIncome.map((line, i) => (
                  <div key={i} className="flex gap-3">
                    <input
                      type="text"
                      value={line.label}
                      onChange={(e) => setFormIncome((prev) => prev.map((l, j) => j === i ? { ...l, label: e.target.value } : l))}
                      placeholder={t('form.sourcePlaceholder')}
                      className="flex-1 px-4 py-2.5 rounded-lg text-sm outline-none"
                      style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
                    />
                    <input
                      type="number"
                      value={line.amount}
                      onChange={(e) => setFormIncome((prev) => prev.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))}
                      placeholder="0.00"
                      className="w-32 px-4 py-2.5 rounded-lg text-sm outline-none"
                      style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={() => setFormIncome((prev) => [...prev, { label: '', amount: '' }])}
                className="mt-3 text-sm font-medium cursor-pointer"
                style={{ color: '#2ABFBF' }}
              >
                {t('form.addLine')}
              </button>
            </div>

            {/* Expenses */}
            <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
              <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('form.expenses')}</h3>
              <div className="space-y-3">
                {formExpenses.map((line, i) => (
                  <div key={i} className="flex gap-3">
                    <input
                      type="text"
                      value={line.label}
                      onChange={(e) => setFormExpenses((prev) => prev.map((l, j) => j === i ? { ...l, label: e.target.value } : l))}
                      placeholder={t('form.expensePlaceholder')}
                      className="flex-1 px-4 py-2.5 rounded-lg text-sm outline-none"
                      style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
                    />
                    <input
                      type="number"
                      value={line.amount}
                      onChange={(e) => setFormExpenses((prev) => prev.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))}
                      placeholder="0.00"
                      className="w-32 px-4 py-2.5 rounded-lg text-sm outline-none"
                      style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={() => setFormExpenses((prev) => [...prev, { label: '', amount: '' }])}
                className="mt-3 text-sm font-medium cursor-pointer"
                style={{ color: '#2ABFBF' }}
              >
                {t('form.addLine')}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={submitForm}
                disabled={formSubmitting}
                className="px-8 py-3 rounded-full text-white font-semibold text-lg cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                style={{ background: '#0F2044' }}
              >
                {formSubmitting ? t('confirm.generating') : t('form.submit')}
              </button>
              <button
                onClick={() => setStatus('idle')}
                className="px-8 py-3 rounded-full font-semibold text-lg cursor-pointer hover:opacity-90 transition-all"
                style={{ border: '2px solid #0F2044', color: '#0F2044' }}
              >
                {t('confirm.editBtn')}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="rounded-2xl p-8 text-center" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <p className="text-red-600 mb-6">{error}</p>
            <button
              onClick={() => setStatus('idle')}
              className="px-6 py-2 rounded-full font-medium cursor-pointer"
              style={{ background: '#0F2044', color: 'white' }}
            >
              {t('tryAgain')}
            </button>
          </div>
        )}

        {/* Plan Display */}
        {status === 'plan' && plan && (
          <div className="space-y-8">
            {/* Top Recommendation */}
            <div className="rounded-2xl p-8 text-center" style={{ background: '#0F2044' }}>
              <p className="text-sm font-medium mb-2" style={{ color: '#2ABFBF' }}>
                {t('plan.topRec')}
              </p>
              <p className="text-xl font-semibold text-white">
                {plan.topRecommendation}
              </p>
            </div>

            {/* Monthly Budget */}
            <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
              <h3 className="text-xl font-bold mb-6" style={{ color: '#0F2044' }}>
                {t('plan.budget')}
              </h3>

              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="rounded-xl p-4" style={{ background: '#F0FDFD' }}>
                  <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.income')}</p>
                  <p className="text-xl font-bold" style={{ color: '#16A34A' }}>
                    {formatCurrency(plan.monthlyBudget.totalIncome)}
                  </p>
                </div>
                <div className="rounded-xl p-4" style={{ background: '#FEF2F2' }}>
                  <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.expenses')}</p>
                  <p className="text-xl font-bold" style={{ color: '#DC2626' }}>
                    {formatCurrency(plan.monthlyBudget.totalExpenses)}
                  </p>
                </div>
                <div className="rounded-xl p-4" style={{ background: '#F0FDF4' }}>
                  <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.savings')}</p>
                  <p className="text-xl font-bold" style={{ color: '#0F2044' }}>
                    {formatCurrency(plan.monthlyBudget.totalSavings)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {plan.monthlyBudget.categories.map((cat, i) => (
                  <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <span style={{ color: '#0F2044' }}>{cat.name}</span>
                    <span className="font-medium" style={{ color: cat.type === 'income' ? '#16A34A' : '#6B7280' }}>
                      {formatCurrency(cat.budgeted)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sinking Funds */}
            {plan.sinkingFunds.length > 0 && (
              <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
                <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
                  {t('plan.sinkingFunds')}
                </h3>
                <div className="space-y-4">
                  {plan.sinkingFunds.map((fund, i) => (
                    <div key={i} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <div>
                        <p className="font-medium" style={{ color: '#0F2044' }}>{fund.name}</p>
                        <p className="text-sm" style={{ color: '#6B7280' }}>
                          {t('plan.dueIn')} {fund.dueMonth} · {formatCurrency(fund.annualAmount)}{t('plan.perYear')}
                        </p>
                      </div>
                      <p className="font-bold" style={{ color: '#2ABFBF' }}>
                        {formatCurrency(fund.monthlyProvision)}{t('plan.perMonth')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Debt Payoff */}
            {plan.debtPayoff && (
              <div className="rounded-2xl bg-white p-8" style={{ border: '2px solid #F5A623' }}>
                <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
                  {t('plan.debtPayoff')}
                </h3>
                <p className="mb-4" style={{ color: '#6B7280' }}>{plan.debtPayoff.description}</p>
                <div className="flex gap-6">
                  <div>
                    <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.targetDate')}</p>
                    <p className="font-bold" style={{ color: '#0F2044' }}>{plan.debtPayoff.targetDate}</p>
                  </div>
                  <div>
                    <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.monthlyPayment')}</p>
                    <p className="font-bold" style={{ color: '#F5A623' }}>
                      {formatCurrency(plan.debtPayoff.monthlyPayment)}{t('plan.perMonth')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Goals */}
            {plan.goals.length > 0 && (
              <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
                <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
                  {t('plan.goals')}
                </h3>
                <div className="space-y-4">
                  {plan.goals.map((goal, i) => (
                    <div key={i} className="rounded-xl p-4" style={{ background: '#F0FDFD', border: '1px solid #D1FAE5' }}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold" style={{ color: '#0F2044' }}>{goal.name}</p>
                        <span
                          className="px-3 py-1 rounded-full text-xs font-medium"
                          style={{
                            background: goal.onTrack ? '#DCFCE7' : '#FEF2F2',
                            color: goal.onTrack ? '#16A34A' : '#DC2626',
                          }}
                        >
                          {goal.onTrack ? t('plan.onTrack') : t('plan.behind')}
                        </span>
                      </div>
                      <div className="flex gap-6 text-sm">
                        <span style={{ color: '#6B7280' }}>
                          {formatCurrency(goal.targetAmount)}
                        </span>
                        <span style={{ color: '#2ABFBF' }}>
                          {formatCurrency(goal.monthlyContribution)}{t('plan.perMonth')}
                        </span>
                        <span style={{ color: '#6B7280' }}>
                          {t('plan.estimatedDate')} {goal.estimatedDate}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Monthly Review */}
            <div className="rounded-2xl bg-white p-8" style={{ border: '2px solid #2ABFBF' }}>
              <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
                {t('plan.monthlyReview')}
              </h3>
              <div className="prose" style={{ color: '#374151' }}>
                {reviewText
                  ? reviewText.split('\n').filter(Boolean).map((paragraph, i) => (
                      <p key={i} className="mb-4">{paragraph}</p>
                    ))
                  : null}
                {reviewStreaming && (
                  <span className="inline-block w-2 h-5 align-middle animate-pulse" style={{ background: '#2ABFBF' }} />
                )}
              </div>
            </div>

            {/* Start over */}
            <div className="text-center pt-4">
              <button
                onClick={() => {
                  setStatus('idle');
                  setPlan(null);
                  setReviewText('');
                }}
                className="text-sm font-medium underline cursor-pointer"
                style={{ color: '#6B7280' }}
              >
                {t('plan.startOver')}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}