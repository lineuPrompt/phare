import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/components/dashboard/types';
import { BudgetVsActualRow, sumOverTarget } from '@/lib/reportsDisplayHelpers';

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
  rows,
  locale,
}: {
  rows: BudgetVsActualRow[];
  locale: string;
}) {
  const t = useTranslations('reports.budgetVsActual');
  const headline = sumOverTarget(rows);
  const overCount = rows.filter((r) => r.hasTarget && r.overAmount > 0).length;

  return (
    <div className="rounded-2xl bg-white p-6 sm:p-8" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="text-xl font-bold mb-1" style={{ color: '#0F2044' }}>{t('title')}</h2>
      <p className="text-sm mb-4" style={{ color: '#6B7280' }}>{t('subtitle')}</p>

      {rows.length === 0 ? (
        <p className="text-sm text-center py-6" style={{ color: '#6B7280' }}>{t('empty')}</p>
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

          <div className="space-y-4">
            {rows.map((row) => {
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
    </div>
  );
}
