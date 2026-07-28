import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/dashboard/types';
import { classifyGoalProgress, GoalProgressInput } from '@/lib/reportsDisplayHelpers';

function formatMonthYear(yyyyMM: string, locale: string): string {
  return new Date(yyyyMM + '-01T00:00:00').toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA',
    { month: 'long', year: 'numeric' }
  );
}

// Same hand-built bar as BudgetVsActualChart — a plain div fill, no library.
function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-3 rounded-full" style={{ background: '#F3F4F6' }}>
      <div className="h-3 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function GoalProgressChart({
  goals,
  locale,
}: {
  goals: GoalProgressInput[];
  locale: string;
}) {
  const t = useTranslations('reports.goalProgress');

  return (
    <div className="rounded-2xl bg-white p-6 sm:p-8" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h2>

      {goals.length === 0 ? (
        <p className="text-sm text-center py-6" style={{ color: '#6B7280' }}>{t('empty')}</p>
      ) : (
        <div className="space-y-6">
          {goals.map((goal) => {
            const row = classifyGoalProgress(goal);

            return (
              <div key={row.id}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="font-medium truncate min-w-0" style={{ color: '#0F2044' }} title={row.name}>
                    {row.name}
                  </p>
                  {row.kind === 'notStarted' && (
                    <span
                      className="shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: '#F0FDFD', color: '#2ABFBF' }}
                    >
                      {t('notStartedBadge')}
                    </span>
                  )}
                  {row.kind === 'funded' && (
                    <span
                      className="shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: '#F0FDF4', color: '#15803D' }}
                    >
                      ✓ {t('fundedBadge')}
                    </span>
                  )}
                  {row.kind === 'inProgress' && row.onTrack !== null && (
                    <span
                      className="shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full"
                      style={{
                        background: row.onTrack ? '#F0FDF4' : '#FEF3C7',
                        color: row.onTrack ? '#15803D' : '#D97706',
                      }}
                    >
                      {row.onTrack ? `✓ ${t('onTrackBadge')}` : `⚠ ${t('behindBadge')}`}
                    </span>
                  )}
                </div>

                {row.kind === 'debt' ? (
                  <>
                    <p className="text-sm font-medium mb-1" style={{ color: row.balance < 0 ? '#DC2626' : '#16A34A' }}>
                      {row.balance < 0
                        ? t('debtOwed', { amount: formatCurrency(Math.abs(row.balance), locale) })
                        : `✓ ${t('debtPaidOff')}`}
                    </p>
                    {row.debtPayoff && (
                      <p className="text-xs" style={{ color: '#6B7280' }}>
                        {t('notStartedPlan', {
                          amount: formatCurrency(row.debtPayoff.monthlyPayment, locale),
                          date: formatMonthYear(row.debtPayoff.targetDate, locale),
                        })}
                      </p>
                    )}
                  </>
                ) : row.kind === 'noTarget' ? (
                  <p className="text-xs" style={{ color: '#6B7280' }}>{t('noTarget')}</p>
                ) : (
                  <>
                    <ProgressBar
                      pct={row.pct ?? 0}
                      color={row.kind === 'notStarted' ? '#2ABFBF' : row.kind === 'funded' ? '#16A34A' : '#2ABFBF'}
                    />
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="text-xs" style={{ color: '#6B7280' }}>
                        {t('savedOfTarget', {
                          saved: formatCurrency(row.balance, locale),
                          target: formatCurrency(row.goalTarget ?? 0, locale),
                        })}
                        {' '}({row.pct ?? 0}%)
                      </p>
                    </div>
                    {row.kind === 'notStarted' && (
                      <p className="text-xs mt-1" style={{ color: '#6B7280' }}>
                        {row.monthlyContribution && row.estimatedDate
                          ? t('notStartedPlan', {
                              amount: formatCurrency(row.monthlyContribution, locale),
                              date: formatMonthYear(row.estimatedDate, locale),
                            })
                          : t('notStartedNoDate')}
                      </p>
                    )}
                    {row.kind === 'inProgress' && row.estimatedDate && (
                      <p className="text-xs mt-1" style={{ color: '#6B7280' }}>
                        {t('estimated', { date: formatMonthYear(row.estimatedDate, locale) })}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
