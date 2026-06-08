'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';

type Analysis = {
  summary: {
    monthsDetected: number;
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    currency: string;
  };
  categories: {
    name: string;
    name_fr: string;
    type: string;
    monthlyAverage: number;
    confidence: string;
  }[];
  insights: {
    type: string;
    title: string;
    title_fr: string;
    description: string;
    description_fr: string;
  }[];
  suggestedSinkingFunds: {
    name: string;
    name_fr: string;
    annualAmount: number;
    monthlyProvision: number;
    reason: string;
    reason_fr: string;
  }[];
  questions: {
    question: string;
    question_fr: string;
    reason: string;
  }[];
};

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
  monthlyReview: string;
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

export default function UploadPage() {
  const t = useTranslations('upload');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'done' | 'error' | 'plan'>('idle');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setStatus('uploading');
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || 'Upload failed');
      }

      const uploadData = await uploadRes.json();

      setStatus('analyzing');

      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheets: uploadData.sheets,
          fileName: uploadData.fileName,
        }),
      });

      if (!analyzeRes.ok) {
        const err = await analyzeRes.json();
        throw new Error(err.error || 'Analysis failed');
      }

      const analyzeData = await analyzeRes.json();
      setAnalysis(analyzeData.analysis);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    }
  }, []);

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

  const handleBuildPlan = useCallback(async () => {
    if (!analysis) return;
    setGenerating(true);

    try {
      const questionsWithAnswers = analysis.questions.map((q, i) => ({
        question: q.question,
        answer: answers[i] || 'Not answered',
      }));

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis,
          answers: questionsWithAnswers,
        }),
      });

      if (!res.ok) throw new Error('Plan generation failed');

      const data = await res.json();
      setPlan(data.plan);
      setStatus('plan');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    } finally {
      setGenerating(false);
    }
  }, [analysis, answers]);

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

            <div className="flex items-center gap-4">
              <div className="flex-1 h-px" style={{ background: '#D1D5DB' }} />
              <span className="text-sm font-medium" style={{ color: '#6B7280' }}>{t('or')}</span>
              <div className="flex-1 h-px" style={{ background: '#D1D5DB' }} />
            </div>

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
            <div className="mt-6 pt-6" style={{ borderTop: '1px solid #FECACA' }}>
              <p className="text-sm mb-2" style={{ color: '#6B7280' }}>{t('templateHint')}</p>
              <a
                href="/phare_template.xlsx"
                download
                className="inline-block text-sm font-medium underline cursor-pointer"
                style={{ color: '#2ABFBF' }}
              >
                {t('template')}
              </a>
            </div>
          </div>
        )}

        {/* Analysis Results */}
        {status === 'done' && analysis && (
          <div className="space-y-8">
            <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
              <h2 className="text-2xl font-bold mb-6" style={{ color: '#0F2044' }}>
                {t('confirm.title')}
              </h2>
              <p className="mb-6" style={{ color: '#6B7280' }}>{t('confirm.subtitle')}</p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="rounded-xl p-4" style={{ background: '#F0FDFD' }}>
                  <p className="text-sm" style={{ color: '#6B7280' }}>{t('confirm.income')}</p>
                  <p className="text-xl font-bold" style={{ color: '#0F2044' }}>
                    {formatCurrency(analysis.summary.totalIncome)}
                  </p>
                </div>
                <div className="rounded-xl p-4" style={{ background: '#FEF2F2' }}>
                  <p className="text-sm" style={{ color: '#6B7280' }}>{t('confirm.expenses')}</p>
                  <p className="text-xl font-bold" style={{ color: '#0F2044' }}>
                    {formatCurrency(analysis.summary.totalExpenses)}
                  </p>
                </div>
                <div className="rounded-xl p-4" style={{ background: analysis.summary.netCashFlow >= 0 ? '#F0FDF4' : '#FEF2F2' }}>
                  <p className="text-sm" style={{ color: '#6B7280' }}>{t('confirm.cashFlow')}</p>
                  <p className="text-xl font-bold" style={{ color: analysis.summary.netCashFlow >= 0 ? '#16A34A' : '#DC2626' }}>
                    {formatCurrency(analysis.summary.netCashFlow)}
                  </p>
                </div>
                <div className="rounded-xl p-4" style={{ background: '#F5F3FF' }}>
                  <p className="text-sm" style={{ color: '#6B7280' }}>{t('confirm.months')}</p>
                  <p className="text-xl font-bold" style={{ color: '#0F2044' }}>
                    {analysis.summary.monthsDetected}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
              <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
                {t('confirm.categories')}
              </h3>
              <div className="space-y-3">
                {analysis.categories.map((cat, i) => (
                  <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <div className="flex items-center gap-3">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: cat.confidence === 'high' ? '#16A34A' : cat.confidence === 'medium' ? '#F5A623' : '#DC2626' }}
                      />
                      <span style={{ color: '#0F2044' }}>{cat.name}</span>
                    </div>
                    <span className="font-medium" style={{ color: '#6B7280' }}>
                      {formatCurrency(cat.monthlyAverage)}{t('confirm.perMonth')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {analysis.insights.length > 0 && (
              <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
                <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
                  {t('confirm.insights')}
                </h3>
                <div className="space-y-4">
                  {analysis.insights.map((insight, i) => (
                    <div
                      key={i}
                      className="rounded-xl p-4"
                      style={{
                        background: insight.type === 'warning' ? '#FEF2F2' : insight.type === 'opportunity' ? '#F0FDFD' : '#F0FDF4',
                        border: `1px solid ${insight.type === 'warning' ? '#FECACA' : insight.type === 'opportunity' ? '#A7F3D0' : '#BBF7D0'}`,
                      }}
                    >
                      <p className="font-semibold mb-1" style={{ color: '#0F2044' }}>
                        {insight.type === 'warning' ? '⚠️' : insight.type === 'opportunity' ? '💡' : '✅'} {insight.title}
                      </p>
                      <p style={{ color: '#6B7280' }}>{insight.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.suggestedSinkingFunds.length > 0 && (
              <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
                <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
                  {t('confirm.sinkingFunds')}
                </h3>
                <div className="space-y-4">
                  {analysis.suggestedSinkingFunds.map((fund, i) => (
                    <div key={i} className="rounded-xl p-4" style={{ background: '#F0FDFD', border: '1px solid #D1FAE5' }}>
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-semibold" style={{ color: '#0F2044' }}>{fund.name}</p>
                        <div className="text-right">
                          <p className="font-bold" style={{ color: '#2ABFBF' }}>
                            {formatCurrency(fund.monthlyProvision)}{t('confirm.perMonth')}
                          </p>
                          <p className="text-sm" style={{ color: '#6B7280' }}>
                            {formatCurrency(fund.annualAmount)}{t('confirm.perYear')}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm" style={{ color: '#6B7280' }}>{fund.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.questions.length > 0 && (
              <div className="rounded-2xl bg-white p-8" style={{ border: '2px solid #F5A623' }}>
                <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
                  {t('confirm.questions')}
                </h3>
                <div className="space-y-6">
                  {analysis.questions.map((q, i) => (
                    <div key={i}>
                      <p className="font-medium mb-1" style={{ color: '#0F2044' }}>{q.question}</p>
                      <p className="text-sm mb-2" style={{ color: '#6B7280' }}>{q.reason}</p>
                      <input
                        type="text"
                        value={answers[i] || ''}
                        onChange={(e) => setAnswers(prev => ({ ...prev, [i]: e.target.value }))}
                        placeholder={t('confirm.answerPlaceholder')}
                        className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all"
                        style={{
                          border: '1.5px solid #D1D5DB',
                          color: '#0F2044',
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#2ABFBF'}
                        onBlur={(e) => e.target.style.borderColor = '#D1D5DB'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <button
                onClick={handleBuildPlan}
                disabled={generating}
                className="px-8 py-3 rounded-full text-white font-semibold text-lg cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                style={{ background: '#0F2044' }}
              >
                {generating ? t('confirm.generating') : t('confirm.confirmBtn')}
              </button>
              <button
                className="px-8 py-3 rounded-full font-semibold text-lg cursor-pointer hover:opacity-90 transition-all"
                style={{ border: '2px solid #0F2044', color: '#0F2044' }}
                onClick={() => { setStatus('idle'); setAnalysis(null); setAnswers({}); }}
              >
                {t('confirm.editBtn')}
              </button>
            </div>
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
                {plan.monthlyReview.split('\n').map((paragraph, i) => (
                  <p key={i} className="mb-4">{paragraph}</p>
                ))}
              </div>
            </div>

            {/* Start over */}
            <div className="text-center pt-4">
              <button
                onClick={() => {
                  setStatus('idle');
                  setAnalysis(null);
                  setAnswers({});
                  setPlan(null);
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