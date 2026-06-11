import { useTranslations } from 'next-intl';
import { SinkingFund, formatCurrency, monthName } from './types';

export default function SinkingFundsCard({ funds, locale }: { funds: SinkingFund[]; locale: string }) {
  const t = useTranslations('dashboard');
  if (!funds.length) return null;

  return (
    <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
        {t('sinkingFunds')}
      </h2>
      <div className="space-y-3">
        {funds.map((fund, i) => (
          <div key={i} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
            <div>
              <p className="font-medium" style={{ color: '#0F2044' }}>{fund.name}</p>
              <p className="text-sm" style={{ color: '#6B7280' }}>
                {monthName(fund.due_month, locale)}{fund.due_month ? ' · ' : ''}{formatCurrency(fund.annual_amount, locale)}{t('perYear')}
              </p>
            </div>
            <p className="font-bold" style={{ color: '#2ABFBF' }}>
              {formatCurrency(fund.monthly_provision, locale)}{t('perMonth')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}