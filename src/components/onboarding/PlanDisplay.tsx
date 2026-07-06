'use client';

import { useTranslations } from 'next-intl';
import { Plan, formatCAD } from './types';

export default function PlanDisplay({
  plan,
  reviewText,
  reviewStreaming,
  planSaveStatus,
  onRetrySave,
  onStartOver,
  replaceConfirmation,
  onConfirmReplace,
  onCancelReplace,
  saveNotices,
}: {
  plan: Plan;
  reviewText: string;
  reviewStreaming: boolean;
  planSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onRetrySave: () => void;
  onStartOver: () => void;
  replaceConfirmation: {
    totalRecurring: number; provenancedRecurring: number; legacyRecurring: number;
    accountsToDelete: { id: string; name: string }[];
    accountsToPreserve: { id: string; name: string; reason: 'not_from_import' | 'has_transactions' | 'has_envelope_budget' | 'has_monthly_goal' }[];
  } | null;
  onConfirmReplace: () => void;
  onCancelReplace: () => void;
  saveNotices: {
    unmatchedMembers: { label: string; attemptedMember: string }[];
    needsPayDate: { id: string; description: string }[];
  } | null;
}) {
  const t = useTranslations('upload');

  return (
    <div className="space-y-8">
      {/* Top Recommendation */}
      <div className="rounded-2xl p-8 text-center" style={{ background: '#0F2044' }}>
        <p className="text-sm font-medium mb-2" style={{ color: '#2ABFBF' }}>{t('plan.topRec')}</p>
        <p className="text-xl font-semibold text-white">{plan.topRecommendation}</p>
      </div>

      {/* Monthly Budget */}
      <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
        <h3 className="text-xl font-bold mb-6" style={{ color: '#0F2044' }}>{t('plan.budget')}</h3>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl p-4" style={{ background: '#F0FDFD' }}>
            <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.income')}</p>
            <p className="text-xl font-bold" style={{ color: '#16A34A' }}>{formatCAD(plan.monthlyBudget.totalIncome)}</p>
          </div>
          <div className="rounded-xl p-4" style={{ background: '#FEF2F2' }}>
            <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.expenses')}</p>
            <p className="text-xl font-bold" style={{ color: '#DC2626' }}>{formatCAD(plan.monthlyBudget.totalExpenses)}</p>
          </div>
          <div className="rounded-xl p-4" style={{ background: '#F0FDF4' }}>
            <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.savings')}</p>
            <p className="text-xl font-bold" style={{ color: '#0F2044' }}>{formatCAD(plan.monthlyBudget.totalSavings)}</p>
          </div>
        </div>

        <div className="space-y-2">
          {plan.monthlyBudget.categories.map((cat, i) => (
            <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
              <span style={{ color: '#0F2044' }}>{cat.name}</span>
              <span className="font-medium" style={{ color: cat.type === 'income' ? '#16A34A' : '#6B7280' }}>
                {formatCAD(cat.budgeted)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Sinking Funds */}
      {plan.sinkingFunds.length > 0 && (
        <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('plan.sinkingFunds')}</h3>
          <div className="space-y-4">
            {plan.sinkingFunds.map((fund, i) => (
              <div key={i} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
                <div>
                  <p className="font-medium" style={{ color: '#0F2044' }}>{fund.name}</p>
                  <p className="text-sm" style={{ color: '#6B7280' }}>
                    {t('plan.dueIn')} {fund.dueMonth} · {formatCAD(fund.annualAmount)}{t('plan.perYear')}
                  </p>
                </div>
                <p className="font-bold" style={{ color: '#2ABFBF' }}>
                  {formatCAD(fund.monthlyProvision)}{t('plan.perMonth')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debt Payoff */}
      {plan.debtPayoff && (
        <div className="rounded-2xl bg-white p-8" style={{ border: '2px solid #F5A623' }}>
          <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('plan.debtPayoff')}</h3>
          <p className="mb-4" style={{ color: '#6B7280' }}>{plan.debtPayoff.description}</p>
          <div className="flex gap-6">
            <div>
              <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.targetDate')}</p>
              <p className="font-bold" style={{ color: '#0F2044' }}>{plan.debtPayoff.targetDate}</p>
            </div>
            <div>
              <p className="text-sm" style={{ color: '#6B7280' }}>{t('plan.monthlyPayment')}</p>
              <p className="font-bold" style={{ color: '#F5A623' }}>
                {formatCAD(plan.debtPayoff.monthlyPayment)}{t('plan.perMonth')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Goals */}
      {plan.goals.length > 0 && (
        <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
          <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('plan.goals')}</h3>
          <div className="space-y-4">
            {plan.goals.map((goal, i) => (
              <div key={i} className="rounded-xl p-4" style={{ background: '#F0FDFD', border: '1px solid #D1FAE5' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold" style={{ color: '#0F2044' }}>{goal.name}</p>
                  <span className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      background: goal.onTrack ? '#DCFCE7' : '#FEF2F2',
                      color: goal.onTrack ? '#16A34A' : '#DC2626',
                    }}>
                    {goal.onTrack ? t('plan.onTrack') : t('plan.behind')}
                  </span>
                </div>
                <div className="flex gap-6 text-sm">
                  <span style={{ color: '#6B7280' }}>{formatCAD(goal.targetAmount)}</span>
                  <span style={{ color: '#2ABFBF' }}>{formatCAD(goal.monthlyContribution)}{t('plan.perMonth')}</span>
                  <span style={{ color: '#6B7280' }}>{t('plan.estimatedDate')} {goal.estimatedDate}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Review */}
      <div className="rounded-2xl bg-white p-8" style={{ border: '2px solid #2ABFBF' }}>
        <h3 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('plan.monthlyReview')}</h3>
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

      {replaceConfirmation && (
        <div className="rounded-2xl p-8 space-y-4" style={{ background: '#FFFBEB', border: '1.5px solid #F5A623' }}>
          <p className="text-lg font-bold" style={{ color: '#0F2044' }}>{t('plan.replaceConfirm.title')}</p>
          <p style={{ color: '#374151' }}>
            {t('plan.replaceConfirm.body', { count: replaceConfirmation.provenancedRecurring })}
          </p>
          {replaceConfirmation.legacyRecurring > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'white', border: '1px solid #FDE68A' }}>
              <p style={{ color: '#374151' }}>
                {t('plan.replaceConfirm.legacy', { count: replaceConfirmation.legacyRecurring })}
              </p>
            </div>
          )}

          {replaceConfirmation.accountsToDelete.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'white', border: '1px solid #FECACA' }}>
              <p className="font-semibold mb-1" style={{ color: '#DC2626' }}>{t('plan.replaceConfirm.accountsDeleteTitle')}</p>
              <ul className="list-disc list-inside" style={{ color: '#374151' }}>
                {replaceConfirmation.accountsToDelete.map((a) => <li key={a.id}>{a.name}</li>)}
              </ul>
            </div>
          )}

          {replaceConfirmation.accountsToPreserve.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'white', border: '1px solid #BBF7D0' }}>
              <p className="font-semibold mb-1" style={{ color: '#16A34A' }}>{t('plan.replaceConfirm.accountsPreserveTitle')}</p>
              <ul className="list-disc list-inside" style={{ color: '#374151' }}>
                {replaceConfirmation.accountsToPreserve.map((a) => (
                  <li key={a.id}>{a.name} — {t(`plan.replaceConfirm.reason.${a.reason}`)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onCancelReplace}
              className="flex-1 px-6 py-3 rounded-full font-semibold cursor-pointer hover:opacity-90 transition-all"
              style={{ border: '2px solid #0F2044', color: '#0F2044' }}
            >
              {t('plan.replaceConfirm.cancel')}
            </button>
            <button
              onClick={onConfirmReplace}
              className="flex-1 px-6 py-3 rounded-full font-semibold cursor-pointer hover:opacity-90 transition-all"
              style={{ background: '#0F2044', color: 'white' }}
            >
              {t('plan.replaceConfirm.confirm')}
            </button>
          </div>
        </div>
      )}

      {planSaveStatus === 'saved' && saveNotices && (saveNotices.unmatchedMembers.length > 0 || saveNotices.needsPayDate.length > 0) && (
        <div className="rounded-2xl p-6 space-y-3" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          {saveNotices.unmatchedMembers.length > 0 && (
            <p style={{ color: '#374151' }}>
              {t('plan.unmatchedMembers', { count: saveNotices.unmatchedMembers.length })}
            </p>
          )}
          {saveNotices.needsPayDate.length > 0 && (
            <p style={{ color: '#374151' }}>
              {t('plan.needsPayDate', { count: saveNotices.needsPayDate.length })}
            </p>
          )}
        </div>
      )}

      {planSaveStatus === 'saving' && (
        <p className="text-center text-sm" style={{ color: '#9CA3AF' }}>{t('plan.saving')}</p>
      )}
      {planSaveStatus === 'error' && (
        <div className="text-center">
          <p className="text-sm mb-1" style={{ color: '#DC2626' }}>{t('plan.saveError')}</p>
          <button onClick={onRetrySave} className="text-sm font-medium underline cursor-pointer" style={{ color: '#DC2626' }}>
            {t('plan.saveRetry')}
          </button>
        </div>
      )}

      <div className="text-center pt-4">
        <button onClick={onStartOver} className="text-sm font-medium underline cursor-pointer" style={{ color: '#6B7280' }}>
          {t('plan.startOver')}
        </button>
      </div>
    </div>
  );
}
