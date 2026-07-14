'use client';

import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/expenses/types';
import { EnvelopeStatus, envelopeStatus, sumWarning } from '@/lib/envelopeHelpers';

export type EnvelopeItem = {
  categoryId: string;
  categoryName: string;
  monthlyAmount: number;
  actual: number;
  remaining: number;
  status: EnvelopeStatus;
};

export type DecisionViewProps = {
  totalGoal: number | null;
  totalSpent: number;
  envelopeItems: EnvelopeItem[];
  uncategorized: number;
  locale: string;
  onEditEnvelope: () => void;
};

export default function CardDecisionView({
  totalGoal,
  totalSpent,
  envelopeItems,
  uncategorized,
  locale,
  onEditEnvelope,
}: DecisionViewProps) {
  const t = useTranslations('cards');
  const remaining = totalGoal !== null ? totalGoal - totalSpent : null;
  const overGoal = remaining !== null && remaining < 0;
  const hasEnvelope = envelopeItems.length > 0;

  // TOTAL row sums its own columns — Envelope and Spent are independent
  // truths, not a comparison against the card goal (that comparison lives in
  // its own labeled line below, tied to the same warn-not-block rule the
  // editor already uses).
  const envelopeSum = envelopeItems.reduce((s, i) => s + i.monthlyAmount, 0);
  const spentSum = envelopeItems.reduce((s, i) => s + i.actual, 0) + uncategorized;
  const leftSum = envelopeSum - spentSum;
  const totalStatus: EnvelopeStatus = envelopeStatus(envelopeSum, spentSum);
  const overAllocated = totalGoal !== null && sumWarning(envelopeItems.map((i) => ({ monthlyAmount: i.monthlyAmount })), totalGoal);

  const statusColor = (status: EnvelopeStatus, actual: number) => {
    if (status === 'over') return '#DC2626';
    if (status === 'watch') return '#D97706';
    if (status === 'ok' && actual > 0) return '#16A34A';
    return '#9CA3AF';
  };

  return (
    <div className="space-y-4">
      {/* Three-question header strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white p-5" style={{ border: '1px solid #E5E7EB' }}>
          <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: '#6B7280' }}>
            {t('decision.totalGoal')}
          </p>
          <p className="text-2xl font-bold" style={{ color: '#0F2044' }}>
            {totalGoal !== null ? formatCurrency(totalGoal, locale) : <span style={{ color: '#9CA3AF' }}>{t('decision.noGoal')}</span>}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5" style={{ border: '1px solid #E5E7EB' }}>
          <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: '#6B7280' }}>
            {t('decision.spent')}
          </p>
          <p className="text-2xl font-bold" style={{ color: overGoal ? '#DC2626' : '#0F2044' }}>
            {formatCurrency(totalSpent, locale)}
          </p>
        </div>

        <div className="rounded-2xl p-5" style={{
          border: overGoal ? '2px solid #DC2626' : '1px solid #E5E7EB',
          background: overGoal ? '#FEF2F2' : 'white',
        }}>
          <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: '#6B7280' }}>
            {t('decision.remaining')}
          </p>
          <p className="text-2xl font-bold" style={{ color: remaining === null ? '#9CA3AF' : overGoal ? '#DC2626' : '#16A34A' }}>
            {remaining !== null ? formatCurrency(remaining, locale) : '—'}
          </p>
          {overGoal && (
            <p className="text-xs font-semibold mt-1" style={{ color: '#DC2626' }}>
              {t('decision.overGoal')}
            </p>
          )}
        </div>
      </div>

      {/* Per-category decision table */}
      <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
        {!hasEnvelope ? (
          <div className="text-center py-6">
            <p className="text-sm mb-3" style={{ color: '#6B7280' }}>{t('decision.noEnvelope')}</p>
            <button
              onClick={onEditEnvelope}
              className="px-4 py-2 rounded-full text-sm font-medium cursor-pointer hover:opacity-90"
              style={{ background: '#0F2044', color: 'white' }}
            >
              {t('editor.title')}
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold" style={{ color: '#0F2044' }}>
                {t('decision.category')}
              </h3>
              <button
                onClick={onEditEnvelope}
                className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer hover:opacity-80"
                style={{ border: '1.5px solid #2ABFBF', color: '#2ABFBF' }}
              >
                {t('editor.title')}
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                  <th className="text-left py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.category')}</th>
                  <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.subBudget')}</th>
                  <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.actual')}</th>
                  <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.difference')}</th>
                  <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.status')}</th>
                </tr>
              </thead>
              <tbody>
                {envelopeItems.map((row) => (
                  <tr key={row.categoryId} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td className="py-2.5 font-medium" style={{ color: '#0F2044' }}>{row.categoryName}</td>
                    <td className="py-2.5 text-right" style={{ color: '#6B7280' }}>
                      {formatCurrency(row.monthlyAmount, locale)}
                    </td>
                    <td className="py-2.5 text-right font-medium" style={{ color: '#0F2044' }}>
                      {formatCurrency(row.actual, locale)}
                    </td>
                    <td className="py-2.5 text-right font-medium" style={{ color: statusColor(row.status, row.actual) }}>
                      {row.monthlyAmount > 0 ? formatCurrency(row.remaining, locale) : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      {row.status === 'over' ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                          {t('decision.over')}
                        </span>
                      ) : row.status === 'watch' ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#D97706' }}>
                          {t('decision.watch')}
                        </span>
                      ) : row.status === 'ok' && row.actual > 0 ? (
                        <span className="text-xs font-semibold" style={{ color: '#16A34A' }}>✓ {t('decision.ok')}</span>
                      ) : (
                        <span style={{ color: '#9CA3AF' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}

                {/* Uncategorized row (always shown when > 0) */}
                {uncategorized > 0 && (
                  <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td className="py-2.5 italic" style={{ color: '#9CA3AF' }}>{t('decision.uncategorized')}</td>
                    <td className="py-2.5 text-right" style={{ color: '#9CA3AF' }}>—</td>
                    <td className="py-2.5 text-right font-medium" style={{ color: '#DC2626' }}>
                      {formatCurrency(uncategorized, locale)}
                    </td>
                    <td className="py-2.5 text-right" style={{ color: '#9CA3AF' }}>—</td>
                    <td className="py-2.5 text-right">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#D97706' }}>
                        !
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                {/* TOTAL sums its own columns — no goal comparison mixed in. */}
                <tr style={{ borderTop: '2px solid #0F2044' }}>
                  <td className="py-3 font-bold" style={{ color: '#0F2044' }}>{t('decision.total')}</td>
                  <td className="py-3 text-right font-bold" style={{ color: '#0F2044' }}>
                    {formatCurrency(envelopeSum, locale)}
                  </td>
                  <td className="py-3 text-right font-bold" style={{ color: statusColor(totalStatus, spentSum) === '#9CA3AF' ? '#0F2044' : statusColor(totalStatus, spentSum) }}>
                    {formatCurrency(spentSum, locale)}
                  </td>
                  <td className="py-3 text-right font-bold" style={{ color: leftSum < 0 ? '#DC2626' : '#0F2044' }}>
                    {formatCurrency(leftSum, locale)}
                  </td>
                  <td className="py-3 text-right font-bold">
                    {totalStatus === 'over' ? (
                      <span style={{ color: '#DC2626' }}>{t('decision.over')}</span>
                    ) : totalStatus === 'watch' ? (
                      <span style={{ color: '#D97706' }}>{t('decision.watch')}</span>
                    ) : totalStatus === 'ok' ? (
                      <span style={{ color: '#16A34A' }}>✓ {t('decision.ok')}</span>
                    ) : (
                      <span style={{ color: '#9CA3AF' }}>—</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Goal comparison lives on its own line — a separate truth from the
                column sums above. Warn, never block, same rule the editor uses. */}
            {overAllocated && (
              <p className="text-xs font-medium mt-3 px-3 py-2 rounded-lg" style={{ background: '#FEF3C7', color: '#D97706' }}>
                {t('decision.goalVsAllocated', {
                  goal: formatCurrency(totalGoal as number, locale),
                  sum: formatCurrency(envelopeSum, locale),
                  over: formatCurrency(envelopeSum - (totalGoal as number), locale),
                })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
