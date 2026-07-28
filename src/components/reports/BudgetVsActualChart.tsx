import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/dashboard/types';
import { BudgetVsActualRow, FixedCommitmentRow, sumOverTarget, sumFixedCommitments } from '@/lib/reportsDisplayHelpers';

// Hand-built bullet bar — no charting library (see build handoff for why:
// this is a container div with a width-percentage fill and a marker tick,
// which gives simpler mobile behavior and precise control over long/accented
// user-defined category names than a chart library would).
function BulletBar({ target, actual, over }: { target: number | null; actual: number; over: boolean }) {
  const scaleMax = Math.max(target ?? 0, actual, 1) * 1.15;
  const actualPct = Math.min(100, (actual / scaleMax) * 100);
  const targetPct = target !== null ? Math.min(100, (target / scaleMax) * 100) : null;

  return (
    <div className="relative w-full h-3 rounded-full" style={{ background: '#F3F4F6' }}>
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all"
        style={{ width: `${actualPct}%`, background: over ? '#DC2626' : '#2ABFBF' }}
      />
      {targetPct !== null && (
        <div
          className="absolute inset-y-0 w-0.5"
          style={{ left: `${targetPct}%`, background: '#0F2044' }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export default function BudgetVsActualChart({
  variableRows,
  fixedRows,
  hasActivity,
  monthLabel,
  locale,
}: {
  variableRows: BudgetVsActualRow[];
  fixedRows: FixedCommitmentRow[];
  // False when neither bucket has a single real transaction this month —
  // distinct from "no budgets configured," which can be true in an otherwise
  // perfectly normal month with real spend and just no plan set.
  hasActivity: boolean;
  monthLabel: string;
  locale: string;
}) {
  const t = useTranslations('reports.budgetVsActual');
  // Headline sums ONLY variable overages — a fixed bill has no target to be
  // over, by design (see categorySpendHelpers.ts's FIXED vs VARIABLE note).
  const headline = sumOverTarget(variableRows);
  const overCount = variableRows.filter((r) => r.hasTarget && r.overAmount > 0).length;
  const fixedTotal = sumFixedCommitments(fixedRows);

  return (
    <div className="rounded-2xl bg-white p-6 sm:p-8" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="text-xl font-bold mb-1" style={{ color: '#0F2044' }}>{t('title')}</h2>
      <p className="text-sm mb-4" style={{ color: '#6B7280' }}>{t('subtitle')}</p>

      {!hasActivity ? (
        <p className="text-sm text-center py-6" style={{ color: '#6B7280' }}>
          {t('noActivity', { month: monthLabel })}
        </p>
      ) : variableRows.length === 0 && fixedRows.length === 0 ? (
        <p className="text-sm text-center py-6" style={{ color: '#6B7280' }}>{t('empty')}</p>
      ) : (
        <>
          {/* Variable spending — the only place an over/under verdict ever
              appears, compared against what save-plan actually budgeted for
              each category's discretionary portion. */}
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#6B7280' }}>
            {t('variableTitle')}
          </p>
          {variableRows.length === 0 ? (
            <p className="text-sm mb-6" style={{ color: '#6B7280' }}>{t('empty')}</p>
          ) : (
            <>
              <p
                className="text-lg font-semibold mb-6"
                style={{ color: headline > 0 ? '#DC2626' : '#16A34A' }}
              >
                {headline > 0
                  ? t('headlineOver', { amount: formatCurrency(headline, locale), count: overCount })
                  : t('headlineOnTarget')}
              </p>

              <div className="space-y-4 mb-8">
                {variableRows.map((row) => {
                  const statusLabel = !row.hasTarget
                    ? t('noTargetLabel')
                    : row.overAmount > 0
                      ? t('overLabel', { amount: formatCurrency(row.overAmount, locale) })
                      : row.actual === row.target
                        ? t('onTargetLabel')
                        : t('underLabel', { amount: formatCurrency((row.target as number) - row.actual, locale) });

                  return (
                    <div key={row.categoryId}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p
                          className="font-medium truncate min-w-0"
                          style={{ color: '#0F2044' }}
                          title={row.categoryName}
                        >
                          {row.categoryName}
                        </p>
                        <p
                          className="text-sm font-medium shrink-0"
                          style={{ color: !row.hasTarget ? '#6B7280' : row.overAmount > 0 ? '#DC2626' : '#16A34A' }}
                        >
                          {statusLabel}
                        </p>
                      </div>
                      <BulletBar target={row.target} actual={row.actual} over={row.overAmount > 0} />
                      <p className="text-xs mt-1" style={{ color: '#6B7280' }}>
                        {formatCurrency(row.actual, locale)}
                        {row.hasTarget ? ` / ${formatCurrency(row.target as number, locale)}` : ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Fixed commitments — judgment-free by design: no target, no
              over/under, no color coding. A mortgage is not something to be
              over on. Deliberately visually distinct from the section above
              (plain rows, gray text, no bars) so it never reads as a second
              set of bullet bars a family should be scanning for red/green. */}
          {fixedRows.length > 0 && (
            <div className="pt-6" style={{ borderTop: '1px solid #E5E7EB' }}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>
                  {t('fixedTitle')}
                </p>
                <p className="text-sm font-medium" style={{ color: '#0F2044' }}>
                  {formatCurrency(fixedTotal, locale)}
                </p>
              </div>
              <p className="text-xs mb-4" style={{ color: '#9CA3AF' }}>{t('fixedSubtitle')}</p>
              <div className="space-y-2">
                {fixedRows.map((row) => (
                  <div key={row.categoryId} className="flex items-center justify-between gap-2">
                    <p className="truncate min-w-0" style={{ color: '#374151' }} title={row.categoryName}>
                      {row.categoryName}
                    </p>
                    <p className="text-sm shrink-0" style={{ color: '#374151' }}>
                      {formatCurrency(row.actual, locale)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
