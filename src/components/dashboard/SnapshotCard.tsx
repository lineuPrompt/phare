import { useTranslations } from 'next-intl';
import { DashboardSummary, formatCurrency } from './types';

export default function SnapshotCard({ summary, locale }: { summary: DashboardSummary; locale: string }) {
  const t = useTranslations('dashboard');
  const surplus = summary.netCashFlow >= 0;

  return (
    <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="text-xl font-bold mb-6" style={{ color: '#0F2044' }}>
        {t('snapshot')}
      </h2>
      {/* Three main buckets */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="rounded-xl p-4" style={{ background: '#F0FDFD' }}>
          <p className="text-xs" style={{ color: '#6B7280' }}>{t('income')}</p>
          <p className="text-lg font-bold mt-1" style={{ color: '#16A34A' }}>
            {formatCurrency(summary.totalIncome, locale)}
          </p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#FEF2F2' }}>
          <p className="text-xs" style={{ color: '#6B7280' }}>{t('expenses')}</p>
          <p className="text-lg font-bold mt-1" style={{ color: '#DC2626' }}>
            {formatCurrency(summary.totalExpenses, locale)}
          </p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#F0F9FF' }}>
          <p className="text-xs" style={{ color: '#6B7280' }}>{t('savings')}</p>
          <p className="text-lg font-bold mt-1" style={{ color: '#0284C7' }}>
            {formatCurrency(summary.totalSavings, locale)}
          </p>
        </div>
      </div>
      {/* Net cash flow — remaining after income − expenses − savings */}
      <div
        className="rounded-xl p-4"
        style={{ background: surplus ? '#F0FDF4' : '#FEF2F2' }}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: '#6B7280' }}>
            {surplus ? t('surplus') : t('deficit')}
          </p>
          <p className="text-xl font-bold" style={{ color: surplus ? '#16A34A' : '#DC2626' }}>
            {formatCurrency(summary.netCashFlow, locale)}
          </p>
        </div>
      </div>
    </div>
  );
}
