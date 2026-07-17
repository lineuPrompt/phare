import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GoalAccount, formatCurrency } from './types';

export default function GoalsCard({
  goals,
  locale,
}: {
  goals: GoalAccount[];
  locale: string;
}) {
  const t = useTranslations('dashboard');
  const tGoals = useTranslations('goals');

  return (
    <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold" style={{ color: '#0F2044' }}>
          {t('goals')}
        </h2>
        <Link
          href={`/${locale}/goals`}
          className="text-sm font-medium"
          style={{ color: '#2ABFBF' }}
        >
          {goals.length === 0 ? tGoals('createGoal') : tGoals('viewAll')}
        </Link>
      </div>

      {goals.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm" style={{ color: '#6B7280' }}>{t('noGoals')}</p>
          <Link
            href={`/${locale}/goals`}
            className="inline-block mt-3 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: '#F0FDFD', color: '#2ABFBF' }}
          >
            {t('createGoalCta')}
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {goals.map((goal) => {
            const pct = !goal.isDebt && goal.goalTarget && goal.goalTarget > 0
              ? Math.min(100, Math.round((goal.balance / goal.goalTarget) * 100))
              : null;

            return (
              <div key={goal.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-medium truncate" style={{ color: '#0F2044' }}>{goal.name}</p>
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded-full text-xs font-semibold"
                      style={{
                        background: goal.isDebt ? '#FEF2F2' : '#F0FDFD',
                        color: goal.isDebt ? '#DC2626' : '#2ABFBF',
                      }}
                    >
                      {tGoals(`type.${goal.type as 'savings' | 'tfsa' | 'rrsp' | 'debt'}`)}
                    </span>
                    {/* Code-computed verdict, rendered directly — never the AI's
                        words. Sits right next to ReviewCard's prose on this
                        same page (Part B.6): if a narration ever asserted a
                        different status, this is the visible, ground-truth
                        contradiction. */}
                    {!goal.isDebt && goal.onTrack !== null && (
                      <span
                        className="shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full"
                        style={{
                          background: goal.onTrack ? '#F0FDF4' : '#FEF3C7',
                          color: goal.onTrack ? '#15803D' : '#D97706',
                        }}
                      >
                        {goal.onTrack ? `✓ ${t('onTrack')}` : `⚠ ${t('behindTrack')}`}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium shrink-0 ml-2" style={{ color: goal.isDebt ? '#DC2626' : '#6B7280' }}>
                    {goal.isDebt
                      ? `${goal.balance < 0 ? '−' : ''}${formatCurrency(Math.abs(goal.balance), locale)}`
                      : `${formatCurrency(goal.balance, locale)}${goal.goalTarget ? ` / ${formatCurrency(goal.goalTarget, locale)}` : ''}`}
                  </p>
                </div>

                {goal.isDebt ? (
                  goal.debtPayoff ? (
                    <p className="text-xs mt-1" style={{ color: '#6B7280' }}>
                      {tGoals('payoffPlan', {
                        amount: formatCurrency(goal.debtPayoff.monthlyPayment, locale),
                        date: new Date(goal.debtPayoff.targetDate + '-01T00:00:00').toLocaleDateString(
                          locale === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' }
                        ),
                      })}
                    </p>
                  ) : goal.balance >= 0 ? (
                    <p className="text-xs mt-1 font-semibold" style={{ color: '#16A34A' }}>✓ {tGoals('debtPaidOff')}</p>
                  ) : null
                ) : pct !== null ? (
                  <>
                    <div className="w-full h-2.5 rounded-full" style={{ background: '#F3F4F6' }}>
                      <div
                        className="h-2.5 rounded-full transition-all"
                        style={{ width: `${pct}%`, background: '#2ABFBF' }}
                      />
                    </div>
                    <p className="text-xs mt-1" style={{ color: '#6B7280' }}>{pct}%</p>
                  </>
                ) : (
                  <p className="text-xs mt-1" style={{ color: '#6B7280' }}>{tGoals('noTarget')}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
