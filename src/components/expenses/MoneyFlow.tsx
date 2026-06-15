import { useTranslations } from 'next-intl';
import { Expense, formatCurrency } from './types';

export default function MoneyFlow({
  income,
  totalIncome,
  totalSpent,
  net,
  locale,
}: {
  income: Expense[];
  totalIncome: number;
  totalSpent: number;
  net: number;
  locale: string;
}) {
  const t = useTranslations('expenses.flow');
  const positive = net >= 0;

  return (
    <div className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="rounded-xl p-4" style={{ background: '#F0FDF4' }}>
          <p className="text-sm" style={{ color: '#6B7280' }}>{t('in')}</p>
          <p className="text-xl font-bold" style={{ color: '#16A34A' }}>{formatCurrency(totalIncome, locale)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#FEF2F2' }}>
          <p className="text-sm" style={{ color: '#6B7280' }}>{t('out')}</p>
          <p className="text-xl font-bold" style={{ color: '#DC2626' }}>{formatCurrency(totalSpent, locale)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: positive ? '#F0FDFD' : '#FEF2F2' }}>
          <p className="text-sm" style={{ color: '#6B7280' }}>{t('net')}</p>
          <p className="text-xl font-bold" style={{ color: positive ? '#16A34A' : '#DC2626' }}>
            {formatCurrency(net, locale)}
          </p>
        </div>
      </div>

      {income.length > 0 && (
        <div className="space-y-1">
          {income.map((i) => (
            <div key={i.id} className="flex items-center justify-between py-1.5 text-sm" style={{ borderBottom: '1px solid #F9FAFB' }}>
              <span style={{ color: '#0F2044' }}>{i.description}</span>
              <span className="font-medium" style={{ color: '#16A34A' }}>+{formatCurrency(Number(i.amount), locale)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}