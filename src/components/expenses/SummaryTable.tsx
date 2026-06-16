import { useTranslations } from 'next-intl';
import { SummaryRow, formatCurrency } from './types';

export default function SummaryTable({
  summary,
  totalSpent,
  cardGoal,
  locale,
}: {
  summary: SummaryRow[];
  totalSpent: number;
  cardGoal: number | null;
  locale: string;
}) {
  const t = useTranslations('expenses.summary');
  const withinGoal = cardGoal !== null && totalSpent <= cardGoal;

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: '#0F2044' }}>{t('title')}</h3>

      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
            <th className="text-left py-2 font-semibold" style={{ color: '#0F2044' }}>{t('category')}</th>
            <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('budget')}</th>
            <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('spent')}</th>
            <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('difference')}</th>
            <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((row) => {
            const noBudget = row.budget === 0;
            const over = !noBudget && row.difference < 0;
            const untouched = row.spent === 0;
            return (
              <tr key={row.categoryId} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td className="py-2.5" style={{ color: '#0F2044' }}>{row.name}</td>
                <td className="py-2.5 text-right" style={{ color: '#6B7280' }}>{formatCurrency(row.budget, locale)}</td>
                <td className="py-2.5 text-right font-medium" style={{ color: '#0F2044' }}>{formatCurrency(row.spent, locale)}</td>
                <td className="py-2.5 text-right font-medium" style={{ color: noBudget ? '#9CA3AF' : over ? '#DC2626' : '#16A34A' }}>
                  {noBudget ? '—' : formatCurrency(row.difference, locale)}
                </td>
                <td className="py-2.5 text-right">
                  {untouched || noBudget ? <span style={{ color: '#9CA3AF' }}>—</span>
                    : over ? <span style={{ color: '#DC2626' }}>{t('over')}</span>
                    : <span style={{ color: '#16A34A' }}>✓ {t('ok')}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid #0F2044' }}>
            <td className="py-3 font-bold" style={{ color: '#0F2044' }}>{t('total')}</td>
            <td className="py-3 text-right font-bold" style={{ color: '#0F2044' }}>
              {cardGoal !== null ? formatCurrency(cardGoal, locale) : '—'}
            </td>
            <td className="py-3 text-right font-bold" style={{ color: withinGoal || cardGoal === null ? '#16A34A' : '#DC2626' }}>
              {formatCurrency(totalSpent, locale)}
            </td>
            <td className="py-3 text-right font-bold" style={{ color: withinGoal || cardGoal === null ? '#16A34A' : '#DC2626' }}>
              {cardGoal !== null ? formatCurrency(cardGoal - totalSpent, locale) : '—'}
            </td>
            <td className="py-3 text-right font-bold">
              {cardGoal === null ? '—'
                : withinGoal ? <span style={{ color: '#16A34A' }}>✓ {t('within')}</span>
                : <span style={{ color: '#DC2626' }}>{t('overGoal')}</span>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}