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

export default function CardGrid({
  grid,
  locale,
}: {
  grid: GridData;
  locale: string;
}) {
  const t = useTranslations('cards.grid');

  if (grid.rows.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
        <h3 className="text-base font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h3>
        <p className="text-sm" style={{ color: '#9CA3AF' }}>
          Set up envelope categories to see your 12-month history.
        </p>
      </div>
    );
  }

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
              {grid.months.map((mo) => (
                <th key={mo} className="text-right py-2 px-2 font-semibold" style={{ color: '#6B7280' }}>
                  {shortMonth(mo, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.categoryId} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td className="py-2 pr-4 font-medium" style={{ color: '#0F2044' }}>{row.name}</td>
                {row.actuals.map((amt, i) => (
                  <td key={i} className="py-2 px-2 text-right" style={{ color: amt > 0 ? '#0F2044' : '#D1D5DB' }}>
                    {amt > 0 ? formatCurrency(amt, locale) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {/* Total spent row */}
            <tr style={{ borderTop: '2px solid #0F2044' }}>
              <td className="py-2.5 pr-4 font-bold text-xs" style={{ color: '#0F2044' }}>{t('total')}</td>
              {grid.totalActuals.map((amt, i) => (
                <td key={i} className="py-2.5 px-2 text-right font-bold" style={{ color: '#0F2044' }}>
                  {formatCurrency(amt, locale)}
                </td>
              ))}
            </tr>
            {/* Goal row (only when any month has a goal) */}
            {grid.totalGoals.some((g) => g !== null) && (
              <tr style={{ borderTop: '1px solid #E5E7EB' }}>
                <td className="py-2 pr-4 text-xs" style={{ color: '#6B7280' }}>{t('goal')}</td>
                {grid.totalGoals.map((g, i) => {
                  const over = g !== null && grid.totalActuals[i] > g;
                  return (
                    <td key={i} className="py-2 px-2 text-right text-xs" style={{ color: g === null ? '#D1D5DB' : over ? '#DC2626' : '#16A34A' }}>
                      {g !== null ? formatCurrency(g, locale) : '—'}
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
