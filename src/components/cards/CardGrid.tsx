'use client';

import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/expenses/types';
import { GridData } from '@/lib/envelopeHelpers';

function shortMonth(yyyyMM: string, locale: string): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA',
    { month: 'short', year: '2-digit' }
  );
}

// Closed-statement columns are shaded: history, compared against the plan
// saved for that month. Future columns stay italic grey (planned only). The
// open column is plain. Three visibly different kinds of number.
const CLOSED_BG = '#F8FAFC';

// A cell shows real actual-vs-budget for closed and open cycles; future
// cycles are budget-only (planned), since actuals[i] is null there.
function Cell({ actual, budget, locale }: { actual: number | null; budget: number; locale: string }) {
  if (actual === null) {
    return (
      <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>
        {budget > 0 ? formatCurrency(budget, locale) : '—'}
      </span>
    );
  }
  return (
    <span>
      <span style={{ color: actual > budget && budget > 0 ? '#DC2626' : '#0F2044' }}>
        {formatCurrency(actual, locale)}
      </span>
      {budget > 0 && (
        <span style={{ color: '#9CA3AF' }}> / {formatCurrency(budget, locale)}</span>
      )}
    </span>
  );
}

export default function CardGrid({
  grid,
  locale,
}: {
  grid: GridData;
  locale: string;
}) {
  const t = useTranslations('cards.grid');

  if (grid.rows.length === 0 && grid.uncategorizedActuals.every((a) => !a)) {
    return (
      <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
        <h3 className="text-base font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h3>
        <p className="text-sm" style={{ color: '#9CA3AF' }}>{t('empty')}</p>
      </div>
    );
  }

  const closedAt = (i: number) => grid.cycleStates[i] === 'closed';
  const cellBg = (i: number) => (closedAt(i) ? CLOSED_BG : undefined);
  const hasClosed = grid.cycleStates.some((s) => s === 'closed');
  const hasGoalOnly = grid.pastPlans.some((p) => p === 'goalOnly');
  const hasNone = grid.pastPlans.some((p) => p === 'none');

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <h3 className="text-base font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h3>

      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
              <th className="text-left py-2 pr-4 font-semibold w-32" style={{ color: '#0F2044' }}>
                {t('title')}
              </th>
              {grid.months.map((mo, i) => (
                <th
                  key={mo}
                  className="text-right py-2 px-2 font-semibold align-top"
                  style={{ color: mo === grid.currentMonth ? '#0F2044' : '#6B7280', background: cellBg(i) }}
                >
                  {shortMonth(mo, locale)}
                  {mo === grid.currentMonth && (
                    <span className="block font-normal" style={{ color: '#2ABFBF' }}>{t('current')}</span>
                  )}
                  {/* Both labels can apply: after a card's close day, the
                      current month's own statement has already closed. */}
                  {closedAt(i) && (
                    <span className="block font-normal" style={{ color: grid.pastPlans[i] === 'saved' ? '#94A3B8' : '#B45309' }}>
                      {grid.pastPlans[i] === 'goalOnly' ? t('goalOnly')
                        : grid.pastPlans[i] === 'none' ? t('noPlan')
                        : t('closed')}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.categoryId} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td className="py-2 pr-4 font-medium" style={{ color: '#0F2044' }}>{row.name}</td>
                {row.actuals.map((amt, i) => (
                  <td key={i} className="py-2 px-2 text-right" style={{ background: cellBg(i) }}>
                    <Cell actual={amt} budget={row.budgets[i]} locale={locale} />
                  </td>
                ))}
              </tr>
            ))}

            {/* Uncategorized — its own row, counted in totals AND visible per-row,
                never a totals-only ghost. */}
            {grid.uncategorizedActuals.some((a) => a) && (
              <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td className="py-2 pr-4 italic" style={{ color: '#9CA3AF' }}>{t('uncategorized')}</td>
                {grid.uncategorizedActuals.map((amt, i) => (
                  <td key={i} className="py-2 px-2 text-right" style={{ background: cellBg(i) }}>
                    <Cell actual={amt} budget={0} locale={locale} />
                  </td>
                ))}
              </tr>
            )}
          </tbody>
          <tfoot>
            {/* Total spent row */}
            <tr style={{ borderTop: '2px solid #0F2044' }}>
              <td className="py-2.5 pr-4 font-bold text-xs" style={{ color: '#0F2044' }}>{t('total')}</td>
              {grid.totalActuals.map((amt, i) => (
                <td key={i} className="py-2.5 px-2 text-right font-bold" style={{ color: amt === null ? '#9CA3AF' : '#0F2044', background: cellBg(i) }}>
                  {amt === null ? '—' : formatCurrency(amt, locale)}
                </td>
              ))}
            </tr>
            {/* Goal row: a closed month's own saved goal (or —); open and
                future months carry forward, so they show the projected goal. */}
            {grid.totalGoals.some((g) => g !== null) && (
              <tr style={{ borderTop: '1px solid #E5E7EB' }}>
                <td className="py-2 pr-4 text-xs" style={{ color: '#6B7280' }}>{t('goal')}</td>
                {grid.totalGoals.map((g, i) => {
                  const actual = grid.totalActuals[i];
                  const over = g !== null && actual !== null && actual > g;
                  return (
                    <td key={i} className="py-2 px-2 text-right text-xs" style={{ color: g === null ? '#D1D5DB' : over ? '#DC2626' : '#16A34A', background: cellBg(i) }}>
                      {g !== null ? formatCurrency(g, locale) : '—'}
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {hasClosed && (
        <div className="mt-3 space-y-0.5 text-xs" style={{ color: '#6B7280' }}>
          <p>{t('legendClosed')}</p>
          {hasGoalOnly && <p>{t('legendGoalOnly')}</p>}
          {hasNone && <p>{t('legendNoPlan')}</p>}
        </div>
      )}
    </div>
  );
}
